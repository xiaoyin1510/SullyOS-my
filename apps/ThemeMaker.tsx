


import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { ChatTheme, BubbleStyle } from '../types';
import { processImage } from '../utils/file';

const cloneTheme = (theme: ChatTheme): ChatTheme => {
    if (typeof structuredClone === 'function') {
        return structuredClone(theme);
    }
    return JSON.parse(JSON.stringify(theme));
};

const DEFAULT_STYLE: BubbleStyle = {
    textColor: '#334155',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    opacity: 1,
    backgroundImageOpacity: 0.5,
    decorationX: 90,
    decorationY: -10,
    decorationScale: 1,
    decorationRotate: 0,
    avatarDecorationX: 50,
    avatarDecorationY: 50,
    avatarDecorationScale: 1,
    avatarDecorationRotate: 0
};

const DEFAULT_THEME: ChatTheme = {
    id: '',
    name: 'New Theme',
    type: 'custom',
    user: { ...DEFAULT_STYLE, textColor: '#ffffff', backgroundColor: '#6366f1' },
    ai: { ...DEFAULT_STYLE },
    customCss: ''
};

// --- CSS Examples ---
const CSS_EXAMPLES = [
    {
        name: '毛玻璃 (Glass)',
        code: `/* Glassmorphism for bubbles */
.sully-bubble-user, .sully-bubble-ai {
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 4px 6px rgba(0,0,0,0.05);
}
.sully-bubble-user { background: rgba(99, 102, 241, 0.7) !important; }
.sully-bubble-ai { background: rgba(255, 255, 255, 0.7) !important; }`
    },
    {
        name: '霓虹 (Neon)',
        code: `/* Glowing Neon Borders */
.sully-bubble-user {
  border: 2px solid #a855f7;
  box-shadow: 0 0 10px #a855f7;
  background: #2e1065 !important;
  color: #fff !important;
}
.sully-bubble-ai {
  border: 2px solid #3b82f6;
  box-shadow: 0 0 10px #3b82f6;
  background: #172554 !important;
  color: #fff !important;
}`
    },
    {
        name: '像素 (Pixel)',
        code: `/* Pixel Art Style — Refined */
.sully-bubble-user, .sully-bubble-ai {
  border-radius: 0px !important;
  border: 3px solid #2d2d2d;
  box-shadow: 4px 4px 0px #2d2d2d, inset -2px -2px 0px rgba(0,0,0,0.12), inset 2px 2px 0px rgba(255,255,255,0.25);
  font-family: 'Courier New', monospace;
  image-rendering: pixelated;
  letter-spacing: 0.02em;
}
.sully-bubble-user {
  background: linear-gradient(135deg, #6366f1 0%, #818cf8 100%) !important;
  border-color: #4338ca;
  box-shadow: 4px 4px 0px #4338ca, inset -2px -2px 0px rgba(0,0,0,0.15), inset 2px 2px 0px rgba(255,255,255,0.2);
}
.sully-bubble-ai {
  background: linear-gradient(135deg, #f8f8f8 0%, #e8e8e8 100%) !important;
  border-color: #bbb;
  box-shadow: 4px 4px 0px #bbb, inset -2px -2px 0px rgba(0,0,0,0.06), inset 2px 2px 0px rgba(255,255,255,0.8);
}`
    }
];

// --- Helpers for Color & CSS ---

// Parse Hex/RGBA to { hex: "#RRGGBB", alpha: 0-1 }
const parseColorValue = (color: string) => {
    // Default
    let hex = '#ffffff';
    let alpha = 1;

    if (!color) return { hex, alpha };

    if (color.startsWith('#')) {
        hex = color.substring(0, 7);
        // Handle #RRGGBBAA? Assuming standard 6 char for now or simple
        return { hex, alpha: 1 };
    }

    if (color.startsWith('rgba')) {
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (match) {
            const r = parseInt(match[1]);
            const g = parseInt(match[2]);
            const b = parseInt(match[3]);
            const a = match[4] ? parseFloat(match[4]) : 1;
            const toHex = (n: number) => n.toString(16).padStart(2, '0');
            hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            alpha = a;
        }
    }
    return { hex, alpha };
};

const toRgbaString = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string): RGB => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
});

const mixColors = (fg: RGB, bg: RGB, alpha: number): RGB => {
    const a = clamp(alpha, 0, 1);
    return {
        r: Math.round(fg.r * a + bg.r * (1 - a)),
        g: Math.round(fg.g * a + bg.g * (1 - a)),
        b: Math.round(fg.b * a + bg.b * (1 - a))
    };
};

