/**
 * 彩色笔批注 / 勾画
 *
 * 用 SVG 在卡片表面叠一层"手绘"标记 — 下划波浪线、圈、箭头、星、tick。
 * 颜色是马克笔风(略半透明)。位置由 seed 决定,同一 seed 永远长一样。
 *
 * 用法: <CardAnnotations seed="frag-id" intensity="light|medium" />
 */

import React from 'react';
import { seedFloat, seedRange, seedCentered } from './paper';

const PEN_COLORS = [
    '#e89b91',  // 樱粉
    '#c94a4a',  // 红
    '#5a7a8e',  // 蓝
    '#88c5a8',  // 绿
    '#d6b85a',  // 黄
    '#a98ec4',  // 紫
];

type MarkKind = 'underline' | 'circle' | 'arrow' | 'star' | 'tick' | 'wave' | 'highlight';

const ALL_KINDS: MarkKind[] = ['underline', 'circle', 'arrow', 'star', 'tick', 'wave', 'highlight'];

interface Props {
    seed: string;
    intensity?: 'none' | 'light' | 'medium' | 'busy';
    /** 限制可用颜色 — 默认全部 */
    palette?: string[];
}

const CardAnnotations: React.FC<Props> = ({ seed, intensity = 'light', palette }) => {
    if (intensity === 'none') return null;

    const colors = palette && palette.length > 0 ? palette : PEN_COLORS;

    const count = intensity === 'busy' ? 3 : intensity === 'medium' ? 2 : 1;
    const marks: React.ReactNode[] = [];

    for (let i = 0; i < count; i++) {
        const kindIdx = Math.floor(seedFloat(seed, i * 11 + 1) * ALL_KINDS.length);
        const kind = ALL_KINDS[kindIdx];
        const color = colors[Math.floor(seedFloat(seed, i * 11 + 2) * colors.length)];
        const top = seedRange(seed, i * 11 + 3, 8, 80);    // % 容器高度
        const left = seedRange(seed, i * 11 + 4, 4, 80);
        const widthPct = seedRange(seed, i * 11 + 5, 22, 50);
        const rotate = seedCentered(seed, i * 11 + 6, 8);

        marks.push(
            <Mark
                key={i}
                kind={kind}
                color={color}
                topPct={top}
                leftPct={left}
                widthPct={widthPct}
                rotate={rotate}
                seed={`${seed}-${i}`}
            />
        );
    }

    return (
        <div
            className="absolute inset-0 pointer-events-none"
            style={{ zIndex: 5 }}
            aria-hidden
        >
            {marks}
        </div>
    );
};

const Mark: React.FC<{
    kind: MarkKind;
    color: string;
    topPct: number; leftPct: number; widthPct: number;
    rotate: number;
    seed: string;
}> = ({ kind, color, topPct, leftPct, widthPct, rotate, seed }) => {
    const baseStyle: React.CSSProperties = {
        position: 'absolute',
        top: `${topPct}%`,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        transform: `rotate(${rotate}deg)`,
        transformOrigin: 'left center',
        opacity: 0.7,
    };

    if (kind === 'underline') {
        return (
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" style={{ ...baseStyle, height: 6 }}>
                <path
                    d={`M 1 ${3 + seedFloat(seed, 1) * 1.5} Q 25 ${1 + seedFloat(seed, 2) * 4} 50 ${2 + seedFloat(seed, 3) * 3} T 99 ${3 + seedFloat(seed, 4) * 2}`}
                    stroke={color}
                    strokeWidth={2}
                    fill="none"
                    strokeLinecap="round"
                />
            </svg>
        );
    }

    if (kind === 'wave') {
        return (
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" style={{ ...baseStyle, height: 6 }}>
                <path
                    d="M 1 4 Q 8 1 16 4 T 32 4 T 48 4 T 64 4 T 80 4 T 99 4"
                    stroke={color}
                    strokeWidth={1.6}
                    fill="none"
                    strokeLinecap="round"
                />
            </svg>
        );
    }

    if (kind === 'highlight') {
        return (
            <div
                style={{
                    ...baseStyle,
                    height: 16,
                    background: `linear-gradient(transparent 30%, ${color}44 30%, ${color}44 80%, transparent 80%)`,
                    borderRadius: 2,
                }}
            />
        );
    }

    if (kind === 'circle') {
        return (
            <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ ...baseStyle, height: widthPct * 0.6 + '%' }}>
                <ellipse
                    cx="50" cy="30" rx="46" ry="24"
                    stroke={color} strokeWidth="1.8"
                    fill="none"
                    strokeDasharray="2,1"
                    transform={`rotate(${seedCentered(seed, 7, 4)} 50 30)`}
                />
            </svg>
        );
    }

    if (kind === 'arrow') {
        const dy = seedCentered(seed, 8, 8);
        return (
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ ...baseStyle, height: 22 }}>
                <path
                    d={`M 4 ${15 + dy} Q 35 ${5 + dy} 70 ${15 + dy}`}
                    stroke={color} strokeWidth={1.6}
                    fill="none" strokeLinecap="round"
                />
                <path
                    d={`M 70 ${15 + dy} L 80 ${10 + dy} M 70 ${15 + dy} L 80 ${20 + dy}`}
                    stroke={color} strokeWidth={1.6}
                    fill="none" strokeLinecap="round"
                />
            </svg>
        );
    }

    if (kind === 'star') {
        return (
            <svg viewBox="0 0 24 24" style={{ ...baseStyle, width: 16 + seedFloat(seed, 9) * 8, height: 'auto' }}>
                <path
                    d="M12 2 L14 9 L21 9 L15.5 13 L17.5 20 L12 16 L6.5 20 L8.5 13 L3 9 L10 9 Z"
                    fill="none" stroke={color} strokeWidth="1.4"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }

    if (kind === 'tick') {
        return (
            <svg viewBox="0 0 30 24" style={{ ...baseStyle, width: 18 + seedFloat(seed, 10) * 6, height: 'auto' }}>
                <path
                    d="M 4 13 L 12 20 L 26 4"
                    stroke={color} strokeWidth="2.2"
                    fill="none" strokeLinecap="round" strokeLinejoin="round"
                />
            </svg>
        );
    }

    return null;
};

export default CardAnnotations;
