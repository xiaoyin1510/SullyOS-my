/// <reference lib="WebWorker" />

import { installReiSW } from '@rei-standard/amsg-sw';

/**
 * SW_VERSION: 改 SW 实质行为时（push handler / message protocol / 通知策略 / IDB 升级）
 * 手工 bump。前端 BuildBadge 通过 GET_SW_VERSION postMessage 协议读取并显示，
 * 也作为 source-bytes-changed 的 cache buster 让浏览器 24h SW 缓存绕过去。
 *
 * 历史：
 *  - 1.0.0: 初版 ActiveMsg 2.0 push + keep-alive
 *  - 1.1.0: 加 BuildBadge SW 版本协议 + 文案通用化
 *  - 1.2.0: iOS 前台跳过 showNotification
 *  - 1.3.0: 测试推送 metadata.test 强制弹通知
 *  - 1.4.0: Phase 2 Round 1 — ActiveMsg IDB v1→v2 (加 outbound_sessions /
 *           pending_tool_calls / reasoning_buffer 三个 store), 上线后老 SW 不升级
 *           会因为 VersionError 丢推送, 必须 bump 触发字节比较 + 重装。
 *  - 1.5.0: Phase 2 Round 2 — push handler 按 messageKind 分轨
 *           (content / reasoning / tool_request / error), 处理 _blob envelope,
 *           tool_request 按 visibility 决定 postMessage 或 showNotification。
 *  - 1.5.1: saveContentToInbox 兼容 directive-only push (body 空但 metadata.directives
 *           非空, e.g. LLM 只输出 [[ACTION:POKE]] 时), 不再 early-return 漏掉副作用.
 *  - 1.5.2: saveContentToInbox gate 化简到只看 charId — directive-only / 空 payload
 *           都信任 worker 契约, 不在 SW 二次验证, 行为更可预测.
 *  - 1.6.0: amsg-instant 升 0.8.0-next.2, ReasoningPush 自动按字节切多 push.
 *           saveReasoningToBuffer 改累积式 (chunks[] 数组, read-modify-write),
 *           按 (messageIndex, chunkIndex) 保留每个分片, 主线程 claimReasoning
 *           取出时排序拼接. savePendingToolCall 之前清空同 sessionId 的 reasoning
 *           buffer — 镜像主应用 `data = newResponse` 的"只保留最后一轮 reasoning"
 *           行为, 避免 agentic loop 跨轮污染.
 *  - 1.7.0: content push 在没有可见 client 时补一条系统通知（当时由应用层实现）。
 *           之前只有 tool_request 弹通知, content (含写日记的 directive 回复) 关浏览器 /
 *           后台冻结时零通知 — 用户不知道要回前台, inbox 不 flush, 客户端副作用 (写 Notion)
 *           永远不跑. 与 tool_request 同策略: 有可见 client 交给 in-app UI, 否则系统通知.
 *  - 1.9.0: 升级 amsg-sw 2.1.0-next.2，由插件接管 _multipart 透明重组。
 *           删除了应用层的 reasoning chunking 逻辑，现收到完整 reasoningContent。
 *           content 通知兜底也交给 amsg-sw，应用层只负责写 inbox / tool / emotion。
 *           修复了在应用关闭期间收到分片推送丢失的问题（通过 notificationclick 恢复及前台拦截 REI_AMSG_PUSH）。
 *  - 1.9.1: 升级 amsg-sw 2.1.1，沿用插件侧 multipart 同 id 串行锁和标准通知标题 fallback。
 *  - 1.10.0: saveReasoningToBuffer 写完后 notifyClients('active-msg-reasoning')，让主线程在
 *           "content 抢先于 reasoning 落库" 的竞态下把思维链回填到已存的首条回复上，
 *           修复 instant 模式弱网/移动端思维链(心象)间歇丢失。
 *  - 1.10.1: 合并 1.10.0 思维链回填修复与 ReiStandard amsg-sw 2.1.1 升级。
 *  - 1.11.0: 加 process-sse-payload message 协议，SSE 直达 payload 也复用同一套
 *           ActiveMsg inbox / tool / emotion 路由。
 *  - 1.12.0: SSE 直达 payload 经 MessageChannel 回 ack，前台据此确认 SW 是否
 *           收下（含去重命中）。
 *  - 1.13.0: 接入 amsg-sw 通用 REI_AMSG_DELIVER + delivery dedupe。SSE bridge
 *           和 WebPush backup 统一在包层 showNotification 前去重。
 *  - 1.14.0: 升级 amsg-sw dedupe 语义：去重记录区分业务处理与通知展示，
 *           SSE-first 且前台未展示通知时，WebPush backup 可在隐藏态只补通知。
 */
