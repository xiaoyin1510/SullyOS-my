/**
 * 碎片拼贴(端正版 — 雅致日记本风)
 *
 * 设计原则(user 反馈对齐):
 * - 卡片**端正不歪**(rotate=0),不重叠,统一间距
 * - 不再"左右乱跳",几乎居中,只允许小尺寸卡片轻微偏左/右
 * - 6 种皮肤保留(尺寸/颜色/材质 多样性还在),但摆位一致 → 像有秩序的日记
 * - 装饰物从"压在卡片上"挪到"卡片之间和两侧的留白",不破坏卡片本身
 * - 段间装饰仍有(washi 整条 / 心串 / sparkles),但只在 fragment 之间放
 *
 * 视觉参考: LOVE&DEEPSPACE 紫调日记页 + 雅致收据风
 */

import React from 'react';
import { HandbookFragment } from '../../types';
import {
    PAPER_TONES, SERIF_STACK, CUTE_STACK, WashiTape,
    seedRange, seedFloat,
} from './paper';
import {
    HeartSticker, StarSticker, SparkleDot,
} from './stickers';

// ─── 卡片皮肤 ───────────────────────────────────
type SkinKind = 'sticky' | 'polaroid' | 'ripped' | 'sticker' | 'washi_card' | 'handnote';

const STICKY_PALETTES = [
    { bg: '#f5eef7', border: '#d6c8e8', accent: '#a98ec4' },  // 薰衣草(放第一,频率高)
    { bg: '#eef4f9', border: '#b9d3e0', accent: '#7ea7be' },  // 雾蓝
    { bg: '#fff0f5', border: '#fbb8c8', accent: '#f29db0' },  // 樱粉
    { bg: '#f0faf5', border: '#bfe1cf', accent: '#88c5a8' },  // 薄荷
    { bg: '#fef9e0', border: '#f5e295', accent: '#d6b85a' },  // 蜜
];

const HANDNOTE_PALETTES = [
    { bg: '#f5eef7', tint: '#8870a8' },
    { bg: '#eef4f9', tint: '#5a7a8e' },
    { bg: '#fffaf2', tint: '#a87a8a' },
    { bg: '#fdf9eb', tint: '#a89048' },
];

function pickSkin(id: string): SkinKind {
    const skins: SkinKind[] = [
        'sticky', 'sticky', 'sticky',
        'polaroid',
        'washi_card', 'washi_card',
        'ripped',
        'sticker',
        'handnote',
    ];
    return skins[Math.floor(seedFloat(id, 9001) * skins.length)];
}

function pickSize(text: string): 'xs' | 'sm' | 'md' | 'lg' {
    const len = text.length;
    if (len < 22) return 'xs';
    if (len < 42) return 'sm';
    if (len < 75) return 'md';
    return 'lg';
}

const SIZE_TO_WIDTH: Record<'xs' | 'sm' | 'md' | 'lg', [number, number]> = {
    xs: [50, 70],
    sm: [62, 80],
    md: [76, 90],
    lg: [86, 96],
};

