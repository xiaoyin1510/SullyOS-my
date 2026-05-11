/**
 * StyledIcon — 手绘风格 SVG 图标系统
 *
 * 用精致的 SVG 小插画替代 Twemoji，提供更统一、更有设计感的视觉体验。
 * 每个图标都是手工设计的极简矢量图，带有柔和的渐变和圆润的线条。
 */

import React from 'react';

interface IconProps {
    size?: number;
    className?: string;
    style?: React.CSSProperties;
}

// ── 通用容器 ──────────────────────────────────────────
const Wrap: React.FC<IconProps & { children: React.ReactNode; viewBox?: string }> = ({ size = 24, className = '', style, children, viewBox = '0 0 24 24' }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox={viewBox}
        className={`inline-block ${className}`} style={{ verticalAlign: 'middle', ...style }} fill="none">
        {children}
    </svg>
);

// ── 情绪/事件图标 ──────────────────────────────────────

/** 愤怒 - 红色闪电裂痕 */
export const IconFight: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="url(#gFight)" stroke="#dc2626" strokeWidth="1.2" strokeLinejoin="round"/>
        <defs><linearGradient id="gFight" x1="7" y1="2" x2="15" y2="22"><stop stopColor="#fca5a5"/><stop offset="1" stopColor="#dc2626"/></linearGradient></defs>
    </Wrap>
);

/** 派对 - 彩色星爆 */
export const IconParty: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <circle cx="12" cy="12" r="6" fill="url(#gParty)" opacity="0.3"/>
        <path d="M12 2l1.5 4.5L18 5l-2.5 4L20 12l-4.5 1.5L17 18l-4-2.5L12 20l-1-4.5L7 18l2.5-4.5L5 12l4.5-1L7 6l4.5 2.5z" fill="url(#gParty2)" stroke="#f59e0b" strokeWidth="0.6"/>
        <defs>
            <radialGradient id="gParty"><stop stopColor="#fde68a"/><stop offset="1" stopColor="#f59e0b" stopOpacity="0"/></radialGradient>
            <linearGradient id="gParty2" x1="5" y1="2" x2="20" y2="20"><stop stopColor="#fb923c"/><stop offset="0.5" stopColor="#f59e0b"/><stop offset="1" stopColor="#a855f7"/></linearGradient>
        </defs>
    </Wrap>
);

/** 浪漫 - 柔和心形 */
export const IconRomance: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill="url(#gRomance)" stroke="#ec4899" strokeWidth="0.8"/>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill="white" opacity="0.3" style={{ clipPath: 'inset(0 0 60% 0)' }}/>
        <defs><linearGradient id="gRomance" x1="2" y1="3" x2="22" y2="21"><stop stopColor="#fda4af"/><stop offset="1" stopColor="#e11d48"/></linearGradient></defs>
    </Wrap>
);

/** 闲话 - 气泡 */
export const IconGossip: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M20 12c0 4.418-3.582 7-8 7a9.863 9.863 0 01-3.2-.533L4 20l1.338-3.346C4.485 15.26 4 13.698 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8z"
            fill="url(#gGossip)" stroke="#8b5cf6" strokeWidth="1"/>
        <circle cx="9" cy="12" r="1" fill="#8b5cf6"/>
        <circle cx="12" cy="12" r="1" fill="#8b5cf6"/>
        <circle cx="15" cy="12" r="1" fill="#8b5cf6"/>
        <defs><linearGradient id="gGossip" x1="4" y1="4" x2="20" y2="20"><stop stopColor="#ede9fe"/><stop offset="1" stopColor="#c4b5fd"/></linearGradient></defs>
    </Wrap>
);

/** 竞争 - 交叉剑 */
export const IconRivalry: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M6 18L16 4" stroke="url(#gRiv1)" strokeWidth="2" strokeLinecap="round"/>
        <path d="M18 18L8 4" stroke="url(#gRiv2)" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="6" cy="18" r="1.5" fill="#94a3b8"/>
        <circle cx="18" cy="18" r="1.5" fill="#94a3b8"/>
        <path d="M14.5 4L16 2.5 17.5 4" stroke="#cbd5e1" strokeWidth="1" fill="none"/>
        <path d="M6.5 4L8 2.5 9.5 4" stroke="#cbd5e1" strokeWidth="1" fill="none"/>
        <defs>
            <linearGradient id="gRiv1" x1="6" y1="18" x2="16" y2="4"><stop stopColor="#64748b"/><stop offset="1" stopColor="#e2e8f0"/></linearGradient>
            <linearGradient id="gRiv2" x1="18" y1="18" x2="8" y2="4"><stop stopColor="#64748b"/><stop offset="1" stopColor="#e2e8f0"/></linearGradient>
        </defs>
    </Wrap>
);