const SW_VERSION = '1.14.0';

const PING_INTERVAL = 15_000;
const MAX_MANUAL_ALIVE_MS = 5 * 60_000;
const ACTIVE_MSG_DB_NAME = 'ActiveMsg';
// MUST be kept in sync with utils/activeMsgStore.ts:DB_VERSION. Phase 2 Round 1 bumped to 2 to add
// outbound_sessions / pending_tool_calls / reasoning_buffer stores. SW only reads/writes `inbox`,
// but if SW pins a lower version while main thread is on v2, SW's open() will throw VersionError
// and push messages will be silently dropped.
const ACTIVE_MSG_DB_VERSION = 2;
const ACTIVE_MSG_INBOX_STORE = 'inbox';
const ACTIVE_MSG_OUTBOUND_SESSIONS_STORE = 'outbound_sessions';
const ACTIVE_MSG_PENDING_TOOL_CALLS_STORE = 'pending_tool_calls';
const ACTIVE_MSG_REASONING_BUFFER_STORE = 'reasoning_buffer';

let pingTimer: number | null = null;
let manualKeepAliveCount = 0;
let manualKeepAliveStartedAt = 0;

const proactiveSchedules = new Map<string, { charId: string; intervalMs: number }>();
const proactiveTimers = new Map<string, number>();

const sw = self as unknown as ServiceWorkerGlobalScope;

installReiSW(sw, {
  defaultIcon: './icons/icon-192.png',
  defaultBadge: './icons/icon-192.png',
  multipart: { enabled: true },
  onBusinessPayload: async (payload: any) => {
    await saveIncomingActiveMessage(payload);
  },
});

function hasActiveProactiveSchedules() {
  return proactiveTimers.size > 0;
}

function shouldKeepAlive() {
  return manualKeepAliveCount > 0 || hasActiveProactiveSchedules();
}

function stopPingLoop() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function ensurePingLoop() {
  if (pingTimer) return;

  pingTimer = setInterval(() => {
    if (manualKeepAliveCount > 0 && Date.now() - manualKeepAliveStartedAt > MAX_MANUAL_ALIVE_MS) {
      manualKeepAliveCount = 0;
      manualKeepAliveStartedAt = 0;
    }

    if (!shouldKeepAlive()) {
      stopPingLoop();
      return;
    }

    sw.registration.active?.postMessage({ type: 'ping' });
  }, PING_INTERVAL) as unknown as number;
}

function refreshKeepAlive() {
  if (shouldKeepAlive()) ensurePingLoop();
  else stopPingLoop();
}

function startKeepAlive() {
  manualKeepAliveCount += 1;
  if (!manualKeepAliveStartedAt) manualKeepAliveStartedAt = Date.now();
  refreshKeepAlive();
}

function stopKeepAlive() {
  if (manualKeepAliveCount > 0) manualKeepAliveCount -= 1;
  if (manualKeepAliveCount === 0) manualKeepAliveStartedAt = 0;
  refreshKeepAlive();
}

async function notifyClients(data: Record<string, any>) {
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(data);
  }
}

