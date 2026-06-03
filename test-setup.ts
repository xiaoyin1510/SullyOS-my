/**
 * vitest 全局 setup — 为 Node 环境补齐浏览器 API.
 *  - fake-indexeddb/auto: 把 indexedDB / IDBKeyRange 等挂到 globalThis,
 *    让 activeMsgStore.ts 在 Node 里能直接跑.
 *  - localStorage stub: instantPushClient.ts 在模块加载时不读 localStorage,
 *    但运行时调 loadInstantConfig() 会读, 给最简易 in-memory 实现.
 */

import 'fake-indexeddb/auto';

class MemStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  get length() { return this.store.size; }
}

if (typeof (globalThis as any).localStorage === 'undefined') {
  (globalThis as any).localStorage = new MemStorage();
}
