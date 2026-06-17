import { describe, it, expect, vi, afterEach } from 'vitest';
import { isChunkLoadError, tryAutoReloadForChunkError } from './chunkLoadRecovery';

// 锁住 "Importing a module script failed." 自愈链路:
// iOS Safari standalone PWA 下动态 import 失败会被缓存进模块表, 本页内重试必失败,
// 只有整页 reload 能恢复 — AppErrorBoundary 靠这两个函数识别 + 自动刷新 (带防循环冷却)。

describe('isChunkLoadError', () => {
    it('识别各浏览器的 chunk 加载失败指纹', () => {
        // iOS / macOS Safari (用户报错原文)
        expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
        // Chrome
        expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x.dev/assets/Chat-Ck2f.js'))).toBe(true);
        // Firefox
        expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
        // Vite CSS 依赖预载失败
        expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/Chat-D3xq.css'))).toBe(true);
        // 字符串形态也接受
        expect(isChunkLoadError('Importing a module script failed.')).toBe(true);
    });

    it('普通运行时错误不误判', () => {
        expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
        expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError(undefined)).toBe(false);
        expect(isChunkLoadError(42)).toBe(false);
    });
});

describe('tryAutoReloadForChunkError', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const stubEnv = () => {
        const store = new Map<string, string>();
        const reload = vi.fn();
        vi.stubGlobal('sessionStorage', {
            getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
            setItem: (k: string, v: string) => { store.set(k, String(v)); },
        });
        vi.stubGlobal('window', { location: { reload } });
        return { reload };
    };

    it('首次触发: 记录时间戳并整页刷新', () => {
        const { reload } = stubEnv();
        expect(tryAutoReloadForChunkError()).toBe(true);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('冷却期内再触发: 不再自动刷新 (防循环), 留给手动按钮', () => {
        const { reload } = stubEnv();
        expect(tryAutoReloadForChunkError()).toBe(true);
        expect(tryAutoReloadForChunkError()).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it('sessionStorage 不可用时不自动刷新 (没法防循环)', () => {
        const reload = vi.fn();
        vi.stubGlobal('window', { location: { reload } });
        // 不 stub sessionStorage → 访问抛 ReferenceError → 内部 catch → 不自刷
        expect(tryAutoReloadForChunkError()).toBe(false);
        expect(reload).not.toHaveBeenCalled();
    });
});
