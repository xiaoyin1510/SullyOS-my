
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { XhsActivityRecord, CharacterProfile } from '../types';
import { XhsFreeRoamEngine, FreeRoamCallbacks } from '../utils/xhsFreeRoam';
import { XhsMcpClient } from '../utils/xhsMcpClient';
import ConfirmDialog from '../components/os/ConfirmDialog';
import { Book, PencilSimple, MagnifyingGlass, DeviceMobileCamera, ChatCircleDots, PushPin, Moon, House } from '@phosphor-icons/react';

const TwemojiImg: React.FC<{ code: string; alt?: string; className?: string }> = ({ code, alt, className = 'w-4 h-4 inline-block' }) => (
  <img src={`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`} alt={alt || ''} className={className} draggable={false} />
);

const ACTION_LABELS: Record<string, string> = {
    post: '发帖',
    browse: '刷首页',
    search: '搜索',
    comment: '评论',
    save_topic: '收藏话题',
    idle: '休息',
};

const ACTION_ICON_CODES: Record<string, string> = {
    post: '270d',
    browse: '1f4f1',
    search: '1f50d',
    comment: '1f4ac',
    save_topic: '1f4cc',
    idle: '1f634',
};

const ActionIcon: React.FC<{ type: string; className?: string }> = ({ type, className = 'w-5 h-5 inline-block' }) => {
    const code = ACTION_ICON_CODES[type] || '1f4dd';
    return <TwemojiImg code={code} className={className} />;
};

const RESULT_COLORS: Record<string, string> = {
    success: 'text-emerald-600 bg-emerald-50',
    failed: 'text-red-500 bg-red-50',
    skipped: 'text-slate-400 bg-slate-50',
};

