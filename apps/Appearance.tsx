
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useOS, DEFAULT_WALLPAPER } from '../context/OSContext';
import { OSTheme, DesktopDecoration, AppearancePreset, Toast } from '../types';
import { INSTALLED_APPS, Icons } from '../constants';
import { processImage } from '../utils/file';
import { Sparkle } from '@phosphor-icons/react';
import { ChatAppearanceEditor as ModularChatAppearanceEditor } from '../components/appearance/ChatAppearanceEditor';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

// Touch-friendly long-press wrapper. `onContextMenu` alone misses iOS Safari /
// Capacitor WebView, so we also wire pointer/touch timers to fire after ~550ms.
// When a long-press fires, the subsequent click is suppressed.
const LongPressArea: React.FC<{
    onLongPress: () => void;
    onClick?: () => void;
    delay?: number;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
}> = ({ onLongPress, onClick, delay = 550, className, style, children }) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const fired = useRef(false);
    const startPos = useRef<{ x: number; y: number } | null>(null);

    const clear = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        startPos.current = null;
    }, []);

    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const start = (x: number, y: number) => {
        fired.current = false;
        startPos.current = { x, y };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            fired.current = true;
            onLongPress();
        }, delay);
    };
    const move = (x: number, y: number) => {
        const sp = startPos.current;
        if (!sp) return;
        if (Math.hypot(x - sp.x, y - sp.y) > 8) clear();
    };

    return (
        <div
            className={className}
            style={style}
            onContextMenu={(e) => { e.preventDefault(); onLongPress(); }}
            onTouchStart={(e) => { const t = e.touches[0]; if (t) start(t.clientX, t.clientY); }}
            onTouchMove={(e) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }}
            onTouchEnd={clear}
            onTouchCancel={clear}
            onPointerDown={(e) => { if (e.pointerType !== 'touch') start(e.clientX, e.clientY); }}
            onPointerMove={(e) => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY); }}
            onPointerUp={clear}
            onPointerLeave={clear}
            onPointerCancel={clear}
            onClick={() => {
                if (fired.current) { fired.current = false; return; }
                onClick?.();
            }}
        >
            {children}
        </div>
    );
};

const TwemojiImg: React.FC<{ code: string; alt?: string; className?: string }> = ({ code, alt, className = 'w-4 h-4 inline-block' }) => (
  <img src={`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`} alt={alt || ''} className={className} draggable={false} />
);

const CATEGORY_LABELS: Record<string, { code: string; label: string }> = {
  'stars': { code: '2728', label: 'Stars' },
  'hearts': { code: '1f496', label: 'Hearts' },
  'flowers': { code: '1f338', label: 'Flowers' },
  'ribbons': { code: '1f380', label: 'Ribbons' },
  'animals': { code: '1f431', label: 'Animals' },
  'shapes': { code: '1f52e', label: 'Shapes' },
  'badges': { code: '1f3f7', label: 'Badges' },
};

// --- Chat Appearance Editor Component ---
const AVATAR_SHAPES: { value: 'circle' | 'rounded' | 'square'; label: string; preview: string }[] = [
    { value: 'circle', label: '圆形', preview: 'rounded-full' },
    { value: 'rounded', label: '圆角', preview: 'rounded-xl' },
    { value: 'square', label: '方形', preview: 'rounded-none' },
];
const AVATAR_SIZES: { value: 'small' | 'medium' | 'large'; label: string; size: string }[] = [
    { value: 'small', label: '小', size: 'w-7 h-7' },
    { value: 'medium', label: '中', size: 'w-9 h-9' },
    { value: 'large', label: '大', size: 'w-12 h-12' },
];
const BUBBLE_STYLES: { value: 'modern' | 'flat' | 'outline' | 'shadow'; label: string; desc: string }[] = [
    { value: 'modern', label: '现代', desc: '圆角气泡+微透明' },
    { value: 'flat', label: '扁平', desc: '无阴影纯色气泡' },
    { value: 'outline', label: '描边', desc: '边框线条风格' },
    { value: 'shadow', label: '立体', desc: '深阴影立体效果' },
];
const MSG_SPACINGS: { value: 'compact' | 'default' | 'spacious'; label: string }[] = [
    { value: 'compact', label: '紧凑' },
    { value: 'default', label: '默认' },
    { value: 'spacious', label: '宽松' },
];
const HEADER_STYLES: { value: 'default' | 'minimal' | 'gradient'; label: string; desc: string }[] = [
    { value: 'default', label: '默认', desc: '标准头部' },
    { value: 'minimal', label: '简约', desc: '仅显示名字' },
    { value: 'gradient', label: '渐变', desc: '渐变色头部' },
];
const INPUT_STYLES: { value: 'default' | 'rounded' | 'flat'; label: string }[] = [
    { value: 'default', label: '默认' },
    { value: 'rounded', label: '圆角' },
    { value: 'flat', label: '扁平' },
];
const TIMESTAMP_OPTIONS: { value: 'always' | 'hover' | 'never'; label: string }[] = [
    { value: 'always', label: '始终显示' },
    { value: 'hover', label: '悬停显示' },
    { value: 'never', label: '不显示' },
];

// Chat Layout Presets (built-in combinations)
const CHAT_LAYOUT_COMBOS: { name: string; desc: string; config: Partial<OSTheme> }[] = [
    { name: '默认', desc: '标准聊天界面', config: { chatAvatarShape: 'circle', chatAvatarSize: 'medium', chatBubbleStyle: 'modern', chatMessageSpacing: 'default', chatHeaderStyle: 'default', chatInputStyle: 'default', chatShowTimestamp: 'hover' } },
    { name: 'QQ风格', desc: '圆角头像+紧凑间距', config: { chatAvatarShape: 'rounded', chatAvatarSize: 'medium', chatBubbleStyle: 'shadow', chatMessageSpacing: 'compact', chatHeaderStyle: 'gradient', chatInputStyle: 'rounded', chatShowTimestamp: 'hover' } },
    { name: '微信风格', desc: '方形头像+扁平气泡', config: { chatAvatarShape: 'square', chatAvatarSize: 'medium', chatBubbleStyle: 'flat', chatMessageSpacing: 'default', chatHeaderStyle: 'default', chatInputStyle: 'flat', chatShowTimestamp: 'hover' } },
    { name: 'iMessage', desc: '大圆头像+宽松气泡', config: { chatAvatarShape: 'circle', chatAvatarSize: 'large', chatBubbleStyle: 'modern', chatMessageSpacing: 'spacious', chatHeaderStyle: 'minimal', chatInputStyle: 'rounded', chatShowTimestamp: 'always' } },
    { name: '简约模式', desc: '小头像+最简界面', config: { chatAvatarShape: 'circle', chatAvatarSize: 'small', chatBubbleStyle: 'flat', chatMessageSpacing: 'compact', chatHeaderStyle: 'minimal', chatInputStyle: 'flat', chatShowTimestamp: 'never' } },
];