// ─── 单个 fragment 的卡片渲染(端正,无旋转) ─────
const FragmentCard: React.FC<{
    fragment: HandbookFragment;
    skin: SkinKind;
}> = ({ fragment, skin }) => {
    const { id, text, time } = fragment;
    const stickyIdx = Math.floor(seedFloat(id, 13) * STICKY_PALETTES.length);
    const stickyColor = STICKY_PALETTES[stickyIdx];

    const timeBadge = time && (
        <div
            className="inline-block px-2 py-0.5 mb-1.5 rounded-full"
            style={{
                ...CUTE_STACK,
                fontSize: 9.5,
                letterSpacing: '0.1em',
                color: stickyColor.accent,
                background: 'rgba(255,255,255,0.7)',
                border: `1px solid ${stickyColor.border}`,
            }}
        >
            ◆ {time}
        </div>
    );

    const textStyle: React.CSSProperties = {
        ...SERIF_STACK,
        fontSize: 13.5,
        lineHeight: '23px',
        color: PAPER_TONES.ink,
        margin: 0,
    };

    if (skin === 'sticky') {
        return (
            <div
                className="px-3.5 py-3 rounded-lg"
                style={{
                    background: stickyColor.bg,
                    border: `1px solid ${stickyColor.border}`,
                    boxShadow: '0 1px 2px rgba(122,90,114,0.06), 0 4px 10px -8px rgba(122,90,114,0.16)',
                }}
            >
                {timeBadge}
                <p className="whitespace-pre-wrap break-words" style={textStyle}>{text}</p>
            </div>
        );
    }

    if (skin === 'polaroid') {
        const blockHeight = 36;
        return (
            <div
                className="rounded-sm"
                style={{
                    background: '#fff',
                    padding: '8px 10px 12px 10px',
                    boxShadow: '0 1px 3px rgba(122,90,114,0.1), 0 6px 14px -8px rgba(122,90,114,0.2)',
                }}
            >
                <div
                    style={{
                        height: blockHeight,
                        borderRadius: 2,
                        background: `linear-gradient(135deg, ${stickyColor.bg} 0%, ${stickyColor.border} 100%)`,
                        marginBottom: 8,
                        position: 'relative',
                    }}
                >
                    {time && (
                        <span
                            className="absolute top-1 left-2 px-1.5 py-0 rounded text-[9px]"
                            style={{
                                ...CUTE_STACK,
                                background: 'rgba(255,255,255,0.85)',
                                color: stickyColor.accent,
                                letterSpacing: '0.1em',
                            }}
                        >
                            ◆ {time}
                        </span>
                    )}
                </div>
                <p className="whitespace-pre-wrap break-words" style={textStyle}>{text}</p>
            </div>
        );
    }

    if (skin === 'ripped') {
        return (
            <div className="relative">
                <ZigzagEdge color="#fff" flip={false} />
                <div
                    className="px-3.5 py-3"
                    style={{
                        background: '#fff',
                        backgroundImage: `repeating-linear-gradient(transparent, transparent 22px, ${stickyColor.border}55 22px, ${stickyColor.border}55 23px)`,
                        boxShadow: '0 1px 2px rgba(122,90,114,0.08)',
                    }}
                >
                    {timeBadge}
                    <p className="whitespace-pre-wrap break-words" style={textStyle}>{text}</p>
                </div>
                <ZigzagEdge color="#fff" flip={true} />
            </div>
        );
    }

    if (skin === 'sticker') {
        return (
            <div
                className="px-3.5 py-2.5"
                style={{
                    background: 'rgba(255,255,255,0.5)',
                    border: `1.5px dashed ${stickyColor.accent}`,
                    borderRadius: 14,
                    backdropFilter: 'blur(2px)',
                }}
            >
                {time && (
                    <span
                        className="inline-block mb-1 text-[9.5px] tracking-widest"
                        style={{ ...CUTE_STACK, color: stickyColor.accent }}
                    >
                        ◆ {time}
                    </span>
                )}
                <p className="whitespace-pre-wrap break-words" style={textStyle}>{text}</p>
            </div>
        );
    }

    if (skin === 'washi_card') {
        const tapeColors: Array<'rose' | 'mint' | 'lemon' | 'blue' | 'lavender'> = ['lavender','blue','rose','mint','lemon'];
        const tapeColor = tapeColors[Math.floor(seedFloat(id, 17) * tapeColors.length)];
        return (
            <div
                className="relative pt-5 pb-3 px-3.5 rounded-sm"
                style={{
                    background: '#fff',
                    boxShadow: '0 1px 3px rgba(122,90,114,0.08), 0 4px 10px -8px rgba(122,90,114,0.16)',
                }}
            >
                <div className="absolute -top-1.5 left-3 right-3 h-3 pointer-events-none">
                    <div
                        style={{
                            height: '100%',
                            background: `repeating-linear-gradient(135deg, ${stickyColor.bg} 0 8px, ${stickyColor.border}cc 8px 14px)`,
                            clipPath: 'polygon(2% 0, 99% 6%, 100% 100%, 0 95%)',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                        }}
                    />
                </div>
                {timeBadge}
                <p className="whitespace-pre-wrap break-words" style={textStyle}>{text}</p>
            </div>
        );
    }

    if (skin === 'handnote') {
        const palIdx = Math.floor(seedFloat(id, 19) * HANDNOTE_PALETTES.length);
        const pal = HANDNOTE_PALETTES[palIdx];
        return (
            <div
                className="px-3.5 py-3"
                style={{
                    background: pal.bg,
                    border: `1px solid ${pal.tint}33`,
                    borderRadius: 6,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                }}
            >
                {time && (
                    <span
                        className="inline-block mb-1.5 text-[9.5px] tracking-widest italic"
                        style={{ ...CUTE_STACK, color: pal.tint }}
                    >
                        ◆ {time}
                    </span>
                )}
                <p
                    className="whitespace-pre-wrap break-words"
                    style={{
                        ...SERIF_STACK,
                        fontSize: 13.5,
                        lineHeight: '23px',
                        color: pal.tint,
                        margin: 0,
                        fontStyle: 'italic',
                    }}
                >
                    {text}
                </p>
            </div>
        );
    }

    return null;
};

// ─── zigzag 撕边 ─────────────────────────────────
const ZigzagEdge: React.FC<{ color: string; flip: boolean }> = ({ color, flip }) => (
    <svg
        viewBox="0 0 100 6" preserveAspectRatio="none"
        style={{ width: '100%', height: 5, display: 'block', transform: flip ? 'scaleY(-1)' : undefined }}
        aria-hidden
    >
        <polygon
            points="0,6 4,0 8,6 12,0 16,6 20,0 24,6 28,0 32,6 36,0 40,6 44,0 48,6 52,0 56,6 60,0 64,6 68,0 72,6 76,0 80,6 84,0 88,6 92,0 96,6 100,0 100,6"
            fill={color}
        />
    </svg>
);

