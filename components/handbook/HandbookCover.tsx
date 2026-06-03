/**
 * 列表视图 = 杂志感手账封面 + 今日丝带书签 + 散落贴纸 + tab 标签纸
 *
 * 视觉灵感：季節の手帳 — magazine-style cover with washi tape,
 *           DM Serif Display 大标语 + Caveat 月份花字 + Shippori Mincho 副标 + Courier 卷号
 */

import React from 'react';
import { HandbookEntry } from '../../types';
import {
    PAPER_TONES, SERIF_STACK, CUTE_STACK, DISPLAY_STACK, SCRIPT_STACK, JP_STACK, MONO_STACK,
    dayOfWeekZh, monthEn, monthFullEn, dayNum, yearNum,
    seasonOf, seasonLabel, volNum, tiltFor,
} from './paper';
import {
    StarSticker, PawSticker, BowSticker, SparkleDot, Cloud,
    Ribbon, ScatteredStickers,
} from './stickers';
import { Sparkle, Notebook, CaretRight } from '@phosphor-icons/react';

interface CoverProps {
    today: string;
    todayEntry: HandbookEntry | null;
    entries: HandbookEntry[];
    userName: string;
    generating: boolean;
    onGenerateToday: () => void;
    onOpenDate: (date: string) => void;
}

// ─── 装饰用的简版 Washi tape ───────────────────────────────
const TapeStripe: React.FC<{
    width: number; rotate: number; color: string; pattern?: 'stripe' | 'flower' | 'dot';
    style?: React.CSSProperties;
}> = ({ width, rotate, color, pattern = 'stripe', style }) => {
    let bg: string;
    let bgSize: string | undefined;
    if (pattern === 'flower') {
        const svg = encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" fill="rgba(255,255,255,0.55)"/><circle cx="3" cy="8" r="1.6" fill="rgba(255,255,255,0.45)"/><circle cx="13" cy="8" r="1.6" fill="rgba(255,255,255,0.45)"/><circle cx="8" cy="3" r="1.6" fill="rgba(255,255,255,0.45)"/><circle cx="8" cy="13" r="1.6" fill="rgba(255,255,255,0.45)"/></svg>`
        );
        bg = `${color} url("data:image/svg+xml,${svg}")`;
        bgSize = '14px 14px';
    } else if (pattern === 'dot') {
        bg = `${color} radial-gradient(rgba(255,255,255,0.55) 1.5px, transparent 1.5px)`;
        bgSize = '8px 8px';
    } else {
        bg = `repeating-linear-gradient(135deg, ${color} 0 8px, rgba(255,255,255,0.4) 8px 12px, ${color} 12px 22px)`;
    }
    return (
        <div
            style={{
                width, height: 18,
                background: bg,
                backgroundSize: bgSize,
                transform: `rotate(${rotate}deg)`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                clipPath: 'polygon(2% 0, 100% 6%, 99% 100%, 0 95%)',
                ...style,
            }}
        />
    );
};