const relativeLuminance = ({ r, g, b }: RGB) => {
    const toLinear = (channel: number) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const getContrastRatio = (textHex: string, backgroundColor: string, previewBgHex: string) => {
    const parsedBg = parseColorValue(backgroundColor);
    const text = hexToRgb(parseColorValue(textHex).hex);
    const bubbleBg = hexToRgb(parsedBg.hex);
    const previewBg = hexToRgb(previewBgHex);
    const effectiveBg = mixColors(bubbleBg, previewBg, parsedBg.alpha);
    const l1 = relativeLuminance(text);
    const l2 = relativeLuminance(effectiveBg);
    const bright = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (bright + 0.05) / (dark + 0.05);
};

const getContrastGrade = (ratio: number) => {
    if (ratio >= 7) return 'A';
    if (ratio >= 4.5) return 'B';
    return 'C';
};

const getReadableTextColor = (backgroundColor: string, previewBgHex: string) => {
    const whiteContrast = getContrastRatio('#ffffff', backgroundColor, previewBgHex);
    const blackContrast = getContrastRatio('#000000', backgroundColor, previewBgHex);
    return whiteContrast >= blackContrast ? '#ffffff' : '#000000';
};

// Padding CSS Injection Helper
const PADDING_MARKER_START = '/* PADDING_AUTO_START */';
const PADDING_MARKER_END = '/* PADDING_AUTO_END */';

const injectPaddingCss = (css: string, verticalPadding: number) => {
    const horizontalPadding = Math.round(verticalPadding * 1.6); // Aspect ratio for bubble
    const rule = `
${PADDING_MARKER_START}
.sully-bubble-user, .sully-bubble-ai {
  padding: ${verticalPadding}px ${horizontalPadding}px !important;
}
${PADDING_MARKER_END}`;

    const regex = new RegExp(`${PADDING_MARKER_START.replace(/\*/g, '\\*')}[\\s\\S]*?${PADDING_MARKER_END.replace(/\*/g, '\\*')}`);
    
    if (css && css.match(regex)) {
        return css.replace(regex, rule);
    }
    return (css || '') + rule;
};

const extractPaddingFromCss = (css: string) => {
    const match = css?.match(/padding:\s*(\d+)px/);
    return match ? parseInt(match[1]) : 12; // Default 12px (py-3)
};

const SHADOW_MARKER_START = '/* SHADOW_AUTO_START */';
const SHADOW_MARKER_END = '/* SHADOW_AUTO_END */';

const injectShadowCss = (css: string, userShadow: string, aiShadow: string) => {
    const rule = `
${SHADOW_MARKER_START}
.sully-bubble-user { box-shadow: ${userShadow} !important; }
.sully-bubble-ai { box-shadow: ${aiShadow} !important; }
${SHADOW_MARKER_END}`;

    const regex = new RegExp(`${SHADOW_MARKER_START.replace(/\*/g, '\\*')}[\\s\\S]*?${SHADOW_MARKER_END.replace(/\*/g, '\\*')}`);
    if (css && css.match(regex)) {
        return css.replace(regex, rule);
    }
    return (css || '') + rule;
};

const hslToHex = (h: number, s: number, l: number) => {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = light - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    const toHex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

type StyleTemplate = {
    id: string;
    name: string;
    description: string;
    user: Partial<BubbleStyle>;
    ai: Partial<BubbleStyle>;
    userShadow: string;
    aiShadow: string;
};

type CssSnippet = {
    id: string;
    name: string;
    description: string;
    code: string;
};

type CssValidationResult = {
    isValid: boolean;
    errors: string[];
    errorLines: number[];
    importantCount: number;
};

const TARGET_SELECTOR_REGEX = /^\.sully-bubble-(user|ai)\b/;

const isValidHttpImageUrl = (value: string) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

const findLineNumberByIndex = (input: string, index: number) => input.slice(0, index).split('\n').length;

const extractLineFromErrorMessage = (message: string) => {
    const lineMatch = message.match(/line\s*(\d+)/i);
    return lineMatch ? parseInt(lineMatch[1], 10) : null;
};

const validateCustomCss = (css: string): CssValidationResult => {
    const source = css || '';
    const errors: string[] = [];
    const errorLines: number[] = [];
    const pushError = (message: string, line?: number | null) => {
        errors.push(message);
        if (line && !Number.isNaN(line)) {
            errorLines.push(line);
        }
    };

    const importantCount = (source.match(/!important/g) || []).length;
    if (!source.trim()) {
        return { isValid: true, errors: [], errorLines: [], importantCount };
    }

    // Minimal syntax check 1: browser parser
    try {
        if (typeof CSSStyleSheet !== 'undefined') {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(source);
        }
    } catch (error: any) {
        pushError(`CSS 语法错误：${error?.message || '请检查语法。'}`, extractLineFromErrorMessage(error?.message || ''));
    }

    // Minimal syntax check 2: brace balance
    const braceStack: number[] = [];
    [...source].forEach((char, index) => {
        if (char === '{') braceStack.push(index);
        if (char === '}') {
            if (braceStack.length === 0) {
                pushError('发现多余的 `}`，请检查大括号闭合。', findLineNumberByIndex(source, index));
            } else {
                braceStack.pop();
            }
        }
    });
    braceStack.forEach(index => pushError('存在未闭合的 `{`，请补全规则块。', findLineNumberByIndex(source, index)));

    // Scope check: only allow .sully-bubble-user / .sully-bubble-ai
    // Ignore comments first to avoid false positives like:
    // /* comment */ .sully-bubble-user { ... }
    const sourceWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectorRegex = /([^{}]+)\{/g;
    let selectorMatch = selectorRegex.exec(sourceWithoutComments);
    while (selectorMatch) {
        const selectorGroup = selectorMatch[1].trim();
        if (!selectorGroup.startsWith('@')) {
            const selectorList = selectorGroup.split(',').map(item => item.trim()).filter(Boolean);
            selectorList.forEach(selector => {
                if (!TARGET_SELECTOR_REGEX.test(selector)) {
                    pushError(
                        `选择器 \`${selector}\` 超出限定范围，仅允许以 .sully-bubble-user / .sully-bubble-ai 开头。`,
                        findLineNumberByIndex(sourceWithoutComments, selectorMatch.index)
                    );
                }
            });
        }
        selectorMatch = selectorRegex.exec(sourceWithoutComments);
    }

    return {
        isValid: errors.length === 0,
        errors,
        errorLines,
        importantCount
    };
};

const runCssRenderabilityCheck = (css: string, validation: CssValidationResult) => {
    if (!validation.isValid) {
        return {
            ok: false,
            message: `CSS 不可渲染：第 ${validation.errorLines[0] || '?'} 行附近存在错误，请先修复。`
        };
    }

    if (!css.trim()) {
        return { ok: true, message: '' };
    }

    try {
        const styleEl = document.createElement('style');
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
        const ruleCount = styleEl.sheet?.cssRules?.length ?? 0;
        styleEl.remove();
        if (ruleCount === 0) {
            return { ok: false, message: 'CSS 未生成有效规则，请确认语法和选择器。' };
        }
    } catch (error: any) {
        return { ok: false, message: `CSS 渲染检查失败：${error?.message || '未知错误。'}` };
    }

    return { ok: true, message: '' };
};

const CSS_SCOPE_SNIPPETS: CssSnippet[] = [
    {
        id: 'scope-shadow',
        name: '阴影',
        description: '给两侧气泡添加柔和投影',
        code: `.sully-bubble-user, .sully-bubble-ai {\n  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.14);\n}`
    },
    {
        id: 'scope-stroke',
        name: '描边',
        description: '统一边框轮廓',
        code: `.sully-bubble-user, .sully-bubble-ai {\n  border: 1px solid rgba(148, 163, 184, 0.45);\n}`
    },
    {
        id: 'scope-gradient',
        name: '渐变',
        description: '区分用户与角色气泡层次',
        code: `.sully-bubble-user {\n  background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;\n}\n.sully-bubble-ai {\n  background: linear-gradient(135deg, #ffffff, #e2e8f0) !important;\n}`
    },
    {
        id: 'scope-glass',
        name: '玻璃',
        description: '毛玻璃 + 高光边框',
        code: `.sully-bubble-user, .sully-bubble-ai {\n  backdrop-filter: blur(10px);\n  border: 1px solid rgba(255, 255, 255, 0.45);\n}\n.sully-bubble-user {\n  background: rgba(99, 102, 241, 0.62) !important;\n}\n.sully-bubble-ai {\n  background: rgba(255, 255, 255, 0.62) !important;\n}`
    }
];

const STYLE_TEMPLATES: StyleTemplate[] = [
    {
        id: 'cream',
        name: '奶油',
        description: '温暖低饱和，柔和阴影',
        user: { textColor: '#7c2d12', backgroundColor: 'rgba(254, 243, 199, 0.92)', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.45, decorationX: 88, decorationY: -12, avatarDecorationX: 52, avatarDecorationY: 50 },
        ai: { textColor: '#78350f', backgroundColor: 'rgba(255, 251, 235, 0.9)', borderRadius: 20, opacity: 1, backgroundImageOpacity: 0.4, decorationX: 12, decorationY: -10, avatarDecorationX: 48, avatarDecorationY: 50 },
        userShadow: '0 8px 24px rgba(217, 119, 6, 0.18)',
        aiShadow: '0 6px 20px rgba(180, 83, 9, 0.14)'
    },
    {
        id: 'glass',
        name: '玻璃',
        description: '半透明磨砂，轻薄边缘',
        user: { textColor: '#0f172a', backgroundColor: 'rgba(191, 219, 254, 0.78)', borderRadius: 18, opacity: 0.98, backgroundImageOpacity: 0.6, decorationX: 90, decorationY: -14, avatarDecorationX: 50, avatarDecorationY: 48 },
        ai: { textColor: '#0f172a', backgroundColor: 'rgba(255, 255, 255, 0.72)', borderRadius: 18, opacity: 0.98, backgroundImageOpacity: 0.55, decorationX: 10, decorationY: -14, avatarDecorationX: 50, avatarDecorationY: 48 },
        userShadow: '0 10px 28px rgba(30, 41, 59, 0.16)',
        aiShadow: '0 8px 22px rgba(30, 41, 59, 0.13)'
    },
    {
        id: 'neon',
        name: '霓虹',
        description: '高对比荧光，发光轮廓',
        user: { textColor: '#faf5ff', backgroundColor: 'rgba(88, 28, 135, 0.9)', borderRadius: 16, opacity: 1, backgroundImageOpacity: 0.32, decorationX: 94, decorationY: -8, avatarDecorationX: 50, avatarDecorationY: 46 },
        ai: { textColor: '#e0f2fe', backgroundColor: 'rgba(12, 74, 110, 0.9)', borderRadius: 16, opacity: 1, backgroundImageOpacity: 0.32, decorationX: 8, decorationY: -8, avatarDecorationX: 50, avatarDecorationY: 46 },
        userShadow: '0 0 18px rgba(217, 70, 239, 0.55)',
        aiShadow: '0 0 18px rgba(14, 165, 233, 0.55)'
    },
    {
        id: 'paper',
        name: '纸感',
        description: '微黄纸张，细节颗粒感',
        user: { textColor: '#3f3f46', backgroundColor: 'rgba(254, 249, 195, 0.93)', borderRadius: 14, opacity: 1, backgroundImageOpacity: 0.7, decorationX: 90, decorationY: -6, avatarDecorationX: 54, avatarDecorationY: 52 },
        ai: { textColor: '#44403c', backgroundColor: 'rgba(254, 252, 232, 0.93)', borderRadius: 14, opacity: 1, backgroundImageOpacity: 0.68, decorationX: 10, decorationY: -6, avatarDecorationX: 46, avatarDecorationY: 52 },
        userShadow: '2px 2px 0 rgba(120, 113, 108, 0.32)',
        aiShadow: '2px 2px 0 rgba(113, 113, 122, 0.26)'
    },
    {
        id: 'minimal',
        name: '极简',
        description: '低阴影，清爽留白',
        user: { textColor: '#0f172a', backgroundColor: 'rgba(226, 232, 240, 0.86)', borderRadius: 20, opacity: 0.97, backgroundImageOpacity: 0.25, decorationX: 92, decorationY: -10, avatarDecorationX: 50, avatarDecorationY: 50 },
        ai: { textColor: '#1e293b', backgroundColor: 'rgba(248, 250, 252, 0.85)', borderRadius: 20, opacity: 0.97, backgroundImageOpacity: 0.22, decorationX: 8, decorationY: -10, avatarDecorationX: 50, avatarDecorationY: 50 },
        userShadow: '0 2px 8px rgba(15, 23, 42, 0.08)',
        aiShadow: '0 2px 8px rgba(15, 23, 42, 0.06)'
    }
];

type PreviewMockMessage = {
    id: string;
    role: 'user' | 'ai';
    kind: 'text' | 'image' | 'emoji';
    content: string;
    replyTo?: {
        name: string;
        content: string;
    };
};

type PreviewScene = {
    id: string;
    name: string;
    wallpaper?: string;
    darkMode?: boolean;
    messages: PreviewMockMessage[];
};

const PREVIEW_SCENES: PreviewScene[] = [
    {
        id: 'daily',
        name: '日常聊天',
        messages: [
            { id: 'd1', role: 'ai', kind: 'text', content: '今天状态怎么样？要不要一起复盘一下计划。' },
            { id: 'd2', role: 'user', kind: 'text', content: '挺好！晚点一起把任务过一遍吧。' }
        ]
    },
    {
        id: 'long',
        name: '长文',
        messages: [
            {
                id: 'l1',
                role: 'ai',
                kind: 'text',
                content: '这是一个长文本示例，用于观察在大段内容、自动换行和段落阅读中的可读性表现。\n\n第二段会保持留白，你可以重点观察行距、背景图叠加透明度与文本对比是否舒适。'
            },
            {
                id: 'l2',
                role: 'user',
                kind: 'text',
                content: '收到，我会重点看边角、段落间距、亮暗背景下的可读性。'
            }
        ]
    },
    {
        id: 'reply',
        name: '回复链',
        messages: [
            { id: 'r1', role: 'ai', kind: 'text', content: '我把重点标出来了，看看这个版本。' },
            {
                id: 'r2',
                role: 'user',
                kind: 'text',
                content: '这里我想再调一下边框高亮效果。',
                replyTo: { name: 'AI', content: '我把重点标出来了，看看这个版本。' }
            }
        ]
    },
    {
        id: 'mix',
        name: '图片混排',
        messages: [
            { id: 'm1', role: 'ai', kind: 'image', content: '预览图' },
            { id: 'm2', role: 'user', kind: 'emoji', content: '😆' },
            { id: 'm3', role: 'ai', kind: 'text', content: '图片和文字、表情混排时也要保持层级清晰。' }
        ]
    },
    {
        id: 'dark-wallpaper',
        name: '深色壁纸',
        darkMode: true,
        wallpaper: 'linear-gradient(135deg,#020617 0%,#1e293b 35%,#0f172a 100%)',
        messages: [
            { id: 'dw1', role: 'ai', kind: 'text', content: '深色壁纸下建议确认浅色文字的对比度。' },
            { id: 'dw2', role: 'user', kind: 'text', content: 'OK，我再检查透明背景图和阴影是否干净。' }
        ]
    }
];

const ThemeMaker: React.FC = () => {
    const { closeApp, addCustomTheme, addToast } = useOS();
    const [initialThemeId] = useState(() => `theme-${Date.now()}`);
    const [editingTheme, setEditingTheme] = useState<ChatTheme>({ ...DEFAULT_THEME, id: initialThemeId });
    const [activeTab, setActiveTab] = useState<'user' | 'ai' | 'css'>('user');
    const [toolSection, setToolSection] = useState<'base' | 'sticker' | 'avatar'>('base'); 
    const [previewSceneId, setPreviewSceneId] = useState(PREVIEW_SCENES[0].id);
    const [showPreviewBgImage, setShowPreviewBgImage] = useState(true);
    const [isPreviewDark, setIsPreviewDark] = useState(false);
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [userFollowAi, setUserFollowAi] = useState(false);
    const [lastSavedTheme, setLastSavedTheme] = useState<ChatTheme>(() => cloneTheme({ ...DEFAULT_THEME, id: initialThemeId }));
    const [isDirty, setIsDirty] = useState(false);
    const [pendingDiscardAction, setPendingDiscardAction] = useState<(() => void) | null>(null);
    const [showLowContrastConfirm, setShowLowContrastConfirm] = useState(false);
    const [pendingSaveExit, setPendingSaveExit] = useState(false);
    const [isAppliedToPreview, setIsAppliedToPreview] = useState(false);
    const [undoStack, setUndoStack] = useState<ChatTheme[]>([]);
    const [redoStack, setRedoStack] = useState<ChatTheme[]>([]);
    const [previewCompareMode, setPreviewCompareMode] = useState<'single' | 'split' | 'toggle'>('single');
    const [previewToggleTarget, setPreviewToggleTarget] = useState<'A' | 'B'>('A');
    const [lastUsableCss, setLastUsableCss] = useState('');
    const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
    const [assetUrlDraft, setAssetUrlDraft] = useState<Record<'bg' | 'deco' | 'avatarDeco', string>>({ bg: '', deco: '', avatarDeco: '' });
    
    // Local state for sliders
    const [paddingVal, setPaddingVal] = useState(12);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const decorationInputRef = useRef<HTMLInputElement>(null);
    const avatarDecoInputRef = useRef<HTMLInputElement>(null);
    const cssTextareaRef = useRef<HTMLTextAreaElement>(null);

    const activeStyle = editingTheme[activeTab === 'css' ? 'user' : activeTab];
    const CONTRAST_LOW_THRESHOLD = 4.5;
    const CONTRAST_CRITICAL_THRESHOLD = 3;
    const HIGH_BG_IMAGE_OPACITY = 0.75;
    const cssValidation = useMemo(() => validateCustomCss(editingTheme.customCss || ''), [editingTheme.customCss]);

    useEffect(() => {
        if (cssValidation.isValid) {
            setLastUsableCss(editingTheme.customCss || '');
        }
    }, [cssValidation.isValid, editingTheme.customCss]);

    const updateTheme = (
        updater: (prev: ChatTheme) => ChatTheme,
        options?: { trackHistory?: boolean; markDirty?: boolean }
    ) => {
        const trackHistory = options?.trackHistory ?? true;
        const markDirty = options?.markDirty ?? true;
        setEditingTheme(prev => {
            const next = updater(prev);
            if (next === prev) return prev;
            if (trackHistory) {
                setUndoStack(history => [...history, cloneTheme(prev)]);
                setRedoStack([]);
            }
            if (markDirty) {
                setIsDirty(true);
                setIsAppliedToPreview(false);
            }
            return next;
        });
    };

    const withDiscardGuard = (action: () => void) => {
        if (!isDirty) { action(); return; }
        setPendingDiscardAction(() => action);
    };

    const requestTabSwitch = (target: 'user' | 'ai' | 'css') => {
        if (target === activeTab) return;
        setActiveTab(target);
    };

    const requestToolSectionSwitch = (target: 'base' | 'sticker' | 'avatar') => {
        if (target === toolSection) return;
        setToolSection(target);
    };

    const requestClose = () => withDiscardGuard(() => closeApp());

    // Initialize padding state from CSS on load
    useEffect(() => {
        if (editingTheme.customCss) {
            setPaddingVal(extractPaddingFromCss(editingTheme.customCss));
        }
    }, []);

    const updateStyle = (key: keyof BubbleStyle, value: any) => {
        if (activeTab === 'css') return;
        updateTheme(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab as 'user' | 'ai'],
                [key]: value
            },
            ...(userFollowAi && activeTab === 'ai'
                ? {
                    user: {
                        ...prev.user,
                        [key]: value
                    }
                }
                : {})
        }));
    };

    const updateColorWithAlpha = (newHex: string, newAlpha: number) => {
        const val = newAlpha === 1 ? newHex : toRgbaString(newHex, newAlpha);
        updateStyle('backgroundColor', val);
    };

    const updatePadding = (val: number) => {
        setPaddingVal(val);
        const newCss = injectPaddingCss(editingTheme.customCss || '', val);
        updateTheme(prev => ({ ...prev, customCss: newCss }));
    };

    const handleImageUpload = async (file: File, type: 'bg' | 'deco' | 'avatarDeco') => {
        try {
            const result = await processImage(file);
            if (type === 'bg') updateStyle('backgroundImage', result);
            else if (type === 'deco') updateStyle('decoration', result);
            else if (type === 'avatarDeco') updateStyle('avatarDecoration', result);
            addToast('图片上传成功', 'success');
        } catch (e: any) {
            addToast(e.message, 'error');
        }
    };

    const handleUrlApply = (type: 'bg' | 'deco' | 'avatarDeco') => {
        const url = assetUrlDraft[type].trim();
        if (!url) {
            addToast('请输入图床 URL', 'error');
            return;
        }
        if (!isValidHttpImageUrl(url)) {
            addToast('URL 无效，请填写 http(s) 图床地址', 'error');
            return;
        }

        if (type === 'bg') updateStyle('backgroundImage', url);
        else if (type === 'deco') updateStyle('decoration', url);
        else updateStyle('avatarDecoration', url);

        setAssetUrlDraft(prev => ({ ...prev, [type]: '' }));
        addToast('已应用图床图片', 'success');
    };

    const doSaveTheme = (exitAfterSave: boolean) => {
        addCustomTheme(editingTheme);
        setLastSavedTheme(cloneTheme(editingTheme));
        setIsDirty(false);
        setIsAppliedToPreview(true);
        addToast('已保存并应用到当前聊天预览', 'success');
        if (exitAfterSave) closeApp();
    };

    const saveTheme = ({ exitAfterSave }: { exitAfterSave: boolean }) => {
        if (!editingTheme.name.trim()) return;
        const renderability = runCssRenderabilityCheck(editingTheme.customCss || '', cssValidation);
        if (!renderability.ok) {
            addToast(renderability.message, 'error');
            return;
        }
        if (overallContrastScore.ratio < CONTRAST_CRITICAL_THRESHOLD) {
            setPendingSaveExit(exitAfterSave);
            setShowLowContrastConfirm(true);
            return;
        }
        doSaveTheme(exitAfterSave);
    };

    const insertCssSnippet = (snippet: CssSnippet) => {
        const textarea = cssTextareaRef.current;
        const currentCss = editingTheme.customCss || '';
        if (!textarea) {
            updateTheme(prev => ({ ...prev, customCss: `${currentCss}${currentCss.endsWith('\n') || !currentCss ? '' : '\n'}${snippet.code}\n` }));
            return;
        }

        const start = textarea.selectionStart ?? currentCss.length;
        const end = textarea.selectionEnd ?? currentCss.length;
        const insertContent = `${start === 0 ? '' : '\n'}${snippet.code}\n`;
        const nextCss = `${currentCss.slice(0, start)}${insertContent}${currentCss.slice(end)}`;
        updateTheme(prev => ({ ...prev, customCss: nextCss }));
        requestAnimationFrame(() => {
            const cursor = start + insertContent.length;
            textarea.focus();
            textarea.setSelectionRange(cursor, cursor);
        });
    };

    const restoreLastUsableCss = () => {
        if ((editingTheme.customCss || '') === lastUsableCss) {
            addToast('当前已是上次可用 CSS', 'success');
            return;
        }
        updateTheme(prev => ({ ...prev, customCss: lastUsableCss }));
        addToast('已恢复到上次可用 CSS', 'success');
    };

    const applyTemplate = (template: StyleTemplate) => {
        updateTheme(prev => ({
            ...prev,
            user: { ...prev.user, ...template.user },
            ai: { ...prev.ai, ...template.ai },
            customCss: injectShadowCss(prev.customCss || '', template.userShadow, template.aiShadow)
        }));
        addToast(`已应用 ${template.name} 模板`, 'success');
    };

    const randomizeMonochrome = () => {
        const baseHue = Math.floor(Math.random() * 360);
        const hueShift = Math.floor(Math.random() * 18) - 9;
        const aiHue = (baseHue + hueShift + 360) % 360;
        const userBg = hslToHex(baseHue, 68, 48);
        const aiBg = hslToHex(aiHue, 54, 84);
        const userAlpha = 0.88;
        const aiAlpha = 0.85;
        const userText = '#f8fafc';
        const aiText = '#0f172a';
        updateTheme(prev => ({
            ...prev,
            user: {
                ...prev.user,
                backgroundColor: toRgbaString(userBg, userAlpha),
                textColor: userText,
                borderRadius: 20,
                backgroundImageOpacity: 0.4
            },
            ai: {
                ...prev.ai,
                backgroundColor: toRgbaString(aiBg, aiAlpha),
                textColor: aiText,
                borderRadius: 16,
                backgroundImageOpacity: 0.35
            }
        }));
        addToast('已生成同色系配色', 'success');
    };

    const mirrorToOtherBubble = () => {
        if (activeTab === 'css') return;
        const sourceKey = activeTab;
        const targetKey = activeTab === 'user' ? 'ai' : 'user';
        updateTheme(prev => ({
            ...prev,
            [targetKey]: {
                ...prev[targetKey],
                ...prev[sourceKey]
            }
        }));
        addToast('已镜像当前气泡参数', 'success');
    };

    const currentScene = useMemo(
        () => PREVIEW_SCENES.find(scene => scene.id === previewSceneId) || PREVIEW_SCENES[0],
        [previewSceneId]
    );

    const previewBgHex = useMemo(() => {
        if (currentScene.darkMode || isPreviewDark) return '#0f172a';
        return '#f1f5f9';
    }, [currentScene.darkMode, isPreviewDark]);

    const contrastScores = useMemo(() => {
        const userRatio = getContrastRatio(editingTheme.user.textColor, editingTheme.user.backgroundColor, previewBgHex);
        const aiRatio = getContrastRatio(editingTheme.ai.textColor, editingTheme.ai.backgroundColor, previewBgHex);
        return {
            user: { ratio: userRatio, grade: getContrastGrade(userRatio) },
            ai: { ratio: aiRatio, grade: getContrastGrade(aiRatio) }
        };
    }, [editingTheme.user.textColor, editingTheme.user.backgroundColor, editingTheme.ai.textColor, editingTheme.ai.backgroundColor, previewBgHex]);

    const overallContrastScore = useMemo(() => {
        return contrastScores.user.ratio <= contrastScores.ai.ratio
            ? { ...contrastScores.user, role: 'user' as const }
            : { ...contrastScores.ai, role: 'ai' as const };
    }, [contrastScores]);

    const activeContrastScore = activeTab === 'ai' ? contrastScores.ai : contrastScores.user;
    const showLowContrastWarning = activeTab !== 'css' && activeContrastScore.ratio < CONTRAST_LOW_THRESHOLD;
    const showCombinedRisk = activeTab !== 'css'
        && (activeStyle.backgroundImageOpacity ?? 0) >= HIGH_BG_IMAGE_OPACITY
        && activeContrastScore.ratio < CONTRAST_LOW_THRESHOLD;

    const oneClickFixContrast = () => {
        if (activeTab === 'css') return;
        const betterTextColor = getReadableTextColor(activeStyle.backgroundColor, previewBgHex);
        updateTheme(prev => ({
            ...prev,
            [activeTab]: {
                ...prev[activeTab],
                textColor: betterTextColor,
                backgroundImageOpacity: Math.min(prev[activeTab].backgroundImageOpacity ?? 0.5, 0.55)
            }
        }));
        addToast('已自动优化文字对比度', 'success');
    };

    useEffect(() => {
        setIsPreviewDark(!!currentScene.darkMode);
    }, [currentScene.id]);

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const previous = undoStack[undoStack.length - 1];
        const nextUndo = undoStack.slice(0, -1);
        setUndoStack(nextUndo);
        setRedoStack(stack => [...stack, cloneTheme(editingTheme)]);
        setEditingTheme(cloneTheme(previous));
        setIsDirty(true);
        setIsAppliedToPreview(false);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        const nextRedo = redoStack.slice(0, -1);
        setRedoStack(nextRedo);
        setUndoStack(stack => [...stack, cloneTheme(editingTheme)]);
        setEditingTheme(cloneTheme(next));
        setIsDirty(true);
        setIsAppliedToPreview(false);
    };

    const renderPreviewBubble = (mock: PreviewMockMessage, theme: ChatTheme, panel: 'A' | 'B') => {
        const role = mock.role;
        const style = role === 'user' ? theme.user : theme.ai;
        const isUser = role === 'user';
        const isActive = panel === 'A' && (activeTab === role || activeTab === 'css');
        
        // Match core bubble corner strategy in MessageItem.tsx
        const containerStyle = {
            backgroundColor: style.backgroundColor,
            borderRadius: `${style.borderRadius}px`,
            opacity: style.opacity,
            borderBottomLeftRadius: isUser ? `${style.borderRadius}px` : '4px',
            borderBottomRightRadius: isUser ? '4px' : `${style.borderRadius}px`,
            borderTopLeftRadius: `${style.borderRadius}px`,
            borderTopRightRadius: `${style.borderRadius}px`,
        };

        return (
            <div 
                className={`relative w-full flex items-end transition-all duration-300 cursor-pointer opacity-100 scale-100 ${isUser ? 'justify-end' : 'justify-start'}`}
                onClick={() => panel === 'A' && requestTabSwitch(role)}
                title={panel === 'A' ? `点击编辑${isUser ? '用户' : '角色'}气泡` : '上次保存版本'}
            >
                {/* Avatar + decoration: align with MessageItem layering */}
                <div className={`absolute bottom-0 ${isUser ? 'right-0' : 'left-0'} w-9 h-9 z-10`}>
                    <div className="w-full h-full rounded-full bg-slate-300 overflow-hidden relative z-0 shadow-sm ring-1 ring-black/5">
                         <div className="absolute inset-0 flex items-center justify-center text-white/50 font-bold text-[10px]">{isUser ? 'ME' : 'AI'}</div>
                    </div>
                    {style.avatarDecoration && (
                        <img 
                            src={style.avatarDecoration}
                            className="absolute pointer-events-none z-10 max-w-none"
                            style={{
                                left: `${style.avatarDecorationX ?? 50}%`,
                                top: `${style.avatarDecorationY ?? 50}%`,
                                width: `${36 * (style.avatarDecorationScale ?? 1)}px`, 
                                height: 'auto',
                                transform: `translate(-50%, -50%) rotate(${style.avatarDecorationRotate ?? 0}deg)`,
                            }}
                        />
                    )}
                </div>

                <div className={`relative group max-w-[78%] ${isUser ? 'mr-12' : 'ml-12'}`}>
                    {style.decoration && (
                        <img 
                            src={style.decoration} 
                            className="absolute z-10 w-8 h-8 object-contain drop-shadow-sm pointer-events-none"
                            style={{
                                left: `${style.decorationX ?? (isUser ? 90 : 10)}%`,
                                top: `${style.decorationY ?? -10}%`,
                                transform: `translate(-50%, -50%) scale(${style.decorationScale ?? 1}) rotate(${style.decorationRotate ?? 0}deg)`
                            }}
                        />
                    )}

                    <div
                        className={`relative px-5 py-3 shadow-sm border border-black/5 text-sm overflow-visible ${isUser ? 'sully-bubble-user' : 'sully-bubble-ai'} ${isActive ? 'ring-2 ring-primary/70' : ''}`}
                        style={containerStyle}
                    >
                        {showPreviewBgImage && style.backgroundImage && (
                            <div 
                                className="absolute inset-0 bg-cover bg-center pointer-events-none z-0"
                                style={{ 
                                    backgroundImage: `url(${style.backgroundImage})`,
                                    opacity: style.backgroundImageOpacity ?? 0.5,
                                    borderRadius: 'inherit'
                                }}
                            ></div>
                        )}
                        {mock.replyTo && (
                            <div className="relative z-10 mb-1 text-[10px] bg-black/5 p-1.5 rounded-md border-l-2 border-current opacity-60 flex flex-col gap-0.5 max-w-full overflow-hidden">
                                <span className="font-bold opacity-90 truncate">{mock.replyTo.name}</span>
                                <span className="truncate italic">"{mock.replyTo.content}"</span>
                            </div>
                        )}

                        {mock.kind === 'image' ? (
                            <div className="relative z-10 w-40 h-28 rounded-xl bg-black/10 border border-black/10 flex items-center justify-center text-xs" style={{ color: style.textColor }}>
                                🖼️ 图片占位
                            </div>
                        ) : mock.kind === 'emoji' ? (
                            <div className="relative z-10 text-3xl leading-none">{mock.content}</div>
                        ) : (
                            <div className="relative z-10 text-[15px] leading-relaxed whitespace-pre-wrap break-all" style={{ color: style.textColor }}>
                                {mock.content}
                            </div>
                        )}

                        {isActive && (
                            <div className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full bg-primary text-white text-[9px] font-bold tracking-wider z-20">
                                正在编辑{isUser ? '用户' : '角色'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const parsedBgColor = parseColorValue(activeStyle.backgroundColor);

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col font-light relative">
            {/* Header */}
            <div className="h-20 bg-white/70 backdrop-blur-md flex items-end pb-3 px-4 border-b border-white/40 shrink-0 z-20 justify-between">
                <div className="flex items-center gap-2">
                    <button onClick={requestClose} className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <div className="flex flex-col">
                        <h1 className="text-xl font-medium text-slate-700">气泡工坊</h1>
                        <div className="text-[10px] flex items-center gap-1.5 text-slate-500">
                            <span className={`inline-flex w-2 h-2 rounded-full ${isAppliedToPreview && !isDirty ? 'bg-emerald-500' : 'bg-amber-400'}`}></span>
                            {isAppliedToPreview && !isDirty ? '已应用到当前聊天预览' : '预览未应用最新改动'}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => saveTheme({ exitAfterSave: false })} className="px-4 py-1.5 bg-primary text-white rounded-full text-xs font-bold shadow-lg shadow-primary/30 active:scale-95 transition-all">
                        保存并应用
                    </button>
                </div>
            </div>

            {/* Preview Area (Realistic Chat Row) */}
            <div className={`${isPreviewFullscreen ? 'fixed inset-0 z-[120]' : 'flex-1'} relative overflow-hidden flex flex-col p-4 justify-center items-center gap-4 ${isPreviewDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
                <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                {currentScene.wallpaper && (
                    <div className="absolute inset-0" style={{ background: currentScene.wallpaper, opacity: isPreviewDark ? 0.9 : 0.45 }} />
                )}
                
                {/* Live CSS Injection for Preview */}
                {editingTheme.customCss && <style>{editingTheme.customCss}</style>}

                <div className="w-full max-w-sm relative z-10 bg-white/70 dark:bg-black/20 backdrop-blur-sm rounded-2xl p-3 border border-white/30 shadow-sm">
                    <div className={`absolute right-3 top-3 px-2.5 py-1 rounded-full text-[11px] font-bold shadow-sm ${overallContrastScore.grade === 'A' ? 'bg-emerald-100 text-emerald-700' : overallContrastScore.grade === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>
                        可读性 {overallContrastScore.grade}
                    </div>
                    <div className="flex flex-wrap gap-2 mb-3">
                        {PREVIEW_SCENES.map(scene => (
                            <button
                                key={scene.id}
                                onClick={() => setPreviewSceneId(scene.id)}
                                className={`px-2.5 py-1 rounded-full text-[11px] transition-all ${previewSceneId === scene.id ? 'bg-primary text-white shadow' : 'bg-white/80 text-slate-500 hover:bg-white'}`}
                            >
                                {scene.name}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 mb-2">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={showPreviewBgImage} onChange={(e) => setShowPreviewBgImage(e.target.checked)} className="accent-primary" />
                            显示背景图层
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                            <input type="checkbox" checked={isPreviewDark} onChange={(e) => setIsPreviewDark(e.target.checked)} className="accent-primary" />
                            深色聊天背景
                        </label>
                    </div>

                    <div className="flex items-center justify-end">
                        <button
                            onClick={() => setIsPreviewFullscreen(prev => !prev)}
                            className="px-2.5 py-1 rounded-full text-[11px] bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                        >
                            {isPreviewFullscreen ? '退出全屏预览' : '全屏预览'}
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-slate-500">A/B 对比：</span>
                        <button onClick={() => setPreviewCompareMode('single')} className={`px-2 py-1 rounded-full ${previewCompareMode === 'single' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>单预览</button>
                        <button onClick={() => setPreviewCompareMode('split')} className={`px-2 py-1 rounded-full ${previewCompareMode === 'split' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>左右分屏</button>
                        <button onClick={() => setPreviewCompareMode('toggle')} className={`px-2 py-1 rounded-full ${previewCompareMode === 'toggle' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>一键切换</button>
                        {previewCompareMode === 'toggle' && (
                            <div className="flex items-center gap-1">
                                <button onClick={() => setPreviewToggleTarget('A')} className={`px-2 py-1 rounded ${previewToggleTarget === 'A' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>A 当前编辑</button>
                                <button onClick={() => setPreviewToggleTarget('B')} className={`px-2 py-1 rounded ${previewToggleTarget === 'B' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>B 上次保存</button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Simulated Chat Conversation */}
                {previewCompareMode === 'split' ? (
                    <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-3 relative z-10">
                        {[{ label: 'A 当前编辑', theme: editingTheme, panel: 'A' as const }, { label: 'B 上次保存', theme: lastSavedTheme, panel: 'B' as const }].map(item => (
                            <div key={item.label} className={`space-y-4 p-4 rounded-2xl ${isPreviewDark ? 'bg-slate-950/60 border border-white/10' : 'bg-white/70 border border-white/60'}`}>
                                <div className="text-[10px] text-slate-500">{item.label}</div>
                                {currentScene.messages.map(msg => (
                                    <div key={`${item.panel}-${msg.id}`}>{renderPreviewBubble(msg, item.theme, item.panel)}</div>
                                ))}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className={`w-full max-w-sm space-y-4 p-4 rounded-2xl relative z-10 ${isPreviewDark ? 'bg-slate-950/60 border border-white/10' : 'bg-white/70 border border-white/60'}`}>
                        {currentScene.messages.map(msg => (
                            <div key={msg.id}>{renderPreviewBubble(msg, previewCompareMode === 'toggle' && previewToggleTarget === 'B' ? lastSavedTheme : editingTheme, previewCompareMode === 'toggle' && previewToggleTarget === 'B' ? 'B' : 'A')}</div>
                        ))}
                    </div>
                )}
                
                <div className={`text-[10px] absolute bottom-2 ${isPreviewDark ? 'text-slate-400' : 'text-slate-500'}`}>A 为当前编辑，B 为上次保存版本</div>
            </div>

            {/* Editor Controls */}
            {!isPreviewFullscreen && (
            <div className="bg-white rounded-t-[2.5rem] shadow-[0_-5px_30px_rgba(0,0,0,0.08)] z-30 flex flex-col h-[55%] ring-1 ring-slate-100">
                {/* Main Tabs (User / AI / CSS) */}
                <div className="flex px-8 pt-6 pb-2 gap-6 overflow-x-auto no-scrollbar">
                    <button onClick={() => requestTabSwitch('user')} className={`text-sm font-bold transition-colors whitespace-nowrap ${activeTab === 'user' ? 'text-slate-800' : 'text-slate-300'}`}>用户气泡</button>
                    <button onClick={() => requestTabSwitch('ai')} className={`text-sm font-bold transition-colors whitespace-nowrap ${activeTab === 'ai' ? 'text-slate-800' : 'text-slate-300'}`}>角色气泡</button>
                    <button onClick={() => requestTabSwitch('css')} className={`text-sm font-bold transition-colors whitespace-nowrap flex items-center gap-1 ${activeTab === 'css' ? 'text-indigo-600' : 'text-slate-300'}`}>
                        <span>⚡</span> 自定义CSS
                    </button>
                </div>

                <div className="px-8 pb-2 flex items-center gap-2">
                    <button onClick={handleUndo} disabled={undoStack.length === 0} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 disabled:opacity-40">撤销</button>
                    <button onClick={handleRedo} disabled={redoStack.length === 0} className="text-[11px] px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 disabled:opacity-40">重做</button>
                </div>

                {/* Conditional Sub-Tool Tabs */}
                {activeTab !== 'css' && (
                    <div className="flex px-6 border-b border-slate-100 mb-2 overflow-x-auto no-scrollbar">
                        <button onClick={() => requestToolSectionSwitch('base')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 ${toolSection === 'base' ? 'border-primary text-primary' : 'border-transparent text-slate-400'}`}>基础样式</button>
                        <button onClick={() => requestToolSectionSwitch('sticker')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 ${toolSection === 'sticker' ? 'border-primary text-primary' : 'border-transparent text-slate-400'}`}>气泡贴纸</button>
                        <button onClick={() => requestToolSectionSwitch('avatar')} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all shrink-0 ${toolSection === 'avatar' ? 'border-primary text-primary' : 'border-transparent text-slate-400'}`}>头像挂件</button>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar pb-20">
                    
                    {/* --- CSS EDITOR --- */}
                    {activeTab === 'css' && (
                        <div className="space-y-6 animate-fade-in h-full flex flex-col">
                            <div className="text-[10px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-100 leading-relaxed space-y-2">
                                <span className="font-bold block mb-1 text-slate-500">CSS 增强模式</span>
                                可使用CSS类名 <code className="bg-slate-200 px-1 rounded">.sully-bubble-user</code> 和 <code className="bg-slate-200 px-1 rounded">.sully-bubble-ai</code> 来统一定制气泡样式。
                                <br/>支持使用 <code className="text-red-400">!important</code> 覆盖可视化编辑器的设置。
                                <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-2 text-[10px] text-indigo-700">
                                    <div className="font-semibold">优先级说明：可视化参数 vs CSS 覆盖</div>
                                    <div>1) 可视化滑杆/颜色面板先生成基础样式；2) 自定义 CSS 后应用；3) <code>!important</code> 仅对命中的属性强制生效，会压过同属性的可视化参数。</div>
                                </div>
                                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                                    <div>
                                        <div className={`text-[10px] font-semibold ${cssValidation.isValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {cssValidation.isValid ? '语法检查通过' : '语法检查未通过'}
                                        </div>
                                        <div className="text-[10px] text-slate-500">检测到 <code className="text-red-500">!important</code> {cssValidation.importantCount} 处</div>
                                    </div>
                                    <button
                                        onClick={restoreLastUsableCss}
                                        disabled={(editingTheme.customCss || '') === lastUsableCss}
                                        className="text-[10px] px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 disabled:opacity-50"
                                    >
                                        重置为上次可用 CSS
                                    </button>
                                </div>
                            </div>

                            <textarea 
                                ref={cssTextareaRef}
                                value={editingTheme.customCss || ''} 
                                onChange={(e) => updateTheme(prev => ({ ...prev, customCss: e.target.value }))}
                                placeholder="/* 在这里输入 CSS 代码 */"
                                className="flex-1 w-full bg-slate-800 text-slate-300 font-mono text-xs p-4 rounded-xl resize-none shadow-inner focus:ring-2 focus:ring-indigo-500 outline-none leading-relaxed"
                                spellCheck={false}
                            />

                            {!cssValidation.isValid && (
                                <div className="text-[11px] rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                                    <div className="font-semibold mb-1">CSS 错误提示（实时）</div>
                                    <ul className="space-y-1 list-disc pl-4">
                                        {cssValidation.errors.map((error, idx) => (
                                            <li key={`${error}-${idx}`}>
                                                {cssValidation.errorLines[idx] ? `第 ${cssValidation.errorLines[idx]} 行：` : ''}{error}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">限定作用域插入器（仅 .sully-bubble-user/.sully-bubble-ai）</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {CSS_SCOPE_SNIPPETS.map(snippet => (
                                        <button
                                            key={snippet.id}
                                            onClick={() => insertCssSnippet(snippet)}
                                            className="text-left p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:border-indigo-300 hover:bg-indigo-50 transition-all"
                                        >
                                            <div className="text-xs font-semibold text-slate-700">{snippet.name}</div>
                                            <div className="text-[10px] text-slate-500 mt-1">{snippet.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">快速模板 (Templates)</label>
                                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                                    {CSS_EXAMPLES.map((ex, i) => (
                                        <button 
                                            key={i}
                                            onClick={() => updateTheme(prev => ({ ...prev, customCss: ex.code }))}
                                            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-mono text-slate-600 border border-slate-200 whitespace-nowrap transition-colors"
                                        >
                                            {ex.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- BASE STYLE TOOLS --- */}
                    {activeTab !== 'css' && toolSection === 'base' && (
                        <div className="space-y-6 animate-fade-in"> 
                            {/* Name Input (Only on Base) */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">主题名称 (Theme Name)</label>
                                <input value={editingTheme.name} onChange={(e) => updateTheme(prev => ({ ...prev, name: e.target.value }), { trackHistory: false })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-primary/50 transition-all outline-none" placeholder="我的个性主题" />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">风格模板卡片</label>
                                    <button onClick={randomizeMonochrome} className="text-[10px] px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100">随机生成（同色系）</button>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {STYLE_TEMPLATES.map(template => (
                                        <button
                                            key={template.id}
                                            onClick={() => applyTemplate(template)}
                                            className="text-left p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:border-primary/30 hover:bg-primary/5 transition-all"
                                        >
                                            <div className="text-xs font-semibold text-slate-700">{template.name}</div>
                                            <div className="text-[10px] text-slate-500 mt-1">{template.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">快速联动</div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <label className="text-xs text-slate-600 flex items-center gap-2">
                                        <input type="checkbox" checked={userFollowAi} onChange={(e) => setUserFollowAi(e.target.checked)} className="accent-primary" />
                                        用户气泡跟随角色气泡
                                    </label>
                                    <button onClick={mirrorToOtherBubble} className="text-[10px] px-2.5 py-1 rounded-full bg-white border border-slate-200 hover:border-primary/30">镜像参数到另一个气泡</button>
                                </div>
                            </div>

                            {activeTab !== 'css' && (
                                <div className={`rounded-xl border p-3 ${showLowContrastWarning ? 'border-amber-200 bg-amber-50/80' : 'border-emerald-200 bg-emerald-50/70'}`}>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div className="text-[11px] font-semibold text-slate-700">实时可读性评分：{activeContrastScore.grade}（{activeContrastScore.ratio.toFixed(2)}:1）</div>
                                            <div className={`text-[10px] mt-1 ${showLowContrastWarning ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                {showLowContrastWarning ? '文字可读性偏低，建议提升文字与背景对比。' : '当前文字与背景对比良好。'}
                                            </div>
                                        </div>
                                        {showLowContrastWarning && (
                                            <button onClick={oneClickFixContrast} className="text-[10px] px-2.5 py-1 rounded-full bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors">
                                                一键修复
                                            </button>
                                        )}
                                    </div>
                                    {showCombinedRisk && (
                                        <div className="mt-2 text-[10px] text-rose-600 font-medium">
                                            组合风险：背景图透明层较强 + 对比度不足，可能在复杂壁纸上难以阅读。
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Colors & Opacity */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">文字颜色</label><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">推荐：自动对比</span></div>
                                    <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100"><input type="color" value={activeStyle.textColor} onChange={(e) => updateStyle('textColor', e.target.value)} className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent" /></div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">气泡颜色 (Base)</label><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">推荐：同色系</span></div>
                                    <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                                        <input 
                                            type="color" 
                                            value={parsedBgColor.hex} 
                                            onChange={(e) => updateColorWithAlpha(e.target.value, parsedBgColor.alpha)} 
                                            className="w-8 h-8 rounded-lg border-none cursor-pointer bg-transparent" 
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Background Alpha (Transparency) */}
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">背景透明度 (Background Alpha)</label>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">推荐：85%</span>
                                </div>
                                <input 
                                    type="range" min="0" max="1" step="0.05" 
                                    value={parsedBgColor.alpha} 
                                    onChange={(e) => updateColorWithAlpha(parsedBgColor.hex, parseFloat(e.target.value))} 
                                    className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" 
                                />
                            </div>

                            {/* Padding (Compactness) */}
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">气泡大小/紧凑度 (Size/Padding)</label>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">推荐：12</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-slate-400">紧凑</span>
                                    <input 
                                        type="range" min="4" max="24" step="1" 
                                        value={paddingVal} 
                                        onChange={(e) => updatePadding(parseInt(e.target.value))} 
                                        className="flex-1 h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" 
                                    />
                                    <span className="text-[10px] text-slate-400">宽敞</span>
                                </div>
                            </div>

                            {/* Border Radius */}
                            <div>
                                <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase">圆角大小</label><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">推荐：16 / 20</span></div>
                                <input type="range" min="0" max="30" value={activeStyle.borderRadius} onChange={(e) => updateStyle('borderRadius', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                            </div>

                            {/* Background Image Logic */}
                            <div onClick={() => fileInputRef.current?.click()} className="cursor-pointer group relative h-24 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 overflow-hidden hover:border-primary/50 hover:text-primary transition-all">
                                {activeStyle.backgroundImage ? (
                                    <>
                                        <img src={activeStyle.backgroundImage} className="absolute inset-0 w-full h-full object-cover opacity-50" />
                                        <span className="relative z-10 text-[10px] bg-white/80 px-2 py-1 rounded shadow-sm font-bold">更换底纹</span>
                                    </>
                                ) : <span className="text-xs font-bold">+ 上传底纹图片 (Texture)</span>}
                                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'bg')} />
                                {activeStyle.backgroundImage && <button onClick={(e) => { e.stopPropagation(); updateStyle('backgroundImage', undefined); }} className="absolute top-2 right-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full z-20">移除</button>}
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={assetUrlDraft.bg}
                                    onChange={(e) => setAssetUrlDraft(prev => ({ ...prev, bg: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    placeholder="或粘贴图床 URL"
                                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                />
                                <button onClick={() => handleUrlApply('bg')} className="px-3 py-2 rounded-lg bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200">应用</button>
                            </div>

                            {/* Background Image Opacity */}
                            {activeStyle.backgroundImage && (
                                <div>
                                    <div className="flex justify-between mb-2"><label className="text-[10px] font-bold text-slate-400 uppercase">底纹透明度</label><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600">推荐：35%~55%</span></div>
                                    <input type="range" min="0" max="1" step="0.05" value={activeStyle.backgroundImageOpacity ?? 0.5} onChange={(e) => updateStyle('backgroundImageOpacity', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full appearance-none cursor-pointer accent-primary" />
                                </div>
                            )}
                            {/* Voice Bar Style */}
                            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" /><path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" /></svg>
                                    语音条样式
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] text-slate-400 block mb-1">背景色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarBg || '#f1f5f9'} onChange={(e) => updateStyle('voiceBarBg', e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
                                            <span className="text-[10px] text-slate-400 font-mono">{activeStyle.voiceBarBg || '默认'}</span>
                                            {activeStyle.voiceBarBg && <button onClick={() => updateStyle('voiceBarBg', undefined)} className="text-[9px] text-red-400">重置</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-400 block mb-1">播放时背景</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarActiveBg || '#d1fae5'} onChange={(e) => updateStyle('voiceBarActiveBg', e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
                                            <span className="text-[10px] text-slate-400 font-mono">{activeStyle.voiceBarActiveBg || '默认'}</span>
                                            {activeStyle.voiceBarActiveBg && <button onClick={() => updateStyle('voiceBarActiveBg', undefined)} className="text-[9px] text-red-400">重置</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-400 block mb-1">按钮颜色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarBtnColor || '#10b981'} onChange={(e) => updateStyle('voiceBarBtnColor', e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
                                            <span className="text-[10px] text-slate-400 font-mono">{activeStyle.voiceBarBtnColor || '默认'}</span>
                                            {activeStyle.voiceBarBtnColor && <button onClick={() => updateStyle('voiceBarBtnColor', undefined)} className="text-[9px] text-red-400">重置</button>}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-slate-400 block mb-1">波形颜色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarWaveColor || '#10b981'} onChange={(e) => updateStyle('voiceBarWaveColor', e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
                                            <span className="text-[10px] text-slate-400 font-mono">{activeStyle.voiceBarWaveColor || '默认'}</span>
                                            {activeStyle.voiceBarWaveColor && <button onClick={() => updateStyle('voiceBarWaveColor', undefined)} className="text-[9px] text-red-400">重置</button>}
                                        </div>
                                    </div>
                                    <div className="col-span-2">
                                        <label className="text-[10px] text-slate-400 block mb-1">文字颜色</label>
                                        <div className="flex items-center gap-2">
                                            <input type="color" value={activeStyle.voiceBarTextColor || '#475569'} onChange={(e) => updateStyle('voiceBarTextColor', e.target.value)} className="w-7 h-7 rounded-lg border-0 cursor-pointer" />
                                            <span className="text-[10px] text-slate-400 font-mono">{activeStyle.voiceBarTextColor || '默认'}</span>
                                            {activeStyle.voiceBarTextColor && <button onClick={() => updateStyle('voiceBarTextColor', undefined)} className="text-[9px] text-red-400">重置</button>}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- STICKER TOOLS --- */}
                    {activeTab !== 'css' && toolSection === 'sticker' && (
                        <div className="space-y-6 animate-fade-in">
                            <div onClick={() => decorationInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-primary/50 hover:text-primary transition-all">
                                 {activeStyle.decoration ? <img src={activeStyle.decoration} className="h-10 w-10 object-contain" /> : <span className="text-xs font-bold">+ 上传气泡角标/贴纸</span>}
                                 <input type="file" ref={decorationInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'deco')} />
                                 {activeStyle.decoration && <button onClick={(e) => { e.stopPropagation(); updateStyle('decoration', undefined); }} className="absolute top-2 right-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full">移除</button>}
                            </div>
                            <div className="flex gap-2 -mt-4">
                                <input
                                    type="url"
                                    value={assetUrlDraft.deco}
                                    onChange={(e) => setAssetUrlDraft(prev => ({ ...prev, deco: e.target.value }))}
                                    placeholder="或粘贴贴纸图床 URL"
                                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                />
                                <button onClick={() => handleUrlApply('deco')} className="px-3 py-2 rounded-lg bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200">应用</button>
                            </div>

                            {activeStyle.decoration && (
                                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3" open={showAdvancedSettings}>
                                    <summary onClick={(e) => { e.preventDefault(); setShowAdvancedSettings(prev => !prev); }} className="text-xs font-semibold text-slate-600 cursor-pointer">高级设置 · 贴纸坐标与旋转</summary>
                                    {showAdvancedSettings && (
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-4">
                                            <div className="col-span-2"><label className="text-[10px] text-slate-400 uppercase block mb-2">位置坐标 (X / Y)</label>
                                                <div className="flex gap-3">
                                                    <input type="range" min="-50" max="150" value={activeStyle.decorationX ?? 90} onChange={(e) => updateStyle('decorationX', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                                    <input type="range" min="-50" max="150" value={activeStyle.decorationY ?? -10} onChange={(e) => updateStyle('decorationY', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                                </div>
                                            </div>
                                            <div><label className="text-[10px] text-slate-400 uppercase block mb-2">缩放 ({activeStyle.decorationScale ?? 1}x)</label>
                                                <input type="range" min="0.2" max="3" step="0.1" value={activeStyle.decorationScale ?? 1} onChange={(e) => updateStyle('decorationScale', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                            </div>
                                            <div><label className="text-[10px] text-slate-400 uppercase block mb-2">旋转 ({activeStyle.decorationRotate ?? 0}°)</label>
                                                <input type="range" min="-180" max="180" value={activeStyle.decorationRotate ?? 0} onChange={(e) => updateStyle('decorationRotate', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                            </div>
                                        </div>
                                    )}
                                </details>
                            )}
                        </div>
                    )}

                    {/* --- AVATAR TOOLS --- */}
                    {activeTab !== 'css' && toolSection === 'avatar' && (
                        <div className="space-y-6 animate-fade-in">
                            <div onClick={() => avatarDecoInputRef.current?.click()} className="cursor-pointer group relative h-20 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-primary/50 hover:text-primary transition-all">
                                 {activeStyle.avatarDecoration ? <img src={activeStyle.avatarDecoration} className="h-10 w-10 object-contain" /> : <span className="text-xs font-bold">+ 上传头像框/挂件</span>}
                                 <input type="file" ref={avatarDecoInputRef} className="hidden" accept="image/*" onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0], 'avatarDeco')} />
                                 {activeStyle.avatarDecoration && <button onClick={(e) => { e.stopPropagation(); updateStyle('avatarDecoration', undefined); }} className="absolute top-2 right-2 text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded-full">移除</button>}
                            </div>
                            <div className="flex gap-2 -mt-4">
                                <input
                                    type="url"
                                    value={assetUrlDraft.avatarDeco}
                                    onChange={(e) => setAssetUrlDraft(prev => ({ ...prev, avatarDeco: e.target.value }))}
                                    placeholder="或粘贴挂件图床 URL"
                                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                />
                                <button onClick={() => handleUrlApply('avatarDeco')} className="px-3 py-2 rounded-lg bg-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-200">应用</button>
                            </div>

                            {activeStyle.avatarDecoration && (
                                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3" open={showAdvancedSettings}>
                                    <summary onClick={(e) => { e.preventDefault(); setShowAdvancedSettings(prev => !prev); }} className="text-xs font-semibold text-slate-600 cursor-pointer">高级设置 · 挂件偏移与旋转</summary>
                                    {showAdvancedSettings && (
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-6 pt-4">
                                            <div className="col-span-2"><label className="text-[10px] text-slate-400 uppercase block mb-2">中心偏移 (Offset X / Y)</label>
                                                <div className="flex gap-3">
                                                    <input type="range" min="-50" max="150" value={activeStyle.avatarDecorationX ?? 50} onChange={(e) => updateStyle('avatarDecorationX', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                                    <input type="range" min="-50" max="150" value={activeStyle.avatarDecorationY ?? 50} onChange={(e) => updateStyle('avatarDecorationY', parseInt(e.target.value))} className="flex-1 h-1.5 bg-slate-200 rounded-full accent-primary" />
                                                </div>
                                            </div>
                                            <div><label className="text-[10px] text-slate-400 uppercase block mb-2">缩放 ({activeStyle.avatarDecorationScale ?? 1}x)</label>
                                                <input type="range" min="0.5" max="3" step="0.1" value={activeStyle.avatarDecorationScale ?? 1} onChange={(e) => updateStyle('avatarDecorationScale', parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                            </div>
                                            <div><label className="text-[10px] text-slate-400 uppercase block mb-2">旋转 ({activeStyle.avatarDecorationRotate ?? 0}°)</label>
                                                <input type="range" min="-180" max="180" value={activeStyle.avatarDecorationRotate ?? 0} onChange={(e) => updateStyle('avatarDecorationRotate', parseInt(e.target.value))} className="w-full h-1.5 bg-slate-200 rounded-full accent-primary" />
                                            </div>
                                        </div>
                                    )}
                                </details>
                            )}
                        </div>
                    )}

                </div>
            </div>
            )}

            {/* Discard unsaved changes confirm */}
            {pendingDiscardAction && (
                <div className="absolute inset-0 z-[999] bg-black/40 backdrop-blur-sm flex items-center justify-center px-6">
                    <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl">
                        <div className="text-base font-bold text-slate-700">有未保存的改动</div>
                        <p className="mt-2 text-sm text-slate-500">继续操作将丢失当前未保存的改动。</p>
                        <div className="mt-5 flex gap-3">
                            <button onClick={() => setPendingDiscardAction(null)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 font-bold">取消</button>
                            <button onClick={() => { const action = pendingDiscardAction; setPendingDiscardAction(null); action(); }} className="flex-1 py-2.5 rounded-2xl bg-red-500 text-white font-bold">放弃改动</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Low contrast confirm */}
            {showLowContrastConfirm && (
                <div className="absolute inset-0 z-[999] bg-black/40 backdrop-blur-sm flex items-center justify-center px-6">
                    <div className="w-full max-w-sm bg-white rounded-3xl p-5 shadow-2xl">
                        <div className="text-base font-bold text-slate-700">可读性评分极低</div>
                        <p className="mt-2 text-sm text-slate-500">当前文字与背景的对比度过低，可能导致聊天内容难以辨认。仍要保存此样式吗？</p>
                        <div className="mt-5 flex gap-3">
                            <button onClick={() => setShowLowContrastConfirm(false)} className="flex-1 py-2.5 rounded-2xl bg-slate-100 text-slate-600 font-bold">再调整一下</button>
                            <button onClick={() => { setShowLowContrastConfirm(false); doSaveTheme(pendingSaveExit); }} className="flex-1 py-2.5 rounded-2xl bg-amber-500 text-white font-bold">仍然保存</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ThemeMaker;