/** 结盟 - 握手 */
export const IconAlliance: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M2 11l4-4 3 1 3-3 3 3 3-1 4 4" stroke="url(#gAll)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <path d="M7 14l2.5 2.5L12 14l2.5 2.5L17 14" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <circle cx="12" cy="19" r="1.5" fill="#22d3ee" opacity="0.5"/>
        <defs><linearGradient id="gAll" x1="2" y1="7" x2="22" y2="15"><stop stopColor="#67e8f9"/><stop offset="1" stopColor="#06b6d4"/></linearGradient></defs>
    </Wrap>
);

/** 火焰 - 仇恨 */
export const IconFlame: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M12 22c-4 0-7-3.134-7-7 0-2.5 1.5-4.5 3-6.5C9.5 6.5 10 4 12 2c1 2 2 3.5 3 5.5 1.5 2 3 4 3 6.5 0 3.866-3 7-6 7z"
            fill="url(#gFlame)"/>
        <path d="M12 22c-2 0-3.5-1.567-3.5-3.5S10 15 12 13c2 2 3.5 3 3.5 5.5S14 22 12 22z"
            fill="url(#gFlame2)"/>
        <defs>
            <linearGradient id="gFlame" x1="12" y1="2" x2="12" y2="22"><stop stopColor="#fbbf24"/><stop offset="0.5" stopColor="#f97316"/><stop offset="1" stopColor="#dc2626"/></linearGradient>
            <linearGradient id="gFlame2" x1="12" y1="13" x2="12" y2="22"><stop stopColor="#fde68a"/><stop offset="1" stopColor="#fbbf24"/></linearGradient>
        </defs>
    </Wrap>
);

/** 心动 - 暗恋 */
export const IconCrush: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill="url(#gCrush)" opacity="0.6"/>
        <path d="M8 9l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
        <defs><linearGradient id="gCrush" x1="2" y1="3" x2="22" y2="21"><stop stopColor="#f9a8d4"/><stop offset="1" stopColor="#ec4899"/></linearGradient></defs>
    </Wrap>
);

// ── 天气图标 ──────────────────────────────────────

/** 雨滴 */
export const IconRaindrop: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M12 2C12 2 5 10 5 14a7 7 0 0014 0c0-4-7-12-7-12z" fill="url(#gRain)" stroke="#60a5fa" strokeWidth="0.5"/>
        <path d="M9 14c0 1.5 1.3 3 3 3" stroke="white" strokeWidth="0.8" strokeLinecap="round" opacity="0.5"/>
        <defs><linearGradient id="gRain" x1="12" y1="2" x2="12" y2="22"><stop stopColor="#bfdbfe"/><stop offset="1" stopColor="#3b82f6"/></linearGradient></defs>
    </Wrap>
);

/** 雪花 */
export const IconSnowflake: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07" stroke="url(#gSnow)" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx="12" cy="12" r="2" fill="#e0f2fe"/>
        <circle cx="12" cy="4" r="1" fill="#bae6fd"/><circle cx="12" cy="20" r="1" fill="#bae6fd"/>
        <circle cx="4" cy="12" r="1" fill="#bae6fd"/><circle cx="20" cy="12" r="1" fill="#bae6fd"/>
        <defs><linearGradient id="gSnow" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#e0f2fe"/><stop offset="1" stopColor="#7dd3fc"/></linearGradient></defs>
    </Wrap>
);

/** 闪电 */
export const IconLightning: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" fill="url(#gLtn)" stroke="#fbbf24" strokeWidth="0.8" strokeLinejoin="round"/>
        <defs><linearGradient id="gLtn" x1="7" y1="2" x2="15" y2="22"><stop stopColor="#fef3c7"/><stop offset="1" stopColor="#f59e0b"/></linearGradient></defs>
    </Wrap>
);

