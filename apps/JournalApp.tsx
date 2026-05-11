
import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, DiaryEntry, StickerData, MemoryFragment, DiaryPage } from '../types';
import { ContextBuilder } from '../utils/context';
import { processImage } from '../utils/file';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { Sparkle } from '@phosphor-icons/react';

const TWEMOJI_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72';
const twemojiUrl = (codepoint: string) => `${TWEMOJI_BASE}/${codepoint}.png`;

// --- Assets & Constants ---

const PAPER_STYLES = [
    { id: 'plain', name: '白纸', css: 'bg-white', text: 'text-slate-700' },
    { id: 'grid', name: '网格', css: 'bg-white', text: 'text-slate-700', style: { backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'dot', name: '点阵', css: 'bg-[#fffdf5]', text: 'text-slate-700', style: { backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', backgroundSize: '20px 20px' } },
    { id: 'lined', name: '横线', css: 'bg-[#fefce8]', text: 'text-slate-700', style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 23px, #e5e7eb 23px, #e5e7eb 24px)' } },
    { id: 'dark', name: '夜空', css: 'bg-slate-800', text: 'text-white/90' },
    { id: 'pink', name: '少女', css: 'bg-pink-50', text: 'text-slate-700', style: { backgroundImage: 'radial-gradient(#fbcfe8 2px, transparent 2px)', backgroundSize: '30px 30px' } },
];

const DEFAULT_STICKERS = [
    twemojiUrl('2728'), twemojiUrl('1f496'), twemojiUrl('1f338'), twemojiUrl('1f380'), twemojiUrl('1f370'),
    twemojiUrl('1f431'), twemojiUrl('1f436'), twemojiUrl('2601-fe0f'), twemojiUrl('1f319'), twemojiUrl('2b50'),
    twemojiUrl('1f3b5'), twemojiUrl('1f33f'), twemojiUrl('1f353'), twemojiUrl('1f9f8'), twemojiUrl('1f388'),
    twemojiUrl('1f48c'), twemojiUrl('1f4a4'), twemojiUrl('1f97a'), twemojiUrl('1f621'), twemojiUrl('1f62d'),
];

// HELPER: Get local date string YYYY-MM-DD
const getLocalDateStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const JournalApp: React.FC = () => {
    const { closeApp, characters, activeCharacterId, apiConfig, addToast, userProfile, updateCharacter } = useOS();
    
    const [mode, setMode] = useState<'select' | 'calendar' | 'write'>('select');
    const [selectedChar, setSelectedChar] = useState<CharacterProfile | null>(null);
    const [diaries, setDiaries] = useState<DiaryEntry[]>([]);
    const [currentEntry, setCurrentEntry] = useState<DiaryEntry | null>(null);
    const [selectedDate, setSelectedDate] = useState<string>(getLocalDateStr());
    
    // Editor State
    const [isThinking, setIsThinking] = useState(false);
    const [isArchiving, setIsArchiving] = useState(false); // New: Archiving state
    const [showStickerPanel, setShowStickerPanel] = useState(false);
    const [activeTab, setActiveTab] = useState<'user' | 'char'>('user'); // View Tab
    const [hideCharStickers, setHideCharStickers] = useState(false); // Toggle to hide char stickers
    
    // Sticker Interaction State
    const [draggingSticker, setDraggingSticker] = useState<string | null>(null);
    const [selectedStickerId, setSelectedStickerId] = useState<string | null>(null); // For resizing/deleting
    const [resizingSticker, setResizingSticker] = useState<string | null>(null);
    const paperRef = useRef<HTMLDivElement>(null);
    
    // Custom Stickers State (Separate from Chat Emojis)
    const [customStickers, setCustomStickers] = useState<{name: string, url: string}[]>([]);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [deletingSticker, setDeletingSticker] = useState<{name: string, url: string} | null>(null);
    const [deletingDiary, setDeletingDiary] = useState<DiaryEntry | null>(null);
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Data Loading ---

    useEffect(() => {
        if (characters.length > 0 && activeCharacterId) {
            const initial = characters.find(c => c.id === activeCharacterId);
            if (initial) {
                setSelectedChar(initial);
                setMode('calendar');
                loadDiaries(initial.id);
            }
        }
        // Load custom stickers from new journal store
        DB.getJournalStickers().then(setCustomStickers);
    }, [activeCharacterId]);

    const loadDiaries = async (charId: string) => {
        const list = await DB.getDiariesByCharId(charId);
        setDiaries(list.sort((a, b) => b.date.localeCompare(a.date)));
    };

    const handleCharSelect = (char: CharacterProfile) => {
        setSelectedChar(char);
        setMode('calendar');
        loadDiaries(char.id);
    };

    const openEntry = (date: string) => {
        const existing = diaries.find(d => d.date === date);
        if (existing) {
            setCurrentEntry(existing);
            // Default to char tab if they replied
            setActiveTab(existing.charPage ? 'char' : 'user');
        } else {
            // New Entry
            setCurrentEntry({
                id: `diary-${Date.now()}`,
                charId: selectedChar!.id,
                date: date,
                userPage: { text: '', paperStyle: 'grid', stickers: [] },
                timestamp: Date.now(),
                isArchived: false
            });
            setActiveTab('user');
        }
        setMode('write');
        setSelectedDate(date);
        setSelectedStickerId(null); // Reset selection
    };

    // --- Editor Logic ---

    const updatePage = (updates: Partial<DiaryEntry['userPage']>, side: 'user' | 'char' = 'user') => {
        if (!currentEntry) return;
        const targetPage = side === 'user' ? 'userPage' : 'charPage';
        
        // If char page doesn't exist yet, init it
        let pageData = currentEntry[targetPage] || { text: '', paperStyle: 'plain', stickers: [] };
        
        setCurrentEntry(prev => {
            if (!prev) return null;
            return {
                ...prev,
                [targetPage]: { ...pageData, ...updates }
            };
        });
    };

    const addSticker = (url: string) => {
        const side = activeTab;
        const targetPage = side === 'user' ? currentEntry?.userPage : currentEntry?.charPage;
        if (!targetPage && side === 'char') return;

        const newSticker: StickerData = {
            id: `st-${Date.now()}-${Math.random()}`,
            url,
            x: 50,
            y: 50,
            rotation: (Math.random() - 0.5) * 40,
            scale: 1.0 // Default scale
        };
        
        const currentStickers = targetPage?.stickers || [];
        updatePage({ stickers: [...currentStickers, newSticker] }, side);
        setShowStickerPanel(false);
    };

    const handleImportStickers = async () => {
        if (!importText.trim()) return;
        const lines = importText.split('\n');
        let count = 0;
        for (const line of lines) {
            const parts = line.split('--');
            if (parts.length >= 2) {
                const name = parts[0].trim();
                const url = parts.slice(1).join('--').trim();
                if (name && url) {
                    await DB.saveJournalSticker(name, url); // Changed Store
                    count++;
                }
            }
        }
        setCustomStickers(await DB.getJournalStickers()); // Changed Store
        setImportText('');
        setShowImportModal(false);
        addToast(`成功添加 ${count} 个贴纸`, 'success');
    };

    const handleDeleteStickerAsset = async () => {
        if (deletingSticker) {
            await DB.deleteJournalSticker(deletingSticker.name); // Changed Store
            setCustomStickers(prev => prev.filter(s => s.name !== deletingSticker.name));
            setDeletingSticker(null);
            addToast('贴纸已删除', 'success');
        }
    };

    const saveEntry = async () => {
        if (!currentEntry) return;
        await DB.saveDiary(currentEntry);
        await loadDiaries(currentEntry.charId);
        addToast('日记已保存', 'success');
    };

    const handleDeleteDiary = async () => {
        if (!deletingDiary || !selectedChar) return;
        await DB.deleteDiary(deletingDiary.id);
        await loadDiaries(selectedChar.id);
        setDeletingDiary(null);
        addToast('日记已删除', 'success');
    };

    // --- Interaction Logic (Move, Resize, Delete) ---

    // 1. Selection
    const selectSticker = (e: React.MouseEvent | React.TouchEvent, id: string) => {
        e.stopPropagation();
        setSelectedStickerId(id);
    };

    // 2. Remove Sticker from Page
    const removeStickerFromPage = (id: string) => {
        const targetPage = activeTab === 'user' ? currentEntry?.userPage : currentEntry?.charPage;
        if (!targetPage) return;
        const updated = targetPage.stickers.filter(s => s.id !== id);
        updatePage({ stickers: updated }, activeTab);
        setSelectedStickerId(null);
    };

    // 3. Pointer Handlers (Move & Resize)
    const handlePointerDown = (e: React.PointerEvent, stickerId: string, action: 'move' | 'resize') => {
        // Allow editing on char page too now
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        
        if (action === 'move') {
            setDraggingSticker(stickerId);
            setSelectedStickerId(stickerId); // Select on drag start
        } else {
            setResizingSticker(stickerId);
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if ((!draggingSticker && !resizingSticker) || !paperRef.current || !currentEntry) return;

        const rect = paperRef.current.getBoundingClientRect();
        
        const targetPage = activeTab === 'user' ? currentEntry.userPage : currentEntry.charPage;
        if (!targetPage) return;

        // Logic for Moving
        if (draggingSticker) {
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            const clampedX = Math.max(0, Math.min(100, x));
            const clampedY = Math.max(0, Math.min(100, y));

            const updatedStickers = targetPage.stickers.map(s => 
                s.id === draggingSticker ? { ...s, x: clampedX, y: clampedY } : s
            );
            updatePage({ stickers: updatedStickers }, activeTab);
        }

        // Logic for Resizing
        if (resizingSticker) {
            const sticker = targetPage.stickers.find(s => s.id === resizingSticker);
            if (!sticker) return;

            // Simple scale logic based on distance from center of sticker (simulated by pointer position relative to paper)
            const dx = (e.clientX - rect.left) - (sticker.x / 100 * rect.width);
            const dy = (e.clientY - rect.top) - (sticker.y / 100 * rect.height);
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Assume 50px is scale 1
            const newScale = Math.max(0.2, Math.min(3.0, dist / 40));
            
            const updatedStickers = targetPage.stickers.map(s => 
                s.id === resizingSticker ? { ...s, scale: newScale } : s
            );
            updatePage({ stickers: updatedStickers }, activeTab);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        setDraggingSticker(null);
        setResizingSticker(null);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleBackgroundClick = () => {
        setSelectedStickerId(null); // Deselect when clicking background
    };

    // Long press handler for drawer items
    const handleDrawerTouchStart = (s: {name: string, url: string}) => {
        longPressTimer.current = setTimeout(() => {
            setDeletingSticker(s);
        }, 600);
    };

    const handleDrawerTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = null;
        }
    };

    // --- AI Interaction ---

    const handleExchange = async () => {
        if (!currentEntry || !selectedChar || !apiConfig.apiKey) {
            addToast('配置错误或内容为空', 'error');
            return;
        }
        if (!currentEntry.userPage.text.trim()) {
            addToast('请先写下今天的日记', 'info');
            return;
        }

        setIsThinking(true);
        saveEntry(); 

        try {
            await injectMemoryPalace(selectedChar, undefined, currentEntry.userPage.text);
            let systemPrompt = ContextBuilder.buildCoreContext(selectedChar, userProfile);

            const styleOptions = PAPER_STYLES.map(p => p.id).join(', ');
            const defaultStickers = DEFAULT_STICKERS.join(' ');
            const customStickerContext = customStickers.length > 0 
                ? `Custom Stickers (Name: URL): \n${customStickers.map(s => `- ${s.name}: ${s.url}`).join('\n')}`
                : '';

            const recentMsgs = await DB.getMessagesByCharId(selectedChar.id);
            const contextLimit = 30;
            const recentContext = recentMsgs.slice(-contextLimit).map(m => {
                const content = m.type === 'image' ? '[User sent an image]' : m.content;
                return `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.role === 'user' ? 'User' : 'You'}: ${content}`;
            }).join('\n');

            systemPrompt += `### [Exchange Diary Mode Instructions]
你正在和用户进行【交换日记】互动。

### 关键：最近发生的互动 (Recent Context)
这是你们最近在聊天软件或见面时的对话记录。请**务必**阅读这些记录，并在日记中提及今天发生的具体事情（例如聊过的话题、去过的地方、用户发过的图片）。
不要只写空泛的回复，还要说一些用户不知道的，你自己没有说过的想法，和你自己独立于用户经历过的今天的事情。
[RECENT LOGS START]
${recentContext}
[RECENT LOGS END]

### 任务
1. 阅读用户今天的日记 (${currentEntry.date})。
2. 以你的角色口吻写一篇**回复日记**。
   - 首先结合上文的聊天记录，回应用户的内容。
   - 最重要的是分享你的生活，此条为必须项**务必说至少一件用户不知道的，你今天做的事情，尽量与用户无关！用户希望看到角色完全独立的一面**。
   - 语言风格在符合设定的基础上，应该更加书面化和诗意，不过一切以角色性格优先。
3. 选择适合你心情的信纸和贴纸。

### 关于贴纸 (Stickers)
你可以使用默认的 Emoji，也可以使用【Custom Stickers】。
${customStickerContext}
如果要使用 Custom Sticker，请将 URL 直接放入返回的 stickers 数组中。

### 输出格式 (必须是纯 JSON)
Structure:
{
  "text": "日记正文...",
  "paperStyle": "one of: ${styleOptions}",
  "stickers": ["sticker1", "http://custom-sticker-url..."] (从默认列表或 Custom Stickers 中选0-3个)
}`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Users Diary:\n${currentEntry.userPage.text}` }
                    ],
                    temperature: 0.85
                })
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            let content = data.choices[0].message.content.trim();
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            
            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (e) {
                parsed = { text: content, paperStyle: 'plain', stickers: [] };
            }

            const charStickers: StickerData[] = (parsed.stickers || []).map((s: string) => ({
                id: `st-${Math.random()}`,
                url: s,
                x: Math.random() * 70 + 10,
                y: Math.random() * 70 + 10,
                rotation: (Math.random() - 0.5) * 40,
                scale: 1.0
            }));

            const charPage: DiaryPage = {
                text: parsed.text || '',
                paperStyle: PAPER_STYLES.find(p => p.id === parsed.paperStyle)?.id || 'plain',
                stickers: charStickers
            };

            const updatedEntry = { ...currentEntry, charPage };
            setCurrentEntry(updatedEntry);
            await DB.saveDiary(updatedEntry);
            await loadDiaries(selectedChar.id);
            setActiveTab('char');
            addToast('对方已回复', 'success');

        } catch (e: any) {
            addToast(`回复失败: ${e.message}`, 'error');
        } finally {
            setIsThinking(false);
        }
    };

    const handleArchive = async () => {
        if (!currentEntry || !selectedChar || currentEntry.isArchived) return;
        
        setIsArchiving(true); // START LOADING
        
        try {
            // 1. Build Context using ContextBuilder to ensure AI knows WHO it is
            await injectMemoryPalace(selectedChar, undefined, currentEntry.userPage.text);
            const baseContext = ContextBuilder.buildCoreContext(selectedChar, userProfile);

            const prompt = `${baseContext}

### [System Instruction: Diary Archival]
当前任务: 将这篇【交换日记】(${currentEntry.date}) 总结为一条属于你的“核心记忆”。

### 输入内容 (Input)
用户 (${userProfile.name}) 的日记:
"${currentEntry.userPage.text}"

你 (${selectedChar.name}) 的回复:
"${currentEntry.charPage?.text || '(无)'}"

### 输出要求 (Output Requirements)
1. **绝对第一人称**: 必须用“我”来称呼自己，用“${userProfile.name}”称呼用户。
2. **内容聚焦**: 总结日记中提到的关键事件、你的感受以及你们之间的互动。
3. **格式**: 输出一句简练的中文总结 (50字以内)。不要包含任何前缀。
`;
            
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3
                })
            });
            
            if (response.ok) {
                const data = await safeResponseJson(response);
                let summary = data.choices[0].message.content;
                summary = summary.replace(/^["']|["']$/g, '').trim();
                
                const newMem: MemoryFragment = {
                    id: `mem-${Date.now()}`,
                    date: currentEntry.date,
                    summary,
                    mood: 'diary'
                };
                
                const updatedMems = [...(selectedChar.memories || []), newMem];
                updateCharacter(selectedChar.id, { memories: updatedMems });
                
                const updatedDiary = { ...currentEntry, isArchived: true };
                setCurrentEntry(updatedDiary);
                await DB.saveDiary(updatedDiary);
                await loadDiaries(selectedChar.id);
                
                addToast('已归档至记忆库', 'success');
            } else {
                throw new Error(`API Error ${response.status}`);
            }
        } catch (e: any) {
            console.error(e);
            addToast(`归档失败: ${e.message}`, 'error');
        } finally {
            setIsArchiving(false); // END LOADING
        }
    };

    // --- Renderers ---

    const renderPage = (page: DiaryPage, side: 'user' | 'char') => {
        const style = PAPER_STYLES.find(s => s.id === page.paperStyle) || PAPER_STYLES[0];
        const isInteractive = true; // Always interactive now for editing

        return (
            <div 
                ref={side === activeTab ? paperRef : undefined}
                className={`relative w-full h-full shadow-md transition-all duration-300 overflow-hidden ${style.css} flex flex-col rounded-3xl touch-none`}
                style={{ ...style.style }}
                onPointerMove={isInteractive && side === activeTab ? handlePointerMove : undefined}
                onPointerUp={isInteractive && side === activeTab ? handlePointerUp : undefined}
                onPointerLeave={isInteractive && side === activeTab ? handlePointerUp : undefined}
                onClick={handleBackgroundClick}
            >
                {/* Content Container */}
                <div className="flex-1 p-6 relative z-10 flex flex-col">
                    <div className="flex justify-between items-center mb-4 pb-2 border-b border-black/5 shrink-0">
                        <span className={`text-xs font-bold uppercase tracking-widest opacity-50 ${style.text}`}>
                            {side === 'user' ? 'MY DIARY' : 'REPLY'}
                        </span>
                        <span className={`text-[10px] opacity-40 font-mono ${style.text}`}>
                            {currentEntry?.date}
                        </span>
                    </div>

                    <textarea 
                        value={page.text}
                        onChange={e => updatePage({ text: e.target.value }, side)}
                        placeholder={side === 'user' ? "记录今天发生的事情..." : "等待回复..."}
                        className={`flex-1 w-full bg-transparent resize-none outline-none leading-loose text-[16px] font-normal ${style.text} placeholder:opacity-30 no-scrollbar`}
                        readOnly={isThinking} 
                    />
                </div>

                {/* Stickers Layer */}
                {/* Check Hide Flag for Char Side */}
                {!(side === 'char' && hideCharStickers) && page.stickers.map(s => {
                    const isSelected = selectedStickerId === s.id;
                    const scale = s.scale || 1.0;
                    
                    return (
                        <div 
                            key={s.id} 
                            onPointerDown={(e) => handlePointerDown(e, s.id, 'move')}
                            onClick={(e) => selectSticker(e, s.id)}
                            className={`absolute text-6xl select-none drop-shadow-md z-20 cursor-move ${draggingSticker === s.id ? 'opacity-90' : ''} transition-transform`}
                            style={{ 
                                left: `${s.x}%`, 
                                top: `${s.y}%`, 
                                transform: `translate(-50%, -50%) rotate(${s.rotation}deg) scale(${scale})`,
                                border: isSelected ? '2px dashed #3b82f6' : 'none',
                                borderRadius: '8px',
                                padding: '4px'
                            }}
                        >
                            {s.url.startsWith('http') || s.url.startsWith('data') ? (
                                <img src={s.url} className="w-20 h-20 object-contain pointer-events-none" draggable={false} />
                            ) : s.url}

                            {/* Controls for Selected Sticker */}
                            {isSelected && (
                                <>
                                    {/* Delete Button (Top Right) */}
                                    <div 
                                        className="absolute -top-3 -right-3 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs shadow-md cursor-pointer pointer-events-auto"
                                        onClick={(e) => { e.stopPropagation(); removeStickerFromPage(s.id); }}
                                    >×</div>
                                    
                                    {/* Resize Handle (Bottom Right) */}
                                    <div 
                                        className="absolute -bottom-2 -right-2 w-5 h-5 bg-blue-500 rounded-full border-2 border-white shadow-md cursor-nwse-resize pointer-events-auto"
                                        onPointerDown={(e) => handlePointerDown(e, s.id, 'resize')}
                                    ></div>
                                </>
                            )}
                        </div>
                    );
                })}
                
                {/* Paper Texture Overlay (Subtle) */}
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/paper-fibers.png')] opacity-10 pointer-events-none z-0 mix-blend-multiply"></div>
            </div>
        );
    };

    if (mode === 'select') {
        return (
            <div className="h-full w-full bg-amber-50 flex flex-col font-light">
                <div className="pt-12 pb-4 px-6 border-b border-amber-100 bg-amber-50/80 backdrop-blur-sm sticky top-0 z-20 flex items-center justify-between shrink-0 h-24 box-border">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-amber-100/50 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-amber-900"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-amber-900 text-lg tracking-wide">选择日记本</span>
                    <div className="w-8"></div>
                </div>
                
                <div className="p-6 grid grid-cols-2 gap-5 overflow-y-auto pb-20 no-scrollbar">
                    {characters.map(c => (
                        <div key={c.id} onClick={() => handleCharSelect(c)} className="aspect-[3/4] bg-white rounded-r-2xl rounded-l-md border-l-4 border-l-amber-800 shadow-[2px_4px_12px_rgba(0,0,0,0.08)] p-4 flex flex-col items-center justify-center gap-3 cursor-pointer active:scale-95 transition-all relative overflow-hidden group">
                            <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/10 to-transparent"></div>
                            <div className="w-16 h-16 rounded-full p-[2px] border border-amber-100 bg-amber-50">
                                <img src={c.avatar} className="w-full h-full rounded-full object-cover" />
                            </div>
                            <span className="font-bold text-amber-900 text-sm">{c.name}</span>
                            <span className="text-[9px] text-amber-600 bg-amber-50 px-2 py-1 rounded-full font-mono uppercase tracking-wide">Journal</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (mode === 'calendar' && selectedChar) {
        return (
            <div className="h-full w-full bg-white flex flex-col font-light relative">
                <div className="pt-12 pb-6 px-6 bg-amber-500 shadow-lg shrink-0 rounded-b-[2rem] z-20">
                    <div className="flex justify-between items-start mb-4">
                         <button onClick={() => setMode('select')} className="text-white/80 hover:text-white transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
                         </button>
                         <div className="w-6"></div>
                    </div>
                    <div className="text-white">
                        <div className="text-xs opacity-70 uppercase tracking-widest font-bold mb-1">Exchange Diary</div>
                        <div className="text-3xl font-bold tracking-tight">{selectedChar.name}</div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 pb-20 no-scrollbar">
                    <button onClick={() => openEntry(getLocalDateStr())} className="w-full py-5 mb-8 border-2 border-dashed border-amber-200 rounded-2xl text-amber-500 font-bold flex items-center justify-center gap-2 hover:bg-amber-50 active:scale-95 transition-all">
                        <span className="text-xl">+</span> 写今天的日记
                    </button>
                    
                    <div className="space-y-4">
                        {diaries.map(d => (
                            <div key={d.id} onClick={() => openEntry(d.date)} className="flex items-center gap-4 p-4 rounded-2xl bg-white border border-slate-100 shadow-sm active:scale-95 transition-all hover:shadow-md cursor-pointer relative overflow-hidden group">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-400"></div>
                                <div className="w-14 h-14 bg-amber-50 rounded-xl flex flex-col items-center justify-center text-amber-800 shrink-0 border border-amber-100">
                                    <span className="text-[10px] font-bold opacity-60">{d.date.split('-')[1]}月</span>
                                    <span className="text-xl font-bold leading-none">{d.date.split('-')[2]}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-700 truncate font-medium">{d.userPage.text || '(空)'}</p>
                                    <div className="flex justify-between items-center mt-1">
                                        <p className="text-xs text-slate-400 font-mono">{d.date.split('-')[0]}</p>
                                        <div className="flex gap-2">
                                            {d.charPage && <span className="px-2 py-0.5 bg-green-100 text-green-600 rounded-full text-[9px] font-bold">已回复</span>}
                                            {d.isArchived && <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[9px] font-bold">已归档</span>}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setDeletingDiary(d);
                                    }}
                                    className="w-8 h-8 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center"
                                    title="删除日记"
                                    aria-label="删除日记"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <Modal 
                    isOpen={!!deletingDiary}
                    title="删除日记"
                    onClose={() => setDeletingDiary(null)}
                    footer={
                        <div className="flex gap-2 w-full">
                            <button onClick={() => setDeletingDiary(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button>
                            <button onClick={handleDeleteDiary} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold">删除</button>
                        </div>
                    }
                >
                    <p className="text-sm text-slate-600">
                        确定删除 {deletingDiary?.date} 的日记吗？删除后无法恢复。
                    </p>
                </Modal>
            </div>
        );
    }

    // --- WRITE MODE ---
    return (
        <div className="h-full w-full bg-[#1a1a1a] flex flex-col relative overflow-hidden">
            
            {/* Editor Header */}
            <div className="pt-12 pb-3 px-4 bg-[#1a1a1a]/90 backdrop-blur-md flex items-center justify-between text-white shrink-0 z-30 h-24 box-border">
                <button onClick={() => setMode('calendar')} className="p-2 -ml-2 text-white/60 hover:text-white rounded-full active:bg-white/10 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>
                <div className="flex gap-3">
                    {/* Toggle Char Sticker Visibility Button */}
                    {activeTab === 'char' && (
                        <button 
                            onClick={() => setHideCharStickers(!hideCharStickers)} 
                            className={`p-2 rounded-full transition-colors ${hideCharStickers ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/60'}`}
                            title={hideCharStickers ? "显示贴纸" : "隐藏贴纸"}
                        >
                            {hideCharStickers ? (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                            )}
                        </button>
                    )}

                    {currentEntry?.charPage && !currentEntry.isArchived && (
                        <button 
                            onClick={handleArchive} 
                            disabled={isArchiving}
                            className={`px-4 py-1.5 rounded-full text-xs font-bold shadow-lg transition-all flex items-center gap-2 ${isArchiving ? 'bg-emerald-800 text-emerald-200 cursor-not-allowed' : 'bg-emerald-600/90 text-white shadow-emerald-900/50 active:scale-95'}`}
                        >
                            {isArchiving && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>}
                            {isArchiving ? '归档中...' : '归档记忆'}
                        </button>
                    )}
                    <button onClick={saveEntry} className="px-4 py-1.5 bg-white/10 rounded-full text-xs font-bold hover:bg-white/20 active:scale-95 transition-transform">
                        保存
                    </button>
                </div>
            </div>

            {/* Main Page Area */}
            <div className="flex-1 relative w-full overflow-hidden flex flex-col">
                <div className="flex-1 w-full max-w-xl mx-auto px-2 pb-4 pt-2 flex flex-col relative">
                    <div className="flex-1 relative rounded-3xl transition-all duration-500">
                        {activeTab === 'user' && currentEntry && renderPage(currentEntry.userPage, 'user')}
                        
                        {activeTab === 'char' && (
                            currentEntry?.charPage ? renderPage(currentEntry.charPage, 'char') : (
                                <div className="w-full h-full bg-[#252525] rounded-3xl border border-white/5 flex flex-col items-center justify-center text-white/40 gap-4 p-8 text-center">
                                    <div className="opacity-20 animate-pulse"><img src={twemojiUrl('1f48c')} alt="letter" className="w-12 h-12" /></div>
                                    {isThinking ? (
                                        <div className="space-y-2">
                                            <p className="text-sm font-medium text-amber-500">对方正在阅读你的日记...</p>
                                            <div className="flex justify-center gap-1">
                                                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce"></div>
                                                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce delay-100"></div>
                                                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce delay-200"></div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="text-sm">写完日记后，点击下方按钮<br/>邀请 {selectedChar?.name} 交换日记。</p>
                                            <button 
                                                onClick={handleExchange} 
                                                className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-white text-sm font-bold rounded-full shadow-[0_0_20px_rgba(245,158,11,0.3)] active:scale-95 transition-all mt-2"
                                            >
                                                查看 TA 的今日
                                            </button>
                                        </>
                                    )}
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Bottom Controls */}
            <div className="shrink-0 bg-[#222] border-t border-white/5 pb-safe pt-2 z-30">
                <div className="flex justify-center gap-4 mb-4 px-4">
                    <button 
                        onClick={() => { setActiveTab('user'); setSelectedStickerId(null); }}
                        className={`flex-1 py-3 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all duration-300 relative overflow-hidden ${activeTab === 'user' ? 'bg-white text-black shadow-lg' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                    >
                        My Diary
                    </button>
                    <button 
                        onClick={() => { setActiveTab('char'); setSelectedStickerId(null); }}
                        className={`flex-1 py-3 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all duration-300 relative overflow-hidden ${activeTab === 'char' ? 'bg-amber-500 text-white shadow-lg shadow-amber-900/50' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                    >
                        {selectedChar?.name || 'Partner'}
                        {currentEntry?.charPage && activeTab !== 'char' && <div className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full shadow-sm animate-pulse"></div>}
                    </button>
                </div>

                <div className="flex items-center justify-between px-6 pb-4">
                    <div className="flex gap-3 bg-[#111] p-1.5 rounded-full border border-white/10">
                        {PAPER_STYLES.slice(0, 4).map(s => (
                            <button 
                                key={s.id} 
                                onClick={() => updatePage({ paperStyle: s.id }, activeTab)}
                                className={`w-8 h-8 rounded-full border border-white/10 transition-transform active:scale-90 ${s.css}`}
                                title={s.name}
                            />
                        ))}
                    </div>
                    
                    <div className="flex gap-3">
                        {activeTab === 'char' && currentEntry?.charPage && !isThinking && (
                            <button onClick={handleExchange} className="w-11 h-11 bg-white/10 text-white rounded-full flex items-center justify-center active:scale-90 transition-transform border border-white/5">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                            </button>
                        )}
                        
                        <button 
                            onClick={() => setShowStickerPanel(!showStickerPanel)} 
                            className={`w-11 h-11 rounded-full flex items-center justify-center text-xl shadow-lg active:scale-90 transition-transform ${showStickerPanel ? 'bg-white text-black' : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'}`}
                        >
                            <Sparkle size={24} weight="fill" />
                        </button>
                    </div>
                </div>

                {showStickerPanel && (
                    <div className="bg-[#1a1a1a] border-t border-white/10 p-4 animate-slide-up h-48 overflow-y-auto no-scrollbar">
                        <div className="grid grid-cols-6 gap-3">
                            <button onClick={() => setShowImportModal(true)} className="flex items-center justify-center bg-white/10 rounded-xl border-2 border-dashed border-white/20 text-white/50 text-xl font-bold hover:bg-white/20 hover:text-white transition-all aspect-square">
                                +
                            </button>
                            {DEFAULT_STICKERS.map((s, i) => (
                                <button key={`def-${i}`} onClick={() => addSticker(s)} className="hover:scale-110 transition-transform p-2 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center">
                                    <img src={s} alt="" className="w-8 h-8 object-contain pointer-events-none" />
                                </button>
                            ))}
                            {customStickers.map((s, i) => (
                                <button 
                                    key={`cust-${i}`} 
                                    onClick={() => addSticker(s.url)} 
                                    onTouchStart={() => handleDrawerTouchStart(s)}
                                    onTouchEnd={handleDrawerTouchEnd}
                                    onMouseDown={() => handleDrawerTouchStart(s)}
                                    onMouseUp={handleDrawerTouchEnd}
                                    onMouseLeave={handleDrawerTouchEnd}
                                    onContextMenu={(e) => { e.preventDefault(); setDeletingSticker(s); }}
                                    className="p-2 bg-white/5 rounded-xl border border-white/5 flex items-center justify-center relative active:scale-95 transition-transform"
                                >
                                    <img src={s.url} className="w-8 h-8 object-contain pointer-events-none" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Sticker Import Modal */}
            <Modal 
                isOpen={showImportModal} title="添加日记贴纸" onClose={() => setShowImportModal(false)}
                footer={<button onClick={handleImportStickers} className="w-full py-3 bg-white/10 text-white font-bold rounded-2xl hover:bg-white/20 transition-all">确认添加</button>}
            >
                <div className="space-y-3">
                    <p className="text-xs text-slate-500">格式：贴纸名称--图片URL (每行一个)</p>
                    <textarea 
                        value={importText} 
                        onChange={e => setImportText(e.target.value)} 
                        placeholder={`CoolCat--https://...\nHeart--https://...`}
                        className="w-full h-32 bg-slate-100 rounded-2xl p-4 text-sm resize-none focus:outline-none text-slate-700"
                    />
                </div>
            </Modal>

            {/* Sticker Delete Confirmation Modal */}
            <Modal 
                isOpen={!!deletingSticker} title="删除贴纸素材" onClose={() => setDeletingSticker(null)}
                footer={<div className="flex gap-2 w-full"><button onClick={() => setDeletingSticker(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button><button onClick={handleDeleteStickerAsset} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold">删除</button></div>}
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    {deletingSticker && <img src={deletingSticker.url} className="w-16 h-16 object-contain rounded-lg bg-slate-100 border" />}
                    <p className="text-sm text-slate-600">确定要删除这个贴纸素材吗？(不会影响已使用的日记)</p>
                </div>
            </Modal>
        </div>
    );
};

export default JournalApp;
