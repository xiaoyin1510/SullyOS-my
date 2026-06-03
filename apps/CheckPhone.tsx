import React, { useState, useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { CharacterProfile, PhoneEvidence, PhoneCustomApp } from '../types';
import { ContextBuilder } from '../utils/context';
import Modal from '../components/os/Modal';
import { safeResponseJson } from '../utils/safeApi';
import { injectMemoryPalace } from '../utils/memoryPalace/pipeline';
import { User, Phone, ChatCircleDots, ShoppingBag, Hamburger, CircleNotch, Wrench, Compass, GearSix, Tray, Plus, SignOut } from '@phosphor-icons/react';

const TwemojiImg: React.FC<{ code: string; alt?: string; className?: string }> = ({ code, alt, className = 'w-4 h-4 inline-block' }) => (
  <img src={`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`} alt={alt || ''} className={className} draggable={false} />
);


const sanitizePhoneAppHtml = (raw: string): string => {
    const source = String(raw || '').trim();
    if (!source) return '';
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
        return source
            .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
            .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
            .replace(/javascript\s*:/gi, '');
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
    const blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select']);
    doc.body.querySelectorAll('*').forEach((el) => {
        if (blockedTags.has(el.tagName.toLowerCase())) { el.remove(); return; }
        Array.from(el.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value || '';
            if (name.startsWith('on') || name === 'srcdoc') { el.removeAttribute(attr.name); return; }
            if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(value)) { el.removeAttribute(attr.name); return; }
            if (name === 'style' && /(expression\s*\(|javascript\s*:|url\s*\(\s*['"]?javascript:)/i.test(value)) el.removeAttribute(attr.name);
        });
    });
    return doc.body.innerHTML;
};

const sanitizePhoneAppCss = (raw: string): string => String(raw || '').slice(0, 8000)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]+;/gi, '')
    .replace(/@font-face\s*{[\s\S]*?}/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/url\s*\([^)]*\)/gi, '')
    .replace(/behavior\s*:/gi, '')
    .replace(/-moz-binding\s*:/gi, '')
    .trim();

const scopePhoneAppCss = (raw: string, scopeClass: string): string => {
    const safe = sanitizePhoneAppCss(raw);
    if (!safe) return '';
    return safe.split('}').map((rule) => {
        const idx = rule.indexOf('{');
        if (idx < 0) return '';
        const selector = rule.slice(0, idx).trim();
        const body = rule.slice(idx + 1).trim();
        if (!selector || !body || selector.startsWith('@')) return '';
        const scopedSelector = selector.split(',').map((part) => {
            const item = part.trim();
            if (!item) return '';
            if (item.includes(scopeClass)) return item;
            return `${scopeClass} ${item}`;
        }).filter(Boolean).join(', ');
        return scopedSelector ? `${scopedSelector} { ${body} }` : '';
    }).filter(Boolean).join('\n');
};

const escapePhoneTemplateHtml = (value: unknown): string => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br/>');

const isPhoneHtmlTemplate = (value: string): boolean => {
    const text = String(value || '').trim();
    if (!text) return false;
    return /<\s*(div|section|article|p|span|ul|li|h[1-6]|img)\b/i.test(text) || /{{\s*[\w\u4e00-\u9fa5.-]+\s*}}/.test(text);
};

const extractPhoneTemplateKeys = (template: string): string[] => {
    const keys = new Set<string>();
    String(template || '').replace(/{{\s*([\w\u4e00-\u9fa5.-]+)\s*}}/g, (_full, key) => { if (String(key || '').trim()) keys.add(String(key).trim()); return ''; });
    return Array.from(keys).slice(0, 40);
};

const getNestedPhoneTemplateValue = (source: any, key: string): unknown => {
    const parts = String(key || '').split('.').filter(Boolean);
    let cur = source;
    for (const part of parts) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[part]; }
    return cur;
};

const fillPhoneHtmlTemplate = (template: string, data: any, fallback: { title: string; detail: string; value?: string }): string => {
    const source = { ...(data || {}), title: fallback.title, detail: fallback.detail, value: fallback.value || '' };
    const filled = String(template || '').replace(/{{\s*([\w\u4e00-\u9fa5.-]+)\s*}}/g, (_full, key) => escapePhoneTemplateHtml(getNestedPhoneTemplateValue(source, String(key).trim()) ?? ''));
    return sanitizePhoneAppHtml(filled);
};