/** 爆炸 */
export const IconExplosion: React.FC<IconProps> = (p) => (
    <Wrap {...p}>
        <path d="M12 2l2 5 5-2-3 4 5 3-5 1 2 5-4-3-2 5-2-5-4 3 2-5-5-1 5-3-3-4 5 2z" fill="url(#gExp)" stroke="#f97316" strokeWidth="0.6"/>
        <circle cx="12" cy="12" r="3" fill="#fef3c7"/>
        <defs><linearGradient id="gExp" x1="2" y1="2" x2="22" y2="22"><stop stopColor="#fde68a"/><stop offset="0.5" stopColor="#fb923c"/><stop offset="1" stopColor="#ef4444"/></linearGradient></defs>
    </Wrap>
);

// ── 家具图标（RoomApp 用） ──────────────────────────

/** 床 */
export const IconBed: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="3" y="18" width="26" height="8" rx="2" fill="url(#gBed1)"/>
        <rect x="4" y="12" width="24" height="7" rx="1.5" fill="url(#gBed2)"/>
        <rect x="5" y="14" width="8" height="4" rx="1" fill="#e0e7ff" opacity="0.8"/>
        <rect x="3" y="26" width="3" height="3" rx="0.5" fill="#6366f1"/>
        <rect x="26" y="26" width="3" height="3" rx="0.5" fill="#6366f1"/>
        <defs>
            <linearGradient id="gBed1" x1="3" y1="18" x2="29" y2="26"><stop stopColor="#818cf8"/><stop offset="1" stopColor="#6366f1"/></linearGradient>
            <linearGradient id="gBed2" x1="4" y1="12" x2="28" y2="19"><stop stopColor="#c7d2fe"/><stop offset="1" stopColor="#a5b4fc"/></linearGradient>
        </defs>
    </Wrap>
);

/** 沙发 */
export const IconSofa: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="4" y="14" width="24" height="10" rx="3" fill="url(#gSofa)"/>
        <rect x="2" y="12" width="6" height="14" rx="2" fill="#a78bfa"/>
        <rect x="24" y="12" width="6" height="14" rx="2" fill="#a78bfa"/>
        <rect x="7" y="16" width="18" height="3" rx="1" fill="#e0e7ff" opacity="0.4"/>
        <rect x="4" y="26" width="3" height="3" rx="0.5" fill="#7c3aed"/>
        <rect x="25" y="26" width="3" height="3" rx="0.5" fill="#7c3aed"/>
        <defs><linearGradient id="gSofa" x1="4" y1="14" x2="28" y2="24"><stop stopColor="#c4b5fd"/><stop offset="1" stopColor="#8b5cf6"/></linearGradient></defs>
    </Wrap>
);

/** 椅子 */
export const IconChair: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="8" y="4" width="16" height="14" rx="2" fill="url(#gChair)"/>
        <rect x="9" y="18" width="14" height="4" rx="1" fill="#92400e"/>
        <rect x="9" y="22" width="2" height="7" rx="0.5" fill="#78350f"/>
        <rect x="21" y="22" width="2" height="7" rx="0.5" fill="#78350f"/>
        <defs><linearGradient id="gChair" x1="8" y1="4" x2="24" y2="18"><stop stopColor="#d97706"/><stop offset="1" stopColor="#92400e"/></linearGradient></defs>
    </Wrap>
);

/** 盆栽 */
export const IconPlant: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <ellipse cx="16" cy="10" rx="8" ry="7" fill="url(#gPlant1)"/>
        <ellipse cx="12" cy="8" rx="4" ry="4" fill="#4ade80" opacity="0.7"/>
        <ellipse cx="20" cy="9" rx="3.5" ry="3.5" fill="#22c55e" opacity="0.6"/>
        <rect x="15" y="15" width="2" height="4" fill="#92400e"/>
        <path d="M10 22h12l-1.5 7h-9z" fill="url(#gPlant2)"/>
        <defs>
            <radialGradient id="gPlant1"><stop stopColor="#86efac"/><stop offset="1" stopColor="#16a34a"/></radialGradient>
            <linearGradient id="gPlant2" x1="10" y1="22" x2="22" y2="29"><stop stopColor="#d97706"/><stop offset="1" stopColor="#92400e"/></linearGradient>
        </defs>
    </Wrap>
);

