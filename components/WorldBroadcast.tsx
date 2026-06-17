import React, { useEffect, useRef, useState } from 'react';

/**
 * 「家园」全局生成喇叭 —— 任意界面都能看到某个世界正在演绎（推进一段 / 结卷）。
 * 监听 runWorldEpisode 派发的 world-episode-* / world-chapter-* 事件，App 根级挂载。
 * 与彼方 VRBroadcast 同构，但走家园的淡紫风。
 */
interface WorldGen { worldId: string; worldName: string; storyTime?: string; done: number; total: number; charName?: string; chapter?: number; }

const WorldBroadcast: React.FC = () => {
    const [gen, setGen] = useState<WorldGen | null>(null);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const clearHide = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
        const onStart = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            clearHide();
            setGen({ worldId: d.worldId, worldName: d.worldName || '家园', storyTime: d.storyTime, done: 0, total: d.total || 1 });
        };
        const onBeat = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            setGen(prev => prev && prev.worldId === d.worldId ? { ...prev, done: d.done ?? prev.done, total: d.total ?? prev.total, charName: d.charName } : prev);
        };
        const onChapterStart = (e: Event) => {
            const d = (e as CustomEvent).detail || {};
            setGen(prev => prev && prev.worldId === d.worldId ? { ...prev, chapter: d.index } : prev);
        };
        const onEnd = (e: Event) => {
            const id = (e as CustomEvent).detail?.worldId;
            clearHide();
            hideTimer.current = setTimeout(() => setGen(prev => (prev && prev.worldId === id ? null : prev)), 1400);
        };
        window.addEventListener('world-episode-start', onStart);
        window.addEventListener('world-beat-done', onBeat);
        window.addEventListener('world-chapter-start', onChapterStart);
        window.addEventListener('world-episode-end', onEnd);
        return () => {
            window.removeEventListener('world-episode-start', onStart);
            window.removeEventListener('world-beat-done', onBeat);
            window.removeEventListener('world-chapter-start', onChapterStart);
            window.removeEventListener('world-episode-end', onEnd);
            clearHide();
        };
    }, []);

    if (!gen) return null;
    const pct = Math.round((gen.done / Math.max(1, gen.total)) * 100);
    const label = gen.chapter
        ? `结第 ${gen.chapter} 卷总结中…`
        : gen.charName
            ? `正在演绎 ${gen.charName} · ${gen.done}/${gen.total}`
            : '世界引擎运转中…';

    return (
        <div className="fixed left-1/2 -translate-x-1/2 z-[999] pointer-events-none" style={{ top: 'calc(var(--safe-top) + 6px)' }}>
            <style>{`@keyframes whbcin{from{opacity:0;transform:translateY(-14px) scale(.96)}to{opacity:1;transform:translateY(0) scale(1)}}
                     @keyframes whbcshimmer{0%{background-position:-120% 0}100%{background-position:220% 0}}
                     @keyframes whbctwinkle{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1.1)}}`}</style>
            <div className="relative flex items-center gap-2.5 pl-3 pr-3.5 py-1.5 rounded-full overflow-hidden backdrop-blur-xl"
                style={{
                    animation: 'whbcin .45s cubic-bezier(.2,.9,.3,1.2)',
                    background: 'linear-gradient(100deg, rgba(58,53,102,.85), rgba(36,29,68,.85))',
                    border: '1px solid rgba(200,180,255,.3)',
                    boxShadow: '0 10px 30px rgba(0,0,0,.4), inset 0 1px 0 rgba(210,195,255,.18), 0 0 18px rgba(160,130,225,.2)',
                }}>
                <div className="absolute inset-0 pointer-events-none" style={{
                    background: 'linear-gradient(105deg,transparent 32%,rgba(210,195,255,.18) 50%,transparent 68%)',
                    backgroundSize: '220% 100%',
                    animation: 'whbcshimmer 3s linear infinite',
                }} />
                <span className="relative text-[12px] text-violet-100" style={{ filter: 'drop-shadow(0 0 5px rgba(200,170,255,.6))' }}>⌂</span>
                <span className="relative text-[11px] tracking-[0.03em] text-white/90 whitespace-nowrap font-light">
                    <span className="text-amber-200/90">「{gen.worldName}」</span>{label}
                </span>
                {!gen.chapter && (
                    <span className="relative w-12 h-1 rounded-full bg-white/15 overflow-hidden">
                        <span className="block h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#a78bfa,#f0abfc)' }} />
                    </span>
                )}
                <span className="relative flex gap-1">
                    {[0, 1, 2].map(i => (
                        <span key={i} className="w-1 h-1 rounded-full bg-violet-100/80" style={{ animation: 'whbctwinkle 1.4s infinite', animationDelay: `${i * 0.25}s` }} />
                    ))}
                </span>
            </div>
        </div>
    );
};

export default WorldBroadcast;