function fireProactiveTrigger(charId: string) {
  void notifyClients({ type: 'proactive-trigger', charId });
}

function stopProactive(charId: string) {
  const timer = proactiveTimers.get(charId);
  if (timer) {
    clearInterval(timer);
    proactiveTimers.delete(charId);
  }
  proactiveSchedules.delete(charId);
}

function upsertProactive(config: { charId: string; intervalMs: number }) {
  const prev = proactiveSchedules.get(config.charId);
  const unchanged = prev && prev.intervalMs === config.intervalMs;
  if (unchanged && proactiveTimers.has(config.charId)) return;

  stopProactive(config.charId);
  proactiveSchedules.set(config.charId, config);

  const timer = setInterval(() => fireProactiveTrigger(config.charId), config.intervalMs) as unknown as number;
  proactiveTimers.set(config.charId, timer);
}

function syncProactive(configs: Array<{ charId: string; intervalMs: number }>) {
  const nextIds = new Set((configs || []).map((config) => config.charId));

  for (const charId of Array.from(proactiveSchedules.keys())) {
    if (!nextIds.has(charId)) stopProactive(charId);
  }

  for (const config of configs || []) {
    if (config && config.charId && config.intervalMs > 0) {
      upsertProactive(config);
    }
  }

  refreshKeepAlive();
}

function readPushPayload(event: PushEvent): any | null {
  if (!event.data) return null;

  try {
    return event.data.json();
  } catch {
    try {
      return { message: event.data?.text() };
    } catch {
      return null;
    }
  }
}

function openInboxDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ACTIVE_MSG_DB_NAME, ACTIVE_MSG_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      // Main thread or another SW connection holds the DB at a lower version and isn't closing.
      // Push will fail to persist; reject rather than hang forever so event.waitUntil unblocks.
      reject(new Error('IndexedDB open blocked (older version still open elsewhere)'));
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ACTIVE_MSG_INBOX_STORE)) {
        db.createObjectStore(ACTIVE_MSG_INBOX_STORE, { keyPath: 'messageId' });
      }
      // Phase 2 Round 1: additive schema for agentic-loop / reasoning correlation. SW only writes
      // `inbox` today, but it must own the schema for these stores so it can fire its own upgrade
      // (and so an SW-first-install can still create them without main thread being open).
      if (!db.objectStoreNames.contains(ACTIVE_MSG_OUTBOUND_SESSIONS_STORE)) {
        db.createObjectStore(ACTIVE_MSG_OUTBOUND_SESSIONS_STORE, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(ACTIVE_MSG_PENDING_TOOL_CALLS_STORE)) {
        db.createObjectStore(ACTIVE_MSG_PENDING_TOOL_CALLS_STORE, { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains(ACTIVE_MSG_REASONING_BUFFER_STORE)) {
        db.createObjectStore(ACTIVE_MSG_REASONING_BUFFER_STORE, { keyPath: 'sessionId' });
      }
    };
  });
}

// ─── content / inbox (kind=content 老路径, tool_request 的 prefix 也走这里) ───

