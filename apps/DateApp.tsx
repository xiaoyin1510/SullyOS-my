
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, Message, DateState } from '../types';
import { DatePrompts, ApiMessage } from '../utils/datePrompts';
import { processNewMessages, mergePalaceFragmentsIntoMemories, getMemoryPalaceHighWaterMark } from '../utils/memoryPalace/pipeline';
import type { PipelineResult } from '../utils/memoryPalace/pipeline';
import { incrementDigestRound, runCognitiveDigestion } from '../utils/memoryPalace';
import { getRoomLabel } from '../utils/memoryPalace/types';
import { safeResponseJson } from '../utils/safeApi';
import Modal from '../components/os/Modal';
import DateSession from '../components/date/DateSession';
import DateSettings from '../components/date/DateSettings';
import { BookOpen } from '@phosphor-icons/react';

const DateApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, setActiveCharacterId, apiConfig, addToast, updateCharacter, virtualTime, userProfile, memoryPalaceConfig } = useOS();

    // 记忆宫殿（与聊天侧共用同一套上下文：同 charId、同高水位线）
    // 见面流也需要在 AI 回复后跑一次缓冲区检查 + 自动归档，否则只有"读"没有"写"。
    const [memoryPalaceStatus, setMemoryPalaceStatus] = useState<string>('');
    const [memoryPalaceResult, setMemoryPalaceResult] = useState<PipelineResult | null>(null);
    const memoryPalaceStatusRef = useRef(memoryPalaceStatus);
    memoryPalaceStatusRef.current = memoryPalaceStatus;

    // characters ref：见面 hook 跑完后用户可能已经在 MemoryPalaceApp 里关掉了宫殿，
    // 直接闭包里的 charForHook 是回复开始时捕获的，会读到 stale memoryPalaceEnabled=true。
    const charactersRef = useRef(characters);
    charactersRef.current = characters;
    
    // Modes: 'select' -> 'peek' -> 'session' | 'settings' | 'history'
    const [mode, setMode] = useState<'select' | 'peek' | 'session' | 'settings' | 'history'>('select');
    // Track previous mode for Settings back navigation
    const [previousMode, setPreviousMode] = useState<'select' | 'peek'>('select');
    
    const [peekStatus, setPeekStatus] = useState<string>('');
    const [peekLoading, setPeekLoading] = useState(false);
    
    // History State
    const [historySessions, setHistorySessions] = useState<{date: string, msgs: Message[]}[]>([]);
    // History long-press context menu
    const [historyMenuMsg, setHistoryMenuMsg] = useState<Message | null>(null);
    const [historyMenuPos, setHistoryMenuPos] = useState<{x: number, y: number}>({x: 0, y: 0});
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // History edit modal
    const [historyEditMsg, setHistoryEditMsg] = useState<Message | null>(null);
    const [historyEditContent, setHistoryEditContent] = useState('');
    
    // Resume Logic State
    const [pendingSessionChar, setPendingSessionChar] = useState<CharacterProfile | null>(null);

    // --- NEW: Editing State lifted to here for DB sync ---
    const [dateMessages, setDateMessages] = useState<Message[]>([]);
    const [hasSavedOpening, setHasSavedOpening] = useState(false);

    // Edit Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editTargetMsg, setEditTargetMsg] = useState<Message | null>(null);
    const [editContent, setEditContent] = useState('');

    const char = characters.find(c => c.id === activeCharacterId);

    // --- Data Loading ---
    const loadDateMessages = async () => {
        if (char) {
            // includeProcessed=true：见面记录有自己的 source 维度，
            // 不能被聊天侧的 memoryPalace 高水位静默吃掉
            const msgs = await DB.getMessagesByCharId(char.id, true);
            // 只筛选 source='date' 的消息用于小说模式显示
            const filtered = msgs.filter(m => m.metadata?.source === 'date').sort((a,b) => a.timestamp - b.timestamp);
            setDateMessages(filtered);
            
            // 检查数据库中是否已经包含当前的 peekStatus（通过内容比对），避免重复保存
            if (peekStatus && filtered.some(m => m.content === peekStatus && m.role === 'assistant')) {
                setHasSavedOpening(true);
            }
        }
    };

    useEffect(() => {
        if (char && mode === 'session') {
            loadDateMessages();
        }
    }, [char, mode]);

    // --- Navigation Helpers ---
    const handleBack = () => {
        if (mode === 'peek') {
            setMode('select');
            setPeekStatus('');
        } else if (mode === 'history') {
            setMode('select');
        } else closeApp();
    };

    const formatTime = () => `${virtualTime.hours.toString().padStart(2, '0')}:${virtualTime.minutes.toString().padStart(2, '0')}`;

    // peek / send / reroll 共用的 LLM 调用（提示词构建统一在 utils/datePrompts.ts）
    const callLLM = async (messages: ApiMessage[], temperature: number): Promise<string> => {
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages,
                temperature,
                stream: apiConfig.stream ?? false,
            })
        });
        if (!response.ok) throw new Error('API Error');
        const data = await safeResponseJson(response);
        return data.choices[0].message.content;
    };

    // --- Resume / Start Logic ---
    const handleCharClick = (c: CharacterProfile) => {
        if (c.savedDateState) {
            setPendingSessionChar(c);
        } else {
            startPeek(c);
        }
    };

    const handleResumeSession = () => {
        if (!pendingSessionChar) return;
        setActiveCharacterId(pendingSessionChar.id);
        setMode('session');
        setPendingSessionChar(null);
        addToast('已恢复上次进度', 'success');
    };

    const handleStartNewSession = () => {
        if (!pendingSessionChar) return;
        updateCharacter(pendingSessionChar.id, { savedDateState: undefined });
        startPeek(pendingSessionChar);
        setPendingSessionChar(null);
    };

    // --- 关键修复: 进入 Session 时立即归档开场白 ---
    const handleEnterSession = async () => {
        if (!char) return;

        // 1. 如果有开场白且未保存，立即保存到数据库
        // 这确保了 user 发送第一句话时，AI 能在历史记录里读到这个开场
        // UPDATE: 添加 isOpening 标记，用于区分新会话
        if (peekStatus && !hasSavedOpening) {
            try {
                await DB.saveMessage({
                    charId: char.id,
                    role: 'assistant',
                    type: 'text',
                    content: peekStatus,
                    metadata: { source: 'date', isOpening: true } // Added Flag
                });
                setHasSavedOpening(true);
            } catch (e) {
                console.error("Failed to save opening", e);
            }
        }

        // 2. 切换模式并刷新数据
        setMode('session');
        await loadDateMessages();
    };

    // --- Peek (Generation) Logic ---
    const startPeek = async (c: CharacterProfile) => {
        setActiveCharacterId(c.id);
        setMode('peek');
        setPeekLoading(true);
        setPeekStatus('');
        setHasSavedOpening(false); 

        try {
            const msgs = await DB.getMessagesByCharId(c.id, true);
            const emojis = await DB.getEmojis();
            const { messages } = DatePrompts.buildPeekPayload({
                char: c,
                userProfile,
                allMsgs: msgs,
                emojis,
            });
            const content = await callLLM(messages, apiConfig.temperature ?? 0.85);
            setPeekStatus(content);

        } catch (e: any) {
            setPeekStatus(`(无法感知状态: ${e.message})`);
        } finally {
            setPeekLoading(false);
        }
    };

    // 与聊天侧 useChatAI 完全一致的 Memory Palace 后台流程：
    // 触发缓冲区处理 + 自动归档（如开启） + 50 轮认知消化。
    const runMemoryPalacePostHook = useCallback(async (charForHook: CharacterProfile) => {
        // 用 charactersRef 读最新状态，避免见面流程中用户去 MemoryPalaceApp 关掉宫殿后
        // 这里仍然按 charForHook 闭包里的旧 enabled 触发一次 LLM 总结
        const liveBefore = charactersRef.current.find(c => c.id === charForHook.id) || null;
        if (!liveBefore?.memoryPalaceEnabled) return;
        const mpEmb = memoryPalaceConfig?.embedding;
        const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
        const mpLLM = (mpLLMConfigured?.baseUrl)
            ? mpLLMConfigured
            : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
        if (!mpEmb?.baseUrl || !mpEmb?.apiKey || !mpLLM.baseUrl) return;

        const recentMsgs = await DB.getRecentMessagesByCharId(charForHook.id, 50);
        try {
            const pipelineResult = await processNewMessages(
                recentMsgs,
                charForHook.id,
                charForHook.name,
                mpEmb,
                mpLLM,
                userProfile?.name || '',
                false,
                (stage) => setMemoryPalaceStatus(stage),
            );

            // pipeline 跑的过程中用户可能又关了宫殿，再 check 一次
            const liveAfter = charactersRef.current.find(c => c.id === charForHook.id) || null;
            if (!liveAfter?.memoryPalaceEnabled) return;

            if (pipelineResult && pipelineResult.stored > 0) {
                setMemoryPalaceResult(pipelineResult);
            }

            if ((liveAfter as any).autoArchiveEnabled) {
                try {
                    const patch: any = {};
                    if (pipelineResult?.autoArchive) {
                        patch.memories = mergePalaceFragmentsIntoMemories(
                            liveAfter.memories || [],
                            pipelineResult.autoArchive.fragments,
                        );
                    }
                    // 隐藏线追平到向量高水位：覆盖「关闭期推进了 hwm 但 hide 被冻结」的历史空档。
                    // 只要全自动记忆开着，每次自动总结都把 hide 追平到 hwm，无需用户手动操作。
                    const hwm = getMemoryPalaceHighWaterMark(charForHook.id);
                    const curHide = ((liveAfter as any).hideBeforeMessageId as number) || 0;
                    if (hwm > curHide) {
                        patch.hideBeforeMessageId = hwm;
                    }
                    if (Object.keys(patch).length > 0) {
                        updateCharacter(charForHook.id, patch);
                    }
                } catch (e: any) {
                    console.warn(`📚 [DateApp AutoArchive] 失败: ${e?.message || e}`);
                }
            }

            // 50 轮自动认知消化（与聊天侧共享计数器，按 charId 持久化）
            const shouldAutoDigest = incrementDigestRound(charForHook.id);
            if (shouldAutoDigest) {
                setMemoryPalaceStatus(`${charForHook.name}闭上眼睛，开始整理内心…`);
                const persona = [liveAfter.systemPrompt || '', liveAfter.worldview || ''].filter(Boolean).join('\n');
                await runCognitiveDigestion(charForHook.id, charForHook.name, persona, mpLLM, false, userProfile?.name, mpEmb);
            }
        } catch (e: any) {
            console.error('❌ [DateApp MemoryPalace] 后台处理异常:', e?.message || e);
            addToast('记忆整理失败', 'error');
        } finally {
            const current = memoryPalaceStatusRef.current;
            if (current && current.includes('完成')) {
                addToast(current, 'success');
            }
            setMemoryPalaceStatus('');
        }
    }, [memoryPalaceConfig, apiConfig, userProfile?.name, updateCharacter, addToast]);

    // --- Session API Logic ---
    const handleSendMessage = async (text: string): Promise<string> => {
        if (!char) throw new Error("No char");

        // 重发场景：如果 DB 里最后一条已经是这条 user 消息（上一轮发送后 API 失败 / 网络抖动等），
        // 就跳过重复落库，直接走 API。与 chat app 行为对齐，让用户按发送键即可重新触发 LLM。
        const recentCheck = await DB.getRecentMessagesByCharId(char.id, 1, true);
        const isRetry = recentCheck.length > 0
            && recentCheck[0].role === 'user'
            && recentCheck[0].content === text
            && recentCheck[0].metadata?.source === 'date';

        if (!isRetry) {
            // 1. Save User Msg
            await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: text, metadata: { source: 'date' } });
        }
        
        // 2. Prepare Context
        // Re-fetch messages. Since we saved the opening in handleEnterSession,
        // 'allMsgs' will now correctly contain: [History..., Opening, UserMsg]
        const allMsgs = await DB.getMessagesByCharId(char.id, true);
        
        // Update local state for display
        const dateFiltered = allMsgs.filter(m => m.metadata?.source === 'date').sort((a,b) => a.timestamp - b.timestamp);
        setDateMessages(dateFiltered);

        const emojis = await DB.getEmojis();
        const { messages } = await DatePrompts.buildSessionPayload({
            char,
            userProfile,
            allMsgs,
            emojis,
            userText: text,
            variant: 'send',
        });
        const content = await callLLM(messages, apiConfig.temperature ?? 0.85);

        // 3. Save AI Response
        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: content, metadata: { source: 'date' } });

        // Refresh local state
        const freshMsgs = await DB.getMessagesByCharId(char.id, true);
        setDateMessages(freshMsgs.filter(m => m.metadata?.source === 'date').sort((a,b) => a.timestamp - b.timestamp));

        // Memory Palace 后台流程（不阻塞返回，与聊天侧一致）
        runMemoryPalacePostHook(char);

        return content;
    };

    const handleReroll = async (): Promise<string> => {
        if (!char || dateMessages.length === 0) throw new Error("No context");
        
        const lastMsg = dateMessages[dateMessages.length - 1];
        if (lastMsg.role !== 'assistant') throw new Error("Cannot reroll user message");

        // 1. Delete last AI message
        await DB.deleteMessage(lastMsg.id);
        
        // 2. Find the user input that triggered it
        const allMsgs = await DB.getMessagesByCharId(char.id, true);
        const validMsgs = allMsgs.filter(m => m.id !== lastMsg.id);
        const lastUserMsg = validMsgs[validMsgs.length - 1];
        
        if (!lastUserMsg || lastUserMsg.role !== 'user') throw new Error("Context lost");

        // 3. Call API logic（与 handleSendMessage 共用 buildSessionPayload，只差 variant）
        const emojis = await DB.getEmojis();
        const { messages } = await DatePrompts.buildSessionPayload({
            char,
            userProfile,
            allMsgs: validMsgs,
            emojis,
            userText: lastUserMsg.content,
            variant: 'reroll',
        });
        // Reroll 略调高温度求多样性，但绝不低于用户配置的基线。
        const content = await callLLM(messages, Math.max(apiConfig.temperature ?? 0.85, 0.9));

        await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: content, metadata: { source: 'date' } });

        // Sync
        const freshMsgs = await DB.getMessagesByCharId(char.id, true);
        setDateMessages(freshMsgs.filter(m => m.metadata?.source === 'date').sort((a,b) => a.timestamp - b.timestamp));

        // Memory Palace 后台流程（Reroll 也算一轮新输出）
        runMemoryPalacePostHook(char);

        return content;
    };

    // --- Editing & Deletion ---
    const handleDeleteMessage = async (msg: Message) => {
        await DB.deleteMessage(msg.id);
        setDateMessages(prev => prev.filter(m => m.id !== msg.id));
    };

    const handleDeleteMessages = async (ids: number[]) => {
        if (ids.length === 0) return;
        await Promise.all(ids.map(id => DB.deleteMessage(id)));
        setDateMessages(prev => prev.filter(m => !ids.includes(m.id)));
        addToast(`已删除 ${ids.length} 条记录`, 'success');
    };

    const confirmEditMessage = async () => {
        if (!editTargetMsg) return;
        await DB.updateMessage(editTargetMsg.id, editContent);
        setDateMessages(prev => prev.map(m => m.id === editTargetMsg.id ? { ...m, content: editContent } : m));
        setIsEditModalOpen(false);
        setEditTargetMsg(null);
        addToast('已修改', 'success');
    };

    // --- History Long Press ---
    const handleHistoryLongPressStart = useCallback((msg: Message, e: React.TouchEvent | React.MouseEvent) => {
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        longPressTimer.current = setTimeout(() => {
            setHistoryMenuMsg(msg);
            setHistoryMenuPos({ x: clientX, y: clientY });
        }, 500);
    }, []);

    const handleHistoryLongPressEnd = useCallback(() => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    }, []);

    const handleHistoryDelete = async (msg: Message) => {
        await DB.deleteMessage(msg.id);
        setHistorySessions(prev => prev.map(s => ({
            ...s,
            msgs: s.msgs.filter(m => m.id !== msg.id)
        })).filter(s => s.msgs.length > 0));
        setHistoryMenuMsg(null);
        addToast('已删除', 'success');
    };

    const handleHistoryEditOpen = (msg: Message) => {
        setHistoryEditMsg(msg);
        setHistoryEditContent(msg.content);
        setHistoryMenuMsg(null);
    };

    const handleHistoryEditConfirm = async () => {
        if (!historyEditMsg) return;
        await DB.updateMessage(historyEditMsg.id, historyEditContent);
        setHistorySessions(prev => prev.map(s => ({
            ...s,
            msgs: s.msgs.map(m => m.id === historyEditMsg.id ? { ...m, content: historyEditContent } : m)
        })));
        setHistoryEditMsg(null);
        addToast('已修改', 'success');
    };

    const onExitSession = (finalState: DateState) => {
        if (char) {
            updateCharacter(char.id, { savedDateState: finalState });
            addToast('进度已保存', 'success');
        }
        setMode('select');
        setPeekStatus('');
        setHasSavedOpening(false);
    };

    const openHistory = async (c: CharacterProfile) => {
        setActiveCharacterId(c.id);
        // includeProcessed=true：见面历史完全独立于聊天侧高水位，
        // 否则用户开了向量记忆后老的见面记录会全部"消失"
        const msgs = await DB.getMessagesByCharId(c.id, true);
        // dateMsgs sorted DESCENDING (newest first)
        const dateMsgs = msgs.filter(m => m.metadata?.source === 'date').sort((a, b) => b.timestamp - a.timestamp);
        
        const sessions: {date: string, msgs: Message[]}[] = [];
        if (dateMsgs.length > 0) {
            // Group by strict time gap (30 mins) OR explicit Opening flag
            let currentSession: Message[] = [dateMsgs[0]];
            
            for (let i = 1; i < dateMsgs.length; i++) {
                const prev = dateMsgs[i-1]; // Newer message
                const curr = dateMsgs[i];   // Older message
                
                // Break session if:
                // 1. Time gap > 30 minutes
                // 2. OR THE PREVIOUS (Newer) message was an opening. 
                //    (If 'prev' is an opening, it means 'prev' is the START of the newer session we just accumulated. 
                //     So 'curr' must belong to an older, different session.)
                const isTimeBreak = Math.abs(prev.timestamp - curr.timestamp) > 30 * 60 * 1000;
                const splitSincePrevWasOpening = prev.metadata?.isOpening === true;

                if (isTimeBreak || splitSincePrevWasOpening) {
                    // This session ends. 
                    // Date label is the Start Time of this session (which is the oldest msg in currentSession)
                    const sessionStartMsg = currentSession[currentSession.length - 1];
                    sessions.push({ 
                        date: new Date(sessionStartMsg.timestamp).toLocaleString(), 
                        msgs: currentSession.reverse() // Reverse messages to be Chronological (Old->New) inside the bubble
                    });
                    currentSession = [curr];
                } else {
                    currentSession.push(curr);
                }
            }
            // Push final session
            const sessionStartMsg = currentSession[currentSession.length - 1];
            sessions.push({ 
                date: new Date(sessionStartMsg.timestamp).toLocaleString(), 
                msgs: currentSession.reverse() 
            });
        }
        // Do NOT reverse sessions array. We want [NewestSession, OlderSession, OldestSession].
        // Default loop populated them New -> Old.
        setHistorySessions(sessions);
        setMode('history');
    };

    // --- Render ---

    if (mode === 'select' || !char) {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-light">
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 bg-white sticky top-0 z-10">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-slate-100">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-slate-700">选择见面对象</span>
                    <div className="w-8"></div>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4 overflow-y-auto">
                    {characters.map(c => (
                        <div key={c.id} onClick={() => handleCharClick(c)} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 active:scale-95 transition-transform flex flex-col items-center gap-3 relative group">
                            <button 
                                onClick={(e) => { e.stopPropagation(); openHistory(c); }}
                                className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors z-20 active:scale-90"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg>
                            </button>
                            <img src={c.avatar} className="w-16 h-16 rounded-full object-cover" />
                            <span className="font-bold text-slate-700">{c.name}</span>
                            {c.savedDateState && <div className="absolute top-2 left-2 w-2 h-2 bg-green-500 rounded-full animate-pulse" title="有存档"></div>}
                        </div>
                    ))}
                </div>
                <Modal isOpen={!!pendingSessionChar} title="发现进度" onClose={() => setPendingSessionChar(null)} footer={<div className="flex gap-3 w-full"><button onClick={handleStartNewSession} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">新的见面</button><button onClick={handleResumeSession} className="flex-1 py-3 bg-green-500 text-white rounded-2xl font-bold shadow-lg shadow-green-200">继续上次</button></div>}>
                    <div className="text-center text-slate-500 text-sm py-4">检测到 {pendingSessionChar?.name} 有未结束的见面。<br/><span className="text-xs text-slate-400 mt-2 block">(存档时间: {pendingSessionChar?.savedDateState?.timestamp ? new Date(pendingSessionChar.savedDateState.timestamp).toLocaleString() : 'Unknown'})</span></div>
                </Modal>
            </div>
        );
    }

    if (mode === 'history') {
        return (
            <div className="h-full w-full bg-slate-50 flex flex-col font-light" onClick={() => historyMenuMsg && setHistoryMenuMsg(null)}>
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 bg-white sticky top-0 z-10">
                    <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-slate-100"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg></button>
                    <span className="font-bold text-slate-700">见面记录</span>
                    <div className="w-8"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20">
                    {historySessions.length === 0 ? <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2"><BookOpen size={48} className="opacity-50" /><span className="text-xs">暂无见面记录</span></div> : historySessions.map((session, idx) => (
                        <div key={idx} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex justify-between items-center"><span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{session.date}</span><span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{session.msgs.length} 句</span></div>
                            <div className="p-4 space-y-4">
                                {session.msgs.map(m => {
                                    const text = (m.content || '').replace(/\[.*?\]/g, '').trim();
                                    return (
                                        <div
                                            key={m.id}
                                            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} select-none`}
                                            onTouchStart={(e) => handleHistoryLongPressStart(m, e)}
                                            onTouchEnd={handleHistoryLongPressEnd}
                                            onTouchMove={handleHistoryLongPressEnd}
                                            onMouseDown={(e) => handleHistoryLongPressStart(m, e)}
                                            onMouseUp={handleHistoryLongPressEnd}
                                            onMouseLeave={handleHistoryLongPressEnd}
                                            onContextMenu={(e) => { e.preventDefault(); setHistoryMenuMsg(m); setHistoryMenuPos({ x: e.clientX, y: e.clientY }); }}
                                        >
                                            <div className={`max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'text-slate-500 text-right italic' : 'text-slate-800'}`}>
                                                {m.role === 'user' ? <span className="bg-slate-100 px-3 py-2 rounded-xl rounded-tr-none inline-block">{text}</span> : <span>{text || '(无内容)'}</span>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Long-press context menu */}
                {historyMenuMsg && (
                    <div
                        className="fixed z-50 bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden animate-fade-in"
                        style={{ top: Math.min(historyMenuPos.y, window.innerHeight - 120), left: Math.min(historyMenuPos.x, window.innerWidth - 140) }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => handleHistoryEditOpen(historyMenuMsg)}
                            className="w-full px-5 py-3 text-sm text-left text-slate-700 hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                            编辑
                        </button>
                        <div className="border-t border-slate-100" />
                        <button
                            onClick={() => handleHistoryDelete(historyMenuMsg)}
                            className="w-full px-5 py-3 text-sm text-left text-red-500 hover:bg-red-50 active:bg-red-100 flex items-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                            删除
                        </button>
                    </div>
                )}

                {/* History edit modal */}
                <Modal isOpen={!!historyEditMsg} title="编辑消息" onClose={() => setHistoryEditMsg(null)} footer={
                    <div className="flex gap-3 w-full">
                        <button onClick={() => setHistoryEditMsg(null)} className="flex-1 py-3 bg-slate-100 rounded-2xl text-slate-600 font-bold">取消</button>
                        <button onClick={handleHistoryEditConfirm} className="flex-1 py-3 bg-blue-500 text-white rounded-2xl font-bold shadow-lg shadow-blue-200">保存</button>
                    </div>
                }>
                    <textarea
                        value={historyEditContent}
                        onChange={(e) => setHistoryEditContent(e.target.value)}
                        className="w-full h-48 p-3 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                </Modal>
            </div>
        );
    }

    if (mode === 'peek') {
        return (
            <div className="h-full w-full bg-black relative flex flex-col font-sans overflow-hidden">
                <div className="pt-24 flex flex-col items-center z-10 shrink-0">
                     <div className="text-xs font-mono text-neutral-500 mb-2 tracking-[0.2em] font-medium">{virtualTime.day.toUpperCase()} {formatTime()}</div>
                     <h2 className="text-4xl font-light text-white tracking-[0.3em] uppercase">{char.name}</h2>
                </div>
                {peekLoading && (
                    <div className="flex-1 flex flex-col items-center justify-center -mt-20 z-10"><div className="w-12 h-[1px] bg-neutral-800 mb-12"></div><div className="w-[1px] h-12 bg-gradient-to-b from-transparent via-white to-transparent animate-pulse mb-6"></div><p className="text-sm font-light text-neutral-500 italic tracking-widest">正在感知...</p></div>
                )}
                {!peekLoading && peekStatus && (
                    <div className="flex-1 min-h-0 flex flex-col px-8 pb-10 z-10 animate-fade-in">
                        <div className="flex-1 overflow-y-auto no-scrollbar mb-8 mask-image-gradient pt-8"><div className="min-h-full flex flex-col justify-center"><p className="text-neutral-300 text-[15px] leading-8 tracking-wide text-justify font-light select-none whitespace-pre-wrap">{peekStatus}</p></div></div>
                        <div className="shrink-0 flex flex-col items-center gap-6">
                             <div className="w-full flex gap-3">
                                 {/* 修改这里：调用 handleEnterSession 确保开场白被保存 */}
                                 <button onClick={handleEnterSession} className="flex-1 h-14 bg-white text-black rounded-full font-bold tracking-[0.1em] text-sm shadow-[0_0_20px_rgba(255,255,255,0.1)] active:scale-95 transition-transform hover:bg-neutral-200">走过去 (Approach)</button>
                                 <button onClick={() => startPeek(char)} className="w-14 h-14 bg-neutral-800 text-white rounded-full flex items-center justify-center border border-neutral-700 shadow-lg active:scale-90 transition-transform"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg></button>
                             </div>
                             <div className="flex flex-col items-center gap-3 text-[10px] text-neutral-600 font-medium tracking-wider"><button onClick={() => { setPreviousMode('peek'); setMode('settings'); }} className="hover:text-neutral-400 transition-colors">布置场景 / 设定立绘</button><button onClick={handleBack} className="hover:text-neutral-400 transition-colors">悄悄离开</button></div>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (mode === 'settings') {
        return <DateSettings char={char} onBack={() => setMode(previousMode)} />;
    }

    if (mode === 'session') {
        return (
            <>
                <DateSession
                    char={char}
                    userProfile={userProfile}
                    messages={dateMessages}
                    peekStatus={peekStatus}
                    initialState={char.savedDateState}
                    onSendMessage={handleSendMessage}
                    onReroll={handleReroll}
                    onExit={onExitSession}
                    onEditMessage={(msg) => { setEditTargetMsg(msg); setEditContent(msg.content); setIsEditModalOpen(true); }}
                    onDeleteMessage={handleDeleteMessage}
                    onDeleteMessages={handleDeleteMessages}
                    onSettings={() => {}} // Removed parent state change, DateSession handles it internally now
                />

                {/* 记忆整理中 — 顶部浮动胶囊（与聊天侧外观一致） */}
                {memoryPalaceStatus && (
                    <div
                        className="absolute top-[76px] left-1/2 z-[150] animate-fade-in"
                        style={{ transform: 'translateX(-50%)', pointerEvents: 'none', willChange: 'transform, opacity' }}
                    >
                        <div
                            className="flex items-center gap-2.5 pl-2.5 pr-3.5 py-2 max-w-[18rem]"
                            style={{
                                background: 'rgba(255,255,255,0.88)',
                                borderRadius: 999,
                                border: '1px solid rgba(99,102,241,0.18)',
                                boxShadow: '0 6px 18px -6px rgba(15,23,42,0.22)',
                            }}
                        >
                            <span
                                className="shrink-0 inline-block w-3.5 h-3.5 rounded-full border-2 border-slate-200 animate-spin"
                                style={{ borderTopColor: '#6366f1', animationDuration: '0.9s' }}
                            />
                            <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">
                                {char.name}正在沉思
                            </span>
                            <span className="text-[10px] text-slate-400 truncate">{memoryPalaceStatus}</span>
                        </div>
                    </div>
                )}

                {/* 记忆整理结果 — 弹窗 */}
                {memoryPalaceResult && (
                    <div
                        className="absolute inset-0 z-[200] flex items-center justify-center p-4 animate-fade-in"
                        style={{ pointerEvents: 'all', background: 'rgba(15,23,42,0.55)' }}
                        onClick={() => setMemoryPalaceResult(null)}
                    >
                        <div
                            className="w-full max-w-sm max-h-[82vh] overflow-hidden flex flex-col relative"
                            style={{
                                background: 'linear-gradient(160deg, #ffffff 0%, #f8fafc 100%)',
                                borderRadius: 28,
                                border: '1px solid rgba(148,163,184,0.18)',
                                boxShadow: '0 20px 50px -20px rgba(15,23,42,0.35)',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div
                                className="absolute top-0 left-0 right-0 h-[2px] pointer-events-none"
                                style={{ background: 'linear-gradient(90deg, transparent, #6366f1, #a5b4fc, #6366f1, transparent)' }}
                            />
                            <div className="px-6 pt-7 pb-4 text-center">
                                <div
                                    className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-3"
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(129,140,248,0.06))',
                                        border: '1px solid rgba(99,102,241,0.15)',
                                    }}
                                >
                                    <span style={{ fontSize: 26 }}>🗂️</span>
                                </div>
                                <div className="text-[10px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#6366f1' }}>Memory Palace</div>
                                <p className="text-[17px] font-bold mt-1" style={{ color: '#0f172a' }}>记忆整理完成</p>
                                <p className="text-[11px] text-slate-400 mt-1">
                                    新增 {memoryPalaceResult.stored} 条 · 去重跳过 {memoryPalaceResult.skipped} 条
                                    {memoryPalaceResult.batches.length > 1 && ` · ${memoryPalaceResult.batches.length} 批`}
                                </p>
                                {memoryPalaceResult.batches.some(b => !b.ok) && (
                                    <p className="text-[10px] text-red-500 mt-1">
                                        {memoryPalaceResult.batches.filter(b => !b.ok).map(b => `batch ${b.index} 失败`).join(', ')}
                                    </p>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2 no-scrollbar">
                                {memoryPalaceResult.memories.map((m, i) => {
                                    const roomMeta: Record<string, { label: string; color: string }> = {
                                        living_room: { label: '客厅', color: '#f59e0b' },
                                        bedroom: { label: '卧室', color: '#8b5cf6' },
                                        study: { label: '书房', color: '#0ea5e9' },
                                        user_room: { label: '用户房间', color: '#ec4899' },
                                        self_room: { label: '自我房间', color: '#10b981' },
                                        attic: { label: '阁楼', color: '#6366f1' },
                                        windowsill: { label: '窗台', color: '#14b8a6' },
                                    };
                                    const meta = roomMeta[m.room] || { label: m.room, color: '#64748b' };
                                    const roomLabel = getRoomLabel(m.room as any, userProfile?.name) || meta.label;
                                    return (
                                        <div
                                            key={i}
                                            className="p-3 rounded-2xl"
                                            style={{
                                                background: 'rgba(255,255,255,0.75)',
                                                border: `1px solid ${meta.color}22`,
                                                boxShadow: `0 2px 8px ${meta.color}14, inset 0 1px 0 rgba(255,255,255,0.8)`,
                                            }}
                                        >
                                            <div className="flex items-center gap-2 mb-1.5">
                                                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                                                    style={{ background: `${meta.color}18`, color: meta.color }}
                                                >
                                                    {roomLabel}
                                                </span>
                                                <span className="text-[10px] text-slate-400">{m.mood}</span>
                                                <span className="text-[10px] font-bold ml-auto" style={{ color: '#f59e0b' }}>{'★'.repeat(Math.min(m.importance, 5))}</span>
                                            </div>
                                            <p className="text-[12px] text-slate-700 leading-relaxed">{m.content}</p>
                                            {m.tags.length > 0 && (
                                                <div className="flex gap-1 mt-2 flex-wrap">
                                                    {m.tags.map((t, j) => (
                                                        <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full"
                                                            style={{ background: 'rgba(148,163,184,0.15)', color: '#64748b' }}
                                                        >{t}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {memoryPalaceResult.memories.length === 0 && (
                                    <p className="text-center text-xs text-slate-400 py-4">本次未提取到新记忆</p>
                                )}
                            </div>
                            <div className="px-6 pb-6 pt-2">
                                <button
                                    onClick={() => setMemoryPalaceResult(null)}
                                    className="w-full py-3 text-white text-[13px] font-bold rounded-2xl active:scale-[0.98] transition-transform"
                                    style={{
                                        background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                        boxShadow: '0 6px 18px -6px rgba(79,70,229,0.5)',
                                    }}
                                >
                                    确认
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Global Message Edit Modal for Session Mode */}
                <Modal isOpen={isEditModalOpen} title="编辑内容" onClose={() => setIsEditModalOpen(false)} footer={<><button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-3 bg-slate-100 rounded-2xl">取消</button><button onClick={confirmEditMessage} className="flex-1 py-3 bg-primary text-white font-bold rounded-2xl">保存</button></>}>
                    <textarea value={editContent} onChange={e => setEditContent(e.target.value)} className="w-full h-32 bg-slate-100 rounded-2xl p-4 resize-none focus:ring-1 focus:ring-primary/20 transition-all text-sm leading-relaxed" />
                </Modal>
            </>
        );
    }

    return null;
};

export default DateApp;
