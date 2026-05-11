/**
 * 手账视觉原语：糖果色调色板 + 装订环 + 多种胶带 + 拍立得 + 全息渐变
 *
 * 全部用 Tailwind class + inline style + SVG 实现，零额外依赖。
 */

import React from 'react';

// ─── 糖果调色板（奶油粉 / 粉雾蓝 / 薄荷 / 烫银）────────
export const PAPER_TONES = {
    // 主纸张：奶油色偏粉
    paper:      '#fff8fb',
    paperWarm:  '#fff0f5',
    paperCool:  '#f1f6fa',
    paperMint:  '#f0faf5',

    // 封面 / 强调（替换原来的牛皮）
    cover:      '#f8c7d4',     // 樱花粉封
    coverDark:  '#e9a8bb',
    spine:      '#dcc7d5',     // 装订线/标签底

    // 文字：稍微偏紫的深色，不用纯黑、不用棕
    ink:        '#3d2f3d',
    inkSoft:    '#7a5a72',
    inkFaint:   '#a892a3',

    // 各种 accent（贴纸 / 胶带 / tab）
    accentRose:   '#fbb8c8',  // 樱花粉
    accentBlush:  '#f29db0',  // 玫瑰粉
    accentBlue:   '#b9d3e0',  // 粉雾蓝
    accentSky:    '#9dc1d5',  // 天空蓝
    accentMint:   '#bfe1cf',  // 薄荷
    accentLemon:  '#f5e295',  // 蜜黄
    accentLavender: '#d6c8e8', // 薰衣草
    accentSilver: '#dde5ed',  // 烫银
    accentGold:   '#f0d27a',  // 烫金
};

// ─── 字体堆栈 ─────────────────────────────────────────
// SERIF：日期/标题/页眉用衬线
export const SERIF_STACK: React.CSSProperties = {
    fontFamily: '"Noto Serif SC", "Songti SC", "Source Han Serif SC", "STSong", "STZhongsong", serif',
};
// CUTE：可爱圆润字体（标语/装饰文字用）
export const CUTE_STACK: React.CSSProperties = {
    fontFamily: '"YouSheBiaoTiHei", "Maoken Tangyuan", "ZCOOL KuaiLe", "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif',
};
// DISPLAY：杂志感衬线大标题（Hello,  / 主标语）
export const DISPLAY_STACK: React.CSSProperties = {
    fontFamily: '"DM Serif Display", "Noto Serif SC", "Songti SC", serif',
};
// SCRIPT：手写花体（月份花字 / 天气小词）
export const SCRIPT_STACK: React.CSSProperties = {
    fontFamily: '"Caveat", "Noto Serif SC", cursive',
};
// HANDWRITTEN：中英混合手写体(bare 笔记 / 手账涂鸦用)
export const HANDWRITTEN_STACK: React.CSSProperties = {
    fontFamily: '"Caveat", "Ma Shan Zheng", "Long Cang", "ZCOOL KuaiLe", "Noto Serif SC", cursive',
};
// BRUSH：粗一些的手写中文(标题涂鸦感)
export const BRUSH_STACK: React.CSSProperties = {
    fontFamily: '"Ma Shan Zheng", "ZCOOL KuaiLe", "Caveat", "Noto Serif SC", serif',
};
// JP：和风明朝（季節の手帳 副标题）
export const JP_STACK: React.CSSProperties = {
    fontFamily: '"Shippori Mincho", "Hiragino Mincho ProN", "Noto Serif SC", "Yu Mincho", serif',
};
// MONO：复古机械字（DATE / VOL 标签）
export const MONO_STACK: React.CSSProperties = {
    fontFamily: '"Courier Prime", "Courier New", "SFMono-Regular", monospace',
};

// ─── 全息 / 渐变 helper（封面、丝带、shimmer 用）─────
export const HOLO_GRADIENT =
    'linear-gradient(135deg, #ffe2ec 0%, #e2eaff 25%, #e2fff0 50%, #fff8d6 75%, #ffe2ec 100%)';
export const HOLO_GRADIENT_SOFT =
    'linear-gradient(135deg, rgba(255,226,236,0.6) 0%, rgba(226,234,255,0.6) 50%, rgba(255,248,214,0.6) 100%)';

// ─── 纸张图案（每页背景）─────────────────────────────
export type PaperKind = 'plain' | 'lined' | 'grid' | 'dot' | 'cream' | 'mint' | 'rose' | 'sky' | 'sage';

export const PAPERS: Record<PaperKind, { bg: string; style?: React.CSSProperties }> = {
    plain: { bg: PAPER_TONES.paper },
    lined: {
        bg: PAPER_TONES.paper,
        style: { backgroundImage: 'repeating-linear-gradient(transparent, transparent 25px, rgba(242,157,176,0.22) 25px, rgba(242,157,176,0.22) 26px)' },
    },
    grid: {
        bg: PAPER_TONES.paper,
        style: { backgroundImage: 'linear-gradient(rgba(185,211,224,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(185,211,224,0.18) 1px, transparent 1px)', backgroundSize: '22px 22px' },
    },
    dot: {
        bg: PAPER_TONES.paperWarm,
        style: { backgroundImage: 'radial-gradient(rgba(242,157,176,0.35) 1.4px, transparent 1.4px)', backgroundSize: '20px 20px' },
    },
    cream: { bg: PAPER_TONES.paperWarm },
    mint:  { bg: PAPER_TONES.paperMint },
    rose:  { bg: '#ffe8ee' },
    sky:   { bg: '#e6f0f7' },
    // legacy 兼容（别处可能传 'sage'）
    sage:  { bg: PAPER_TONES.paperMint },
};