const ChatAppearanceEditor: React.FC<{ theme: OSTheme; updateTheme: (u: Partial<OSTheme>) => void }> = ({ theme, updateTheme }) => {
    const avatarShape = theme.chatAvatarShape || 'circle';
    const avatarSize = theme.chatAvatarSize || 'medium';
    const bubbleStyle = theme.chatBubbleStyle || 'modern';
    const msgSpacing = theme.chatMessageSpacing || 'default';
    const headerStyle = theme.chatHeaderStyle || 'default';
    const inputStyle = theme.chatInputStyle || 'default';
    const showTimestamp = theme.chatShowTimestamp || 'hover';

    const OptionButton: React.FC<{ active: boolean; label: string; desc?: string; onClick: () => void }> = ({ active, label, desc, onClick }) => (
        <button onClick={onClick}
            className={`px-3 py-2 text-[11px] font-bold rounded-xl border transition-all active:scale-95 ${active ? 'bg-primary/10 text-primary border-primary/30 ring-1 ring-primary/20' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
            <div>{label}</div>
            {desc && <div className="text-[9px] font-normal mt-0.5 opacity-70">{desc}</div>}
        </button>
    );

    return (
        <div className="space-y-5">
            {/* Quick Combo Presets */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">快速风格</h2>
                <p className="text-[10px] text-slate-400 mb-3">一键切换聊天界面风格组合，包含头像、气泡、间距等全套配置。</p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                    {CHAT_LAYOUT_COMBOS.map(combo => (
                        <button key={combo.name} onClick={() => updateTheme(combo.config)}
                            className="shrink-0 px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 hover:border-primary/40 active:scale-95 transition-all text-left">
                            <div className="text-xs font-bold text-slate-700">{combo.name}</div>
                            <div className="text-[9px] text-slate-400 mt-0.5">{combo.desc}</div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Live Preview */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">预览</h2>
                <div className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                    {/* Fake header */}
                    <div className={`px-4 py-3 flex items-center gap-3 border-b border-slate-100 ${headerStyle === 'gradient' ? 'bg-gradient-to-r from-primary/20 to-primary/5' : headerStyle === 'minimal' ? 'bg-white' : 'bg-slate-50'}`}>
                        <div className={`${AVATAR_SIZES.find(s => s.value === avatarSize)?.size || 'w-9 h-9'} ${AVATAR_SHAPES.find(s => s.value === avatarShape)?.preview || 'rounded-full'} bg-primary/20 shrink-0`} />
                        <div>
                            <div className="text-xs font-bold text-slate-700">角色名</div>
                            {headerStyle !== 'minimal' && <div className="text-[9px] text-slate-400">在线</div>}
                        </div>
                    </div>
                    {/* Fake messages */}
                    <div className={`p-3 space-y-${msgSpacing === 'compact' ? '1' : msgSpacing === 'spacious' ? '4' : '2'}`}>
                        {/* AI message */}
                        <div className="flex gap-2 items-end">
                            <div className={`${AVATAR_SIZES.find(s => s.value === avatarSize)?.size || 'w-9 h-9'} ${AVATAR_SHAPES.find(s => s.value === avatarShape)?.preview || 'rounded-full'} bg-pink-200 shrink-0`} />
                            <div className={`px-3 py-2 text-[11px] max-w-[65%] ${bubbleStyle === 'outline' ? 'bg-transparent border-2 border-slate-300 rounded-2xl rounded-bl-sm' : bubbleStyle === 'shadow' ? 'bg-white shadow-md rounded-2xl rounded-bl-sm' : bubbleStyle === 'flat' ? 'bg-slate-100 rounded-2xl rounded-bl-sm' : 'bg-white/90 backdrop-blur-sm rounded-2xl rounded-bl-sm shadow-sm'}`}>
                                你好呀，今天过得怎么样？
                                {showTimestamp === 'always' && <div className="text-[8px] text-slate-300 mt-1 text-right">14:32</div>}
                            </div>
                        </div>
                        {/* User message */}
                        <div className="flex gap-2 items-end justify-end">
                            <div className={`px-3 py-2 text-[11px] text-white max-w-[65%] ${bubbleStyle === 'outline' ? 'bg-transparent border-2 border-primary text-primary rounded-2xl rounded-br-sm' : bubbleStyle === 'shadow' ? 'bg-primary shadow-md rounded-2xl rounded-br-sm' : bubbleStyle === 'flat' ? 'bg-primary rounded-2xl rounded-br-sm' : 'bg-primary/90 backdrop-blur-sm rounded-2xl rounded-br-sm shadow-sm'}`}
                                style={bubbleStyle === 'outline' ? { color: `hsl(${theme.hue}, ${theme.saturation}%, ${theme.lightness}%)` } : undefined}>
                                挺好的，今天天气不错！
                                {showTimestamp === 'always' && <div className={`text-[8px] mt-1 text-right ${bubbleStyle === 'outline' ? 'opacity-50' : 'text-white/60'}`}>14:33</div>}
                            </div>
                            <div className={`${AVATAR_SIZES.find(s => s.value === avatarSize)?.size || 'w-9 h-9'} ${AVATAR_SHAPES.find(s => s.value === avatarShape)?.preview || 'rounded-full'} bg-primary/30 shrink-0`} />
                        </div>
                    </div>
                    {/* Fake input */}
                    <div className={`px-3 py-2 border-t border-slate-100 ${inputStyle === 'flat' ? 'bg-slate-50' : 'bg-white'}`}>
                        <div className={`bg-slate-100 px-4 py-2 text-[10px] text-slate-400 ${inputStyle === 'rounded' ? 'rounded-full' : inputStyle === 'flat' ? 'rounded-none border-b border-slate-200 bg-transparent' : 'rounded-xl'}`}>输入消息...</div>
                    </div>
                </div>
            </section>

            {/* Avatar Shape */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">头像形状</h2>
                <div className="flex gap-2">
                    {AVATAR_SHAPES.map(s => (
                        <OptionButton key={s.value} active={avatarShape === s.value} label={s.label} onClick={() => updateTheme({ chatAvatarShape: s.value })} />
                    ))}
                </div>
            </section>

            {/* Avatar Size */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">头像大小</h2>
                <div className="flex gap-2">
                    {AVATAR_SIZES.map(s => (
                        <OptionButton key={s.value} active={avatarSize === s.value} label={s.label} onClick={() => updateTheme({ chatAvatarSize: s.value })} />
                    ))}
                </div>
            </section>

            {/* Bubble Style */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">气泡风格</h2>
                <div className="flex gap-2 flex-wrap">
                    {BUBBLE_STYLES.map(s => (
                        <OptionButton key={s.value} active={bubbleStyle === s.value} label={s.label} desc={s.desc} onClick={() => updateTheme({ chatBubbleStyle: s.value })} />
                    ))}
                </div>
            </section>

            {/* Message Spacing */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">消息间距</h2>
                <div className="flex gap-2">
                    {MSG_SPACINGS.map(s => (
                        <OptionButton key={s.value} active={msgSpacing === s.value} label={s.label} onClick={() => updateTheme({ chatMessageSpacing: s.value })} />
                    ))}
                </div>
            </section>

            {/* Header Style */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">聊天头部</h2>
                <div className="flex gap-2 flex-wrap">
                    {HEADER_STYLES.map(s => (
                        <OptionButton key={s.value} active={headerStyle === s.value} label={s.label} desc={s.desc} onClick={() => updateTheme({ chatHeaderStyle: s.value })} />
                    ))}
                </div>
            </section>

            {/* Input Style */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">输入框样式</h2>
                <div className="flex gap-2">
                    {INPUT_STYLES.map(s => (
                        <OptionButton key={s.value} active={inputStyle === s.value} label={s.label} onClick={() => updateTheme({ chatInputStyle: s.value })} />
                    ))}
                </div>
            </section>

            {/* Timestamp Display */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">时间戳显示</h2>
                <div className="flex gap-2">
                    {TIMESTAMP_OPTIONS.map(s => (
                        <OptionButton key={s.value} active={showTimestamp === s.value} label={s.label} onClick={() => updateTheme({ chatShowTimestamp: s.value })} />
                    ))}
                </div>
            </section>

            <div className="text-[10px] text-slate-400 text-center px-4 pb-4">
                聊天界面设置全局生效。单个角色的气泡颜色、背景图等可在聊天内的「捏主题」中自定义。
            </div>
        </div>
    );
};

// --- Preset Manager Component ---
interface PresetManagerProps {
    presets: AppearancePreset[];
    onSave: (name: string) => void;
    onApply: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onExport: (id: string) => Promise<Blob>;
    onImport: (file: File) => Promise<void>;
    onReset: () => Promise<void>;
    addToast: (msg: string, type?: Toast['type']) => void;
    currentTheme: OSTheme;
}

const PresetManager: React.FC<PresetManagerProps> = ({ presets, onSave, onApply, onDelete, onRename, onExport, onImport, onReset, addToast, currentTheme }) => {
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmReset, setConfirmReset] = useState(false);
    const [resetting, setResetting] = useState(false);
    const importRef = useRef<HTMLInputElement>(null);

    const handleReset = async () => {
        setResetting(true);
        try {
            await onReset();
        } finally {
            setResetting(false);
            setConfirmReset(false);
        }
    };

    const handleSave = () => {
        const name = newName.trim() || `预设 ${new Date().toLocaleDateString('zh-CN')}`;
        onSave(name);
        setNewName('');
    };

    const handleExport = async (id: string) => {
        try {
            const blob = await onExport(id);
            const preset = presets.find(p => p.id === id);
            const fileName = `appearance_${preset?.name || 'preset'}.zip`;
            const title = `外观预设 - ${preset?.name || 'preset'}`;

            if (Capacitor.isNativePlatform()) {
                // Native: 写到 Cache 再调系统分享
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(blob);
                });
                await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
                const uri = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
                await Share.share({ title, files: [uri.uri] });
            } else {
                // Web: 先触发浏览器原生下载，再尝试拉起系统分享面板
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                try {
                    const file = new File([blob], fileName, { type: 'application/zip' });
                    if (
                        typeof navigator !== 'undefined' &&
                        typeof navigator.share === 'function' &&
                        (typeof (navigator as any).canShare !== 'function' || (navigator as any).canShare({ files: [file] }))
                    ) {
                        await navigator.share({ title, files: [file] });
                    }
                } catch (shareErr: any) {
                    // 用户取消分享是正常情况，吞掉
                    if (shareErr?.name !== 'AbortError') {
                        console.warn('[Appearance] share failed', shareErr);
                    }
                }
            }
            addToast('预设已导出', 'success');
        } catch (e: any) {
            addToast(e.message || '导出失败', 'error');
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            await onImport(file);
        } catch (err: any) {
            addToast(err.message || '导入失败', 'error');
        }
        if (importRef.current) importRef.current.value = '';
    };

    const handleRename = (id: string) => {
        if (editName.trim()) {
            onRename(id, editName.trim());
        }
        setEditingId(null);
        setEditName('');
    };

    return (
        <div className="space-y-5">
            {/* One-click Reset */}
            <section className="bg-gradient-to-br from-rose-50 to-orange-50 rounded-3xl p-5 shadow-sm border border-rose-100">
                <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-sm font-bold text-rose-500 uppercase tracking-widest">一键还原外观</h2>
                </div>
                <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                    把主题色、壁纸、字体、应用图标、桌面小组件、装饰贴纸全部还原成最初始状态。在不同版本之间反复导入预设导致图标错乱时使用。<br/>
                    <span className="text-slate-400">已保存的外观预设不会被删除，随时还能切回去。</span>
                </p>
                {!confirmReset ? (
                    <button onClick={() => setConfirmReset(true)}
                        className="w-full py-2.5 bg-white text-rose-500 font-bold text-xs rounded-xl border border-rose-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                        还原为初始外观
                    </button>
                ) : (
                    <div className="flex gap-2">
                        <button onClick={handleReset} disabled={resetting}
                            className="flex-1 py-2.5 bg-rose-500 text-white font-bold text-xs rounded-xl shadow-sm active:scale-95 transition-transform disabled:opacity-50">
                            {resetting ? '正在还原...' : '确认还原'}
                        </button>
                        <button onClick={() => setConfirmReset(false)} disabled={resetting}
                            className="flex-1 py-2.5 bg-white text-slate-500 font-bold text-xs rounded-xl border border-slate-200 active:scale-95 transition-transform disabled:opacity-50">
                            取消
                        </button>
                    </div>
                )}
            </section>

            {/* Save Current */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">保存当前外观</h2>
                <p className="text-[10px] text-slate-400 mb-3">将当前的主题色、壁纸、字体、图标、装饰等完整外观保存为预设，方便随时切换。</p>
                <div className="flex gap-2">
                    <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        placeholder="预设名称（可选）"
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-primary transition-all"
                        onKeyDown={e => e.key === 'Enter' && handleSave()}
                    />
                    <button onClick={handleSave}
                        className="px-5 py-2.5 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform shrink-0">
                        保存
                    </button>
                </div>
            </section>

            {/* Import */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">导入外观预设</h2>
                <p className="text-[10px] text-slate-400 mb-3">从 .zip 文件导入他人分享的外观预设（兼容旧版 .json）。系统整合备份也会包含当前外观设置，单独预设文件更适合分享。</p>
                <input type="file" ref={importRef} className="hidden" accept=".zip,.json,application/zip,application/json" onChange={handleImport} />
                <button onClick={() => importRef.current?.click()}
                    className="w-full py-2.5 bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-500 font-bold text-xs rounded-xl border border-blue-200 active:scale-95 transition-transform flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                    选择文件导入
                </button>
            </section>

            {/* Preset List */}
            <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-3">已保存预设 ({presets.length})</h2>
                {presets.length === 0 ? (
                    <div className="text-center py-8">
                        <div className="text-3xl mb-2 opacity-40">
                            <Sparkle size={48} weight="fill" className="mx-auto text-slate-300" />
                        </div>
                        <p className="text-xs text-slate-400">还没有外观预设</p>
                        <p className="text-[10px] text-slate-300 mt-1">保存当前外观或导入预设文件开始使用</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {presets.map(preset => (
                            <div key={preset.id} className="bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden">
                                {/* Preview bar */}
                                <div className="h-14 relative overflow-hidden"
                                    style={{
                                        background: (() => {
                                            const wp = preset.theme.wallpaper;
                                            if (!wp) return `linear-gradient(135deg, hsl(${preset.theme.hue}, ${preset.theme.saturation}%, ${preset.theme.lightness}%), hsl(${preset.theme.hue + 30}, ${preset.theme.saturation}%, ${Math.max(preset.theme.lightness - 15, 10)}%))`;
                                            if (wp.startsWith('linear-gradient') || wp.startsWith('radial-gradient') || wp.startsWith('conic-gradient')) return wp;
                                            return `url("${wp}") center/cover`;
                                        })(),
                                    }}>
                                    <div className="absolute inset-0 bg-black/10" />
                                    <div className="absolute bottom-1.5 left-3 flex gap-1">
                                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: `hsl(${preset.theme.hue}, ${preset.theme.saturation}%, ${preset.theme.lightness}%)` }} />
                                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: preset.theme.contentColor || '#fff' }} />
                                    </div>
                                    {preset.theme.desktopDecorations && preset.theme.desktopDecorations.length > 0 && (
                                        <div className="absolute bottom-1.5 right-3 text-[8px] text-white/80 bg-black/30 px-1.5 py-0.5 rounded-full backdrop-blur-sm">
                                            {preset.theme.desktopDecorations.length} 装饰
                                        </div>
                                    )}
                                </div>

                                {/* Info & actions */}
                                <div className="p-3">
                                    {editingId === preset.id ? (
                                        <div className="flex gap-2 mb-2">
                                            <input
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-primary"
                                                autoFocus
                                                onKeyDown={e => { if (e.key === 'Enter') handleRename(preset.id); if (e.key === 'Escape') setEditingId(null); }}
                                            />
                                            <button onClick={() => handleRename(preset.id)} className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg">确定</button>
                                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-lg">取消</button>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <div className="text-xs font-bold text-slate-700">{preset.name}</div>
                                                <div className="text-[9px] text-slate-400">{new Date(preset.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-1.5 flex-wrap">
                                        <button onClick={() => onApply(preset.id)}
                                            className="px-3 py-1.5 bg-primary text-white text-[10px] font-bold rounded-lg active:scale-95 transition-transform shadow-sm">
                                            应用
                                        </button>
                                        <button onClick={() => handleExport(preset.id)}
                                            className="px-3 py-1.5 bg-green-50 text-green-600 text-[10px] font-bold rounded-lg border border-green-200 active:scale-95 transition-transform">
                                            导出
                                        </button>
                                        <button onClick={() => { setEditingId(preset.id); setEditName(preset.name); }}
                                            className="px-3 py-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-lg border border-slate-200 active:scale-95 transition-transform">
                                            重命名
                                        </button>
                                        {confirmDeleteId === preset.id ? (
                                            <div className="flex gap-1">
                                                <button onClick={() => { onDelete(preset.id); setConfirmDeleteId(null); }}
                                                    className="px-3 py-1.5 bg-red-500 text-white text-[10px] font-bold rounded-lg active:scale-95 transition-transform">
                                                    确认删除
                                                </button>
                                                <button onClick={() => setConfirmDeleteId(null)}
                                                    className="px-3 py-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-lg active:scale-95 transition-transform">
                                                    取消
                                                </button>
                                            </div>
                                        ) : (
                                            <button onClick={() => setConfirmDeleteId(preset.id)}
                                                className="px-3 py-1.5 bg-red-50 text-red-400 text-[10px] font-bold rounded-lg border border-red-200 active:scale-95 transition-transform">
                                                删除
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            <div className="text-[10px] text-slate-400 text-center px-4 pb-4">
                外观预设既可以单独导入/导出，也会随系统整合备份一起保存。你可以保存多个预设并随时切换。
            </div>
        </div>
    );
};

const Appearance: React.FC = () => {
  const { theme, updateTheme, closeApp, setCustomIcon, customIcons, addToast, appearancePresets, saveAppearancePreset, applyAppearancePreset, deleteAppearancePreset, renameAppearancePreset, exportAppearancePreset, importAppearancePreset, resetAppearance } = useOS();
  const [activeTab, setActiveTab] = useState<'theme' | 'icons' | 'presets' | 'chat'>('theme');
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState('');
  const widgetInputRef = useRef<HTMLInputElement>(null);
  const [activeWidgetSlot, setActiveWidgetSlot] = useState<string | null>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  
  // Font State
  const [fontMode, setFontMode] = useState<'local' | 'web'>('local');
  const [webFontUrl, setWebFontUrl] = useState('');

  // Desktop Decoration DIY State
  const decoInputRef = useRef<HTMLInputElement>(null);
  const [editingDecoId, setEditingDecoId] = useState<string | null>(null);
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  const decorations = theme.desktopDecorations || [];
  const editingDeco = editingDecoId ? decorations.find(d => d.id === editingDecoId) : null;

  // Preset decoration SVGs (cute decorative elements)
  const PRESET_DECOS: { name: string; content: string; category: string }[] = [
    // Stars & Sparkles
    { name: '闪光', category: 'stars', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L58 38 L95 50 L58 62 L50 95 L42 62 L5 50 L42 38Z" fill="#FFD700" opacity="0.9"/><path d="M50 20 L54 42 L78 50 L54 58 L50 80 L46 58 L22 50 L46 42Z" fill="#FFF8DC"/></svg>')}` },
    { name: '星星', category: 'stars', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 63,35 95,40 72,62 78,95 50,78 22,95 28,62 5,40 37,35" fill="#FF69B4"/><polygon points="50,20 58,38 78,42 64,55 67,78 50,68 33,78 36,55 22,42 42,38" fill="#FFB6C1" opacity="0.7"/></svg>')}` },
    { name: '小星', category: 'stars', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,10 61,40 95,40 68,60 78,90 50,72 22,90 32,60 5,40 39,40" fill="#B19CD9" opacity="0.85"/></svg>')}` },
    // Hearts
    { name: '爱心', category: 'hearts', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 88 C25 65 5 50 5 30 C5 15 17 5 30 5 C38 5 46 10 50 18 C54 10 62 5 70 5 C83 5 95 15 95 30 C95 50 75 65 50 88Z" fill="#FF6B9D"/><path d="M50 78 C30 60 15 48 15 33 C15 22 23 15 33 15 C39 15 45 18 50 25 C55 18 61 15 67 15 C77 15 85 22 85 33 C85 48 70 60 50 78Z" fill="#FF8FB1" opacity="0.6"/></svg>')}` },
    { name: '双心', category: 'hearts', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M35 70 C18 52 3 42 3 27 C3 16 12 8 22 8 C28 8 33 11 35 16 C37 11 42 8 48 8 C58 8 67 16 67 27 C67 42 52 52 35 70Z" fill="#FF69B4" opacity="0.8"/><path d="M65 80 C48 62 33 52 33 37 C33 26 42 18 52 18 C58 18 63 21 65 26 C67 21 72 18 78 18 C88 18 97 26 97 37 C97 52 82 62 65 80Z" fill="#FF1493" opacity="0.7"/></svg>')}` },
    // Flowers & Nature
    { name: '花朵', category: 'flowers', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="30" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="30" cy="50" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="70" cy="50" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="38" cy="70" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="62" cy="70" r="18" fill="#FFB7D5" opacity="0.8"/><circle cx="50" cy="50" r="12" fill="#FFE4B5"/></svg>')}` },
    { name: '樱花', category: 'flowers', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g transform="translate(50,50)"><g fill="#FFB7C5" opacity="0.85"><ellipse rx="12" ry="22" transform="rotate(0) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(72) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(144) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(216) translate(0,-20)"/><ellipse rx="12" ry="22" transform="rotate(288) translate(0,-20)"/></g><circle r="8" fill="#FF69B4"/></g></svg>')}` },
    { name: '叶子', category: 'flowers', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 10 Q80 30 85 60 Q85 90 50 95 Q15 90 15 60 Q20 30 50 10Z" fill="#90EE90" opacity="0.8"/><path d="M50 20 L50 85" stroke="#228B22" stroke-width="2" fill="none" opacity="0.5"/><path d="M50 40 Q65 35 70 45" stroke="#228B22" stroke-width="1.5" fill="none" opacity="0.4"/><path d="M50 55 Q35 50 30 60" stroke="#228B22" stroke-width="1.5" fill="none" opacity="0.4"/></svg>')}` },
    // Ribbons & Bows
    { name: '蝴蝶结', category: 'ribbons', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 45 Q20 20 10 35 Q5 50 25 55 Q35 57 50 50Z" fill="#FF69B4"/><path d="M50 45 Q80 20 90 35 Q95 50 75 55 Q65 57 50 50Z" fill="#FF69B4"/><circle cx="50" cy="48" r="6" fill="#FF1493"/><path d="M45 54 Q42 75 38 90" stroke="#FF69B4" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M55 54 Q58 75 62 90" stroke="#FF69B4" stroke-width="4" fill="none" stroke-linecap="round"/></svg>')}` },
    { name: '丝带', category: 'ribbons', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 30 Q30 20 50 30 Q70 40 90 30 L90 50 Q70 40 50 50 Q30 60 10 50Z" fill="#DDA0DD" opacity="0.85"/><path d="M10 50 Q30 40 50 50 Q70 60 90 50 L90 70 Q70 60 50 70 Q30 80 10 70Z" fill="#BA55D3" opacity="0.7"/></svg>')}` },
    // Cute Animals
    { name: '猫耳', category: 'animals', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M15 65 L5 15 L40 45Z" fill="#333" opacity="0.9"/><path d="M85 65 L95 15 L60 45Z" fill="#333" opacity="0.9"/><path d="M18 60 L12 22 L38 46Z" fill="#FFB6C1" opacity="0.6"/><path d="M82 60 L88 22 L62 46Z" fill="#FFB6C1" opacity="0.6"/></svg>')}` },
    { name: '猫爪', category: 'animals', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="62" rx="22" ry="20" fill="#FFB6C1" opacity="0.85"/><circle cx="35" cy="38" r="10" fill="#FFB6C1" opacity="0.85"/><circle cx="65" cy="38" r="10" fill="#FFB6C1" opacity="0.85"/><circle cx="22" cy="50" r="9" fill="#FFB6C1" opacity="0.85"/><circle cx="78" cy="50" r="9" fill="#FFB6C1" opacity="0.85"/></svg>')}` },
    // Geometric / Shapes
    { name: '月亮', category: 'shapes', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M60 10 A40 40 0 1 0 60 90 A30 30 0 1 1 60 10Z" fill="#FFD700" opacity="0.8"/></svg>')}` },
    { name: '钻石', category: 'shapes', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 85,35 50,95 15,35" fill="#87CEEB" opacity="0.8"/><polygon points="50,5 65,35 50,95" fill="#ADD8E6" opacity="0.5"/><polygon points="15,35 85,35 50,5" fill="#B0E0E6" opacity="0.6"/></svg>')}` },
    { name: '泡泡', category: 'shapes', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="none" stroke="#87CEEB" stroke-width="2" opacity="0.6"/><circle cx="50" cy="50" r="35" fill="#E0F0FF" opacity="0.2"/><ellipse cx="38" cy="38" rx="12" ry="8" fill="white" opacity="0.5" transform="rotate(-30 38 38)"/></svg>')}` },
    // Text Badges
    { name: 'LOVE', category: 'badges', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="2" y="2" width="116" height="46" rx="23" fill="#FF69B4" opacity="0.85"/><text x="60" y="33" text-anchor="middle" fill="white" font-size="22" font-weight="bold" font-family="sans-serif">LOVE</text></svg>')}` },
    { name: 'CUTE', category: 'badges', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="2" y="2" width="116" height="46" rx="23" fill="#DDA0DD" opacity="0.85"/><text x="60" y="33" text-anchor="middle" fill="white" font-size="22" font-weight="bold" font-family="sans-serif">CUTE</text></svg>')}` },
    { name: 'MY♡', category: 'badges', content: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50"><rect x="2" y="2" width="116" height="46" rx="10" fill="none" stroke="#FF69B4" stroke-width="3" opacity="0.8"/><text x="60" y="34" text-anchor="middle" fill="#FF69B4" font-size="20" font-weight="bold" font-family="sans-serif">MY♡</text></svg>')}` },
  ];

  const addDecoration = useCallback((content: string, type: 'image' | 'preset') => {
    const newDeco: DesktopDecoration = {
      id: `deco-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      content,
      x: 20 + Math.random() * 60,
      y: 20 + Math.random() * 60,
      scale: 1,
      rotation: 0,
      opacity: 1,
      zIndex: decorations.length + 1,
    };
    const next = [...decorations, newDeco];
    updateTheme({ desktopDecorations: next });
    setEditingDecoId(newDeco.id);
    setShowPresetPicker(false);
  }, [decorations, updateTheme]);

  const updateDecoration = useCallback((id: string, updates: Partial<DesktopDecoration>) => {
    const next = decorations.map(d => d.id === id ? { ...d, ...updates } : d);
    updateTheme({ desktopDecorations: next });
  }, [decorations, updateTheme]);

  const removeDecoration = useCallback((id: string) => {
    const next = decorations.filter(d => d.id !== id);
    updateTheme({ desktopDecorations: next });
    if (editingDecoId === id) setEditingDecoId(null);
  }, [decorations, updateTheme, editingDecoId]);

  const handleDecoUpload = async (file: File) => {
    try {
      const dataUrl = await processImage(file, { maxWidth: 400, quality: 0.85 });
      addDecoration(dataUrl, 'image');
      addToast('装饰已添加', 'success');
    } catch (e: any) {
      addToast(e.message, 'error');
    }
  };

  const THEME_PRESETS: { name: string, config: Partial<OSTheme>, color: string }[] = [
      { name: 'Indigo', config: { hue: 245, saturation: 25, lightness: 65, contentColor: '#ffffff' }, color: 'hsl(245, 25%, 65%)' },
      { name: 'Sakura', config: { hue: 350, saturation: 70, lightness: 80, contentColor: '#334155' }, color: 'hsl(350, 70%, 80%)' },
      { name: 'Cyber', config: { hue: 170, saturation: 100, lightness: 45, contentColor: '#ffffff' }, color: 'hsl(170, 100%, 45%)' },
      { name: 'Noir', config: { hue: 0, saturation: 0, lightness: 20, contentColor: '#ffffff' }, color: 'hsl(0, 0%, 20%)' },
      { name: 'Sunset', config: { hue: 20, saturation: 90, lightness: 60, contentColor: '#ffffff' }, color: 'hsl(20, 90%, 60%)' },
  ];

  const handleWallpaperUpload = async (file: File) => {
      try {
          addToast('正在处理壁纸 (原画质)...', 'info');
          // Use skipCompression to keep original quality
          const dataUrl = await processImage(file, { skipCompression: true });
          updateTheme({ wallpaper: dataUrl });
          addToast('壁纸更新成功', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const applyWallpaperUrl = () => {
      const url = wallpaperUrl.trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('blob:')) {
          addToast('请填写以 http(s):// 开头的图片地址', 'error');
          return;
      }
      updateTheme({ wallpaper: url });
      setWallpaperUrl('');
      addToast('壁纸已应用', 'success');
  };

  const handleWidgetUpload = async (file: File) => {
      if (!activeWidgetSlot) return;
      try {
          const maxW = activeWidgetSlot === 'wide' ? 800 : activeWidgetSlot === 'dsq' ? 600 : 500;
          const dataUrl = await processImage(file, { maxWidth: maxW, quality: 0.9 });
          const current = theme.launcherWidgets || {};
          updateTheme({ launcherWidgets: { ...current, [activeWidgetSlot]: dataUrl } });
          addToast('小组件已更新', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  const removeWidget = (slot: string) => {
      const current = { ...(theme.launcherWidgets || {}) };
      delete current[slot];
      updateTheme({ launcherWidgets: Object.keys(current).length > 0 ? current : undefined });
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const allowedExts = ['.ttf', '.otf', '.woff', '.woff2'];
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      
      if (!allowedExts.includes(ext)) {
          addToast('仅支持 ttf/otf/woff/woff2 格式', 'error');
          return;
      }

      addToast('正在处理字体文件...', 'info');
      
      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const dataUrl = ev.target?.result as string;
              updateTheme({ customFont: dataUrl });
              addToast('系统字体已更新', 'success');
          } catch(err) {
              addToast('字体加载失败', 'error');
          }
      };
      reader.onerror = () => addToast('读取失败', 'error');
      reader.readAsDataURL(file);
      
      // Clear input
      if (fontInputRef.current) fontInputRef.current.value = '';
  };

  const applyWebFont = () => {
      if (!webFontUrl.trim()) return;
      updateTheme({ customFont: webFontUrl.trim() });
      setWebFontUrl('');
      addToast('网络字体已应用', 'success');
  };

  const handleIconUpload = async (file: File) => {
      if (!selectedAppId) return;
      try {
          const dataUrl = await processImage(file);
          setCustomIcon(selectedAppId, dataUrl);
          addToast('应用图标已更新', 'success');
      } catch (e: any) {
          addToast(e.message, 'error');
      }
  };

  return (
    <div className="h-full w-full bg-slate-50 flex flex-col font-light">
      <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-10 sticky top-0">
        <div className="flex items-center gap-2 w-full">
            <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <h1 className="text-xl font-medium text-slate-700 tracking-wide">外观定制</h1>
        </div>
      </div>

      <div className="flex border-b border-slate-200 bg-white sticky top-0 z-20">
          <button onClick={() => setActiveTab('theme')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'theme' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>系统主题</button>
          <button onClick={() => setActiveTab('icons')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'icons' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>应用图标</button>
          <button onClick={() => setActiveTab('presets')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'presets' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>外观预设</button>
          <button onClick={() => setActiveTab('chat')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'chat' ? 'text-primary border-b-2 border-primary' : 'text-slate-400'}`}>聊天界面</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6 no-scrollbar">
        {activeTab === 'theme' ? (
            <>
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Preset Themes</h2>
                    <div className="flex gap-3 mb-6 overflow-x-auto no-scrollbar pb-1">
                        {THEME_PRESETS.map(preset => (
                            <button 
                                key={preset.name}
                                onClick={() => updateTheme(preset.config)}
                                className="flex flex-col items-center gap-1.5 shrink-0 group"
                            >
                                <div className="w-10 h-10 rounded-full shadow-sm border-2 border-white ring-1 ring-black/5 transition-transform group-active:scale-95" style={{ backgroundColor: preset.color }}></div>
                                <span className="text-[10px] text-slate-500 font-medium">{preset.name}</span>
                            </button>
                        ))}
                    </div>

                    <div className="space-y-5">
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Hue</span><span>{theme.hue}°</span>
                            </div>
                            <input type="range" min="0" max="360" value={theme.hue} onChange={(e) => updateTheme({ hue: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                            <div className="h-2 w-full rounded-full mt-3 opacity-50" style={{ background: `linear-gradient(to right, hsl(0, 50%, 80%), hsl(60, 50%, 80%), hsl(120, 50%, 80%), hsl(180, 50%, 80%), hsl(240, 50%, 80%), hsl(300, 50%, 80%), hsl(360, 50%, 80%))`}}></div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Saturation</span><span>{theme.saturation}%</span>
                            </div>
                            <input type="range" min="0" max="100" value={theme.saturation} onChange={(e) => updateTheme({ saturation: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Lightness</span><span>{theme.lightness}%</span>
                            </div>
                            <input type="range" min="10" max="95" value={theme.lightness} onChange={(e) => updateTheme({ lightness: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                        </div>
                        <div>
                            <div className="flex justify-between text-xs text-slate-500 mb-2 font-medium">
                                <span>Text/Widget Color</span>
                            </div>
                            <div className="flex gap-4 items-center bg-slate-50 p-2 rounded-xl border border-slate-100">
                                <div 
                                    onClick={() => updateTheme({ contentColor: '#ffffff' })}
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer shadow-sm ${theme.contentColor === '#ffffff' ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'}`} 
                                    style={{ backgroundColor: '#ffffff' }}
                                />
                                <div 
                                    onClick={() => updateTheme({ contentColor: '#334155' })} // Slate-700
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer shadow-sm ${theme.contentColor === '#334155' ? 'border-primary ring-2 ring-primary/20' : 'border-slate-200'}`} 
                                    style={{ backgroundColor: '#334155' }}
                                />
                                <div className="h-6 w-px bg-slate-200 mx-1"></div>
                                <input 
                                    type="color" 
                                    value={theme.contentColor || '#ffffff'} 
                                    onChange={(e) => updateTheme({ contentColor: e.target.value })}
                                    className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent p-0" 
                                />
                                <span className="text-xs text-slate-400 font-mono">{theme.contentColor}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Global Font Section */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">全局字体 (Global Font)</h2>
                    
                    <div className="flex bg-slate-100 p-1 rounded-xl mb-4">
                        <button onClick={() => setFontMode('local')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${fontMode === 'local' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}>本地文件</button>
                        <button onClick={() => setFontMode('web')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${fontMode === 'web' ? 'bg-white text-primary shadow-sm' : 'text-slate-400'}`}>网络 URL</button>
                    </div>

                    {fontMode === 'local' ? (
                        <>
                            <div 
                                className="w-full h-24 bg-slate-100 rounded-2xl overflow-hidden relative shadow-inner mb-2 group cursor-pointer border-2 border-dashed border-slate-200 hover:border-primary/50 flex items-center justify-center flex-col gap-2" 
                                onClick={() => fontInputRef.current?.click()}
                            >
                                {theme.customFont && theme.customFont.startsWith('data:') ? (
                                    <>
                                        <span className="text-lg font-bold text-slate-700">Abc 字体预览</span>
                                        <span className="text-[10px] text-slate-400">已应用本地字体</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-2xl text-slate-400">Aa</span>
                                        <span className="text-xs text-slate-400">上传字体文件 (.ttf / .otf)</span>
                                    </>
                                )}
                                <div className="absolute inset-0 bg-black/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="text-white text-xs font-bold bg-black/40 px-3 py-1 rounded-full backdrop-blur-md">更换字体</span>
                                </div>
                            </div>
                            <input type="file" ref={fontInputRef} className="hidden" accept=".ttf,.otf,.woff,.woff2" onChange={handleFontUpload} />
                        </>
                    ) : (
                        <div className="space-y-2">
                            <input 
                                value={webFontUrl} 
                                onChange={e => setWebFontUrl(e.target.value)} 
                                placeholder="输入字体文件 URL (https://...)" 
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary transition-all"
                            />
                            <button onClick={applyWebFont} className="w-full py-2 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform">
                                应用网络字体
                            </button>
                            <div className="text-[10px] text-slate-400 px-1">
                                {theme.customFont && theme.customFont.startsWith('http') ? (
                                    <span className="text-green-500">当前使用: {theme.customFont}</span>
                                ) : '提示: 请确保链接直通字体文件 (.ttf/.woff)'}
                            </div>
                        </div>
                    )}

                    {theme.customFont && (
                        <button onClick={() => updateTheme({ customFont: undefined })} className="w-full py-2 text-xs font-bold text-red-400 bg-red-50 rounded-lg hover:bg-red-100 mt-2">恢复默认字体</button>
                    )}
                </section>

                {/* Status Bar Toggle */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">状态栏 (Status Bar)</h2>
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-slate-700">隐藏顶部时间栏</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">隐藏屏幕顶部的时间、电量等信息</div>
                        </div>
                        <button
                            onClick={() => updateTheme({ hideStatusBar: !theme.hideStatusBar })}
                            className={`w-12 h-7 rounded-full transition-colors relative ${theme.hideStatusBar ? 'bg-primary' : 'bg-slate-200'}`}
                        >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${theme.hideStatusBar ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </section>

                {/* Wallpaper Section */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">Wallpaper</h2>
                    <LongPressArea
                        className="aspect-[9/16] w-1/2 mx-auto bg-slate-100 rounded-2xl overflow-hidden relative shadow-inner mb-4 group cursor-pointer"
                        onClick={() => wallpaperInputRef.current?.click()}
                        onLongPress={() => {
                            if (theme.wallpaper === DEFAULT_WALLPAPER) {
                                addToast('当前已是默认壁纸', 'info');
                                return;
                            }
                            updateTheme({ wallpaper: DEFAULT_WALLPAPER });
                            addToast('已恢复默认壁纸', 'success');
                        }}
                    >
                         <div
                            className="w-full h-full"
                            style={{
                                background: !theme.wallpaper
                                    ? '#e2e8f0'
                                    : (theme.wallpaper.startsWith('linear-gradient') || theme.wallpaper.startsWith('radial-gradient') || theme.wallpaper.startsWith('conic-gradient'))
                                        ? theme.wallpaper
                                        : `url("${theme.wallpaper}") center/cover`,
                            }}
                         />
                         <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                             <span className="text-white text-xs font-bold bg-black/20 px-3 py-1 rounded-full backdrop-blur-md">更换壁纸</span>
                         </div>
                    </LongPressArea>
                    <input type="file" ref={wallpaperInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWallpaperUpload(e.target.files[0])} />
                    <p className="text-center text-[10px] text-slate-400 mb-4">点击上传 / 长按恢复默认壁纸 (支持原画质)</p>

                    <div className="border-t border-slate-100 pt-4 space-y-2">
                        <p className="text-[11px] font-bold text-slate-500">从 URL 导入</p>
                        <input
                            value={wallpaperUrl}
                            onChange={e => setWallpaperUrl(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') applyWallpaperUrl(); }}
                            placeholder="输入图片地址 (https://...)"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs outline-none focus:border-primary transition-all"
                        />
                        <button
                            onClick={applyWallpaperUrl}
                            disabled={!wallpaperUrl.trim()}
                            className="w-full py-2 bg-primary text-white font-bold text-xs rounded-xl shadow-md active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
                        >
                            应用网络壁纸
                        </button>
                        <p className="text-[10px] text-slate-400">直接引用网络图片，不占用本地存储</p>
                    </div>
                </section>

                {/* Page 1 Desktop Square Image */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">首页方形图片</h2>
                    <p className="text-[10px] text-slate-400 mb-4">桌面首页右下角的方形图片槽位，长按移除</p>
                    <div className="flex justify-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        {(() => {
                            const slot = 'dsq';
                            const img = (theme.launcherWidgets || {})[slot];
                            return (
                                <LongPressArea
                                    className={`w-40 aspect-square rounded-2xl overflow-hidden relative cursor-pointer transition-transform active:scale-95 ${img ? 'shadow-sm' : 'border-2 border-dashed border-slate-200 bg-white flex items-center justify-center'}`}
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => {
                                        if (img) {
                                            removeWidget(slot);
                                            addToast('已移除方图', 'success');
                                        }
                                    }}
                                >
                                    {img ? (
                                        <>
                                            <img src={img} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                <span className="text-white text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded-full">更换</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-300 text-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7 mx-auto mb-1"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                            <span className="text-[10px]">方图</span>
                                        </div>
                                    )}
                                </LongPressArea>
                            );
                        })()}
                    </div>
                </section>

                {/* Page 2 Widget Images */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">桌面小组件</h2>
                    <p className="text-[10px] text-slate-400 mb-4">上传小组件图片（如时钟截图、推图等），长按移除</p>
                    <input type="file" ref={widgetInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleWidgetUpload(e.target.files[0])} />
                    <div className="space-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                        <div className="flex gap-2">
                            {['tl', 'tr'].map(slot => {
                                const img = (theme.launcherWidgets || {})[slot];
                                return (
                                    <LongPressArea
                                        key={slot}
                                        className={`flex-1 aspect-square rounded-xl overflow-hidden relative cursor-pointer transition-transform active:scale-95 ${img ? 'shadow-sm' : 'border-2 border-dashed border-slate-200 bg-white flex items-center justify-center'}`}
                                        onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                        onLongPress={() => {
                                            if (img) {
                                                removeWidget(slot);
                                                addToast('已移除小组件', 'success');
                                            }
                                        }}
                                    >
                                        {img ? (
                                            <>
                                                <img src={img} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                    <span className="text-white text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded-full">更换</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-slate-300 text-center">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 mx-auto mb-1"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                <span className="text-[9px]">图片</span>
                                            </div>
                                        )}
                                    </LongPressArea>
                                );
                            })}
                        </div>
                        {(() => {
                            const slot = 'wide';
                            const img = (theme.launcherWidgets || {})[slot];
                            return (
                                <LongPressArea
                                    className={`w-full h-20 rounded-xl overflow-hidden relative cursor-pointer transition-transform active:scale-[0.98] ${img ? 'shadow-sm' : 'border-2 border-dashed border-slate-200 bg-white flex items-center justify-center'}`}
                                    onClick={() => { setActiveWidgetSlot(slot); widgetInputRef.current?.click(); }}
                                    onLongPress={() => {
                                        if (img) {
                                            removeWidget(slot);
                                            addToast('已移除横幅', 'success');
                                        }
                                    }}
                                >
                                    {img ? (
                                        <>
                                            <img src={img} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                                                <span className="text-white text-[10px] font-bold bg-black/40 px-2 py-0.5 rounded-full">更换</span>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-slate-300 text-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mx-auto mb-0.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                            <span className="text-[9px]">横幅</span>
                                        </div>
                                    )}
                                </LongPressArea>
                            );
                        })()}
                    </div>
                </section>

                {/* Desktop Decoration DIY Section */}
                <section className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">桌面装饰 DIY</h2>
                        <span className="text-[10px] bg-gradient-to-r from-pink-100 to-purple-100 text-pink-500 px-2 py-0.5 rounded-full font-bold">花里胡哨模式</span>
                    </div>
                    <p className="text-[10px] text-slate-400 mb-4">自由添加装饰贴纸，调整位置/大小/旋转/透明度，打造你的专属痛机桌面！</p>
                    <input type="file" ref={decoInputRef} className="hidden" accept="image/*" onChange={(e) => { if (e.target.files?.[0]) handleDecoUpload(e.target.files[0]); e.target.value = ''; }} />

                    {/* Live Preview */}
                    <div className="relative w-full aspect-[9/16] bg-slate-100 rounded-2xl overflow-hidden mb-4 border border-slate-200 shadow-inner"
                         style={{ background: theme.wallpaper ? `url(${theme.wallpaper}) center/cover` : `linear-gradient(135deg, hsl(${theme.hue}, ${theme.saturation}%, ${theme.lightness}%), hsl(${theme.hue + 30}, ${theme.saturation}%, ${Math.max(theme.lightness - 15, 10)}%))` }}>
                        <div className="absolute inset-0 bg-black/10"></div>
                        {/* Render widget previews */}
                        <div className="absolute top-[12%] left-4 right-4 space-y-1.5 pointer-events-none">
                            {(() => {
                                const w = theme.launcherWidgets || {};
                                return (
                                    <>
                                        {(w['tl'] || w['tr']) && (
                                            <div className="flex gap-1.5">
                                                {['tl', 'tr'].map(k => w[k] ? (
                                                    <div key={k} className="flex-1 aspect-square rounded-lg overflow-hidden opacity-70"><img src={w[k]} className="w-full h-full object-cover" /></div>
                                                ) : <div key={k} className="flex-1" />)}
                                            </div>
                                        )}
                                        {w['wide'] && (
                                            <div className="w-full h-8 rounded-lg overflow-hidden opacity-70"><img src={w['wide']} className="w-full h-full object-cover" /></div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                        {/* Render decorations in preview */}
                        {decorations.map(deco => (
                            <div key={deco.id}
                                className={`absolute cursor-pointer transition-all duration-100 ${editingDecoId === deco.id ? 'ring-2 ring-pink-400 ring-offset-1' : ''}`}
                                style={{
                                    left: `${deco.x}%`, top: `${deco.y}%`,
                                    transform: `translate(-50%, -50%) scale(${deco.scale * 0.4}) rotate(${deco.rotation}deg)${deco.flip ? ' scaleX(-1)' : ''}`,
                                    opacity: deco.opacity, zIndex: deco.zIndex,
                                }}
                                onClick={() => setEditingDecoId(editingDecoId === deco.id ? null : deco.id)}>
                                <img src={deco.content} className="w-16 h-16 object-contain pointer-events-none select-none" draggable={false} />
                            </div>
                        ))}
                        {decorations.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center text-white/40">
                                    <Sparkle size={48} weight="fill" className="text-white/60 mb-2" />
                                    <div className="text-[10px] font-bold">添加装饰开始DIY</div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Add Decoration Buttons */}
                    <div className="flex gap-2 mb-4">
                        <button onClick={() => setShowPresetPicker(!showPresetPicker)}
                            className="flex-1 py-2.5 bg-gradient-to-r from-pink-50 to-purple-50 text-pink-500 font-bold text-xs rounded-xl border border-pink-200 active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" /></svg>
                            预设贴纸
                        </button>
                        <button onClick={() => decoInputRef.current?.click()}
                            className="flex-1 py-2.5 bg-gradient-to-r from-blue-50 to-cyan-50 text-blue-500 font-bold text-xs rounded-xl border border-blue-200 active:scale-95 transition-transform flex items-center justify-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>
                            上传自定义
                        </button>
                    </div>

                    {/* Preset Picker */}
                    {showPresetPicker && (
                        <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100 mb-4 animate-fade-in">
                            <div className="text-[10px] text-slate-400 font-bold uppercase mb-3">选择预设装饰</div>
                            {['stars', 'hearts', 'flowers', 'ribbons', 'animals', 'shapes', 'badges'].map(cat => {
                                const items = PRESET_DECOS.filter(p => p.category === cat);
                                if (items.length === 0) return null;
                                const catInfo = CATEGORY_LABELS[cat];
                                return (
                                    <div key={cat} className="mb-3">
                                        <div className="text-[10px] text-slate-500 mb-1.5 flex items-center gap-1">{catInfo && <TwemojiImg code={catInfo.code} className="w-3.5 h-3.5 inline-block" />} {catInfo?.label || cat}</div>
                                        <div className="flex gap-2 flex-wrap">
                                            {items.map(preset => (
                                                <button key={preset.name} onClick={() => addDecoration(preset.content, 'preset')}
                                                    className="w-14 h-14 bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center gap-0.5 hover:border-pink-300 hover:shadow-sm active:scale-90 transition-all group">
                                                    <img src={preset.content} className="w-8 h-8 object-contain group-hover:scale-110 transition-transform" />
                                                    <span className="text-[8px] text-slate-400">{preset.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Decoration List & Editor */}
                    {decorations.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-[10px] text-slate-400 font-bold uppercase mb-2">已添加装饰 ({decorations.length})</div>
                            {decorations.map((deco, idx) => (
                                <div key={deco.id} className={`bg-slate-50 rounded-xl border transition-all ${editingDecoId === deco.id ? 'border-pink-300 shadow-md' : 'border-slate-100'}`}>
                                    {/* Decoration header row */}
                                    <div className="flex items-center gap-2 p-2.5 cursor-pointer" onClick={() => setEditingDecoId(editingDecoId === deco.id ? null : deco.id)}>
                                        <div className="w-10 h-10 bg-white rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                            <img src={deco.content} className="w-8 h-8 object-contain" style={{ transform: deco.flip ? 'scaleX(-1)' : undefined }} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-bold text-slate-600">装饰 #{idx + 1}</div>
                                            <div className="text-[9px] text-slate-400">位置 ({Math.round(deco.x)}, {Math.round(deco.y)}) · {deco.scale}x · {deco.rotation}°</div>
                                        </div>
                                        <button onClick={(e) => { e.stopPropagation(); removeDecoration(deco.id); }} className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                        </button>
                                        <div className={`w-5 h-5 flex items-center justify-center transition-transform ${editingDecoId === deco.id ? 'rotate-180' : ''}`}>
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
                                        </div>
                                    </div>

                                    {/* Expanded edit controls */}
                                    {editingDecoId === deco.id && (
                                        <div className="px-3 pb-3 space-y-4 animate-fade-in border-t border-slate-100 pt-3">
                                            {/* Position X */}
                                            <div>
                                                <div className="flex justify-between mb-1.5">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">水平位置 X</label>
                                                    <span className="text-[10px] text-slate-500 font-mono">{Math.round(deco.x)}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={deco.x} onChange={(e) => updateDecoration(deco.id, { x: parseFloat(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-pink-400" />
                                            </div>
                                            {/* Position Y */}
                                            <div>
                                                <div className="flex justify-between mb-1.5">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">垂直位置 Y</label>
                                                    <span className="text-[10px] text-slate-500 font-mono">{Math.round(deco.y)}%</span>
                                                </div>
                                                <input type="range" min="0" max="100" value={deco.y} onChange={(e) => updateDecoration(deco.id, { y: parseFloat(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-pink-400" />
                                            </div>
                                            {/* Scale & Rotation */}
                                            <div className="grid grid-cols-2 gap-4">
                                                <div>
                                                    <div className="flex justify-between mb-1.5">
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase">缩放</label>
                                                        <span className="text-[10px] text-slate-500 font-mono">{deco.scale}x</span>
                                                    </div>
                                                    <input type="range" min="0.2" max="3" step="0.1" value={deco.scale} onChange={(e) => updateDecoration(deco.id, { scale: parseFloat(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-purple-400" />
                                                </div>
                                                <div>
                                                    <div className="flex justify-between mb-1.5">
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase">旋转</label>
                                                        <span className="text-[10px] text-slate-500 font-mono">{deco.rotation}°</span>
                                                    </div>
                                                    <input type="range" min="-180" max="180" value={deco.rotation} onChange={(e) => updateDecoration(deco.id, { rotation: parseInt(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-purple-400" />
                                                </div>
                                            </div>
                                            {/* Opacity */}
                                            <div>
                                                <div className="flex justify-between mb-1.5">
                                                    <label className="text-[10px] font-bold text-slate-400 uppercase">透明度</label>
                                                    <span className="text-[10px] text-slate-500 font-mono">{Math.round(deco.opacity * 100)}%</span>
                                                </div>
                                                <input type="range" min="0.1" max="1" step="0.05" value={deco.opacity} onChange={(e) => updateDecoration(deco.id, { opacity: parseFloat(e.target.value) })} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-400" />
                                            </div>
                                            {/* Quick Actions */}
                                            <div className="flex gap-2 flex-wrap">
                                                <button onClick={() => updateDecoration(deco.id, { flip: !deco.flip })}
                                                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all active:scale-95 ${deco.flip ? 'bg-pink-50 text-pink-500 border-pink-200' : 'bg-white text-slate-400 border-slate-200'}`}>
                                                    镜像翻转
                                                </button>
                                                <button onClick={() => updateDecoration(deco.id, { rotation: 0, scale: 1, opacity: 1, flip: false })}
                                                    className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-white text-slate-400 border border-slate-200 active:scale-95 transition-all">
                                                    重置参数
                                                </button>
                                                <button onClick={() => {
                                                    const dup: DesktopDecoration = { ...deco, id: `deco-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, x: Math.min(deco.x + 8, 95), y: Math.min(deco.y + 8, 95) };
                                                    const next = [...decorations, dup];
                                                    updateTheme({ desktopDecorations: next });
                                                    setEditingDecoId(dup.id);
                                                }}
                                                    className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-white text-slate-400 border border-slate-200 active:scale-95 transition-all">
                                                    复制一个
                                                </button>
                                                {/* Layer controls */}
                                                <button onClick={() => {
                                                    const maxZ = Math.max(...decorations.map(d => d.zIndex), 0);
                                                    updateDecoration(deco.id, { zIndex: maxZ + 1 });
                                                }}
                                                    className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-white text-slate-400 border border-slate-200 active:scale-95 transition-all">
                                                    置顶
                                                </button>
                                                <button onClick={() => updateDecoration(deco.id, { zIndex: 0 })}
                                                    className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-white text-slate-400 border border-slate-200 active:scale-95 transition-all">
                                                    置底
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {/* Clear all button */}
                            <button onClick={() => { updateTheme({ desktopDecorations: [] }); setEditingDecoId(null); }}
                                className="w-full py-2 text-xs font-bold text-red-400 bg-red-50 rounded-xl hover:bg-red-100 transition-colors mt-2">
                                清空所有装饰
                            </button>
                        </div>
                    )}
                    <div className="text-[10px] text-slate-400 mt-3 px-1">提示: 装饰会叠加显示在桌面第二页上，可自由调节每个装饰的位置、大小、旋转和透明度。支持上传自定义图片或使用预设贴纸。</div>
                </section>
            </>
        ) : activeTab === 'icons' ? (
            <div className="grid grid-cols-3 gap-4">
                {INSTALLED_APPS.map(app => {
                    const Icon = Icons[app.icon];
                    const customUrl = customIcons[app.id];
                    return (
                        <div key={app.id} className="flex flex-col items-center gap-2">
                             <div 
                                className="w-16 h-16 rounded-2xl shadow-sm bg-slate-200 overflow-hidden relative group cursor-pointer"
                                onClick={() => { setSelectedAppId(app.id); iconInputRef.current?.click(); }}
                             >
                                 {customUrl ? (
                                     <img src={customUrl} className="w-full h-full object-cover" />
                                 ) : (
                                     <div className={`w-full h-full ${app.color} flex items-center justify-center text-white`}>
                                         <Icon className="w-8 h-8" />
                                     </div>
                                 )}
                                 <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6 text-white"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>
                                 </div>
                             </div>
                             <span className="text-[10px] text-slate-500 font-medium">{app.name}</span>
                             {customUrl && (
                                 <button onClick={() => setCustomIcon(app.id, undefined)} className="text-[10px] text-red-400">重置</button>
                             )}
                        </div>
                    );
                })}
                <input type="file" ref={iconInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleIconUpload(e.target.files[0])} />
            </div>
        ) : activeTab === 'presets' ? (
            <PresetManager
                presets={appearancePresets}
                onSave={saveAppearancePreset}
                onApply={applyAppearancePreset}
                onDelete={deleteAppearancePreset}
                onRename={renameAppearancePreset}
                onExport={exportAppearancePreset}
                onImport={importAppearancePreset}
                onReset={resetAppearance}
                addToast={addToast}
                currentTheme={theme}
            />
        ) : activeTab === 'chat' ? (
            <ModularChatAppearanceEditor theme={theme} updateTheme={updateTheme} />
        ) : null}
      </div>
    </div>
  );
};

export default Appearance;
