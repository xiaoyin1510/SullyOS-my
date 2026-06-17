/**
 * 程序化 roll 一个 NPC 立绘 —— 复用捏脸器（character_creator.html）的随机+导出能力。
 *
 * 做法：挂一个屏幕外的隐藏 iframe 载入捏脸器，等它 `like520_ready` 后发 `like520_init`
 * + `like520_roll`（headless 消息，见 html 里 rollAndExport），它会随机一套并用
 * html2canvas 导出透明立绘，回传 `like520_result`。超时/出错返回 null，调用方降级用
 * emoji 头像。彼方·剧院给缺演员的剧本角色补 NPC 用。
 */

const CHAR_CREATOR_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'like520/character_creator.html').replace(/\/+/g, '/');

export interface RolledNpc { img: string; state: any; }

export function rollNpcChibi(timeoutMs = 18000): Promise<RolledNpc | null> {
    return new Promise((resolve) => {
        if (typeof document === 'undefined' || typeof window === 'undefined') { resolve(null); return; }
        let done = false;
        const iframe = document.createElement('iframe');
        // 屏幕外但保持可见（html2canvas 不渲染 visibility:hidden 的内容），给足布局尺寸
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1200px;border:0;opacity:1;pointer-events:none;z-index:-1;';
        iframe.setAttribute('aria-hidden', 'true');

        const cleanup = () => {
            window.removeEventListener('message', onMsg);
            try { iframe.remove(); } catch { /* ignore */ }
        };
        const finish = (v: RolledNpc | null) => { if (done) return; done = true; cleanup(); resolve(v); };

        const onMsg = (e: MessageEvent) => {
            if (e.source !== iframe.contentWindow || !e.data || typeof e.data !== 'object') return;
            if (e.data.type === 'like520_ready') {
                iframe.contentWindow?.postMessage({ type: 'like520_init', payload: { mode: 'char', charName: 'NPC', isSully: false } }, '*');
                setTimeout(() => iframe.contentWindow?.postMessage({ type: 'like520_roll' }, '*'), 150);
            } else if (e.data.type === 'like520_result' && e.data.payload) {
                const img = e.data.payload.transparentDataUrl || e.data.payload.dataUrl;
                finish(img ? { img, state: e.data.payload.state } : null);
            } else if (e.data.type === 'like520_roll_error') {
                finish(null);
            }
        };

        window.addEventListener('message', onMsg);
        iframe.src = CHAR_CREATOR_URL;
        document.body.appendChild(iframe);
        setTimeout(() => finish(null), timeoutMs);
    });
}

/** 给 NPC 随机起个名字（剧本缺角时用）。 */
const NPC_NAMES = ['路人甲', '路人乙', '路人丙', '阿岛', '小汀', '客串者', '无名氏', '替补演员', '幕后人', '群演 A', '群演 B'];
export function randomNpcName(used: string[]): string {
    const pool = NPC_NAMES.filter(n => !used.includes(n));
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
    return `NPC-${Math.random().toString(36).slice(2, 5)}`;
}