// ─── 装订环列（左侧穿孔 + 烫银金属环）─────────────────
export const BinderRings: React.FC<{ count?: number; tone?: 'silver' | 'gold' | 'pink' }> = ({
    count = 7, tone = 'silver',
}) => {
    const c = tone === 'gold'
        ? { ring: '#e9c97c', highlight: '#fff5d4', shadow: '#a87a3d' }
        : tone === 'pink'
        ? { ring: '#f0b8c8', highlight: '#ffe8ee', shadow: '#b87890' }
        : { ring: '#c8d2dc', highlight: '#f5fafd', shadow: '#7a8694' };
    const holeColor = '#3d2f3d';
    return (
        <div
            className="absolute left-0 top-0 bottom-0 w-7 flex flex-col items-center justify-around py-3 pointer-events-none"
            aria-hidden
        >
            {Array.from({ length: count }).map((_, i) => (
                <svg key={i} viewBox="0 0 24 24" className="w-5 h-5">
                    <ellipse cx="12" cy="13.4" rx="7.5" ry="2.2" fill="rgba(0,0,0,0.16)" />
                    <circle cx="12" cy="12" r="6" fill={holeColor} opacity="0.9" />
                    <circle cx="12" cy="12" r="6" fill="none" stroke={c.ring} strokeWidth="2.4" />
                    {/* 高光弧 */}
                    <path d="M 7.5 9 A 6 6 0 0 1 12.5 5.8" fill="none" stroke={c.highlight} strokeWidth="1.2" strokeLinecap="round" />
                    {/* 阴影弧 */}
                    <path d="M 16 14 A 6 6 0 0 1 12 18" fill="none" stroke={c.shadow} strokeWidth="0.8" strokeLinecap="round" opacity="0.6" />
                </svg>
            ))}
        </div>
    );
};

// ─── Washi 胶带：多种图案变体 ─────────────────────────
type TapeColor = 'rose' | 'blush' | 'blue' | 'sky' | 'mint' | 'lemon' | 'lavender' | 'cream' | 'silver';
type TapePattern = 'stripe' | 'heart' | 'star' | 'dot' | 'lace' | 'plain';

export const WashiTape: React.FC<{
    color?: TapeColor;
    pattern?: TapePattern;
    children?: React.ReactNode;
    className?: string;
    rotate?: number;
    style?: React.CSSProperties;
}> = ({ color = 'rose', pattern = 'stripe', children, className = '', rotate = -1.5, style }) => {
    const palette: Record<TapeColor, { base: string; accent: string; text: string }> = {
        rose:     { base: '#fbb8c8', accent: 'rgba(255,255,255,0.45)', text: '#7a3845' },
        blush:    { base: '#f29db0', accent: 'rgba(255,255,255,0.4)',  text: '#6a2535' },
        blue:     { base: '#b9d3e0', accent: 'rgba(255,255,255,0.4)',  text: '#324651' },
        sky:      { base: '#9dc1d5', accent: 'rgba(255,255,255,0.4)',  text: '#1f3845' },
        mint:     { base: '#bfe1cf', accent: 'rgba(255,255,255,0.4)',  text: '#264a36' },
        lemon:    { base: '#f5e295', accent: 'rgba(255,255,255,0.4)',  text: '#5a4818' },
        lavender: { base: '#d6c8e8', accent: 'rgba(255,255,255,0.45)', text: '#3a2c50' },
        cream:    { base: '#fbe9d0', accent: 'rgba(255,255,255,0.5)',  text: '#5a4825' },
        silver:   { base: '#dde5ed', accent: 'rgba(255,255,255,0.6)',  text: '#3d4a55' },
    };
    const p = palette[color];

    // 根据 pattern 生成 background
    let bg: string;
    let bgSize: string | undefined;
    switch (pattern) {
        case 'heart': {
            // 用 SVG data URI 嵌入小心心
            const svg = encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 13.5 L2 7.5 a3 3 0 0 1 6-3 a3 3 0 0 1 6 3 z" fill="${p.accent}"/></svg>`
            );
            bg = `${p.base} url("data:image/svg+xml,${svg}")`;
            bgSize = '14px 14px';
            break;
        }
        case 'star': {
            const svg = encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1 L9.5 6 L14.5 6 L10.5 9 L12 14 L8 11 L4 14 L5.5 9 L1.5 6 L6.5 6 Z" fill="${p.accent}"/></svg>`
            );
            bg = `${p.base} url("data:image/svg+xml,${svg}")`;
            bgSize = '14px 14px';
            break;
        }
        case 'dot':
            bg = `${p.base} radial-gradient(${p.accent} 1.5px, transparent 1.5px)`;
            bgSize = '8px 8px';
            break;
        case 'lace':
            bg = `${p.base} radial-gradient(circle at 50% 100%, ${p.accent} 4px, transparent 5px)`;
            bgSize = '10px 10px';
            break;
        case 'plain':
            bg = p.base;
            break;
        case 'stripe':
        default:
            bg = `repeating-linear-gradient(135deg, ${p.base} 0 8px, ${p.accent} 8px 12px, ${p.base} 12px 20px)`;
            break;
    }

    return (
        <span
            className={`inline-block px-3 py-1 text-[11px] font-bold tracking-wider relative ${className}`}
            style={{
                background: bg,
                backgroundSize: bgSize,
                color: p.text,
                transform: `rotate(${rotate}deg)`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                clipPath: 'polygon(2% 0, 100% 5%, 99% 100%, 0 95%)',
                ...CUTE_STACK,
                ...style,
            }}
        >
            {children}
        </span>
    );
};

