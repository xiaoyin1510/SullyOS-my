/**
 * v2 槽位渲染器 — 按 SlotRole 分发到不同视觉。
 *
 * 设计:
 *  - 旧版: 每个 placement 都是 JournalFragmentCard (一段段文字)
 *  - 新版: 每个 slotRole 一种视觉 (todo 是 checklist, gratitude 是 bullet,
 *    timeline 是时间表, mood-card 是星级卡, photo-caption 是拍立得 etc.)
 *
 *  - 不在这里做位置/旋转 (那是 JournalCanvas 的事), 只渲染卡片本体
 *  - 字号/留白 跟随 isHero / charBudget
 *  - 如果 fragment 没有 slotRole (老数据), 直接落到 JournalFragmentCard
 */

import React from 'react';
import {
    HandbookFragment, HandbookPage, CharacterProfile, LayoutPlacement, SlotRole, SlotPayload,
} from '../../types';
import {
    PAPER_TONES, HANDWRITTEN_STACK, BRUSH_STACK, SERIF_STACK, seedFloat,
} from './paper';
import JournalFragmentCard from './JournalFragmentCard';
import JournalRichText from './JournalRichText';

// ─── skin variant → 配色 ──────────────────────────────────
const SKIN_PALETTES: Record<string, { bg: string; border: string; accent: string; ink: string }> = {
    lavender: { bg: '#f5eef7', border: '#d6c8e8', accent: '#a98ec4', ink: '#5a4a72' },
    rose:     { bg: '#fff0f5', border: '#fbb8c8', accent: '#f29db0', ink: '#7a3845' },
    mint:     { bg: '#f0faf5', border: '#bfe1cf', accent: '#88c5a8', ink: '#3a5a48' },
    sky:      { bg: '#eef4f9', border: '#b9d3e0', accent: '#7ea7be', ink: '#3a536a' },
    lemon:    { bg: '#fef9e0', border: '#f5e295', accent: '#d6b85a', ink: '#6a5520' },
};
function palette(skinVariant?: string) {
    return SKIN_PALETTES[skinVariant || ''] || SKIN_PALETTES.lavender;
}

// ─── 通用: 作者标签 ─────────────────────────────────────
const AuthorTag: React.FC<{ name: string; color?: string; small?: boolean }> = ({ name, color, small }) => (
    <span style={{
        ...HANDWRITTEN_STACK,
        fontSize: small ? 10 : 12,
        color: color || PAPER_TONES.inkSoft,
        fontWeight: 600,
        opacity: 0.85,
    }}>
        — {name}
    </span>
);

// ─── hero-diary ──────────────────────────────────────────
const HeroDiarySlot: React.FC<{ text: string; authorName: string; isHero?: boolean }> = ({ text, authorName, isHero }) => (
    <div style={{ padding: '4px 6px' }}>
        <div className="flex items-baseline gap-1 mb-1">
            <span style={{
                ...HANDWRITTEN_STACK,
                fontSize: isHero ? 18 : 15,
                color: PAPER_TONES.ink,
                fontWeight: 600,
            }}>
                {authorName}:
            </span>
        </div>
        <JournalRichText
            text={text}
            fontSize={isHero ? 17 : 14}
            lineHeight={isHero ? '26px' : '22px'}
            fontFamily={'"Noto Serif SC", "Songti SC", serif'}
            opts={{
                color: PAPER_TONES.ink,
                accent: PAPER_TONES.accentBlush,
                muted: PAPER_TONES.inkSoft,
                boldColor: PAPER_TONES.ink,
                headColor: PAPER_TONES.ink,
            }}
        />
    </div>
);