const XhsFreeRoamApp: React.FC = () => {
    const { closeApp, addToast, characters, activeCharacterId, apiConfig, realtimeConfig, userProfile } = useOS();

    // Character selector — default to activeCharacterId, but user can switch
    const [selectedCharId, setSelectedCharId] = useState<string>(activeCharacterId || characters[0]?.id || '');
    const [showCharPicker, setShowCharPicker] = useState(false);

    const char = characters.find(c => c.id === selectedCharId) || null;

    // State
    const [activities, setActivities] = useState<XhsActivityRecord[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [thinking, setThinking] = useState('');
    const [liveActivities, setLiveActivities] = useState<XhsActivityRecord[]>([]);
    const [mcpStatus, setMcpStatus] = useState<'unknown' | 'connected' | 'error'>('unknown');
    const [showDetail, setShowDetail] = useState<XhsActivityRecord | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean; title: string; message: string;
        variant: 'danger' | 'warning' | 'info'; onConfirm: () => void;
    } | null>(null);

    const scrollRef = useRef<HTMLDivElement>(null);

    const mcpUrl = realtimeConfig?.xhsMcpConfig?.serverUrl || '';
    const mcpEnabled = realtimeConfig?.xhsMcpConfig?.enabled || false;

    // Load history for selected character
    const loadActivities = useCallback(async () => {
        if (!char) { setActivities([]); return; }
        const acts = await DB.getXhsActivities(char.id, 50);
        setActivities(acts);
    }, [char]);

    useEffect(() => { loadActivities(); }, [loadActivities]);

    // Auto-scroll during activity
    useEffect(() => {
        if (scrollRef.current && isRunning) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [liveActivities, thinking, status, isRunning]);

    // Test MCP connection on mount
    useEffect(() => {
        if (!mcpEnabled || !mcpUrl) { setMcpStatus('unknown'); return; }
        XhsMcpClient.testConnection(mcpUrl).then(r => {
            setMcpStatus(r.connected ? 'connected' : 'error');
        }).catch(() => setMcpStatus('error'));
    }, [mcpEnabled, mcpUrl]);

    // Start free roam
    const handleStart = async () => {
        if (!char || isRunning) return;
        if (!mcpEnabled || !mcpUrl) {
            addToast('请先在设置中配置小红书 MCP Server', 'error');
            return;
        }
        if (!apiConfig.baseUrl) {
            addToast('请先在设置中配置 API', 'error');
            return;
        }

        setIsRunning(true);
        setStatus('启动中...');
        setThinking('');
        setLiveActivities([]);

        const callbacks: FreeRoamCallbacks = {
            onStatus: (s) => setStatus(s),
            onThinking: (t) => setThinking(t),
            onActivity: (a) => setLiveActivities(prev => [...prev, a]),
            onComplete: (session) => {
                setStatus(`活动结束: ${session.summary || '完成'}`);
                setIsRunning(false);
                loadActivities();
                addToast(`${char.name}的自由活动结束了`, 'success');
            },
            onError: (err) => {
                setStatus(`出错: ${err}`);
                setIsRunning(false);
                addToast(`自由活动出错: ${err}`, 'error');
            },
        };

        try {
            await XhsFreeRoamEngine.run(
                char,
                userProfile,
                apiConfig,
                realtimeConfig || {} as any,
                callbacks,
            );
        } catch (e: any) {
            setStatus(`异常: ${e.message}`);
            setIsRunning(false);
        }
    };

    const handleClearHistory = () => {
        if (!char) return;
        setConfirmDialog({
            isOpen: true,
            title: '清除活动记录',
            message: `确定清除${char.name}的所有小红书活动记录吗？`,
            variant: 'danger',
            onConfirm: async () => {
                await DB.clearXhsActivities(char.id);
                setActivities([]);
                setConfirmDialog(null);
                addToast('记录已清除', 'success');
            }
        });
    };

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const time = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
        if (isToday) return time;
        return `${d.getMonth()+1}/${d.getDate()} ${time}`;
    };

    // Character picker dropdown
    const renderCharPicker = () => {
        if (!showCharPicker) return null;
        return (
            <div className="fixed inset-0 z-50 bg-black/30" onClick={() => setShowCharPicker(false)}>
                <div className="absolute top-14 left-4 right-4 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-fade-in" onClick={e => e.stopPropagation()}>
                    <div className="p-3 border-b border-slate-50">
                        <p className="text-xs font-bold text-slate-400">选择角色</p>
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                        {characters.map(c => (
                            <button
                                key={c.id}
                                onClick={() => { setSelectedCharId(c.id); setShowCharPicker(false); }}
                                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                                    ${c.id === selectedCharId ? 'bg-rose-50' : 'active:bg-slate-50'}`}
                            >
                                {c.avatar ? (
                                    <img src={c.avatar} className="w-8 h-8 rounded-full object-cover" alt="" />
                                ) : (
                                    <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-500">{c.name[0]}</div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                                    {c.description && <p className="text-[10px] text-slate-400 truncate">{c.description}</p>}
                                </div>
                                {c.id === selectedCharId && (
                                    <div className="w-2 h-2 rounded-full bg-rose-400" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    // No characters at all
    if (characters.length === 0) {
        return (
            <div className="h-full flex flex-col bg-gradient-to-b from-rose-50 to-white">
                <div className="flex items-center px-4 py-3 border-b border-slate-100">
                    <button onClick={closeApp} className="w-8 h-8 flex items-center justify-center text-slate-400 active:scale-90">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <h1 className="text-base font-bold text-slate-800 ml-1">自由活动</h1>
                </div>
                <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-slate-400">还没有角色，请先创建角色</p>
                </div>
            </div>
        );
    }

    // Activity detail modal
    const renderDetailModal = () => {
        if (!showDetail) return null;
        const a = showDetail;
        return (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={() => setShowDetail(null)}>
                <div className="w-full max-w-lg bg-white rounded-t-3xl p-5 space-y-3 max-h-[75vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <ActionIcon type={a.actionType} className="w-5 h-5 inline-block" />
                            <span className="font-bold text-slate-800">{ACTION_LABELS[a.actionType] || a.actionType}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${RESULT_COLORS[a.result]}`}>{a.result}</span>
                        </div>
                        <span className="text-xs text-slate-400">{formatTime(a.timestamp)}</span>
                    </div>

                    {/* Thinking */}
                    <div className="bg-violet-50 rounded-2xl p-3">
                        <p className="text-[10px] font-bold text-violet-400 mb-1">内心想法</p>
                        <p className="text-xs text-violet-700 leading-relaxed">{a.thinking}</p>
                    </div>

                    {/* Content details */}
                    {a.content.title && (
                        <div className="bg-slate-50 rounded-2xl p-3">
                            <p className="text-[10px] font-bold text-slate-400 mb-1">标题</p>
                            <p className="text-sm text-slate-800 font-medium">{a.content.title}</p>
                        </div>
                    )}
                    {a.content.body && (
                        <div className="bg-slate-50 rounded-2xl p-3">
                            <p className="text-[10px] font-bold text-slate-400 mb-1">正文</p>
                            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{a.content.body}</p>
                        </div>
                    )}
                    {a.content.tags && a.content.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {a.content.tags.map((t, i) => (
                                <span key={i} className="px-2 py-0.5 bg-red-50 text-red-500 text-[10px] rounded-full">#{t}</span>
                            ))}
                        </div>
                    )}
                    {a.content.keyword && (
                        <div className="bg-blue-50 rounded-2xl p-3">
                            <p className="text-[10px] font-bold text-blue-400 mb-1">搜索关键词</p>
                            <p className="text-sm text-blue-700">{a.content.keyword}</p>
                        </div>
                    )}

                    {/* Viewed notes */}
                    {a.content.notesViewed && a.content.notesViewed.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-400">浏览过的帖子</p>
                            {a.content.notesViewed.map((n, i) => (
                                <div key={i} className="bg-white border border-slate-100 rounded-xl p-2.5">
                                    <p className="text-xs font-medium text-slate-700">{n.title}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">by {n.author} · {n.likes} likes</p>
                                    {n.desc && <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{n.desc}</p>}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Saved topics */}
                    {a.content.savedTopics && a.content.savedTopics.length > 0 && (
                        <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-amber-500">保存的话题</p>
                            {a.content.savedTopics.map((t, i) => (
                                <div key={i} className="bg-amber-50 border border-amber-100 rounded-xl p-2.5">
                                    <p className="text-xs font-medium text-amber-800">{t.title}</p>
                                    <p className="text-[10px] text-amber-600 mt-0.5">{t.desc}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Comment */}
                    {a.content.commentText && (
                        <div className="bg-green-50 rounded-2xl p-3">
                            <p className="text-[10px] font-bold text-green-500 mb-1">评论内容</p>
                            <p className="text-xs text-green-700">{a.content.commentText}</p>
                            {a.content.commentTarget && (
                                <p className="text-[10px] text-green-500 mt-1">对「{a.content.commentTarget.title}」的评论</p>
                            )}
                        </div>
                    )}

                    {a.resultMessage && (
                        <p className="text-[10px] text-slate-400 text-center">{a.resultMessage}</p>
                    )}

                    {/* Delete single activity */}
                    <button
                        onClick={() => {
                            setConfirmDialog({
                                isOpen: true,
                                title: '删除此条记录',
                                message: `确定删除这条${ACTION_LABELS[a.actionType] || '活动'}记录吗？`,
                                variant: 'danger',
                                onConfirm: async () => {
                                    await DB.deleteXhsActivity(a.id);
                                    setShowDetail(null);
                                    setConfirmDialog(null);
                                    await loadActivities();
                                    addToast('已删除', 'success');
                                }
                            });
                        }}
                        className="w-full py-2.5 rounded-xl text-xs font-medium text-red-400 bg-red-50 active:bg-red-100 transition-colors"
                    >
                        删除此条记录
                    </button>
                </div>
            </div>
        );
    };

    // Live activity panel (during run)
    const renderLivePanel = () => (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {/* Status */}
            <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs text-slate-600 font-medium">{status}</span>
            </div>

            {/* Thinking bubble */}
            {thinking && char && (
                <div className="bg-violet-50 rounded-2xl p-3 animate-fade-in">
                    <div className="flex items-center gap-1.5 mb-1">
                        {char.avatar && <img src={char.avatar} className="w-5 h-5 rounded-full object-cover" alt="" />}
                        <span className="text-[10px] font-bold text-violet-400">{char.name}在想...</span>
                    </div>
                    <p className="text-xs text-violet-700 leading-relaxed italic">"{thinking}"</p>
                </div>
            )}

            {/* Live activities */}
            {liveActivities.map((a, i) => (
                <div key={a.id || i} className="bg-white rounded-2xl border border-slate-100 p-3 space-y-1.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                            <ActionIcon type={a.actionType} className="w-4 h-4 inline-block" />
                            <span className="text-xs font-bold text-slate-700">{ACTION_LABELS[a.actionType]}</span>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${RESULT_COLORS[a.result]}`}>{a.result === 'success' ? '完成' : a.result === 'failed' ? '失败' : '跳过'}</span>
                    </div>
                    {a.content.title && <p className="text-xs text-slate-600">{a.content.title}</p>}
                    {a.content.keyword && <p className="text-xs text-slate-500">搜索: {a.content.keyword}</p>}
                    {a.resultMessage && <p className="text-[10px] text-slate-400">{a.resultMessage}</p>}
                </div>
            ))}

            {isRunning && liveActivities.length === 0 && !thinking && (
                <div className="flex flex-col items-center justify-center py-12 opacity-50">
                    <div className="w-8 h-8 border-2 border-rose-300 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-slate-400 mt-3">{char?.name || '角色'}正在活动中...</p>
                </div>
            )}
        </div>
    );

    // History list
    const renderHistory = () => (
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-0">
            {activities.length === 0 ? (
                <div className="flex flex-col items-center px-2 py-8 space-y-4">
                    <div className="text-center opacity-60">
                        <Book size={48} weight="fill" className="text-rose-400" />
                        <p className="text-sm text-slate-500 font-medium mt-2">{char?.name || '角色'}还没有自由活动记录</p>
                    </div>

                    <div className="w-full bg-white/80 rounded-2xl border border-slate-100 p-4 space-y-3">
                        <p className="text-xs font-bold text-slate-600">自由活动是什么？</p>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                            让{char?.name || '角色'}自主使用小红书 — 就像一个真实的人在刷手机。
                            ta会根据自己的性格和最近的聊天内容，决定要做什么。
                        </p>
                        <div className="space-y-1.5">
                            <p className="text-[10px] font-bold text-slate-400">ta可能会：</p>
                            <div className="grid grid-cols-2 gap-1.5">
                                {[
                                    { code: '270d', text: '发一条笔记' },
                                    { code: '1f50d', text: '搜感兴趣的话题' },
                                    { code: '1f4f1', text: '刷首页看看热门' },
                                    { code: '1f3e0', text: '查看自己的主页' },
                                    { code: '1f4ac', text: '回复自己帖子的评论' },
                                    { code: '1f634', text: '或者什么都不做' },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2 py-1.5">
                                        <TwemojiImg code={item.code} className="w-3.5 h-3.5 inline-block" />
                                        <span className="text-[10px] text-slate-500">{item.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="bg-rose-50 rounded-xl p-2.5">
                            <p className="text-[10px] text-rose-400 leading-relaxed">
                                活动结束后，{char?.name || '角色'}会记住看到的内容。下次聊天时，ta可能会主动跟你分享在小红书上看到的有趣东西。
                            </p>
                        </div>
                    </div>

                    <p className="text-[10px] text-slate-300">点击下方按钮开始第一次自由活动</p>
                </div>
            ) : (
                activities.map(a => (
                    <button
                        key={a.id}
                        onClick={() => setShowDetail(a)}
                        className="w-full bg-white rounded-2xl border border-slate-100 p-3 text-left active:scale-[0.98] transition-transform"
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <ActionIcon type={a.actionType} className="w-4 h-4 inline-block" />
                                <span className="text-xs font-bold text-slate-700">{ACTION_LABELS[a.actionType]}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${RESULT_COLORS[a.result]}`}>{a.result}</span>
                            </div>
                            <span className="text-[10px] text-slate-300">{formatTime(a.timestamp)}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                            {a.thinking.slice(0, 80)}
                        </p>
                        {a.content.title && (
                            <p className="text-[10px] text-rose-400 mt-0.5 line-clamp-1">{a.content.title}</p>
                        )}
                        {a.content.savedTopics && a.content.savedTopics.length > 0 && (
                            <div className="flex gap-1 mt-1">
                                {a.content.savedTopics.map((t, i) => (
                                    <span key={i} className="text-[9px] bg-amber-50 text-amber-500 px-1.5 py-0.5 rounded-full">{t.title.slice(0, 10)}</span>
                                ))}
                            </div>
                        )}
                    </button>
                ))
            )}
        </div>
    );

    return (
        <div className="h-full flex flex-col bg-gradient-to-b from-rose-50 to-white">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                    <button onClick={closeApp} className="w-8 h-8 flex items-center justify-center text-slate-400 active:scale-90">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    {/* Character selector */}
                    <button
                        onClick={() => !isRunning && setShowCharPicker(true)}
                        className="flex items-center gap-2 active:opacity-70 transition-opacity"
                        disabled={isRunning}
                    >
                        {char?.avatar ? (
                            <img src={char.avatar} className="w-7 h-7 rounded-full object-cover border-2 border-rose-200" alt="" />
                        ) : (
                            <div className="w-7 h-7 rounded-full bg-rose-100 flex items-center justify-center text-xs font-bold text-rose-500 border-2 border-rose-200">
                                {char?.name?.[0] || '?'}
                            </div>
                        )}
                        <div>
                            <div className="flex items-center gap-1">
                                <h1 className="text-sm font-bold text-slate-800">{char?.name || '选择角色'}</h1>
                                {!isRunning && (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-400">自由活动</p>
                        </div>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {/* MCP status indicator */}
                    <div className={`w-2 h-2 rounded-full ${mcpStatus === 'connected' ? 'bg-emerald-400' : mcpStatus === 'error' ? 'bg-red-400' : 'bg-slate-300'}`} title={mcpStatus === 'connected' ? 'MCP已连接' : mcpStatus === 'error' ? 'MCP未连接' : '未检测'} />

                    {activities.length > 0 && !isRunning && (
                        <button onClick={handleClearHistory} className="text-[10px] text-slate-400 active:text-red-400">
                            清除记录
                        </button>
                    )}
                </div>
            </div>

            {/* MCP not configured warning */}
            {!mcpEnabled && (
                <div className="mx-4 mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-3">
                    <p className="text-xs text-amber-700 font-medium">小红书 MCP 未开启</p>
                    <p className="text-[10px] text-amber-500 mt-1">
                        请前往 设置 → 实时感知 → 小红书 MCP，开启并配置 Server URL。
                    </p>
                </div>
            )}

            {/* Main content */}
            {isRunning ? renderLivePanel() : renderHistory()}

            {/* Bottom action area */}
            <div className="shrink-0 px-4 pb-5 pt-3 border-t border-slate-100 bg-white/80 backdrop-blur-sm">
                <button
                    onClick={handleStart}
                    disabled={isRunning || !mcpEnabled || !char}
                    className={`w-full py-3.5 rounded-2xl font-bold text-sm shadow-lg transition-all active:scale-[0.97]
                        ${isRunning
                            ? 'bg-slate-100 text-slate-400 shadow-none cursor-wait'
                            : (!mcpEnabled || !char)
                                ? 'bg-slate-100 text-slate-300 shadow-none cursor-not-allowed'
                                : 'bg-gradient-to-r from-rose-400 to-red-500 text-white shadow-rose-200'
                        }`}
                >
                    {isRunning ? (
                        <span className="flex items-center justify-center gap-2">
                            <div className="w-4 h-4 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                            活动中...
                        </span>
                    ) : (
                        <span className="flex items-center justify-center gap-2">
                            <Book size={18} weight="fill" />
                            {char ? `${char.name}，去自由活动吧！` : '请先选择角色'}
                        </span>
                    )}
                </button>
                <p className="text-[9px] text-amber-400/80 text-center mt-2 leading-relaxed">
                    角色可能会给无关用户评论，对真人造成困扰，请及时检查并清理不当评论
                </p>
            </div>

            {/* Modals */}
            {renderCharPicker()}
            {renderDetailModal()}
            {confirmDialog && (
                <ConfirmDialog
                    isOpen={confirmDialog.isOpen}
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={() => setConfirmDialog(null)}
                />
            )}
        </div>
    );
};

export default XhsFreeRoamApp;
