/**
 * 家园存在 localStorage 里的本机配置（随「设置 → 导出/导入备份」一起带走）：
 *   - world_home_api：家园全局 API（所有世界共用的覆盖）
 *   - world_custom_styles：用户收藏的自定义文风（跨世界复用）
 * 这两份不在 IndexedDB，所以必须单独走备份，否则换设备 / 导入后会丢。
 */
export const WORLD_API_KEY = 'world_home_api';
export const WORLD_CUSTOM_STYLE_KEY = 'world_custom_styles';

export function exportWorldHomeLocal(): Record<string, string> | undefined {
    try {
        const out: Record<string, string> = {};
        const api = localStorage.getItem(WORLD_API_KEY); if (api) out[WORLD_API_KEY] = api;
        const styles = localStorage.getItem(WORLD_CUSTOM_STYLE_KEY); if (styles) out[WORLD_CUSTOM_STYLE_KEY] = styles;
        return Object.keys(out).length ? out : undefined;
    } catch { return undefined; }
}

export function importWorldHomeLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        if (typeof data[WORLD_API_KEY] === 'string') localStorage.setItem(WORLD_API_KEY, data[WORLD_API_KEY]);
        if (typeof data[WORLD_CUSTOM_STYLE_KEY] === 'string') localStorage.setItem(WORLD_CUSTOM_STYLE_KEY, data[WORLD_CUSTOM_STYLE_KEY]);
    } catch { /* ignore */ }
}
