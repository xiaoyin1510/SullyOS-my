import { describe, it, expect, vi } from 'vitest';
import { ActiveMsgStore } from './activeMsgStore';
import type { InstantPushReasoningBufferEntry } from '../types';

// fake-indexeddb 已通过 test-setup.ts 自动注入. activeMsgStore.openDB 每次
// 调都新开连接且不关, 跨测试 deleteDatabase 会被 block — 改用每个 case 唯一
// sessionId 隔离 (生产代码本来就按 sessionId keying 的, 无副作用).

let _sid = 0;
const uniqueSid = (label: string) => `${label}-${++_sid}-${Date.now()}`;

// 直接 put 老格式 record (绕过 ActiveMsgStore.saveReasoning 路径,
// 模拟 SW ≤1.5.2 写过的扁平形态).
async function rawPutReasoning(record: InstantPushReasoningBufferEntry): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('ActiveMsg', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('reasoning_buffer')) {
        d.createObjectStore('reasoning_buffer', { keyPath: 'sessionId' });
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox', { keyPath: 'messageId' });
      if (!d.objectStoreNames.contains('outbound_sessions')) d.createObjectStore('outbound_sessions', { keyPath: 'sessionId' });
      if (!d.objectStoreNames.contains('pending_tool_calls')) d.createObjectStore('pending_tool_calls', { keyPath: 'sessionId' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('reasoning_buffer', 'readwrite');
    tx.objectStore('reasoning_buffer').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('ActiveMsgStore reasoning chunking', () => {
  it('G1 saveReasoning + claimReasoning 单 chunk', async () => {
    const sid = uniqueSid('g1');
    await ActiveMsgStore.saveReasoning({
      sessionId: sid,
      charId: 'c1',
      chunks: [{ messageIndex: 1, chunkIndex: 1, reasoningContent: 'A' }],
      receivedAt: Date.now(),
    });
    const r = await ActiveMsgStore.claimReasoning(sid);
    expect(r).not.toBeNull();
    expect(r?.reasoningContent).toBe('A');
  });

  it('G5 claimReasoning 多 chunk 按 (messageIndex, chunkIndex) 排序拼接', async () => {
    const sid = uniqueSid('g5');
    await ActiveMsgStore.saveReasoning({
      sessionId: sid,
      charId: 'c1',
      chunks: [
        { messageIndex: 2, chunkIndex: 1, reasoningContent: 'X' },
        { messageIndex: 1, chunkIndex: 2, reasoningContent: 'B' },
        { messageIndex: 1, chunkIndex: 1, reasoningContent: 'A' },
      ],
      receivedAt: Date.now(),
    });
    const r = await ActiveMsgStore.claimReasoning(sid);
    expect(r?.reasoningContent).toBe('ABX'); // sort: (1,1)=A, (1,2)=B, (2,1)=X
  });

  it('G6 claim 后 store 被删 (后续 claim 返 null)', async () => {
    const sid = uniqueSid('g6');
    await ActiveMsgStore.saveReasoning({
      sessionId: sid,
      charId: 'c1',
      chunks: [{ messageIndex: 1, chunkIndex: 1, reasoningContent: 'A' }],
      receivedAt: Date.now(),
    });
    await ActiveMsgStore.claimReasoning(sid);
    const second = await ActiveMsgStore.claimReasoning(sid);
    expect(second).toBeNull();
  });

  it('G7 legacy 扁平 row 兼容 (没 chunks 字段)', async () => {
    const sid = uniqueSid('g7');
    await rawPutReasoning({
      sessionId: sid,
      charId: 'c1',
      reasoningContent: 'OLD_CONTENT',
      receivedAt: Date.now(),
    } as InstantPushReasoningBufferEntry);

    const r = await ActiveMsgStore.claimReasoning(sid);
    expect(r?.reasoningContent).toBe('OLD_CONTENT');
  });

  it('claim 不存在的 sessionId 返 null', async () => {
    const sid = uniqueSid('missing');
    expect(await ActiveMsgStore.claimReasoning(sid)).toBeNull();
  });

  it('clearReasoning 删除 buffer entry', async () => {
    const sid = uniqueSid('clear');
    await ActiveMsgStore.saveReasoning({
      sessionId: sid,
      charId: 'c1',
      chunks: [{ messageIndex: 1, chunkIndex: 1, reasoningContent: 'A' }],
      receivedAt: Date.now(),
    });
    await ActiveMsgStore.clearReasoning(sid);
    expect(await ActiveMsgStore.claimReasoning(sid)).toBeNull();
  });

  it('clearReasoning 空 sessionId 静默 no-op', async () => {
    await expect(ActiveMsgStore.clearReasoning('')).resolves.toBeUndefined();
  });

  it('连接复用: 单例建立后后续操作不再新开 indexedDB 连接', async () => {
    // 先跑一次确保单例已建立 (前面的用例多半已经建立, 这里幂等)。
    await ActiveMsgStore.getGlobalConfig();
    const openSpy = vi.spyOn(indexedDB, 'open');
    try {
      await ActiveMsgStore.getGlobalConfig();
      await ActiveMsgStore.listInboxMessages();
      await ActiveMsgStore.consumeInboxMessages();
      // 修复前: 3 个操作 = 3 次 open。修复后: 复用单例, 0 次。
      expect(openSpy).not.toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
    }
  });

  it('多 sessionId 互相隔离', async () => {
    const a = uniqueSid('iso-a');
    const b = uniqueSid('iso-b');
    await ActiveMsgStore.saveReasoning({
      sessionId: a,
      charId: 'c1',
      chunks: [{ messageIndex: 1, chunkIndex: 1, reasoningContent: 'A' }],
      receivedAt: Date.now(),
    });
    await ActiveMsgStore.saveReasoning({
      sessionId: b,
      charId: 'c2',
      chunks: [{ messageIndex: 1, chunkIndex: 1, reasoningContent: 'B' }],
      receivedAt: Date.now(),
    });
    await ActiveMsgStore.clearReasoning(a);
    expect(await ActiveMsgStore.claimReasoning(a)).toBeNull();
    expect((await ActiveMsgStore.claimReasoning(b))?.reasoningContent).toBe('B');
  });
});
