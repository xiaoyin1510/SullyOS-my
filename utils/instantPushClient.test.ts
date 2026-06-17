import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendInstantPush,
  saveInstantConfig,
  INSTANT_PUSH_CONFIG_KEY,
  probeInstantWorkerCapabilities,
  postSsePayloadToServiceWorker,
  buildDenoLoaderSnippet,
} from './instantPushClient';
import type { InstantPushPayload } from './instantPushClient';
import { savePushVapid } from './pushVapid';

// 测 splitPattern 注入到 request body 外层 — 这是 amsg-instant 0.8.0-next.2
// 用来禁默认按句切的唯一正确位置 (放 hook 返回的 pushPayload 上是 no-op).

function setupValidConfig(): void {
  // pushVapid: vapidPublicKey.length 必须 > 60
  savePushVapid({
    vapidPublicKey: 'BIfakeVapidKeyForTestingMustBeOver60CharactersLongAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    vapidPrivateKey: 'private-stub',
  });
  saveInstantConfig({
    enabled: true,
    workerUrl: 'https://worker.example.com',
  });
}

function clearConfig(): void {
  try {
    localStorage.removeItem(INSTANT_PUSH_CONFIG_KEY);
    localStorage.removeItem('push_vapid_v1');
  } catch {}
}

function basePayload(): InstantPushPayload {
  return {
    contactName: 'TestChar',
    apiUrl: 'https://api.example.com',
    apiKey: 'k',
    primaryModel: 'm',
    pushSubscription: {
      endpoint: 'https://push.example.com/e',
      keys: { p256dh: 'p', auth: 'a' },
    },
    completePrompt: 'hi',
  };
}

describe('sendInstantPush splitPattern injection', () => {
  beforeEach(() => {
    clearConfig();
    setupValidConfig();
    // 替换全局 fetch 抓 body
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['cf-ray', 'test']]) as any,
      text: async () => '{"success":true}',
    } as any);
  });

  it('0.8+ 不再注入 splitPattern, payload 直接 stringify', async () => {
    await sendInstantPush(basePayload());
    expect(fetch).toHaveBeenCalled();
    const callArgs = vi.mocked(fetch).mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    // amsg-instant 0.8+ splitPattern 字段被服务端拒收, 客户端也不再带
    expect(body.splitPattern).toBeUndefined();
  });

  it('默认把大包策略声明为 multipart', async () => {
    await sendInstantPush(basePayload());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.oversizeTransport).toBe('multipart');
  });

  it('开启 D1 开关时把大包策略声明为 d1', async () => {
    saveInstantConfig({
      enabled: true,
      workerUrl: 'https://worker.example.com',
      useD1BlobStore: true,
      d1Available: true,
      d1CheckedWorkerUrl: 'https://worker.example.com',
    });
    await sendInstantPush(basePayload());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.oversizeTransport).toBe('d1');
  });

  it('其他字段不受影响 (verify payload 形状没改)', async () => {
    await sendInstantPush(basePayload());
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.contactName).toBe('TestChar');
    expect(body.apiUrl).toBe('https://api.example.com');
    expect(body.completePrompt).toBe('hi');
    expect(body.pushSubscription).toEqual({
      endpoint: 'https://push.example.com/e',
      keys: { p256dh: 'p', auth: 'a' },
    });
  });
});

describe('probeInstantWorkerCapabilities', () => {
  beforeEach(() => {
    clearConfig();
    setupValidConfig();
  });

  it('读取 worker 返回的 D1 能力', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        success: true,
        data: {
          multipart: { available: true },
          d1: { available: true },
        },
      }),
    } as any);

    const result = await probeInstantWorkerCapabilities();
    expect(result.ok).toBe(true);
    expect(result.d1Available).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://worker.example.com/capabilities',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

// postSsePayloadToServiceWorker: amsg-sw 2.3.0+ 的 ack 在落库失败时回 { ok:true, businessError }。
// 这里用最小 stub 模拟 SW 回 ack, 锁住 businessError 被正确透传 (而不是被吞回一个干净的 true)。
describe('postSsePayloadToServiceWorker ack 解析', () => {
  // node 环境没有这些浏览器全局 (且 navigator 是只读 getter), 用 vi.stubGlobal 注入,
  // afterEach 一并 unstub 还原, 避免污染其它用例。
  let ackToReturn: any;

  class FakePort {
    onmessage: ((e: any) => void) | null = null;
    peer: FakePort | null = null;
    postMessage(data: any) {
      const peer = this.peer;
      if (peer) Promise.resolve().then(() => peer.onmessage?.({ data }));
    }
    close() {}
  }
  class FakeMessageChannel {
    port1 = new FakePort();
    port2 = new FakePort();
    constructor() {
      this.port1.peer = this.port2;
      this.port2.peer = this.port1;
    }
  }

  beforeEach(() => {
    vi.stubGlobal('MessageChannel', FakeMessageChannel);
    vi.stubGlobal('window', {
      setTimeout: setTimeout.bind(globalThis),
      clearTimeout: clearTimeout.bind(globalThis),
    });
    // controller 收到投递后, 在被转移的 port (port2) 上回 ack —— 路由到 client 的 port1.onmessage。
    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {
          postMessage: (_msg: any, transfer: any[]) => {
            const port2 = transfer?.[0] as FakePort;
            port2?.postMessage(ackToReturn);
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('落库失败: ack ok:true + businessError 被透传, 不被吞成干净的 true', async () => {
    ackToReturn = { ok: true, businessError: 'inbox write failed: QuotaExceededError' };
    const res = await postSsePayloadToServiceWorker({ messageId: 'm1' });
    expect(res.ok).toBe(true);
    expect(res.businessError).toBe('inbox write failed: QuotaExceededError');
  });

  it('正常落库: ack ok:true 无 businessError', async () => {
    ackToReturn = { ok: true };
    const res = await postSsePayloadToServiceWorker({ messageId: 'm2' });
    expect(res.ok).toBe(true);
    expect(res.businessError).toBeUndefined();
  });

  it('无 controller 时返回 { ok:false }', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
    const res = await postSsePayloadToServiceWorker({ messageId: 'm3' });
    expect(res.ok).toBe(false);
    expect(res.businessError).toBeUndefined();
  });
});

describe('buildDenoLoaderSnippet', () => {
  it('生成的片段: module 标记 + SITE 常量 + fetch 文本 + data: URL import', () => {
    const snippet = buildDenoLoaderSnippet('https://example.com/');
    expect(snippet).toContain('export {};');
    expect(snippet).toContain('const SITE = "https://example.com/";');
    expect(snippet).toContain('fetch(`${SITE}instant-worker.deno.bundle.js`, { cache: "no-store" })');
    expect(snippet).toContain('await import(`data:application/javascript;charset=utf-8,${encodeURIComponent(code)}`);');
  });

  it('site 缺尾斜杠时自动补齐, 避免拼出错误 URL', () => {
    const snippet = buildDenoLoaderSnippet('https://example.com/sully');
    expect(snippet).toContain('const SITE = "https://example.com/sully/";');
  });
});