// ─── timeline-plan ───────────────────────────────────────
const TimelineSlot: React.FC<{ payload: Extract<SlotPayload, { kind: 'timeline' }>; authorName: string }> = ({ payload, authorName }) => {
    const pal = palette('lavender');
    return (
        <div style={{
            background: 'rgba(255,255,255,0.4)',
            borderLeft: `2px solid ${pal.accent}`,
            padding: '6px 8px 6px 10px',
            borderRadius: 4,
        }}>
            <div className="flex items-baseline gap-1 mb-1">
                <span style={{
                    ...HANDWRITTEN_STACK, fontSize: 12, color: pal.accent, fontWeight: 700,
                    letterSpacing: '0.1em',
                }}>
                    TODAY'S PLAN
                </span>
            </div>
            <ul className="space-y-0.5 list-none m-0 p-0">
                {payload.items.map((it, i) => (
                    <li key={i} className="flex items-baseline gap-2" style={{
                        ...HANDWRITTEN_STACK, fontSize: 12, color: PAPER_TONES.ink, lineHeight: 1.4,
                    }}>
                        <span style={{ minWidth: 36, color: pal.accent, fontWeight: 600 }}>{it.time}</span>
                        <span className="flex-1">{it.text}</span>
                        {it.emoji && <span>{it.emoji}</span>}
                    </li>
                ))}
            </ul>
            <div className="text-right mt-1"><AuthorTag name={authorName} small /></div>
        </div>
    );
};

// ─── todo ────────────────────────────────────────────────
const TodoSlot: React.FC<{ payload: Extract<SlotPayload, { kind: 'todo' }>; authorName: string }> = ({ payload, authorName }) => {
    const pal = palette('mint');
    return (
        <div style={{
            background: 'rgba(255,255,255,0.45)',
            border: `1px dashed ${pal.border}`,
            padding: '6px 10px',
            borderRadius: 6,
        }}>
            <div className="flex items-baseline gap-1 mb-1">
                <span style={{
                    ...HANDWRITTEN_STACK, fontSize: 12, color: pal.accent, fontWeight: 700,
                    letterSpacing: '0.1em',
                }}>
                    TO DO
                </span>
            </div>
            <ul className="space-y-1 list-none m-0 p-0">
                {payload.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-1.5" style={{
                        ...HANDWRITTEN_STACK, fontSize: 12.5, color: PAPER_TONES.ink, lineHeight: 1.35,
                    }}>
                        <span style={{
                            width: 11, height: 11, marginTop: 3,
                            border: `1.2px solid ${pal.accent}`,
                            borderRadius: 2,
                            display: 'inline-block', flexShrink: 0,
                            position: 'relative',
                        }}>
                            {it.done && (
                                <span style={{
                                    position: 'absolute', top: -3, left: 1,
                                    color: pal.accent, fontSize: 14, fontWeight: 700,
                                    lineHeight: 1,
                                }}>✓</span>
                            )}
                        </span>
                        <span className={it.done ? 'line-through opacity-60' : ''}>{it.text}</span>
                    </li>
                ))}
            </ul>
            <div className="text-right mt-1"><AuthorTag name={authorName} small /></div>
        </div>
    );
};

// ─── gratitude ───────────────────────────────────────────
const GratitudeSlot: React.FC<{ payload: Extract<SlotPayload, { kind: 'gratitude' }>; authorName: string }> = ({ payload, authorName }) => {
    const pal = palette('rose');
    return (
        <div style={{ padding: '4px 6px' }}>
            <div className="flex items-baseline gap-1 mb-1">
                <span style={{
                    ...HANDWRITTEN_STACK, fontSize: 12, color: pal.accent, fontWeight: 700,
                    letterSpacing: '0.1em',
                }}>
                    今日感恩 ♡
                </span>
            </div>
            <ul className="space-y-0.5 list-none m-0 p-0">
                {payload.items.map((s, i) => (
                    <li key={i} className="flex items-baseline gap-1.5" style={{
                        ...HANDWRITTEN_STACK, fontSize: 12.5, color: PAPER_TONES.ink, lineHeight: 1.4,
                    }}>
                        <span style={{ color: pal.accent }}>·</span>
                        <span className="flex-1">{s}</span>
                    </li>
                ))}
            </ul>
            <div className="text-right mt-1"><AuthorTag name={authorName} small /></div>
        </div>
    );
};