// ─── 纸的边缘阴影 ─────────────────────────────────────
export const PAPER_SHADOW: React.CSSProperties = {
    boxShadow: '0 1px 3px rgba(122,90,114,0.1), 0 8px 18px -8px rgba(122,90,114,0.18), 0 0 0 1px rgba(220,199,213,0.4) inset',
};

// 拍立得相片白边 + 阴影（character_life 用）
export const POLAROID_SHADOW: React.CSSProperties = {
    boxShadow: '0 2px 4px rgba(122,90,114,0.12), 0 10px 20px -8px rgba(122,90,114,0.2)',
    background: '#ffffff',
    padding: '10px 10px 36px 10px', // 底边更宽留笔记位
    borderRadius: 4,
};

// ─── 倾斜种子 ────────────────────────────────────────
export const TILT_ANGLES = [-2.4, -1.2, 0.6, 1.8, -1.6, 1.2, -0.4, 2.0];
export function tiltFor(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return TILT_ANGLES[Math.abs(h) % TILT_ANGLES.length];
}
// 用 seed 取 0~1 之间的伪随机数（贴纸定位用）
//
// FNV-1a + 末段 xorshift avalanche —— 对相似前缀字符串(eg "frag-1735-0",
// "frag-1735-1")也能完全打散。以前用单层 XOR,前缀相同时几乎不分散,
// 导致 pickSkin/pickSize 几乎只返回一个值,所有片段长一样。
export function seedFloat(seed: string, salt: number = 0): number {
    // FNV-1a 32-bit
    let h = ((salt | 0) + 0x811c9dc5) >>> 0;
    for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    // 末段 avalanche(xorshift + multiply + xorshift),让相似输入也能完全打散
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
    return (h >>> 0) / 0x100000000;
}
// 用 seed 取 [min, max] 区间内的伪随机数
export function seedRange(seed: string, salt: number, min: number, max: number): number {
    return min + seedFloat(seed, salt) * (max - min);
}
// 用 seed 取 ±range 居中的伪随机数（用于 ±旋转、±偏移）
export function seedCentered(seed: string, salt: number, range: number): number {
    return (seedFloat(seed, salt) - 0.5) * 2 * range;
}

// ─── 中文星期 + 日期格式化 helpers ────────────────────
export const dayOfWeekZh = (date: string): string => {
    const d = new Date(date.replace(/-/g, '/'));
    return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
};
export const dayOfWeekEn = (date: string): string => {
    const d = new Date(date.replace(/-/g, '/'));
    return ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
};
export const monthEn = (date: string): string => {
    const d = new Date(date.replace(/-/g, '/'));
    return ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][d.getMonth()];
};
export const monthFullEn = (date: string): string => {
    const d = new Date(date.replace(/-/g, '/'));
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()];
};
export const dayNum = (date: string): string => date.split('-')[2];
export const yearNum = (date: string): string => date.split('-')[0];

// ─── 四季 / 卷号 helpers（杂志感封面用）─────────────────
export type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';
export const seasonOf = (date: string): SeasonKey => {
    const m = parseInt(date.split('-')[1], 10);
    if (m >= 3 && m <= 5)  return 'spring';
    if (m >= 6 && m <= 8)  return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
};
export const seasonLabel = (s: SeasonKey): { en: string; jp: string; emoji: string } => {
    return s === 'spring' ? { en: 'SPRING ISSUE', jp: '春', emoji: '✿' }
        :  s === 'summer' ? { en: 'SUMMER ISSUE', jp: '夏', emoji: '☀' }
        :  s === 'autumn' ? { en: 'AUTUMN ISSUE', jp: '秋', emoji: '✦' }
        :                   { en: 'WINTER ISSUE', jp: '冬', emoji: '❄' };
};
// 卷号 = 年份的最后两位（2026 → "VOL. 26"）
export const volNum = (date: string): string => {
    const y = date.split('-')[0];
    return `VOL. ${y.slice(-2)}`;
};