async function saveContentToInbox(payload: any) {
  const charId = payload?.metadata?.charId;
  const charName = payload?.contactName || payload?.metadata?.charName || '主动消息';
  const body = String(payload?.message || payload?.body || '').trim();
  const notificationBody = typeof payload?.notification?.body === 'string'
    ? payload.notification.body.trim()
    : '';
  const previewBody = notificationBody || body;
  const messageId = String(payload?.messageId || `${charId || 'unknown'}-${Date.now()}`);
  const payloadTimestamp = payload?.timestamp;
  const parsedSentAt = payloadTimestamp ? new Date(payloadTimestamp).getTime() : NaN;
  const sentAt = Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now();

  // 唯一不可恢复的是没 charId — 没法路由, 直接丢. 其它形态都接受:
  //   - body 非空 + directives 空 = 普通 content push (老路径)
  //   - body 非空 + directives 非空 = content + 副作用混合 push
  //   - body 空 + directives 非空 = directive-only push (LLM 只输 [[ACTION:POKE]] 等)
  //   - body 空 + directives 空 = worker bug 推白条 → 写一条空 entry, flushInbox 跑空管线无害,
  //     最多让 OSContext 弹一句默认 toast. 这种 case 应该在 worker 端修, SW 不二次验证契约.
  if (!charId) return;

  const db = await openInboxDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_MSG_INBOX_STORE, 'readwrite');
    tx.objectStore(ACTIVE_MSG_INBOX_STORE).put({
      messageId,
      charId,
      charName,
      body,
      previewBody,
      avatarUrl: payload?.avatarUrl,
      source: payload?.source,
      messageType: payload?.messageType,
      messageSubtype: payload?.messageSubtype,
      taskId: payload?.taskId ?? null,
      // sessionId / messageIndex 放到 metadata 里, 主线程 flushInboxToChat 反查 reasoning_buffer
      // + 标记是第几条 (第 1 条才挂 metadata.thinkingChain).
      metadata: {
        ...(payload?.metadata || {}),
        sessionId: payload?.sessionId,
        messageIndex: payload?.messageIndex,
        totalMessages: payload?.totalMessages,
      },
      sentAt,
      receivedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await notifyClients({
    type: 'active-msg-received',
    charId,
    charName,
    body: previewBody,
    avatarUrl: payload?.avatarUrl,
    sentAt,
  });
}

// ─── reasoning_buffer (kind=reasoning, 主线程 claim) ─────────────────────────

async function saveReasoningToBuffer(payload: any) {
  const sessionId: string | undefined = payload?.sessionId;
  const charId: string | undefined = payload?.metadata?.charId;
  const reasoningContent: string = String(payload?.reasoningContent ?? '');
  if (!sessionId || !charId || !reasoningContent) return;

  const db = await openInboxDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_MSG_REASONING_BUFFER_STORE, 'readwrite');
    const store = tx.objectStore(ACTIVE_MSG_REASONING_BUFFER_STORE);
    store.put({
      sessionId,
      charId,
      reasoningContent,
      receivedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('reasoning buffer write aborted'));
  });

  // reasoning push 与 content push 是两条独立 Web Push, 到达/处理顺序不保证. 主线程只在处理
  // "首条 content" 时 claimReasoning, 若 content 抢先落库, reasoning 会变孤儿、思维链丢失.
  // 这里写完 buffer 立刻通知主线程: 若该 session 首条回复已落库就把思维链回填上去 (见
  // activeMsgRuntime 'active-msg-reasoning' 处理); 若 content 还没到则是 no-op, 等正常 claim.
  await notifyClients({ type: 'active-msg-reasoning', sessionId, charId });
}

/**
 * 清空同 sessionId 的 reasoning_buffer.
 * 镜像主应用 `applyAssistantPostProcessing` 跨 LLM round 的 `data = newResponse` 覆盖语义:
 * 早期 round 的 reasoning (工具规划阶段的内心戏) 不应混入最终一轮的 thinking chain.
 */
async function clearReasoningBuffer(sessionId: string) {
  if (!sessionId) return;
  const db = await openInboxDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_MSG_REASONING_BUFFER_STORE, 'readwrite');
    tx.objectStore(ACTIVE_MSG_REASONING_BUFFER_STORE).delete(sessionId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('reasoning buffer clear aborted'));
  });
}

// ─── pending_tool_calls (kind=tool_request, 主线程 runner 跑) ────────────────

