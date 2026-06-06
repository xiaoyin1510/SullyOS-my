import { describe, it, expect, vi } from 'vitest';
import { DB, openDB } from './db';

// fake-indexeddb 已通过 test-setup.ts 注入。这组用例锁住「单例连接复用」这条修复:
// 修复前 openDB 每次调用都 indexedDB.open() 新开一条连接 (a !== b, 且每个 DB 操作
// 都触发一次 open) —— 在记忆管线并发下堆出几十条连接撑爆 backing store。修复后复用
// 同一条连接。

describe('openDB 单例连接复用', () => {
  it('多次 openDB 返回同一条连接 (不再每次新开)', async () => {
    const a = await openDB();
    const b = await openDB();
    expect(a).toBe(b);
  });

  it('连续 DB 操作复用已缓存连接, 不再触发新的 indexedDB.open', async () => {
    await openDB(); // 确保单例已建立 (幂等)
    const openSpy = vi.spyOn(indexedDB, 'open');
    try {
      await DB.getAllCharacters();
      await DB.getAllCharacters();
      await DB.getAllCharacters();
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });
});

// 单例只解决「复用」, 还得保证连接被外部失效后能自愈, 否则下次拿到的还是死连接。
// 这里直接触发挂在连接上的 onversionchange / onclose 回调, 验证缓存被清、下次 openDB 重开。
describe('openDB 失效自愈', () => {
  it('onversionchange 触发后 close 让位并清缓存, 下次 openDB 重开新连接', async () => {
    const a = await openDB();
    // 模拟另一个 tab 升级版本时浏览器派发的 versionchange
    (a as unknown as { onversionchange?: (e: Event) => void }).onversionchange?.(new Event('versionchange'));
    const b = await openDB();
    expect(b).not.toBe(a);
  });

  it('onclose 触发后清缓存, 下次 openDB 重开新连接', async () => {
    const a = await openDB();
    // 真实场景: 浏览器是先强制关闭连接、再 fire close 事件。先 close(a) 让 fake-indexeddb
    // 进入"连接已关"的真实状态 (否则 a 会作为一条开着的孤儿连接残留, 拖累后面的删库),
    // 再手动触发我们挂的 onclose 处理器 (它只负责清缓存, 不负责关连接)。
    a.close();
    (a as unknown as { onclose?: (e: Event) => void }).onclose?.(new Event('close'));
    const b = await openDB();
    expect(b).not.toBe(a);
  });

  it('陈旧连接迟到的 onclose 不误清已重开的新单例 (=== promise 守卫)', async () => {
    const a = await openDB();
    // 重开: 触发 a 的 onversionchange (会 close a + 清缓存), 再 openDB 拿到新单例 b
    (a as unknown as { onversionchange?: (e: Event) => void }).onversionchange?.(new Event('versionchange'));
    const b = await openDB();
    expect(b).not.toBe(a);
    // 此刻才迟到触发 a (陈旧连接) 的 onclose —— 不带守卫会把 b 误清成 null，
    // 下次 openDB 凭空多开一条连接 (正是本次要消灭的 churn)。带守卫则 b 保留。
    (a as unknown as { onclose?: (e: Event) => void }).onclose?.(new Event('close'));
    const c = await openDB();
    expect(c).toBe(b);
  });
});

describe('DB.deleteDB', () => {
  it('删库前先关掉单例连接, 不被本页自己的连接 block', async () => {
    await openDB(); // 建立单例连接
    // 修复前: 单例连接一直开着 → deleteDatabase 被 onblocked 卡住, 这里会 hang/超时。
    // 修复后: deleteDB 先 close 单例再删, 正常 resolve。
    await expect(DB.deleteDB()).resolves.toBeUndefined();
  });
});

// blocked-then-unblocked 连接泄漏: onblocked 先 reject, 但底层 open request 还活着 ——
// 占用方关闭后 onsuccess 仍会触发。修复前那条迟到的连接没人持有也没缓存, 开着会 block
// 后续升级/删库; 修复后 settled 守卫让它被 close。这里复现整条链路, 用「事后 deleteDatabase
// 不被 block」来证明孤儿连接确实被关掉了。
describe('openDB blocked-then-unblocked 不泄漏连接', () => {
  it('占用方关闭后迟到的 onsuccess 关掉孤儿连接, 不 block 后续删库', async () => {
    await DB.deleteDB(); // 复位到 version 0, 让下面能从低版本起步

    // 一条 raw 连接占住 v50 且不挂 onversionchange (模拟不肯让位的旧 tab)
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('AetherOS_Data', 50);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

    // openDB 要升到 DB_VERSION(51) → 被 blocker 挡住 → reject
    await expect(openDB()).rejects.toBeTruthy();

    // 放行: 关掉 blocker, 那条挂起的 51-open 会走完 onsuccess (此时 settled=true → 应 close)
    blocker.close();
    await new Promise((r) => setTimeout(r, 50)); // 等事件队列把 onsuccess 跑掉

    // 若孤儿连接没被关, 这里 deleteDatabase 会触发 onblocked → reject; 关掉了则正常 resolve
    await expect(new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase('AetherOS_Data');
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
      del.onblocked = () => reject(new Error('deleteDatabase 被 block —— 有孤儿连接没关闭'));
    })).resolves.toBeUndefined();
  });
});