/** 电脑 */
export const IconComputer: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="4" y="4" width="24" height="16" rx="2" fill="url(#gComp1)" stroke="#475569" strokeWidth="1"/>
        <rect x="6" y="6" width="20" height="12" rx="1" fill="#1e293b"/>
        <rect x="8" y="8" width="6" height="3" rx="0.5" fill="#38bdf8" opacity="0.7"/>
        <rect x="8" y="12" width="10" height="1" rx="0.5" fill="#94a3b8" opacity="0.4"/>
        <rect x="8" y="14" width="7" height="1" rx="0.5" fill="#94a3b8" opacity="0.3"/>
        <rect x="12" y="20" width="8" height="2" fill="#64748b"/>
        <rect x="9" y="22" width="14" height="2" rx="1" fill="#94a3b8"/>
        <defs><linearGradient id="gComp1" x1="4" y1="4" x2="28" y2="20"><stop stopColor="#94a3b8"/><stop offset="1" stopColor="#64748b"/></linearGradient></defs>
    </Wrap>
);

/** 游戏手柄 */
export const IconGamepad: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <path d="M6 12c0-2 1.5-3.5 3.5-3.5h13c2 0 3.5 1.5 3.5 3.5v4c0 4-2 8-5 9h-10c-3-1-5-5-5-9z" fill="url(#gPad)"/>
        <rect x="10" y="12" width="1.5" height="5" rx="0.5" fill="#1e1b4b"/>
        <rect x="8" y="13.5" width="5" height="1.5" rx="0.5" fill="#1e1b4b"/>
        <circle cx="22" cy="12" r="1.2" fill="#ef4444"/>
        <circle cx="20" cy="14.5" r="1.2" fill="#3b82f6"/>
        <defs><linearGradient id="gPad" x1="6" y1="8" x2="26" y2="25"><stop stopColor="#a5b4fc"/><stop offset="1" stopColor="#6366f1"/></linearGradient></defs>
    </Wrap>
);

/** 吉他 */
export const IconGuitar: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="14.5" y="2" width="3" height="14" rx="1" fill="url(#gGuit1)"/>
        <ellipse cx="16" cy="22" rx="7" ry="8" fill="url(#gGuit2)"/>
        <ellipse cx="16" cy="22" rx="4" ry="5" fill="#451a03" opacity="0.5"/>
        <circle cx="16" cy="22" r="1.5" fill="#1c1917"/>
        <rect x="15" y="6" width="2" height="1" fill="#fbbf24"/>
        <rect x="15" y="8" width="2" height="1" fill="#fbbf24"/>
        <defs>
            <linearGradient id="gGuit1" x1="15" y1="2" x2="17" y2="16"><stop stopColor="#92400e"/><stop offset="1" stopColor="#78350f"/></linearGradient>
            <linearGradient id="gGuit2" x1="9" y1="14" x2="23" y2="30"><stop stopColor="#d97706"/><stop offset="1" stopColor="#92400e"/></linearGradient>
        </defs>
    </Wrap>
);

/** 画框 */
export const IconPainting: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="3" y="5" width="26" height="22" rx="1" fill="#92400e" stroke="#78350f" strokeWidth="1.5"/>
        <rect x="5" y="7" width="22" height="18" rx="0.5" fill="url(#gPaint)"/>
        <circle cx="11" cy="14" r="3" fill="#fbbf24" opacity="0.8"/>
        <path d="M5 20l6-5 4 3 5-6 7 8v5H5z" fill="#16a34a" opacity="0.6"/>
        <path d="M5 22l6-3 4 2 5-4 7 5v3H5z" fill="#15803d" opacity="0.5"/>
        <defs><linearGradient id="gPaint" x1="5" y1="7" x2="27" y2="25"><stop stopColor="#7dd3fc"/><stop offset="1" stopColor="#38bdf8"/></linearGradient></defs>
    </Wrap>
);

/** 书堆 */
export const IconBooks: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="6" y="20" width="20" height="4" rx="0.5" fill="#3b82f6"/>
        <rect x="7" y="15" width="18" height="4" rx="0.5" fill="#ef4444"/>
        <rect x="5" y="10" width="22" height="4" rx="0.5" fill="#22c55e"/>
        <rect x="8" y="5" width="16" height="4" rx="0.5" fill="#f59e0b"/>
        <rect x="6" y="20" width="20" height="1" fill="white" opacity="0.15"/>
        <rect x="7" y="15" width="18" height="1" fill="white" opacity="0.15"/>
        <rect x="5" y="10" width="22" height="1" fill="white" opacity="0.15"/>
        <rect x="8" y="5" width="16" height="1" fill="white" opacity="0.15"/>
        <rect x="4" y="24" width="24" height="2" rx="0.5" fill="#64748b"/>
    </Wrap>
);

