/**
 * 装饰贴纸库（SVG inline,零图片依赖）
 *
 * 设计：每个贴纸是一个独立 React 组件，传 size/color 即可改尺寸。
 * 还提供一个 <ScatteredStickers seed=... /> 用 page id 作种子稳定散布
 * 几枚小贴纸到容器四角（不会随渲染抖动）。
 */

import React from 'react';
import { seedFloat, PAPER_TONES } from './paper';

// ─── 单个贴纸组件 ────────────────────────────────────

export const HeartSticker: React.FC<{ size?: number; color?: string; sparkle?: boolean }> = ({
    size = 20, color = PAPER_TONES.accentBlush, sparkle = true,
}) => (
    <svg viewBox="0 0 24 24" width={size} height={size}>
        <path
            d="M12 21 C 7 16 2 12 2 7.5 a4.5 4.5 0 0 1 9 -1 a4.5 4.5 0 0 1 9 1 C 22 12 17 16 12 21 z"
            fill={color}
            stroke="rgba(255,255,255,0.7)"
            strokeWidth="1"
        />
        {sparkle && (
            <ellipse cx="9" cy="8" rx="1.4" ry="2.2" fill="rgba(255,255,255,0.85)" transform="rotate(-25 9 8)" />
        )}
    </svg>
);

export const StarSticker: React.FC<{ size?: number; color?: string }> = ({
    size = 18, color = PAPER_TONES.accentLemon,
}) => (
    <svg viewBox="0 0 24 24" width={size} height={size}>
        {/* 4-point sparkle */}
        <path
            d="M 12 2 L 13.5 10.5 L 22 12 L 13.5 13.5 L 12 22 L 10.5 13.5 L 2 12 L 10.5 10.5 Z"
            fill={color}
            stroke="rgba(255,255,255,0.6)"
            strokeWidth="0.6"
        />
    </svg>
);

export const PawSticker: React.FC<{ size?: number; color?: string }> = ({
    size = 22, color = PAPER_TONES.accentRose,
}) => (
    <svg viewBox="0 0 24 24" width={size} height={size}>
        {/* 4 toes */}
        <ellipse cx="6" cy="9" rx="2.2" ry="2.8" fill={color} />
        <ellipse cx="11" cy="6" rx="2.2" ry="2.8" fill={color} />
        <ellipse cx="16" cy="6" rx="2.2" ry="2.8" fill={color} />
        <ellipse cx="20" cy="9" rx="2.2" ry="2.8" fill={color} />
        {/* heel pad */}
        <path
            d="M 7 17 Q 7 13 13 13 Q 19 13 19 17 Q 19 21 13 21 Q 7 21 7 17 Z"
            fill={color}
        />
    </svg>
);

export const BowSticker: React.FC<{ size?: number; color?: string }> = ({
    size = 26, color = PAPER_TONES.accentRose,
}) => (
    <svg viewBox="0 0 32 24" width={size} height={size * 24 / 32}>
        {/* left loop */}
        <path d="M 16 12 Q 6 4 4 8 Q 2 14 6 18 Q 10 20 16 12 Z" fill={color} stroke="rgba(255,255,255,0.5)" strokeWidth="0.6" />
        {/* right loop */}
        <path d="M 16 12 Q 26 4 28 8 Q 30 14 26 18 Q 22 20 16 12 Z" fill={color} stroke="rgba(255,255,255,0.5)" strokeWidth="0.6" />
        {/* center knot */}
        <ellipse cx="16" cy="12" rx="3" ry="4" fill={color} stroke="rgba(255,255,255,0.6)" strokeWidth="0.6" />
        <ellipse cx="15" cy="11" rx="0.8" ry="1.2" fill="rgba(255,255,255,0.6)" />
    </svg>
);

export const PaperClip: React.FC<{ size?: number; color?: string; rotate?: number }> = ({
    size = 28, color = '#c8d2dc', rotate = -30,
}) => (
    <svg
        viewBox="0 0 24 32"
        width={size * 24 / 32}
        height={size}
        style={{ transform: `rotate(${rotate}deg)` }}
    >
        <path
            d="M 8 4 Q 4 4 4 8 L 4 26 Q 4 30 8 30 Q 12 30 12 26 L 12 8 Q 12 6 14 6 Q 16 6 16 8 L 16 24 Q 16 24 17 24 L 17 8 Q 17 5 14 5 Q 11 5 11 8 L 11 26 Q 11 29 8 29 Q 5 29 5 26 L 5 8 Q 5 5 8 5 Q 11 5 11 5"
            fill="none"
            stroke={color}
            strokeWidth="1.4"
            strokeLinecap="round"
        />
    </svg>
);