async function savePendingToolCall(payload: any) {
  const sessionId: string | undefined = payload?.sessionId;
  const charId: string | undefined = payload?.metadata?.charId;
  const toolCalls = Array.isArray(payload?.toolCalls) ? payload.toolCalls : [];
  if (!sessionId || !charId || toolCalls.length === 0) return;

  // 进入新 LLM round 前清空老 reasoning — 这一轮的 reasoning 是"工具规划"性质,
  // 不属于最终给用户看的 thinking chain. claimReasoning 永远只读到最后一轮的 chunks.
  await clearReasoningBuffer(sessionId).catch((e) => {
    console.warn('[amsg] clearReasoningBuffer before tool_request failed', e);
  });

  // iteration 来自 worker hook metadata.iteration (Round 2 worker 一定带), 兜底 0 防老 worker.
  // 客户端 /continue 时取它 + 1; 多轮 tool 链路里 iteration 单调递增, worker 也按它做 fail-fast 400.
  const iteration = Number.isFinite(payload?.metadata?.iteration) ? Number(payload.metadata.iteration) : 0;

  const db = await openInboxDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_MSG_PENDING_TOOL_CALLS_STORE, 'readwrite');
    tx.objectStore(ACTIVE_MSG_PENDING_TOOL_CALLS_STORE).put({
      sessionId,
      charId,
      toolCalls,
      llmOutputText: String(payload?.message || ''),
      iteration,
      createdAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function notifyVisibleClientForToolRequest(payload: any) {
  // 找一个 visible window: 在线 visible → postMessage 让 main 立即跑 runner.
  // 否则展示通知, 让用户点开应用; 启动时 ActiveMsgRuntime.init 会消费 pending_tool_calls.
  const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visibleClient = clients.find((c) => (c as WindowClient).visibilityState === 'visible');

  if (visibleClient) {
    visibleClient.postMessage({
      type: 'instant-tool-request',
      sessionId: payload?.sessionId,
      charId: payload?.metadata?.charId,
    });
    return;
  }

  const charName = payload?.contactName || payload?.metadata?.charName || '主动消息';
  const preview = String(payload?.message || '').slice(0, 40);
  try {
    await sw.registration.showNotification(charName, {
      body: preview ? `${preview}…  (点开继续)` : '我想查点东西，点开继续',
      icon: payload?.avatarUrl || './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { payload, kind: 'tool_request' },
      tag: `instant-tool-${payload?.sessionId}`,
    });
  } catch (e) {
    console.warn('[amsg] tool_request notification failed', e);
  }
}

// emotion_update push: worker 跑完副 API 情绪评估后推回的 buff 结果. 静默写进 inbox (不弹通知、
// 不计未读), 客户端 flushInboxToChat 看到 messageType==='emotion_update' 时调 applyEmotionEvalRaw
// 落 buff + 广播 innerState, 不渲染成聊天消息. notifyClients 仅用来触发一次 flush (前台时立即落 buff;
// 后台时 postMessage 排队/丢弃, 回前台 visibilitychange flush 兜底).
async function saveEmotionUpdateToInbox(payload: any) {
  const charId = payload?.metadata?.charId;
  // emotionRaw 允许为空: worker 评估失败/返回空时也会推一条 "done" 信号 (emotionRaw=''),
  // 仍需写 inbox + notify, 让客户端 flush 时 fire 'instant-emotion-done' 熄灭 "情绪分析中" 徽章.
  const emotionRaw = payload?.metadata?.emotionRaw || '';
  if (!charId) return;
  const messageId = String(payload?.messageId || `${charId}-emotion-${Date.now()}`);

  const db = await openInboxDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTIVE_MSG_INBOX_STORE, 'readwrite');
    tx.objectStore(ACTIVE_MSG_INBOX_STORE).put({
      messageId,
      charId,
      charName: payload?.contactName || '',
      body: '',
      messageType: 'emotion_update',
      metadata: { charId, emotionRaw },
      sentAt: Date.now(),
      receivedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  // 触发客户端 flush (不带真实内容, 客户端 flush 时按 messageType 静默处理). 不 showNotification.
  await notifyClients({ type: 'active-msg-received', charId, charName: payload?.contactName || '', body: '', emotionUpdate: true });
}


// ─── _blob envelope (fetch real body, recurse) ───────────────────────────────

async function fetchBlobEnvelope(payload: any): Promise<any | null> {
  const url = payload?.url;
  if (typeof url !== 'string' || !url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('[amsg] blob fetch returned', res.status, url);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[amsg] blob fetch failed', url, e);
    return null;
  }
}

// ─── 路由总入口 ──────────────────────────────────────────────────────────────

async function saveIncomingActiveMessage(payload: any) {
  // 1. blob envelope: 真正 body 在 BlobStore 里, fetch 出来后用 body 继续路由.
  // 重投递的 dedup 由主线程处理 (consumePendingToolCalls / inbox 都是原子 claim).
  if (payload?._blob === true) {
    const real = await fetchBlobEnvelope(payload);
    if (!real) return;
    return saveIncomingActiveMessage(real);
  }

  // 2. 按 messageKind 分轨; 兜底: 老 worker (0.6.x) 推过来的没 messageKind 字段, 当 content 处理.
  const messageKind: string = payload?.messageKind ?? 'content';

  switch (messageKind) {
    case 'content':
      await saveContentToInbox(payload);
      return;

    case 'reasoning':
      await saveReasoningToBuffer(payload);
      return;

    case 'emotion_update':
      await saveEmotionUpdateToInbox(payload);
      return;

    case 'tool_request':
      await savePendingToolCall(payload);
      // tool_request 也可能带 prefix (worker hook 把数据标签前的 narration 放进 message),
      // 走 content 路径让前置 narration 立刻显示 + 触发 applyAssistantPostProcessing 走副作用.
      if (payload?.message) await saveContentToInbox(payload);
      await notifyVisibleClientForToolRequest(payload);
      return;

    case 'error':
      // 诊断 push: 不写 inbox, 不弹通知, 仅 log + 通知任意 visible client 把 error 渲染到 toast.
      console.error('[amsg] error push', payload?.code, payload?.message);
      await notifyClients({
        type: 'active-msg-error',
        code: payload?.code,
        message: payload?.message,
        charId: payload?.metadata?.charId,
      });
      return;

    default:
      console.warn('[amsg] unknown messageKind, falling back to content', messageKind);
      await saveContentToInbox(payload);
  }
}

// 之前我们自己写 sw.addEventListener('push')，现在全量交由 amsg-sw 的 installReiSW 
// 在 onBusinessPayload 里回调，所以这里不再需要手写 push 监听。

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  const payload = event.notification.data?.payload || event.notification.data || {};
  const charId = payload?.metadata?.charId || payload?.charId || '';
  event.notification.close();

  event.waitUntil((async () => {
    const clients = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      const client = clients[0];
      await client.focus();
      client.postMessage({ type: 'active-msg-open', charId });
      return;
    }

    const openUrl = new URL(sw.registration.scope || sw.location.origin);
    openUrl.searchParams.set('openApp', 'chat');
    if (charId) openUrl.searchParams.set('activeMsgCharId', charId);
    await sw.clients.openWindow(openUrl.toString());
  })());
});

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { type } = event.data || {};

  switch (type) {
    case 'GET_SW_VERSION':
      // BuildBadge 通过 MessageChannel + port 协议查询；不响应时 BuildBadge 显示 sw@?
      event.ports[0]?.postMessage({ version: SW_VERSION });
      break;
    case 'keepalive-start':
      startKeepAlive();
      break;
    case 'keepalive-stop':
      stopKeepAlive();
      break;
    case 'proactive-start':
      if (event.data.config) {
        syncProactive([...proactiveSchedules.values(), event.data.config]);
      }
      break;
    case 'proactive-stop':
      if (event.data.charId) {
        stopProactive(event.data.charId);
        refreshKeepAlive();
      } else {
        syncProactive([]);
      }
      break;
    case 'proactive-sync':
      syncProactive(event.data.configs || []);
      break;
  }
});

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim());
});