/** 台灯 */
export const IconLamp: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="14" y="14" width="4" height="10" rx="1" fill="#94a3b8"/>
        <ellipse cx="16" cy="26" rx="6" ry="2" fill="#64748b"/>
        <path d="M8 14h16l-3-10h-10z" fill="url(#gLamp)"/>
        <ellipse cx="16" cy="6" rx="2" ry="1" fill="#fef3c7"/>
        <circle cx="16" cy="9" r="1" fill="#fbbf24" opacity="0.8"/>
        <defs><linearGradient id="gLamp" x1="8" y1="4" x2="24" y2="14"><stop stopColor="#fef3c7"/><stop offset="1" stopColor="#fde68a"/></linearGradient></defs>
    </Wrap>
);

/** 垃圾桶 */
export const IconTrash: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="8" y="8" width="16" height="18" rx="1.5" fill="url(#gTrash)"/>
        <rect x="6" y="6" width="20" height="3" rx="1" fill="#94a3b8"/>
        <rect x="13" y="4" width="6" height="3" rx="1" fill="#64748b"/>
        <rect x="11" y="11" width="1.5" height="12" rx="0.5" fill="#475569" opacity="0.5"/>
        <rect x="15.25" y="11" width="1.5" height="12" rx="0.5" fill="#475569" opacity="0.5"/>
        <rect x="19.5" y="11" width="1.5" height="12" rx="0.5" fill="#475569" opacity="0.5"/>
        <defs><linearGradient id="gTrash" x1="8" y1="8" x2="24" y2="26"><stop stopColor="#94a3b8"/><stop offset="1" stopColor="#64748b"/></linearGradient></defs>
    </Wrap>
);

/** 咖啡 */
export const IconCoffee: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <path d="M6 12h16v12c0 2-2 4-4 4h-8c-2 0-4-2-4-4z" fill="url(#gCof)"/>
        <path d="M22 14h3c1.5 0 3 1 3 3s-1.5 3-3 3h-3" stroke="#94a3b8" strokeWidth="1.5" fill="none"/>
        <rect x="6" y="10" width="16" height="3" rx="1" fill="#e2e8f0"/>
        <path d="M10 7c0-2 1-3 1-3M14 6c0-2 1-3 1-3M18 7c0-2 1-3 1-3" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
        <defs><linearGradient id="gCof" x1="6" y1="12" x2="22" y2="28"><stop stopColor="#78350f"/><stop offset="1" stopColor="#451a03"/></linearGradient></defs>
    </Wrap>
);

/** 蛋糕 */
export const IconCake: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="5" y="16" width="22" height="10" rx="2" fill="url(#gCake1)"/>
        <path d="M5 16h22v3c0 0-3 2-11 2s-11-2-11-2z" fill="#fda4af"/>
        <rect x="7" y="12" width="18" height="5" rx="1.5" fill="url(#gCake2)"/>
        <rect x="15" y="6" width="2" height="7" rx="0.5" fill="#f59e0b"/>
        <ellipse cx="16" cy="5" rx="1.5" ry="2" fill="#fbbf24"/>
        <path d="M16 3c0 0 0-1 0-1" stroke="#fb923c" strokeWidth="1" strokeLinecap="round"/>
        <defs>
            <linearGradient id="gCake1" x1="5" y1="16" x2="27" y2="26"><stop stopColor="#fecdd3"/><stop offset="1" stopColor="#f43f5e"/></linearGradient>
            <linearGradient id="gCake2" x1="7" y1="12" x2="25" y2="17"><stop stopColor="#fef3c7"/><stop offset="1" stopColor="#fde68a"/></linearGradient>
        </defs>
    </Wrap>
);

/** 披萨 */
export const IconPizza: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <path d="M16 4L4 28h24z" fill="url(#gPiz1)"/>
        <path d="M16 8L7 26h18z" fill="url(#gPiz2)"/>
        <circle cx="13" cy="18" r="2" fill="#dc2626" opacity="0.8"/>
        <circle cx="18" cy="20" r="1.5" fill="#dc2626" opacity="0.8"/>
        <circle cx="15" cy="23" r="1.5" fill="#16a34a" opacity="0.7"/>
        <defs>
            <linearGradient id="gPiz1" x1="16" y1="4" x2="16" y2="28"><stop stopColor="#d97706"/><stop offset="1" stopColor="#92400e"/></linearGradient>
            <linearGradient id="gPiz2" x1="16" y1="8" x2="16" y2="26"><stop stopColor="#fde68a"/><stop offset="1" stopColor="#fbbf24"/></linearGradient>
        </defs>
    </Wrap>
);