const stripPhoneAppHtmlToText = (raw: string): string => {
    const source = String(raw || '').trim();
    if (!source) return '';
    if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${sanitizePhoneAppHtml(source)}</div>`, 'text/html');
        return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return source
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
};

const limitPhoneContextText = (raw: string, max = 2200): string => {
    const text = String(raw || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
};

const buildPhoneRecordContextText = (item: any, title: string, detail: string, html?: string): string => {
    const direct = String(item?.contextText || item?.context || item?.plainText || '').trim();
    if (direct) return limitPhoneContextText(direct);
    const lines: string[] = [];
    if (title) lines.push(`标题：${title}`);
    if (item?.value) lines.push(`状态/数值：${String(item.value)}`);
    if (detail) lines.push(`详情：${String(detail)}`);
    if (item?.templateData && typeof item.templateData === 'object') {
        const dataLines = Object.entries(item.templateData)
            .slice(0, 40)
            .map(([key, value]) => `${key}：${String(value ?? '')}`)
            .filter(line => line.replace(/^[^：]+：/, '').trim());
        if (dataLines.length) lines.push(`模板内容：\n${dataLines.join('\n')}`);
    }
    const htmlText = stripPhoneAppHtmlToText(html || item?.html || '');
    if (htmlText && !String(detail || '').includes(htmlText)) lines.push(`卡片完整文字：${htmlText}`);
    return limitPhoneContextText(lines.join('\n'));
};

const normalizePhoneDedupeText = (raw: string): string => String(raw || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
    .trim();

const getPhoneDedupeTokens = (raw: string): string[] => {
    const clean = normalizePhoneDedupeText(raw);
    if (!clean) return [];
    const tokens = new Set<string>();
    const latin = clean.match(/[a-z0-9]{3,}/g) || [];
    latin.forEach(t => tokens.add(t));
    const cjk = clean.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk.slice(i, i + 2));
    for (let i = 0; i < cjk.length - 2; i++) tokens.add(cjk.slice(i, i + 3));
    const stop = new Set(['这个','一个','内容','记录','手机','显示','标题','详情','状态','数值','卡片','完整','文字','用户','角色','生成','最近','相关','里面','当前','符合','人设']);
    return Array.from(tokens).filter(t => !stop.has(t)).slice(0, 260);
};

const isPhoneRecordDuplicate = (title: string, contextText: string, pool: PhoneEvidence[]): boolean => {
    const source = `${title}\n${contextText}`;
    const normalizedTitle = normalizePhoneDedupeText(title);
    const sourceTokens = getPhoneDedupeTokens(source);
    if (sourceTokens.length < 5) return false;
    const sourceSet = new Set(sourceTokens);
    return pool.some((record) => {
        const oldTitle = normalizePhoneDedupeText(record.title || '');
        const oldSource = `${record.title || ''}\n${record.contextText || ''}\n${record.detail || ''}`;
        if (normalizedTitle && oldTitle && normalizedTitle.length >= 4 && (normalizedTitle.includes(oldTitle) || oldTitle.includes(normalizedTitle))) return true;
        const oldTokens = getPhoneDedupeTokens(oldSource);
        if (oldTokens.length < 5) return false;
        let overlap = 0;
        for (const token of oldTokens) if (sourceSet.has(token)) overlap++;
        const score = overlap / Math.min(sourceTokens.length, oldTokens.length);
        return overlap >= 8 && score >= 0.58;
    });
};


const isHtmlCardModeEnabled = (app?: PhoneCustomApp): boolean => {
    if (!app) return false;
    if (typeof app.htmlCardEnabled === 'boolean') return app.htmlCardEnabled;
    return !!app.cardPrompt?.trim();
};

const isCssCardModeEnabled = (app?: PhoneCustomApp): boolean => {
    if (!app) return false;
    if (typeof app.cssCardEnabled === 'boolean') return app.cssCardEnabled;
    return !!app.cardCss?.trim();
};

// --- Debug Component ---
const LayoutInspector: React.FC = () => {
    const [stats, setStats] = useState({ w: 0, h: 0, vh: 0, top: 0 });
    
    useEffect(() => {
        const update = () => {
            setStats({
                w: window.innerWidth,
                h: window.innerHeight,
                vh: window.visualViewport?.height || 0,
                top: window.visualViewport?.offsetTop || 0
            });
        };
        window.addEventListener('resize', update);
        window.visualViewport?.addEventListener('resize', update);
        window.visualViewport?.addEventListener('scroll', update);
        update();
        return () => {
            window.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('resize', update);
            window.visualViewport?.removeEventListener('scroll', update);
        };
    }, []);

    return (
        <div className="absolute top-0 right-0 z-[9999] bg-red-500/80 text-white text-[10px] font-mono p-1 pointer-events-none select-none">
            Win: {stats.w}x{stats.h}<br/>
            VV: {stats.vh.toFixed(0)} (y:{stats.top.toFixed(0)})
        </div>
    );
};

const CheckPhone: React.FC = () => {
    const { closeApp, characters, activeCharacterId, updateCharacter, apiConfig, addToast, userProfile } = useOS();
    const [view, setView] = useState<'select' | 'phone'>('select');
    // activeAppId: 'home' | 'chat_detail' | 'app_id'
    const [activeAppId, setActiveAppId] = useState<string>('home'); 
    const [targetChar, setTargetChar] = useState<CharacterProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    
    // Chat Detail State
    const [selectedChatRecord, setSelectedChatRecord] = useState<PhoneEvidence | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    
    // Custom App Creation State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newAppName, setNewAppName] = useState('');
    const [newAppIcon, setNewAppIcon] = useState('App');
    const [newAppColor, setNewAppColor] = useState('#3b82f6');
    const [newAppPrompt, setNewAppPrompt] = useState('');
    const [newAppHtmlEnabled, setNewAppHtmlEnabled] = useState(false);
    const [newAppCardPrompt, setNewAppCardPrompt] = useState('');
    const [newAppCssEnabled, setNewAppCssEnabled] = useState(false);
    const [newAppCardCss, setNewAppCardCss] = useState('');
    const [editingAppId, setEditingAppId] = useState<string | null>(null);
    const [manageAppId, setManageAppId] = useState<string | null>(null);

    // Debug Toggle
    const [showDebug, setShowDebug] = useState(false);

    // Derived state for evidence records
    const records = targetChar?.phoneState?.records || [];
    const customApps = targetChar?.phoneState?.customApps || [];

    useEffect(() => {
        if (targetChar) {
            // Keep targetChar in sync with global state if it updates (e.g. deletion)
            const updated = characters.find(c => c.id === targetChar.id);
            if (updated) {
                setTargetChar(updated);
                // Update selected record ref if open
                if (selectedChatRecord) {
                    const freshRecord = updated.phoneState?.records?.find(r => r.id === selectedChatRecord.id);
                    if (freshRecord) setSelectedChatRecord(freshRecord);
                }
            }
        }
    }, [characters]);

    // Reset page scroll on navigation to prevent mobile layout shift
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeAppId, view]);

    // Auto scroll to bottom of chat detail
    // NOTE: Do NOT use scrollIntoView - it propagates to page scroll on mobile, shifting the entire layout up
    useEffect(() => {
        if (activeAppId === 'chat_detail' && chatEndRef.current) {
            const container = chatEndRef.current.parentElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [selectedChatRecord?.detail, activeAppId]);

    const handleSelectChar = (c: CharacterProfile) => {
        setTargetChar(c);
        setView('phone');
        setActiveAppId('home');
    };

    const handleExitPhone = () => {
        setView('select');
        setTargetChar(null);
        setActiveAppId('home');
    };

    const handleDeleteRecord = async (record: PhoneEvidence) => {
        if (!targetChar) return;
        
        const newRecords = (targetChar.phoneState?.records || []).filter(r => r.id !== record.id);
        updateCharacter(targetChar.id, { 
            phoneState: { ...targetChar.phoneState, records: newRecords } 
        });

        if (record.systemMessageId) {
            await DB.deleteMessage(record.systemMessageId);
        }

        if (selectedChatRecord?.id === record.id) {
            setActiveAppId('chat'); // Go back to list
            setSelectedChatRecord(null);
        }

        addToast('记录已删除', 'success');
    };

    const resetCustomAppForm = () => {
        setEditingAppId(null);
        setNewAppName('');
        setNewAppIcon('App');
        setNewAppColor('#3b82f6');
        setNewAppPrompt('');
        setNewAppHtmlEnabled(false);
        setNewAppCardPrompt('');
        setNewAppCssEnabled(false);
        setNewAppCardCss('');
    };

    const openCreateCustomApp = () => {
        resetCustomAppForm();
        setShowCreateModal(true);
    };

    const openEditCustomApp = (app: PhoneCustomApp) => {
        setEditingAppId(app.id);
        setNewAppName(app.name || '');
        setNewAppIcon(app.icon || 'App');
        setNewAppColor(app.color || '#3b82f6');
        setNewAppPrompt(app.prompt || '');
        setNewAppHtmlEnabled(isHtmlCardModeEnabled(app));
        setNewAppCardPrompt(app.cardPrompt || '');
        setNewAppCssEnabled(isCssCardModeEnabled(app));
        setNewAppCardCss(app.cardCss || '');
        setManageAppId(null);
        setShowCreateModal(true);
    };

    const closeCustomAppModal = () => {
        setShowCreateModal(false);
        resetCustomAppForm();
    };

    const handleDeleteApp = async (appId: string) => {
        if (!targetChar) return;
        const removedRecords = (targetChar.phoneState?.records || []).filter(r => r.type === appId);
        const newRecords = (targetChar.phoneState?.records || []).filter(r => r.type !== appId);
        const newApps = (targetChar.phoneState?.customApps || []).filter(a => a.id !== appId);
        updateCharacter(targetChar.id, { phoneState: { ...targetChar.phoneState, customApps: newApps, records: newRecords } });
        for (const record of removedRecords) { if (record.systemMessageId) await DB.deleteMessage(record.systemMessageId); }
        if (activeAppId === appId) setActiveAppId('home');
        setManageAppId(null);
        addToast('App 已卸载', 'success');
    };

    const handleSaveCustomApp = () => {
        if (!targetChar) return;
        if (!newAppName.trim() || !newAppPrompt.trim()) { addToast('请填写 App 名称和功能指令', 'error'); return; }
        const currentApps = targetChar.phoneState?.customApps || [];
        const savedApp: PhoneCustomApp = {
            id: editingAppId || `app-${Date.now()}`,
            name: newAppName.trim(),
            icon: newAppIcon.trim() || 'App',
            color: newAppColor || '#3b82f6',
            prompt: newAppPrompt.trim(),
            htmlCardEnabled: newAppHtmlEnabled,
            cardPrompt: newAppCardPrompt.trim(),
            cssCardEnabled: newAppCssEnabled,
            cardCss: newAppCardCss.trim()
        };
        const nextApps = editingAppId ? currentApps.map(app => app.id === editingAppId ? savedApp : app) : [...currentApps, savedApp];
        updateCharacter(targetChar.id, { phoneState: { records: targetChar.phoneState?.records || [], ...targetChar.phoneState, customApps: nextApps } });
        closeCustomAppModal();
        addToast(editingAppId ? `已修改 ${savedApp.name}` : `已安装 ${savedApp.name}`, 'success');
    };
    // Calculate Time Gap - Duplicated logic from other apps for consistent experience
    const getTimeGapHint = (lastMsgTimestamp: number | undefined): string => {
        if (!lastMsgTimestamp) return '这是初次见面。';
        const now = Date.now();
        const diffMs = now - lastMsgTimestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 5) return '你们刚刚还在聊天。';
        if (diffMins < 60) return `距离上次互动只有 ${diffMins} 分钟。`;
        if (diffHours < 24) return `距离上次互动已经过了 ${diffHours} 小时。`;
        return `距离上次互动已经过了 ${diffDays} 天。`;
    };

    // --- Core Generation Logic ---

    const handleGenerate = async (type: string, customPrompt?: string) => {
        if (!targetChar || !apiConfig.apiKey) {
            addToast('配置错误', 'error');
            return;
        }
        setIsLoading(true);

        try {
            // Include full memory details for accuracy
            await injectMemoryPalace(targetChar);
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true);
            const msgs = await DB.getMessagesByCharId(targetChar.id);
            
            const lastMsg = msgs[msgs.length - 1];
            const timeGap = getTimeGapHint(lastMsg?.timestamp);

            const recentMsgs = msgs.slice(-50).map(m => {
                const roleName = m.role === 'user' ? userProfile.name : targetChar.name;
                const content = m.type === 'text' ? m.content : `[${m.type}]`;
                return `${roleName}: ${content}`;
            }).join('\n');

            let promptInstruction = "";
            let logPrefix = "";

            if (customPrompt) {
                const customApp = customApps.find(a => a.id === type);
                const cardPrompt = customApp?.cardPrompt?.trim() || '';
                const cardCss = customApp?.cardCss?.trim() || '';
                const shouldUseCssCard = isCssCardModeEnabled(customApp) && !!cardCss;
                const htmlSwitchReady = isHtmlCardModeEnabled(customApp) && !!cardPrompt;
                const shouldUseHtmlCard = shouldUseCssCard || htmlSwitchReady;
                const shouldUseFixedTemplate = !!cardPrompt && isPhoneHtmlTemplate(cardPrompt);
                const templateKeys = shouldUseFixedTemplate ? extractPhoneTemplateKeys(cardPrompt) : [];
                const existingAppRecordsForPrompt = (targetChar.phoneState?.records || [])
                    .filter(r => r.type === type)
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .slice(0, 14)
                    .map((r, idx) => `${idx + 1}. ${r.title}${r.value ? `｜${r.value}` : ''}｜${String(r.contextText || r.detail || '').replace(/\s+/g, ' ').slice(0, 220)}`)
                    .join('\n');
                const avoidRepeatBlock = existingAppRecordsForPrompt
                    ? `\n\n### 已有 App 记录，必须避开重复\n${existingAppRecordsForPrompt}\n\n避重要求：\n- 不要重复已有记录里的主题、商品、地点、事件、视频/帖子角度、消费品类或核心梗。\n- 即使最近聊天反复提到同一个东西，也要换成新的相关角度，不要再次生成同名或高度相似内容。\n- 优先生成之前没有出现过的新记录。`
                    : '\n\n### 已有 App 记录\n暂无。';
                const contextTextRule = `\n\n每一项都必须额外包含 contextText 字段：\n- contextText 是写给主聊天角色看的完整纯文字内容，不要写 HTML/CSS/代码。\n- 如果卡片里有 3 条镜头、2 条神评、观后感、订单明细等，contextText 也必须完整写出这些内容。\n- contextText 不要只总结成一句话，应该让角色不用看卡片也能知道全部重点。`;
                const baseCustomPrompt = `用户正在查看你的手机 App: "${customApp?.name || type}"。
该 App 的功能/用户想看的内容是: "${customPrompt}"。
请生成 2-4 条符合该 App 功能的记录。
必须符合你的人设（例如银行余额要符合身份，备忘录要符合性格）。${avoidRepeatBlock}${contextTextRule}`;

                if (shouldUseHtmlCard) {
                    const fixedTemplateRules = `当前用户填写的是固定 HTML 模板。你不要自己改模板结构，也不要输出 html 字段；系统会把你生成的数据填进模板。
输出格式必须是 JSON 数组，每一项都必须包含：
{
  "title": "标题/项目名",
  "detail": "详细内容/金额/状态，作为纯文字备份",
  "value": "可选的数值状态(如 +100)",
  "contextText": "完整纯文字内容，包含卡片中所有重点，给主聊天角色阅读",
  "templateData": {
    ${templateKeys.length ? templateKeys.map((k) => `"${k}": "填入 ${k} 对应内容"`).join(',\n    ') : '"title": "标题",\n    "detail": "详情"'}
  }
}

固定模板占位符：${templateKeys.length ? templateKeys.join('、') : '未检测到 {{占位符}}，至少要让 title/detail/value/contextText 有内容'}。
请确保 templateData 和 contextText 里的内容符合该 App 功能和角色人设。`;
                    const freeHtmlRules = `输出格式必须是 JSON 数组，每一项都必须包含：
{
  "title": "标题/项目名",
  "detail": "详细内容/金额/状态，作为纯文字备份",
  "value": "可选的数值状态(如 +100)",
  "contextText": "完整纯文字内容，包含卡片中所有重点，给主聊天角色阅读",
  "html": "一个手机 App 内部可直接展示的 HTML 卡片片段"
}

html 生成规则：
- 当前已开启卡片模式，所以必须生成 html 字段。
- 只输出单个卡片片段，不要 html/body/head/style，不要 markdown，不要代码块。
- 不要使用 script、iframe、form、input、button，也不要写任何 onClick/onload 等事件。
- 宽度按手机屏幕自适应，避免横向滚动。
- 卡片内容必须和 title/detail/value/contextText 一致，不要只做空壳样式。
${shouldUseCssCard ? `- 当前优先使用用户填写的 CSS 样式。html 里请尽量使用语义清晰的 class 名，例如 phone-card、phone-card-header、phone-card-title、phone-card-subtitle、phone-card-section、phone-card-label、phone-card-list、phone-card-item、phone-card-value、phone-card-note；不要依赖内联 style。
- CSS 样式由系统单独注入，你只需要输出结构清晰的 html 片段。` : `- 可以使用 div/span/p/ul/li/img 和内联 style。
- 严格遵守“HTML 卡片指令”，如果用户要求固定区块/固定数量/固定标题，不要擅自增删模块。
- HTML 卡片指令：${cardPrompt}`}`;
                    promptInstruction = `${baseCustomPrompt}\n\n${shouldUseFixedTemplate ? fixedTemplateRules : freeHtmlRules}`;
                } else {
                    promptInstruction = `${baseCustomPrompt}

输出格式必须是 JSON 数组，每一项只包含这些字段：
{
  "title": "标题/项目名",
  "detail": "详细内容/金额/状态",
  "value": "可选的数值状态(如 +100)",
  "contextText": "完整纯文字内容，给主聊天角色阅读"
}

注意：用户没有开启可用的 HTML/CSS 卡片设置，所以不要生成 html 字段，不要生成 HTML 卡片，保持原版纯文字记录样式。`;
                }
                logPrefix = customApp ? customApp.name : type;
            } else {                if (type === 'chat') {
                    promptInstruction = `生成 3 个该角色手机聊天软件(Message/Line)中的**对话片段**。
    要求：
    1. **自动匹配角色**: 根据人设，虚构 3 个合理的联系人（如：如果是学生，联系人可以是“辅导员”、“社团学长”；如果是杀手，联系人可以是“中间人”）。不要使用“User”作为联系人。
    2. **对话感**: 内容必须是有来有回的对话脚本（3-4句），体现他们之间的关系。
    3. **格式**: 必须严格使用 "我:..." 代表主角(你)，"对方:..." 或 "人名:..." 代表联系人。
    格式JSON数组: [{ "title": "联系人名称 (身份)", "detail": "对方: 最近怎么样？\\n我: 还活着。\\n对方: 那就好。" }, ...]`;
                    logPrefix = "聊天软件";
                } else if (type === 'call') {
                    promptInstruction = `生成 3 条该角色的近期**通话记录**。
    格式JSON数组: [{ "title": "联系人名称", "value": "呼入 (5分钟) / 未接 / 呼出 (30秒)", "detail": "关于下周聚会的事..." }, ...]`;
                    logPrefix = "通话记录";
                } else if (type === 'order') {
                    promptInstruction = `生成 3 条该角色最近的购物订单。
    格式JSON数组: [{ "title": "商品名", "detail": "状态" }, ...]`;
                    logPrefix = "购物APP";
                } else if (type === 'delivery') {
                    promptInstruction = `生成 3 条该角色最近的外卖记录。
    格式JSON数组: [{ "title": "店名", "detail": "菜品" }, ...]`;
                    logPrefix = "外卖APP";
                } else if (type === 'social') {
                    promptInstruction = `生成 2 条该角色的朋友圈/社交媒体动态。
    格式JSON数组: [{ "title": "时间/状态", "detail": "正文内容" }, ...]`;
                    logPrefix = "朋友圈";
                }
            }

            const fullPrompt = `${context}\n\n### [Current Status]\n时间距离上次互动: ${timeGap}\n\n### [Recent Chat Context]\n${recentMsgs}\n\n### [Task]\n${promptInstruction}\n请根据[Current Status]和人设调整生成内容的时间戳和情绪。如果很久没聊天，记录可能是近期的独处状态；如果刚聊过，记录可能与聊天内容相关。`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: fullPrompt }],
                    temperature: 0.8
                })
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            let content = data.choices[0].message.content;
            content = content.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBracket = content.indexOf('[');
            const lastBracket = content.lastIndexOf(']');
            if (firstBracket > -1 && lastBracket > -1) content = content.substring(firstBracket, lastBracket + 1);
            
            let json = [];
            try { json = JSON.parse(content); } catch (e) { json = []; }

            const newRecordsToAdd: PhoneEvidence[] = [];

            if (Array.isArray(json)) {
                for (const item of json) {
                    const recordTitle = item.title || 'Unknown';
                    const recordDetail = item.detail || '...';
                    const appForRecord = customApps.find(a => a.id === type);
                    const cardPromptForRecord = appForRecord?.cardPrompt?.trim() || '';
                    const cssReadyForRecord = isCssCardModeEnabled(appForRecord) && !!appForRecord?.cardCss?.trim();
                    const htmlReadyForRecord = isHtmlCardModeEnabled(appForRecord) && !!cardPromptForRecord;
                    let recordHtml: string | undefined = undefined;
                    if (customPrompt && (cssReadyForRecord || htmlReadyForRecord)) {
                        if (cardPromptForRecord && isPhoneHtmlTemplate(cardPromptForRecord)) {
                            recordHtml = fillPhoneHtmlTemplate(cardPromptForRecord, item.templateData, { title: recordTitle, detail: recordDetail, value: item.value });
                        } else if (typeof item.html === 'string') {
                            recordHtml = item.html;
                        }
                    }
                    const recordContextText = buildPhoneRecordContextText(item, recordTitle, recordDetail, recordHtml);
                    const duplicatePool = [...(targetChar.phoneState?.records || []), ...newRecordsToAdd].filter(r => r.type === type);
                    if (customPrompt && isPhoneRecordDuplicate(recordTitle, recordContextText, duplicatePool)) {
                        continue;
                    }

                    let sysMsgContent = "";
                    if (type === 'chat') {
                        sysMsgContent = `[系统: ${targetChar.name} 与 "${recordTitle}" 的聊天记录-内容涉及: ${recordContextText.replace(/\n/g, ' ')}]`;
                    } else {
                        sysMsgContent = `[系统: ${targetChar.name}的手机(${logPrefix}) 显示:\n${recordContextText}\n]`;
                    }
                    
                    await DB.saveMessage({
                        charId: targetChar.id,
                        role: 'system',
                        type: 'text',
                        content: sysMsgContent
                    });
                    
                    const currentMsgs = await DB.getMessagesByCharId(targetChar.id);
                    const savedMsg = currentMsgs[currentMsgs.length - 1];
                    
                    newRecordsToAdd.push({
                        id: `rec-${Date.now()}-${Math.random()}`,
                        type: type, 
                        title: recordTitle,
                        detail: recordDetail,
                        value: item.value,
                        html: recordHtml,
                        contextText: recordContextText,
                        timestamp: Date.now(),
                        systemMessageId: savedMsg?.id 
                    });
                    
                    await new Promise(r => setTimeout(r, 50)); 
                }
            }

            const existingRecords = targetChar.phoneState?.records || [];
            updateCharacter(targetChar.id, {
                phoneState: { ...targetChar.phoneState, records: [...existingRecords, ...newRecordsToAdd] }
            });

            addToast(`已刷新 ${newRecordsToAdd.length} 条数据`, 'success');

        } catch (e: any) {
            console.error(e);
            addToast('解析失败，请重试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Continue Chat Logic ---

    const handleContinueChat = async () => {
        if (!selectedChatRecord || !targetChar || !apiConfig.apiKey) return;
        setIsLoading(true);

        try {
            await injectMemoryPalace(targetChar);
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true); // Enable detailed context
            const prompt = `${context}

### [Task: Continue Conversation]
Roleplay: You are "${targetChar.name}". You are chatting on your phone with "${selectedChatRecord.title}".
Current History:
"""
${selectedChatRecord.detail}
"""

Task: Please continue this conversation for 3-5 more turns. 
Style: Casual, IM style.
Format: 
- Use "我: ..." for yourself (${targetChar.name}).
- Use "对方: ..." for the contact (${selectedChatRecord.title}).
- Only output the new dialogue lines. Do NOT repeat history.
`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.85
                })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                let newLines = data.choices[0].message.content.trim();
                
                // Clean up any markdown
                newLines = newLines.replace(/```/g, '');

                // Append to existing record
                const updatedDetail = `${selectedChatRecord.detail}\n${newLines}`;
                
                // Update Local State
                const updatedRecord = { ...selectedChatRecord, detail: updatedDetail };
                setSelectedChatRecord(updatedRecord);

                // Update Character Profile
                const allRecords = targetChar.phoneState?.records || [];
                const updatedRecords = allRecords.map(r => r.id === updatedRecord.id ? updatedRecord : r);
                updateCharacter(targetChar.id, {
                    phoneState: { ...targetChar.phoneState, records: updatedRecords }
                });
                
                // Note: We deliberately do NOT add a system message to the main chat context here.
                // This is "pure viewing" mode.
            }

        } catch (e) {
            console.error(e);
            addToast('续写失败', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Renderers ---

    const renderHeader = (title: string, backAction: () => void, extraAction?: React.ReactNode) => (
        <div className="h-14 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md text-slate-800 shrink-0 z-20 border-b border-slate-200">
            <button onClick={backAction} className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <span className="font-bold text-base tracking-wide truncate max-w-[200px]">{title}</span>
            <div className="w-8 flex justify-end">{extraAction}</div>
        </div>
    );

    const renderChatList = () => {
        const list = records.filter(r => r.type === 'chat').sort((a,b) => b.timestamp - a.timestamp);
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader('Message', () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="text-center text-slate-400 mt-20 text-xs">暂无聊天记录</div>}
                    {list.map(r => (
                        <div 
                            key={r.id} 
                            onClick={() => { setSelectedChatRecord(r); setActiveAppId('chat_detail'); }}
                            className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative group animate-slide-up active:scale-98 transition-transform cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center shadow-inner shrink-0">
                                    <User size={24} className="text-indigo-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <div className="font-bold text-slate-700 text-sm truncate">{r.title}</div>
                                        <div className="text-[10px] text-slate-400">{new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">
                                        {r.detail.split('\n').pop() || '...'}
                                    </div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteRecord(r); }} className="absolute top-2 right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity z-10">×</button>
                        </div>
                    ))}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button disabled={isLoading} onClick={() => handleGenerate('chat')} className="pointer-events-auto bg-green-500 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform">
                        {isLoading ? '连接中...' : '刷新消息列表'}
                    </button>
                </div>
            </div>
        );
    };

  const renderChatDetail = () => {
    if (!selectedChatRecord || !targetChar) return null;

    // Parse logic: look for "Me:" or "我:" vs others
    const lines = selectedChatRecord.detail.split('\n').filter(l => l.trim());
    const parsedLines = lines.map(line => {
        const isMe = line.startsWith('我') || line.startsWith('Me') || line.startsWith('Me:') || line.startsWith('我:');
        const content = line.replace(/^(我|Me|对方|Them|[\w\u4e00-\u9fa5]+)[:：]\s*/, '');
        return { isMe, content };
    });

    return (
        // 关键修复：添加不透明背景色，确保完全覆盖
      <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f2f2f2] z-[100] overflow-hidden">
            {renderHeader(selectedChatRecord.title, () => setActiveAppId('chat'))}
            
            {/* 聊天内容区域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar overscroll-contain min-h-0">
                {parsedLines.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                        {!msg.isMe && (
                            <div className="w-9 h-9 rounded-md bg-gray-300 flex items-center justify-center text-xs text-gray-500 mr-2 shrink-0">
                                {selectedChatRecord.title[0]}
                            </div>
                        )}
                        <div className={`px-3 py-2 rounded-lg max-w-[75%] text-sm leading-relaxed shadow-sm break-words relative ${msg.isMe ? 'bg-[#95ec69] text-black' : 'bg-white text-black'}`}>
                            {msg.isMe && <div className="absolute top-2 -right-1.5 w-3 h-3 bg-[#95ec69] rotate-45"></div>}
                            {!msg.isMe && <div className="absolute top-3 -left-1 w-2.5 h-2.5 bg-white rotate-45"></div>}
                            <span className="relative z-10">{msg.content}</span>
                        </div>
                        {msg.isMe && (
                            <img src={targetChar.avatar} className="w-9 h-9 rounded-md object-cover ml-2 shrink-0 shadow-sm" />
                        )}
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-center py-4">
                        <div className="flex gap-1">
                            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                            <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
                        </div>
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* 底部按钮 - 关键修复：移除复杂的 env() 计算，使用固定 padding */}
            <div className="shrink-0 w-full p-4 bg-[#f7f7f7] border-t border-gray-200">
                <button 
                    onClick={handleContinueChat} 
                    disabled={isLoading}
                    className="w-full py-3 bg-white border border-gray-300 rounded-xl text-sm font-bold text-slate-600 shadow-sm active:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                    {isLoading ? '对方正在输入...' : '偷看后续 / 拱火'}
                </button>
            </div>
        </div>
    );
};

    const renderCallList = () => {
        const list = records.filter(r => r.type === 'call').sort((a,b) => b.timestamp - a.timestamp);
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-white z-10">
                {renderHeader('Recents', () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="text-center text-slate-400 mt-20 text-xs">暂无通话记录</div>}
                    {list.map(r => {
                        const isMissed = r.value?.includes('未接') || r.value?.includes('Missed');
                        const isOutgoing = r.value?.includes('呼出') || r.value?.includes('Outgoing');
                        return (
                            <div key={r.id} className="flex items-center gap-4 px-6 py-4 border-b border-slate-50 relative group animate-fade-in hover:bg-slate-50 transition-colors">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isMissed ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-500'}`}>
                                    <Phone size={20} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className={`font-bold text-sm truncate ${isMissed ? 'text-red-500' : 'text-slate-800'}`}>{r.title}</div>
                                    <div className="text-[10px] text-slate-400 flex items-center gap-1">
                                        <span>{isMissed ? '未接来电' : (isOutgoing ? '呼出' : '呼入')}</span>
                                        {r.value && !isMissed && <span>• {r.value.replace(/.*?\((.*?)\).*/, '$1')}</span>}
                                    </div>
                                    {r.detail && <div className="text-[10px] text-slate-500 mt-1 italic truncate">"{r.detail}"</div>}
                                </div>
                                <div className="text-[10px] text-slate-300">{new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                <button onClick={() => handleDeleteRecord(r)} className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                            </div>
                        );
                    })}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button disabled={isLoading} onClick={() => handleGenerate('call')} className="pointer-events-auto bg-slate-800 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform">
                        {isLoading ? '...' : '刷新通话记录'}
                    </button>
                </div>
            </div>
        );
    };

    const renderGenericList = (appId: string, appName: string, customPrompt?: string) => {
        const list = records.filter(r => r.type === appId).sort((a,b) => b.timestamp - a.timestamp);
        const customAppForRender = customApps.find(app => app.id === appId);
        const isCustomApp = !!customAppForRender;
        const cssForRender = isCssCardModeEnabled(customAppForRender) && customAppForRender?.cardCss?.trim() ? scopePhoneAppCss(customAppForRender.cardCss, '.phone-custom-app-card-css-scope') : '';
        const shouldRenderHtmlCard = !!cssForRender || (isHtmlCardModeEnabled(customAppForRender) && !!customAppForRender?.cardPrompt?.trim());
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader(appName, () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2"><Tray size={48} className="opacity-20 text-slate-400" /><span className="text-xs">暂无数据</span></div>}
                    {list.map(r => {
                        const safeHtml = isCustomApp && shouldRenderHtmlCard && r.html ? sanitizePhoneAppHtml(r.html) : '';
                        return (
                            <div key={r.id} className={`rounded-xl relative group animate-slide-up overflow-hidden ${safeHtml && cssForRender ? 'bg-transparent p-0 border-0 shadow-none' : 'bg-white p-4 border border-slate-100 shadow-sm'}`}>
                                {safeHtml ? (
                                    <div className={`phone-custom-app-card phone-custom-app-card-css-scope text-slate-700 text-xs leading-relaxed [&_*]:max-w-full ${cssForRender ? 'p-0 bg-transparent border-0 shadow-none' : ''}`}>
                                        {cssForRender && <style>{cssForRender}</style>}
                                        <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
                                    </div>
                                ) : (<><div className="flex justify-between items-start mb-1 gap-2"><span className="font-bold text-slate-700 text-sm line-clamp-1">{r.title}</span>{r.value && <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded shrink-0">{r.value}</span>}</div><div className="text-xs text-slate-500 leading-relaxed whitespace-pre-wrap">{r.detail}</div></>)}
                                <div className="text-[10px] text-slate-300 mt-2 text-right">{new Date(r.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                <button onClick={() => handleDeleteRecord(r)} className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow-md">×</button>
                            </div>
                        );
                    })}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30"><button disabled={isLoading} onClick={() => handleGenerate(appId, customPrompt)} className="pointer-events-auto bg-slate-800 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform hover:bg-slate-700">{isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}刷新数据</button></div>
            </div>
        );
    };

    const ZenTile: React.FC<{
        children: React.ReactNode;
        label: string;
        onClick: () => void;
        onDelete?: () => void;
        onManage?: () => void;
        muted?: boolean;
        tintColor?: string;
    }> = ({ children, label, onClick, onDelete, onManage, muted, tintColor }) => {
        const longPressTimer = useRef<number | null>(null);
        const didLongPress = useRef(false);
        const startLongPress = () => {
            if (!onManage) return;
            didLongPress.current = false;
            if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
            longPressTimer.current = window.setTimeout(() => { didLongPress.current = true; onManage(); }, 520);
        };
        const cancelLongPress = () => { if (longPressTimer.current) window.clearTimeout(longPressTimer.current); longPressTimer.current = null; };
        return (
            <div className="flex flex-col items-center gap-2.5 relative group">
                <button onPointerDown={startLongPress} onPointerUp={cancelLongPress} onPointerLeave={cancelLongPress} onPointerCancel={cancelLongPress} onContextMenu={(e) => { if (onManage) { e.preventDefault(); onManage(); } }} onClick={(e) => { if (didLongPress.current) { e.preventDefault(); didLongPress.current = false; return; } onClick(); }} className={`w-14 h-14 rounded-xl flex items-center justify-center backdrop-blur-xl border transition-all active:scale-95 duration-300 relative overflow-hidden ${muted ? 'bg-[#191a1a]/50 border-[#484848]/20 hover:bg-[#252626]/50 text-[#acabaa]' : 'bg-[#252626]/50 border-[#484848]/25 hover:bg-[#2c2c2c]/70 text-[#e7e5e4]'}`} style={tintColor ? { boxShadow: `inset 0 0 18px 0 ${tintColor}33` } : undefined}>
                    <span className="relative z-10 drop-shadow-sm">{children}</span>
                </button>
                <span className="text-[9px] uppercase tracking-[0.18em] text-[#acabaa] font-medium leading-none">{label}</span>
                {onDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="absolute -top-1 -right-1 w-4 h-4 bg-[#484848] text-[#e7e5e4] rounded-full flex items-center justify-center text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity z-20 hover:bg-[#bb5551]">×</button>}
            </div>
        );
    };

    const renderDesktop = () => {
        const hasBg = !!targetChar?.dateBackground;
        const charName = targetChar?.name || 'Digital Monolith';

        return (
            <div className="absolute inset-0 flex flex-col z-0 overflow-hidden bg-[#0e0e0e]">
                {/* Zen mesh background */}
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: 'radial-gradient(circle at 50% 40%, #1f2020 0%, #0e0e0e 75%)' }}
                />
                {hasBg && (
                    <div
                        className="absolute inset-0 opacity-15 grayscale pointer-events-none"
                        style={{ backgroundImage: `url(${targetChar!.dateBackground})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                    />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/50 pointer-events-none" />
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none z-20" />

                {/* Status bar */}
                <div className="h-8 flex justify-between px-6 items-center z-20 relative pt-3 text-[#c8c6c5]">
                    <span className="text-[11px] font-semibold tracking-tight">9:41</span>
                    <div className="flex gap-1.5 items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M2 22h3V10H2v12zm6 0h3V6H8v16zm6 0h3V2h-3v20zm6 0h3v-8h-3v8z"/></svg>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M1.371 8.143c5.858-5.857 15.356-5.857 21.213 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.06 0c-4.98-4.979-13.053-4.979-18.032 0a.75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182c4.1-4.1 10.749-4.1 14.85 0a.75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.062 0 8.25 8.25 0 0 0-11.667 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.204 3.182a6 6 0 0 1 8.486 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0 3.75 3.75 0 0 0-5.304 0 .75.75 0 0 1-1.06 0l-.53-.53a.75.75 0 0 1 0-1.06Zm3.182 3.182a1.5 1.5 0 0 1 2.122 0 .75.75 0 0 1 0 1.061l-.53.53a.75.75 0 0 1-1.061 0l-.53-.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>
                        <div className="w-4 h-2 border border-current rounded-[2px] relative"><div className="absolute left-0 top-0 bottom-0 bg-current w-3/4"></div></div>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 px-6 pt-6 pb-28 z-10 overflow-y-auto no-scrollbar overscroll-none">
                    {/* Header */}
                    <div className="mb-8">
                        <h1 className="text-lg font-bold tracking-tighter text-[#c8c6c5] leading-tight truncate">{charName}</h1>
                        <p className="text-[10px] tracking-[0.25em] uppercase text-[#acabaa] mt-1">The Space Between</p>
                    </div>

                    {/* Apps grid */}
                    <div className="grid grid-cols-4 gap-y-6 gap-x-2 place-items-center content-start">
                        <ZenTile label="Message" onClick={() => setActiveAppId('chat')}>
                            <ChatCircleDots size={24} weight="light" />
                        </ZenTile>
                        <ZenTile label="Taobao" onClick={() => setActiveAppId('taobao')}>
                            <ShoppingBag size={24} weight="light" />
                        </ZenTile>
                        <ZenTile label="Food" onClick={() => setActiveAppId('waimai')}>
                            <Hamburger size={24} weight="light" />
                        </ZenTile>
                        <ZenTile label="Moments" onClick={() => setActiveAppId('social')}>
                            <CircleNotch size={24} weight="light" />
                        </ZenTile>

                        {customApps.map(app => (
                            <ZenTile key={app.id} label={app.name} onClick={() => setActiveAppId(app.id)} onManage={() => setManageAppId(app.id)} tintColor={app.color}>
                                <span className="text-xl grayscale-0">{app.icon}</span>
                            </ZenTile>
                        ))}

                        <ZenTile label="Add App" onClick={openCreateCustomApp} muted>
                            <Plus size={22} weight="light" />
                        </ZenTile>

                        <ZenTile label="Debug" onClick={() => setShowDebug(!showDebug)} muted>
                            <Wrench size={22} weight="light" />
                        </ZenTile>
                    </div>
                </div>

                {/* Floating glass nav */}
                <nav className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[90%] z-40">
                    <div className="bg-[#252626]/70 backdrop-blur-xl rounded-2xl border border-[#484848]/30 shadow-[0_0_64px_rgba(0,0,0,0.25)] flex justify-around items-center px-4 py-3">
                        <button onClick={() => {}} className="flex items-center justify-center text-[#acabaa] p-2.5 hover:bg-[#1f2020] rounded-xl transition-all active:scale-90 duration-200">
                            <Phone size={22} weight="light" />
                        </button>
                        <button onClick={() => setActiveAppId('chat')} className="flex items-center justify-center text-[#acabaa] p-2.5 hover:bg-[#1f2020] rounded-xl transition-all active:scale-90 duration-200">
                            <ChatCircleDots size={22} weight="light" />
                        </button>
                        <button onClick={handleExitPhone} className="flex items-center justify-center bg-[#474646] text-[#f0fded] rounded-xl p-2.5 active:scale-90 duration-200" aria-label="断开连接">
                            <SignOut size={22} weight="light" />
                        </button>
                        <button onClick={() => {}} className="flex items-center justify-center text-[#acabaa] p-2.5 hover:bg-[#1f2020] rounded-xl transition-all active:scale-90 duration-200">
                            <Compass size={22} weight="light" />
                        </button>
                        <button onClick={() => {}} className="flex items-center justify-center text-[#acabaa] p-2.5 hover:bg-[#1f2020] rounded-xl transition-all active:scale-90 duration-200">
                            <GearSix size={22} weight="light" />
                        </button>
                    </div>
                </nav>
            </div>
        );
    };

    if (view === 'select') {
        return (
            <div className="absolute inset-0 flex flex-col bg-slate-900 font-light overflow-hidden">
                <div className="h-20 pt-4 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10 shrink-0">
                    <button onClick={closeApp} className="p-2 -ml-2 rounded-full hover:bg-white/10 text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="font-bold text-white tracking-widest uppercase text-sm">Target Device</span>
                    <div className="w-8"></div>
                </div>
                <div className="flex-1 min-h-0 p-6 grid grid-cols-2 gap-5 overflow-y-auto pb-20 no-scrollbar overscroll-contain content-start">
                    {characters.map(c => (
                        <div key={c.id} onClick={() => handleSelectChar(c)} className="aspect-[3/4] bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col items-center justify-center gap-4 cursor-pointer active:scale-95 transition-all group hover:border-green-500 hover:shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                            <div className="w-20 h-20 rounded-full p-[2px] border-2 border-slate-600 group-hover:border-green-500 transition-colors">
                                <img src={c.avatar} className="w-full h-full rounded-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                            </div>
                            <div className="text-center">
                                <div className="font-bold text-slate-300 text-sm group-hover:text-green-400">{c.name}</div>
                                <div className="text-[10px] text-slate-500 font-mono mt-1">
  CONNECT &gt;
</div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Phone View Container
    // FIXED: Use absolute inset-0 to force fill parent container properly
    return (
        <div className="absolute inset-0 bg-slate-900 overflow-hidden font-sans overscroll-none">
            {showDebug && <LayoutInspector />}
            {activeAppId === 'home' ? renderDesktop() : (
                <>
                    {activeAppId === 'chat' && renderChatList()}
                    {activeAppId === 'chat_detail' && renderChatDetail()}
                    {activeAppId === 'taobao' && renderGenericList('order', 'Taobao')}
                    {activeAppId === 'waimai' && renderGenericList('delivery', 'Food Delivery')}
                    {activeAppId === 'social' && renderGenericList('social', 'Moments')}
                    
                    {/* Render Custom Apps */}
                    {customApps.find(a => a.id === activeAppId) && (
                        (() => {
                            const app = customApps.find(a => a.id === activeAppId)!;
                            return renderGenericList(app.id, app.name, app.prompt);
                        })()
                    )}
                </>
            )}

            {/* Create / Edit App Modal */}
            <Modal isOpen={showCreateModal} title={editingAppId ? "修改自定义 App" : "安装自定义 App"} onClose={closeCustomAppModal} footer={<button onClick={handleSaveCustomApp} className="w-full py-3 bg-blue-500 text-white font-bold rounded-2xl">{editingAppId ? '保存修改' : '安装到桌面'}</button>}>
                <div className="space-y-4">
                    <div className="flex gap-4"><div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-md border-2 border-slate-100 shrink-0" style={{ background: newAppColor }}>{newAppIcon}</div><div className="flex-1 space-y-2"><input value={newAppName} onChange={e => setNewAppName(e.target.value)} placeholder="App 名称 (如: 银行)" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" /><div className="flex gap-2"><input value={newAppIcon} onChange={e => setNewAppIcon(e.target.value)} placeholder="Emoji" className="w-16 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-center" /><input type="color" value={newAppColor} onChange={e => setNewAppColor(e.target.value)} className="h-9 flex-1 cursor-pointer rounded-lg bg-transparent" /></div></div></div>
                    <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">功能指令 (AI Prompt)</label><textarea value={newAppPrompt} onChange={e => setNewAppPrompt(e.target.value)} placeholder="例如: 显示该用户的存款余额、近期的转账记录以及理财收益。" className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs resize-none" /><p className="text-[9px] text-slate-400 mt-1">AI 将根据此指令生成该 App 内部的数据。</p></div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 space-y-3"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-bold text-slate-400 uppercase">HTML 卡片</div><p className="text-[9px] text-slate-400 mt-0.5">关闭时就是原版纯文字；打开后才使用下面的 HTML 卡片指令。</p></div><button type="button" onClick={() => setNewAppHtmlEnabled(v => !v)} className={`px-3 py-1.5 rounded-full text-[10px] font-bold border active:scale-95 transition-all ${newAppHtmlEnabled ? 'bg-blue-500 text-white border-blue-500 shadow-sm' : 'bg-white text-slate-400 border-slate-200'}`}>{newAppHtmlEnabled ? '开' : '关'}</button></div>{newAppHtmlEnabled && <div><textarea value={newAppCardPrompt} onChange={e => setNewAppCardPrompt(e.target.value)} placeholder="可以写自然语言卡片指令，也可以粘贴固定 HTML 模板；模板可用 {{title}}、{{detail}}、{{value}} 或自定义占位符。" className="w-full h-28 bg-white border border-slate-200 rounded-xl p-3 text-xs resize-none" /><p className="text-[9px] text-slate-400 mt-1">打开但不填写时不会生成卡片，会自动回到原版纯文字。固定 HTML 模板会比普通描述更稳定。</p></div>}</div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3 space-y-3"><div className="flex items-center justify-between gap-3"><div><div className="text-[10px] font-bold text-slate-400 uppercase">CSS 样式</div><p className="text-[9px] text-slate-400 mt-0.5">高级样式。开启并填写 CSS 后优先使用；CSS 为空时继续按 HTML 卡片指令处理。</p></div><button type="button" onClick={() => setNewAppCssEnabled(v => !v)} className={`px-3 py-1.5 rounded-full text-[10px] font-bold border active:scale-95 transition-all ${newAppCssEnabled ? 'bg-purple-500 text-white border-purple-500 shadow-sm' : 'bg-white text-slate-400 border-slate-200'}`}>{newAppCssEnabled ? '开' : '关'}</button></div>{newAppCssEnabled && <div><textarea value={newAppCardCss} onChange={e => setNewAppCardCss(e.target.value)} placeholder={`例如：\n.phone-card { padding: 16px; border-radius: 20px; background: rgba(15,23,42,.88); color: white; }\n.phone-card-title { font-size: 18px; font-weight: 800; }`} className="w-full h-32 bg-white border border-slate-200 rounded-xl p-3 text-[11px] font-mono resize-none" /><p className="text-[9px] text-slate-400 mt-1">建议用 .phone-card、.phone-card-title、.phone-card-section 等类名；系统会把 CSS 限制在这个 App 卡片区域里。</p></div>}</div>
                </div>
            </Modal>

            {manageAppId && (() => { const app = customApps.find(a => a.id === manageAppId); if (!app) return null; return (<div className="absolute inset-0 z-[120] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setManageAppId(null)}><div className="w-full max-w-sm mx-4 mb-6 rounded-3xl bg-white p-4 shadow-2xl space-y-3 animate-slide-up" onClick={e => e.stopPropagation()}><div className="flex items-center gap-3 pb-2"><div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm" style={{ background: app.color }}>{app.icon}</div><div className="min-w-0 flex-1"><div className="font-bold text-slate-800 truncate">{app.name}</div><div className="text-[10px] text-slate-400">修改设置或卸载这个 App</div></div></div><button onClick={() => openEditCustomApp(app)} className="w-full py-3 rounded-2xl bg-blue-500 text-white text-sm font-bold shadow-sm active:scale-95 transition-transform">修改设置</button><button onClick={() => handleDeleteApp(app.id)} className="w-full py-3 rounded-2xl bg-red-50 text-red-500 text-sm font-bold border border-red-100 active:scale-95 transition-transform">卸载 App</button><button onClick={() => setManageAppId(null)} className="w-full py-3 rounded-2xl bg-slate-50 text-slate-500 text-sm font-bold active:scale-95 transition-transform">取消</button></div></div>); })()}
        </div>
    );
};

export default CheckPhone;