// ─── 段间装饰(端正版 — 居中 / 一致) ───────────
type DecoKind = 'sparkles' | 'heartstrip' | 'washi_thin' | 'dotline' | 'star_chain';

const InterleaveDeco: React.FC<{ kind: DecoKind; seed: string }> = ({ kind, seed }) => {
    if (kind === 'sparkles') {
        return (
            <div className="flex items-center justify-center gap-3 my-2">
                <SparkleDot size={9} color={PAPER_TONES.accentLavender} />
                <StarSticker size={11} color={PAPER_TONES.accentLemon} />
                <SparkleDot size={9} color={PAPER_TONES.accentBlue} />
            </div>
        );
    }
    if (kind === 'heartstrip') {
        const count = 5;
        return (
            <div className="flex items-center justify-center gap-1.5 my-1">
                {Array.from({ length: count }).map((_, i) => (
                    <HeartSticker
                        key={i}
                        size={8 + (i === 2 ? 4 : 0)} /* 中心稍大 */
                        sparkle={false}
                        color={i % 2 === 0 ? PAPER_TONES.accentBlush : PAPER_TONES.accentRose}
                    />
                ))}
            </div>
        );
    }
    if (kind === 'washi_thin') {
        const tapes: Array<'rose' | 'mint' | 'lemon' | 'blue' | 'lavender'> = ['lavender','blue','rose'];
        const c = tapes[Math.floor(seedFloat(seed, 1) * tapes.length)];
        return (
            <div className="flex justify-center my-2">
                <div style={{ width: '40%' }}>
                    <WashiTape color={c} pattern="dot" rotate={0}>
                        {' · · · '}
                    </WashiTape>
                </div>
            </div>
        );
    }
    if (kind === 'dotline') {
        return (
            <div className="flex items-center justify-center gap-1 my-2 px-8" aria-hidden>
                <div style={{ flex: 1, height: 1, background: PAPER_TONES.spine, opacity: 0.5 }} />
                <SparkleDot size={8} color={PAPER_TONES.accentLavender} />
                <div style={{ flex: 1, height: 1, background: PAPER_TONES.spine, opacity: 0.5 }} />
            </div>
        );
    }
    if (kind === 'star_chain') {
        return (
            <div className="flex items-center justify-center gap-2 my-1.5">
                <span style={{ color: PAPER_TONES.accentLavender, fontSize: 10 }}>✦</span>
                <span style={{ color: PAPER_TONES.accentBlue, fontSize: 8 }}>·</span>
                <span style={{ color: PAPER_TONES.accentLemon, fontSize: 12 }}>✦</span>
                <span style={{ color: PAPER_TONES.accentBlue, fontSize: 8 }}>·</span>
                <span style={{ color: PAPER_TONES.accentLavender, fontSize: 10 }}>✦</span>
            </div>
        );
    }
    return null;
};

// ─── 主组件 — 端正布局 ───────────────────────────
const FragmentCollage: React.FC<{
    fragments: HandbookFragment[];
    compact?: boolean;
}> = ({ fragments, compact: _compact = false }) => {
    if (!fragments || fragments.length === 0) return null;

    return (
        <div className="relative pt-2 pb-2 flex flex-col items-center">
            {fragments.map((f, i) => {
                const skin = pickSkin(f.id);
                const size = pickSize(f.text);
                const [wMin, wMax] = SIZE_TO_WIDTH[size];
                const widthPct = seedRange(f.id, 21, wMin, wMax);

                // 端正:几乎居中,小尺寸允许微偏左/右(±3%)
                // 大尺寸固定居中
                const isWide = widthPct > 80;
                const offsetX = isWide ? 0 : (seedFloat(f.id, 22) - 0.5) * 6; // ±3%

                // 段间装饰:每 ~2 片插一次,装饰在 fragment 之间(不在卡片上)
                const insertDecoBefore = i > 0 && (i % 2 === 0) && seedFloat(f.id, 27) > 0.45;
                const decoKinds: DecoKind[] = ['sparkles', 'heartstrip', 'washi_thin', 'dotline', 'star_chain'];
                const decoKind = decoKinds[Math.floor(seedFloat(f.id, 28) * decoKinds.length)];

                return (
                    <React.Fragment key={f.id}>
                        {insertDecoBefore && (
                            <div style={{ width: '100%' }}>
                                <InterleaveDeco kind={decoKind} seed={f.id + ':deco'} />
                            </div>
                        )}
                        <div
                            style={{
                                position: 'relative',
                                width: `${widthPct}%`,
                                marginLeft: `${offsetX}%`,
                                marginTop: i === 0 ? 6 : 14,
                            }}
                        >
                            <FragmentCard fragment={f} skin={skin} />
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default FragmentCollage;