/** 马桶 */
export const IconToilet: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <ellipse cx="16" cy="20" rx="9" ry="6" fill="url(#gToilet1)"/>
        <rect x="10" y="6" width="12" height="14" rx="2" fill="url(#gToilet2)"/>
        <rect x="12" y="8" width="8" height="4" rx="1" fill="#f1f5f9" opacity="0.5"/>
        <rect x="14" y="4" width="4" height="3" rx="1" fill="#94a3b8"/>
        <defs>
            <linearGradient id="gToilet1" x1="7" y1="14" x2="25" y2="26"><stop stopColor="#f1f5f9"/><stop offset="1" stopColor="#cbd5e1"/></linearGradient>
            <linearGradient id="gToilet2" x1="10" y1="6" x2="22" y2="20"><stop stopColor="#e2e8f0"/><stop offset="1" stopColor="#94a3b8"/></linearGradient>
        </defs>
    </Wrap>
);

/** 浴缸 */
export const IconBathtub: React.FC<IconProps> = (p) => (
    <Wrap {...p} viewBox="0 0 32 32">
        <rect x="2" y="12" width="28" height="3" rx="1" fill="#e2e8f0"/>
        <path d="M4 15v8c0 2 2 4 4 4h16c2 0 4-2 4-4v-8z" fill="url(#gBath)"/>
        <rect x="4" y="6" width="3" height="7" rx="1" fill="#94a3b8"/>
        <circle cx="6" cy="6" r="2" fill="#64748b"/>
        <ellipse cx="16" cy="13" rx="10" ry="1.5" fill="#bfdbfe" opacity="0.5"/>
        <defs><linearGradient id="gBath" x1="4" y1="15" x2="28" y2="27"><stop stopColor="#f1f5f9"/><stop offset="1" stopColor="#94a3b8"/></linearGradient></defs>
    </Wrap>
);

// ── LifeSim 特殊事件图标 ──────────────────────────

const EVENT_SVG_MAP: Record<string, React.FC<IconProps>> = {
    fight: IconFight,
    party: IconParty,
    romance: IconRomance,
    gossip: IconGossip,
    rivalry: IconRivalry,
    alliance: IconAlliance,
    fight_break: IconExplosion,
    mood_drop: IconRaindrop,
    relationship_change: IconRomance,
    revenge_plot: IconRivalry,
    love_triangle: IconCrush,
    jealousy_spiral: IconFlame,
    family_feud: IconFight,
    betrayal: IconRivalry,
    romantic_confession: IconRomance,
    gossip_wildfire: IconGossip,
    npc_runaway: IconLightning,
    mood_breakdown: IconRaindrop,
    secret_alliance: IconGossip,
    power_shift: IconParty,
    reconciliation: IconAlliance,
};

/**
 * 获取事件对应的 SVG 图标组件
 * 如果没有匹配的图标，返回 IconParty 作为默认
 */
export function getEventIcon(eventType: string): React.FC<IconProps> {
    return EVENT_SVG_MAP[eventType] || IconParty;
}

/**
 * EventIcon — 根据事件类型渲染对应 SVG 图标
 */
export const EventIcon: React.FC<IconProps & { eventType: string }> = ({ eventType, ...rest }) => {
    const Comp = getEventIcon(eventType);
    return <Comp {...rest} />;
};

// ── 用于替代 NPC 头像 emoji 的彩色首字母头像 ──────────

/**
 * NPCAvatar — 彩色首字母头像
 * 根据名字生成固定的渐变背景色 + 首字母，比 emoji 更精致
 */
export const NPCAvatar: React.FC<{
    name: string;
    emoji?: string;
    size?: number;
    className?: string;
    style?: React.CSSProperties;
}> = ({ name, size = 24, className = '', style }) => {
    // 根据名字生成稳定的 hue
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;

    const initial = name.charAt(0).toUpperCase();
    const bgFrom = `hsl(${hue}, 70%, 55%)`;
    const bgTo = `hsl(${(hue + 30) % 360}, 60%, 40%)`;

    return (
        <div
            className={`inline-flex items-center justify-center rounded-lg font-bold select-none ${className}`}
            style={{
                width: size,
                height: size,
                fontSize: size * 0.45,
                background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
                color: 'white',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                verticalAlign: 'middle',
                flexShrink: 0,
                ...style,
            }}
        >
            {initial}
        </div>
    );
};