// ─── mood-card ───────────────────────────────────────────
const MoodSlot: React.FC<{
    text: string;
    payload?: Extract<SlotPayload, { kind: 'mood' }>;
    authorName: string;
    skinVariant?: string;
}> = ({ text, payload, authorName, skinVariant }) => {
    const pal = palette(skinVariant);
    const rating = payload?.rating ?? 3;
    return (
        <div style={{
            background: pal.bg,
            border: `1px solid ${pal.border}`,
            borderRadius: 8,
            padding: '6px 10px',
            boxShadow: '0 1px 2px rgba(122,90,114,0.06)',
        }}>
            <div className="flex items-baseline justify-between mb-1">
                <span style={{
                    ...HANDWRITTEN_STACK, fontSize: 12, color: pal.accent, fontWeight: 700,
                }}>
                    Mood ♡
                </span>
                <span style={{ fontSize: 11, color: pal.accent, letterSpacing: 1 }}>
                    {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
                </span>
            </div>
            {text && (
                <div style={{
                    ...HANDWRITTEN_STACK, fontSize: 12.5, color: pal.ink, lineHeight: 1.4,
                }}>
                    {text}
                </div>
            )}
            {payload?.tag && (
                <div style={{
                    display: 'inline-block', marginTop: 4,
                    fontSize: 10, padding: '1px 6px', borderRadius: 8,
                    background: pal.accent, color: '#fff',
                }}>
                    #{payload.tag}
                </div>
            )}
            <div className="text-right mt-1"><AuthorTag name={authorName} color={pal.ink} small /></div>
        </div>
    );
};

// ─── photo-caption ───────────────────────────────────────
const PhotoSlot: React.FC<{
    payload?: Extract<SlotPayload, { kind: 'photo' }>;
    authorName: string;
}> = ({ payload, authorName }) => {
    const caption = payload?.caption || '';
    const src = payload?.src;
    return (
        <div style={{
            background: '#fff',
            padding: '6px 6px 8px 6px',
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(122,90,114,0.12), 0 1px 2px rgba(0,0,0,0.05)',
            transform: 'rotate(-1.2deg)',
        }}>
            <div style={{
                width: '100%', aspectRatio: '4 / 3',
                background: src ? `url(${src}) center / cover` : 'repeating-linear-gradient(45deg, #f0e6ed 0 6px, #fbf3f7 6px 12px)',
                borderRadius: 2,
                position: 'relative',
            }}>
                {!src && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{
                        ...HANDWRITTEN_STACK, fontSize: 11, color: PAPER_TONES.inkFaint,
                    }}>
                        贴一张今日照片
                    </div>
                )}
            </div>
            <div className="mt-1 text-center" style={{
                ...HANDWRITTEN_STACK, fontSize: 11, color: PAPER_TONES.ink, lineHeight: 1.3,
            }}>
                {caption}
            </div>
            <div className="text-center" style={{ marginTop: 1 }}>
                <AuthorTag name={authorName} small />
            </div>
        </div>
    );
};

// ─── sticky-reaction ─────────────────────────────────────
const StickyReactionSlot: React.FC<{
    text: string; authorName: string; skinVariant?: string;
}> = ({ text, authorName, skinVariant }) => {
    const pal = palette(skinVariant);
    return (
        <div style={{
            background: pal.bg,
            border: `1px solid ${pal.border}`,
            borderRadius: 6,
            padding: '6px 9px',
            boxShadow: '0 2px 4px rgba(122,90,114,0.1), 0 4px 10px -8px rgba(122,90,114,0.18)',
            position: 'relative',
        }}>
            {/* 顶部小胶带 */}
            <div style={{
                position: 'absolute', top: -4, left: '50%',
                transform: 'translateX(-50%) rotate(-2deg)',
                width: '40%', height: 8,
                background: `repeating-linear-gradient(135deg, ${pal.accent}80 0 4px, transparent 4px 7px)`,
                borderRadius: 1,
            }} />
            <div style={{
                ...HANDWRITTEN_STACK, fontSize: 12, color: pal.ink, lineHeight: 1.4, marginTop: 4,
            }}>
                {text}
            </div>
            <div className="text-right mt-1"><AuthorTag name={authorName} color={pal.accent} small /></div>
        </div>
    );
};