export const SparkleDot: React.FC<{ size?: number; color?: string }> = ({
    size = 14, color = PAPER_TONES.accentLemon,
}) => (
    <svg viewBox="0 0 24 24" width={size} height={size}>
        <path
            d="M 12 4 L 13 11 L 20 12 L 13 13 L 12 20 L 11 13 L 4 12 L 11 11 Z"
            fill={color}
        />
    </svg>
);

export const Ribbon: React.FC<{ size?: number; color?: string }> = ({
    size = 24, color = PAPER_TONES.accentBlue,
}) => (
    <svg viewBox="0 0 24 32" width={size * 24 / 32} height={size}>
        <path
            d="M 4 0 L 20 0 L 20 28 L 12 22 L 4 28 Z"
            fill={color}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="0.6"
        />
        <path d="M 4 0 L 20 0 L 20 4 L 4 4 Z" fill="rgba(255,255,255,0.25)" />
    </svg>
);

export const Cloud: React.FC<{ size?: number; color?: string }> = ({
    size = 30, color = '#e6f0f7',
}) => (
    <svg viewBox="0 0 40 24" width={size} height={size * 24 / 40}>
        <ellipse cx="10" cy="16" rx="9" ry="7" fill={color} />
        <ellipse cx="22" cy="12" rx="11" ry="9" fill={color} />
        <ellipse cx="32" cy="16" rx="7" ry="6" fill={color} />
    </svg>
);

export const TicketStub: React.FC<{ size?: number; color?: string; label?: string }> = ({
    size = 36, color = PAPER_TONES.accentLemon, label = 'TICKET',
}) => (
    <svg viewBox="0 0 60 24" width={size} height={size * 24 / 60}>
        <path
            d="M 4 4 L 56 4 L 56 8 a 2 2 0 0 1 0 4 L 56 16 a 2 2 0 0 1 0 4 L 56 20 L 4 20 L 4 16 a 2 2 0 0 0 0 -4 L 4 8 a 2 2 0 0 0 0 -4 Z"
            fill={color}
            stroke="rgba(0,0,0,0.1)"
            strokeWidth="0.5"
        />
        <text x="30" y="15.5" textAnchor="middle" fill="rgba(0,0,0,0.4)" fontSize="6" fontWeight="bold">
            {label}
        </text>
    </svg>
);

// ─── 散布贴纸（页角装饰）─────────────────────────────
// 用 seed 决定:
//  - 哪几个贴纸出现
//  - 每个的位置（top/right + 些许偏移）
//  - 旋转角度
const STICKER_POOL: Array<React.FC<any>> = [
    HeartSticker, StarSticker, PawSticker, BowSticker, SparkleDot, SparkleDot, HeartSticker, StarSticker,
];

export const ScatteredStickers: React.FC<{
    seed: string;
    count?: number;
    /** 散布范围相对父容器的百分比 */
    zone?: 'corners' | 'top' | 'edges' | 'all';
}> = ({ seed, count = 3, zone = 'corners' }) => {
    const items: { Comp: React.FC<any>; top: string; left: string; rotate: number; key: number }[] = [];
    for (let i = 0; i < count; i++) {
        const compIdx = Math.floor(seedFloat(seed, i * 7 + 1) * STICKER_POOL.length);
        const Comp = STICKER_POOL[compIdx];
        const a = seedFloat(seed, i * 7 + 2);
        const b = seedFloat(seed, i * 7 + 3);

        let top: number, left: number;
        if (zone === 'corners') {
            // 四角随机
            const corner = Math.floor(seedFloat(seed, i * 7 + 4) * 4);
            const ix = corner % 2;       // 0=left, 1=right
            const iy = Math.floor(corner / 2); // 0=top, 1=bottom
            top  = iy === 0 ? -8 + a * 14 : 88 + a * 8;
            left = ix === 0 ? -8 + b * 14 : 88 + b * 8;
        } else if (zone === 'top') {
            top  = -10 + a * 14;
            left = 8 + b * 80;
        } else if (zone === 'edges') {
            const side = Math.floor(seedFloat(seed, i * 7 + 4) * 4);
            if (side === 0) { top = -8 + a * 6; left = 8 + b * 80; }
            else if (side === 1) { top = 92 + a * 6; left = 8 + b * 80; }
            else if (side === 2) { top = 8 + b * 80; left = -8 + a * 6; }
            else { top = 8 + b * 80; left = 92 + a * 6; }
        } else {
            top = a * 100;
            left = b * 100;
        }

        const rotate = (seedFloat(seed, i * 7 + 5) - 0.5) * 60;
        items.push({ Comp, top: `${top}%`, left: `${left}%`, rotate, key: i });
    }
    return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
            {items.map(({ Comp, top, left, rotate, key }) => (
                <div key={key} style={{ position: 'absolute', top, left, transform: `rotate(${rotate}deg)` }}>
                    <Comp />
                </div>
            ))}
        </div>
    );
};