const HandbookCover: React.FC<CoverProps> = ({
    today, todayEntry, entries, userName, generating, onGenerateToday, onOpenDate,
}) => {
    const otherEntries = entries.filter(e => e.date !== today);
    const season = seasonOf(today);
    const sLab = seasonLabel(season);

    // 当前月份英文（April 等）
    const monthFull = monthFullEn(today);

    return (
        <div
            className="flex-1 overflow-y-auto pb-12 relative"
            style={{
                background: `${PAPER_TONES.paperWarm} radial-gradient(circle at 20% 10%, rgba(251,184,200,0.18) 0%, transparent 40%), radial-gradient(circle at 80% 60%, rgba(185,211,224,0.18) 0%, transparent 40%)`,
            }}
        >
            {/* 飘在背景的云朵 */}
            <div className="absolute top-12 right-4 opacity-40 pointer-events-none">
                <Cloud size={70} />
            </div>
            <div className="absolute top-44 left-6 opacity-30 pointer-events-none">
                <Cloud size={54} color="#ffe2ec" />
            </div>

            {/* ═══ 杂志感封面 ═══════════════════════════════════ */}
            <div
                className="mx-4 mt-3 rounded-[20px] relative overflow-hidden"
                style={{
                    background: `${PAPER_TONES.paper} radial-gradient(circle at 30% 20%, ${PAPER_TONES.accentRose}22 0%, transparent 55%), radial-gradient(circle at 75% 75%, ${PAPER_TONES.accentLavender}22 0%, transparent 55%)`,
                    boxShadow: '0 8px 24px -8px rgba(122,90,114,0.3), inset 0 1px 0 rgba(255,255,255,0.7), 0 0 0 1.5px rgba(220,199,213,0.5)',
                    minHeight: 360,
                    padding: '34px 22px 40px',
                }}
            >
                {/* 顶端两道 washi tape（左 -8°, 右 +12°）*/}
                <div className="absolute -top-1 -left-3 z-10 pointer-events-none">
                    <TapeStripe width={130} rotate={-8} color={PAPER_TONES.accentBlush} pattern="flower" />
                </div>
                <div className="absolute top-3 -right-4 z-10 pointer-events-none">
                    <TapeStripe width={110} rotate={12} color={PAPER_TONES.accentMint} pattern="stripe" />
                </div>

                {/* 角落贴纸 */}
                <div className="absolute top-16 left-5 pointer-events-none" style={{ transform: 'rotate(-12deg)' }}>
                    <StarSticker size={18} color={PAPER_TONES.accentLemon} />
                </div>
                <div className="absolute bottom-20 right-7 pointer-events-none" style={{ transform: 'rotate(15deg)' }}>
                    <BowSticker size={28} color={PAPER_TONES.accentRose} />
                </div>
                <div className="absolute bottom-4 left-7 pointer-events-none">
                    <SparkleDot size={14} color={PAPER_TONES.accentBlue} />
                </div>

                {/* ── 主标 ───────────────────────────────────── */}
                <div className="relative text-center mt-7">
                    {/* 顶部小行：PERSONAL · INDEPENDENT */}
                    <div
                        style={{
                            ...DISPLAY_STACK,
                            fontSize: 11,
                            letterSpacing: '0.5em',
                            color: PAPER_TONES.inkSoft,
                        }}
                    >
                        PERSONAL · INDEPENDENT
                    </div>
                    {/* 大写 Hello, （DM Serif Display）*/}
                    <div
                        style={{
                            ...DISPLAY_STACK,
                            fontSize: 60,
                            lineHeight: 0.95,
                            color: PAPER_TONES.ink,
                            marginTop: 8,
                            letterSpacing: '-0.01em',
                        }}
                    >
                        Hello,
                    </div>
                    {/* 月份花字 (Caveat) */}
                    <div
                        style={{
                            ...SCRIPT_STACK,
                            fontSize: 56,
                            lineHeight: 0.95,
                            color: PAPER_TONES.accentBlush,
                            marginTop: -6,
                            letterSpacing: '0.01em',
                        }}
                    >
                        {monthFull} <span style={{ color: PAPER_TONES.accentRose }}>♡</span>
                    </div>
                    {/* 日文副标题 */}
                    <div
                        style={{
                            ...JP_STACK,
                            fontSize: 17,
                            color: PAPER_TONES.ink,
                            marginTop: 14,
                            letterSpacing: '0.35em',
                        }}
                    >
                        季節の手帳 · {yearNum(today)}
                    </div>
                    {/* 下一行：卷号 — 季节 */}
                    <div
                        style={{
                            ...MONO_STACK,
                            fontSize: 11,
                            color: PAPER_TONES.inkSoft,
                            marginTop: 12,
                            letterSpacing: '0.3em',
                        }}
                    >
                        {volNum(today)} — {sLab.en}
                    </div>
                </div>

                {/* ── 用户标记小条（user · season emoji）────── */}
                <div className="mt-7 flex items-center justify-center gap-3">
                    <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentRose, opacity: 0.5 }} />
                    <div
                        className="px-3 py-0.5 rounded-full"
                        style={{
                            background: 'rgba(255,255,255,0.7)',
                            border: `1px solid ${PAPER_TONES.spine}`,
                            ...CUTE_STACK,
                            fontSize: 10,
                            letterSpacing: '0.2em',
                            color: PAPER_TONES.inkSoft,
                        }}
                    >
                        <span style={{ color: PAPER_TONES.accentBlush, marginRight: 6 }}>{sLab.emoji}</span>
                        {userName} · {sLab.jp}
                        <span style={{ color: PAPER_TONES.accentBlush, marginLeft: 6 }}>{sLab.emoji}</span>
                    </div>
                    <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentRose, opacity: 0.5 }} />
                </div>
            </div>

            {/* ═══ 今日 · 翻开按钮 ═════════════════════════════ */}
            <div className="mx-4 mt-6 relative">
                {/* 飘出的 ribbon 装饰 */}
                <div className="absolute -top-2 left-8 z-10 pointer-events-none">
                    <Ribbon size={32} color={PAPER_TONES.accentBlush} />
                </div>
                {/* 散落小贴纸 */}
                <div className="absolute -top-3 right-4 z-10 pointer-events-none" style={{ transform: 'rotate(20deg)' }}>
                    <PawSticker size={24} color={PAPER_TONES.accentRose} />
                </div>

                <div
                    className="rounded-2xl px-5 py-5 pl-12 relative overflow-hidden"
                    style={{
                        background: PAPER_TONES.paper,
                        boxShadow: '0 3px 10px -2px rgba(122,90,114,0.18), 0 0 0 1.5px rgba(220,199,213,0.5)',
                    }}
                >
                    {/* 顶部 courier 日期标签 */}
                    <div
                        className="absolute top-2 right-3"
                        style={{
                            ...MONO_STACK,
                            fontSize: 9,
                            letterSpacing: '0.25em',
                            color: PAPER_TONES.inkFaint,
                        }}
                    >
                        DATE · {today.split('-')[1]}/{dayNum(today)} · {monthEn(today)}
                    </div>

                    <div className="flex items-end gap-4 mt-2">
                        {/* 大号衬线日期 — 用 DM Serif Display 主显示 */}
                        <div className="text-right shrink-0">
                            <div
                                style={{
                                    ...MONO_STACK,
                                    fontSize: 9,
                                    letterSpacing: '0.3em',
                                    color: PAPER_TONES.inkSoft,
                                }}
                            >
                                {monthEn(today)}
                            </div>
                            <div
                                style={{
                                    ...DISPLAY_STACK,
                                    fontSize: 56,
                                    lineHeight: 0.85,
                                    color: PAPER_TONES.ink,
                                    letterSpacing: '-0.02em',
                                }}
                            >
                                {dayNum(today)}
                            </div>
                            <div
                                style={{
                                    ...SCRIPT_STACK,
                                    fontSize: 18,
                                    color: PAPER_TONES.accentBlush,
                                    marginTop: 2,
                                }}
                            >
                                {dayOfWeekZh(today) === '日' ? 'sunday' :
                                 dayOfWeekZh(today) === '一' ? 'monday' :
                                 dayOfWeekZh(today) === '二' ? 'tuesday' :
                                 dayOfWeekZh(today) === '三' ? 'wednesday' :
                                 dayOfWeekZh(today) === '四' ? 'thursday' :
                                 dayOfWeekZh(today) === '五' ? 'friday' : 'saturday'}
                            </div>
                        </div>

                        <div className="flex-1 min-w-0">
                            <div
                                className="text-[12.5px] mb-2.5"
                                style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                            >
                                {todayEntry
                                    ? `今天已经记下 ${todayEntry.pages.length} 页 ♡`
                                    : `今天还没翻开 · 想写就写`}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={onGenerateToday}
                                    disabled={generating}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12px] font-bold active:scale-95 transition disabled:opacity-50"
                                    style={{
                                        ...CUTE_STACK,
                                        background: `linear-gradient(135deg, ${PAPER_TONES.accentBlush} 0%, ${PAPER_TONES.accentRose} 100%)`,
                                        color: '#fff',
                                        boxShadow: '0 2px 6px rgba(242,157,176,0.4)',
                                    }}
                                >
                                    <Sparkle weight="fill" className="w-3.5 h-3.5" />
                                    {generating ? '正在落笔…' : 'AI 替我写一份'}
                                </button>
                                <button
                                    onClick={() => onOpenDate(today)}
                                    className="px-4 py-2.5 rounded-full text-[12px] font-bold active:scale-95 transition"
                                    style={{
                                        ...CUTE_STACK,
                                        background: PAPER_TONES.paperMint,
                                        color: PAPER_TONES.ink,
                                        border: `1.5px solid ${PAPER_TONES.accentMint}`,
                                    }}
                                >
                                    翻开
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ 回望书签列表 ═════════════════════════════════ */}
            <div className="mt-8 px-4">
                <div
                    className="flex items-center justify-center gap-3 mb-4"
                >
                    <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentRose, opacity: 0.4 }} />
                    <div
                        style={{
                            ...DISPLAY_STACK,
                            fontSize: 16,
                            letterSpacing: '0.4em',
                            color: PAPER_TONES.inkSoft,
                            paddingLeft: '0.4em',
                        }}
                    >
                        Archive
                    </div>
                    <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentRose, opacity: 0.4 }} />
                </div>
                <div
                    className="text-center mb-4"
                    style={{
                        ...MONO_STACK,
                        fontSize: 9,
                        letterSpacing: '0.3em',
                        color: PAPER_TONES.inkFaint,
                    }}
                >
                    PAST ENTRIES · 回 望
                </div>

                {otherEntries.length === 0 ? (
                    <div className="text-center py-10" style={{ color: PAPER_TONES.inkSoft }}>
                        <Notebook className="w-9 h-9 mx-auto mb-2 opacity-40" weight="thin" />
                        <div className="text-[13px]" style={CUTE_STACK}>之前还没有记过</div>
                        <div className="text-[11px] mt-1 opacity-70" style={CUTE_STACK}>
                            没关系 · 想翻的时候再翻 ♡
                        </div>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {otherEntries.map((e, i) => {
                            const tilt = tiltFor(e.id);
                            const preview = e.pages.find(p => !p.excluded)?.content?.slice(0, 60) || '';
                            const visibleCount = e.pages.filter(p => !p.excluded).length;
                            const tabColors = [
                                PAPER_TONES.accentRose,
                                PAPER_TONES.accentLemon,
                                PAPER_TONES.accentMint,
                                PAPER_TONES.accentBlue,
                                PAPER_TONES.accentLavender,
                            ];
                            const tab = tabColors[i % tabColors.length];
                            return (
                                <button
                                    key={e.id}
                                    onClick={() => onOpenDate(e.date)}
                                    className="w-full text-left relative active:scale-[0.99] transition"
                                    style={{ transform: `rotate(${tilt * 0.3}deg)` }}
                                >
                                    {/* 散落贴纸 */}
                                    <ScatteredStickers seed={e.id} count={2} zone="corners" />

                                    {/* 侧出的 tab 标签 */}
                                    <div
                                        className="absolute right-0 top-3 px-2 py-0.5 text-[9px] font-bold tracking-widest z-10"
                                        style={{
                                            background: tab,
                                            color: PAPER_TONES.ink,
                                            clipPath: 'polygon(15% 0, 100% 0, 100% 100%, 15% 100%, 0 50%)',
                                            paddingLeft: '14px',
                                            ...CUTE_STACK,
                                        }}
                                    >
                                        {visibleCount}页 ♡
                                    </div>

                                    <div
                                        className="rounded-xl px-4 py-3 pr-16"
                                        style={{
                                            background: PAPER_TONES.paper,
                                            boxShadow: '0 2px 4px rgba(122,90,114,0.1), 0 6px 14px -8px rgba(122,90,114,0.18)',
                                            border: `1px solid ${PAPER_TONES.spine}`,
                                        }}
                                    >
                                        <div className="flex items-baseline gap-2 mb-1">
                                            <span
                                                style={{
                                                    ...DISPLAY_STACK,
                                                    fontSize: 26,
                                                    fontWeight: 400,
                                                    lineHeight: 1,
                                                    color: PAPER_TONES.ink,
                                                    letterSpacing: '-0.01em',
                                                }}
                                            >
                                                {dayNum(e.date)}
                                            </span>
                                            <span
                                                style={{
                                                    ...MONO_STACK,
                                                    fontSize: 9,
                                                    letterSpacing: '0.25em',
                                                    color: PAPER_TONES.inkSoft,
                                                }}
                                            >
                                                {monthEn(e.date)} · 周{dayOfWeekZh(e.date)}
                                            </span>
                                            <CaretRight className="w-3 h-3 ml-auto" style={{ color: PAPER_TONES.inkSoft }} />
                                        </div>
                                        {preview && (
                                            <div
                                                className="text-[12px] leading-snug line-clamp-2"
                                                style={{ ...SERIF_STACK, color: PAPER_TONES.inkSoft }}
                                            >
                                                {preview}{preview.length >= 60 ? '…' : ''}
                                            </div>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HandbookCover;