// ─── corner-note ─────────────────────────────────────────
const CornerNoteSlot: React.FC<{ text: string; authorName: string; seed: string }> = ({ text, authorName, seed }) => {
    const colors = ['#3d2f3d', '#c94a4a', '#5a7a8e', '#a98ec4', '#88a370'];
    const color = colors[Math.floor(seedFloat(seed, 4321) * colors.length)];
    return (
        <div style={{ padding: 0 }}>
            <span style={{
                ...HANDWRITTEN_STACK,
                fontSize: 13, color, lineHeight: 1.3,
                display: 'block', whiteSpace: 'pre-wrap',
            }}>
                {text}
            </span>
            <span style={{
                ...HANDWRITTEN_STACK, fontSize: 9.5, color, opacity: 0.55,
                display: 'block', textAlign: 'right', marginTop: 1,
            }}>
                — {authorName}
            </span>
        </div>
    );
};

// ─── 路由 ────────────────────────────────────────────────
interface SlotRendererProps {
    placement: LayoutPlacement;
    fragment?: HandbookFragment;
    page: HandbookPage;
    char?: CharacterProfile;
    userName: string;
}

const SlotRenderer: React.FC<SlotRendererProps> = ({ placement, fragment, page, char, userName }) => {
    const slotRole: SlotRole | undefined = placement.slotRole || fragment?.slotRole;

    // 老数据 / 没 slotRole → 走老 JournalFragmentCard
    if (!slotRole) {
        return (
            <JournalFragmentCard
                fragment={fragment}
                page={page}
                char={char}
                role={placement.role}
                isHero={placement.isHero}
            />
        );
    }

    const authorName = page.charId ? (char?.name || '某角色') : userName;
    const text = fragment?.text || '';
    const payload = fragment?.payload;
    const skin = placement.skinVariant || (fragment as any)?.skinVariant;

    switch (slotRole) {
        case 'hero-diary':
            return <HeroDiarySlot text={text} authorName={authorName} isHero={placement.isHero} />;

        case 'timeline-plan':
            if (payload?.kind === 'timeline') {
                return <TimelineSlot payload={payload} authorName={authorName} />;
            }
            return <HeroDiarySlot text={text} authorName={authorName} />;

        case 'todo':
            if (payload?.kind === 'todo') {
                return <TodoSlot payload={payload} authorName={authorName} />;
            }
            return <HeroDiarySlot text={text} authorName={authorName} />;

        case 'gratitude':
            if (payload?.kind === 'gratitude') {
                return <GratitudeSlot payload={payload} authorName={authorName} />;
            }
            return <HeroDiarySlot text={text} authorName={authorName} />;

        case 'mood-card':
            return (
                <MoodSlot
                    text={text}
                    payload={payload?.kind === 'mood' ? payload : undefined}
                    authorName={authorName}
                    skinVariant={skin}
                />
            );

        case 'photo-caption':
            return (
                <PhotoSlot
                    payload={payload?.kind === 'photo' ? payload : { kind: 'photo', caption: text }}
                    authorName={authorName}
                />
            );

        case 'sticky-reaction':
            return <StickyReactionSlot text={text} authorName={authorName} skinVariant={skin} />;

        case 'corner-note':
            return <CornerNoteSlot text={text} authorName={authorName} seed={fragment?.id || page.id} />;

        default:
            return (
                <JournalFragmentCard
                    fragment={fragment}
                    page={page}
                    char={char}
                    role={placement.role}
                    isHero={placement.isHero}
                />
            );
    }
};

export default SlotRenderer;
