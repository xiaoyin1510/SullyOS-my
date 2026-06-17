/**
 * 懒加载 chunk 失败自愈 — "Importing a module script failed." 一键恢复
 *
 * 触发场景 (iOS Safari standalone PWA 高发):
 *  - PWA 从后台恢复瞬间网络连接还没拉起来, 此时点 App 图标触发的动态 import 失败;
 *  - 部署更新后旧 bundle 还驻留在内存里, 引用的旧 hash chunk 已从服务器消失 (404)。
 *
 * 关键: Safari 会把"加载失败"缓存进模块表 — 同一 URL 在本页生命周期内再 import
 * 直接秒失败、不再发网络请求。所以"返回桌面再点进"永远修不好, 只有整页 reload
 * (用户侧表现为"大退重进") 才能恢复。这里做的就是把这次 reload 自动化。
 *
 * 防循环: sessionStorage 记录上次自动刷新时间, 冷却期内不再自刷 (留给手动按钮),
 * 避免服务器真把 chunk 弄丢时无限刷新。大退后 sessionStorage 自然清空, 护栏复位。
 */

const RELOAD_MARK_KEY = 'sullyos_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

/** 各浏览器动态 import / chunk 加载失败的报错指纹 (Safari / Chrome / Firefox / webpack 风格) */
const CHUNK_ERROR_RE = new RegExp(
    [
        'Importing a module script failed',          // iOS/macOS Safari
        'Failed to fetch dynamically imported module', // Chrome
        'error loading dynamically imported module',   // Firefox
        'Failed to load module script',                 // MIME/网络层失败
        'Unable to preload CSS',                        // Vite __vitePreload CSS 依赖失败
        'ChunkLoadError',
        'Loading chunk \\S+ failed',
    ].join('|'),
    'i',
);

export const isChunkLoadError = (err: unknown): boolean => {
    const msg = err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === 'string' ? err : '';
    return CHUNK_ERROR_RE.test(msg);
};

/**
 * 尝试自动整页刷新来恢复 chunk 加载失败。
 * 返回 true = 已发起刷新 (页面即将消失); false = 冷却期内/存储不可用, 调用方应展示手动刷新按钮。
 */
export const tryAutoReloadForChunkError = (): boolean => {
    let allowed = false;
    try {
        const last = parseInt(sessionStorage.getItem(RELOAD_MARK_KEY) || '0', 10) || 0;
        allowed = Date.now() - last >= RELOAD_COOLDOWN_MS;
        if (allowed) sessionStorage.setItem(RELOAD_MARK_KEY, String(Date.now()));
    } catch {
        // sessionStorage 不可用时没法防刷新循环 → 不自动刷, 走手动按钮兜底
        allowed = false;
    }
    if (!allowed) return false;
    window.location.reload();
    return true;
};