// ─── 对话气泡（碎片填充用）─────────────────────────
// 用法：在 page 之间或角落散一两个，制造"角色嘀咕"的 collage 感
export const DialogueBubble: React.FC<{
    text: string;
    color?: string;
    textColor?: string;
    direction?: 'left' | 'right';
    size?: 'sm' | 'md';
}> = ({ text, color = '#fff', textColor = PAPER_TONES.ink, direction = 'left', size = 'sm' }) => {
    const padding = size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5';
    const fontSize = size === 'sm' ? 11 : 12;
    return (
        <div
            className={`relative inline-block ${padding} rounded-2xl`}
            style={{
                background: color,
                color: textColor,
                fontSize,
                fontWeight: 700,
                boxShadow: '0 2px 4px rgba(122,90,114,0.15)',
                border: '1px solid rgba(255,255,255,0.6)',
            }}
        >
            {text}
            {/* 气泡尾巴 */}
            <span
                className="absolute"
                style={{
                    [direction === 'left' ? 'left' : 'right']: 8,
                    bottom: -5,
                    width: 0,
                    height: 0,
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: `6px solid ${color}`,
                }}
                aria-hidden
            />
        </div>
    );
};

// 一些预设的萌系小词,在 day 视图里随机选用
export const KAWAII_INTERJECTIONS = [
    'かわいい…', '今日も♡', 'うまい!', 'ぐぅ…', 'すきっ', 'よしっ',
    '嘿嘿', '哇~', '完了完了', '芜湖', '嘻嘻', '叮~', '(･ω･)',
    'ʕ•ᴥ•ʔ', '★ ★ ★', '♡ ♡', '...', '?',
];

// 在容器边缘自由散布"碎片填充"层（对话气泡 + 小贴纸 + 回形针）
// 用在 day view 里让 page 之间不空荡
export const ScatterFillers: React.FC<{
    seed: string;
    count?: number;
}> = ({ seed, count = 4 }) => {
    const items: React.ReactNode[] = [];
    const colors = [
        PAPER_TONES.accentRose, PAPER_TONES.accentBlue, PAPER_TONES.accentMint,
        PAPER_TONES.accentLemon, PAPER_TONES.accentLavender,
    ];
    for (let i = 0; i < count; i++) {
        const top = seedFloat(seed, i * 11 + 1) * 100;
        const isLeft = i % 2 === 0;
        const left = isLeft ? -2 + seedFloat(seed, i * 11 + 2) * 6 : 88 + seedFloat(seed, i * 11 + 2) * 8;
        const rotate = (seedFloat(seed, i * 11 + 3) - 0.5) * 30;
        const kind = Math.floor(seedFloat(seed, i * 11 + 4) * 4);

        let node: React.ReactNode;
        if (kind === 0) {
            const txt = KAWAII_INTERJECTIONS[Math.floor(seedFloat(seed, i * 11 + 5) * KAWAII_INTERJECTIONS.length)];
            const color = colors[Math.floor(seedFloat(seed, i * 11 + 6) * colors.length)];
            node = <DialogueBubble text={txt} color={color} direction={isLeft ? 'left' : 'right'} />;
        } else if (kind === 1) {
            node = <HeartSticker size={18} />;
        } else if (kind === 2) {
            node = <StarSticker size={16} />;
        } else {
            node = <SparkleDot size={12} />;
        }

        items.push(
            <div
                key={i}
                style={{
                    position: 'absolute',
                    top: `${top}%`,
                    left: `${left}%`,
                    transform: `rotate(${rotate}deg)`,
                    pointerEvents: 'none',
                }}
            >
                {node}
            </div>
        );
    }
    return <>{items}</>;
};

// ─── 蕾丝边（页眉 / 页脚装饰）───────────────────────
export const LaceEdge: React.FC<{ color?: string; flip?: boolean }> = ({
    color = '#fbb8c8', flip = false,
}) => (
    <svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 8, transform: flip ? 'scaleY(-1)' : undefined }}
        aria-hidden
    >
        <path
            d="M 0 0 Q 5 8 10 0 Q 15 8 20 0 Q 25 8 30 0 Q 35 8 40 0 Q 45 8 50 0 Q 55 8 60 0 Q 65 8 70 0 Q 75 8 80 0 Q 85 8 90 0 Q 95 8 100 0 L 100 8 L 0 8 Z"
            fill={color}
            opacity="0.55"
        />
    </svg>
);
