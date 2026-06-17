# Instant Push 双通道契约 —— SSE ≠ 送达判定

> 改 Instant Push 路径前必读。这一份只讲一件事：**SSE 不是送达判定通道**，错把它当判定通道就会复现 2026-06 那次「iOS PWA 收到推送但前端报红错」的 bug。

## TL;DR

worker 端 `amsg-instant` 在 0.9.0+ **强制** `sse.backupPush: 'on'`（`off` / `delayed` 都会被库直接 throw）。意思是同一份 LLM 回复**永远同时走两条通道**：

- **SSE**：前台快通道，POST `/instant` 后流式回 chunk，前端 onPayload 拿到就 forward 给 SW
- **Web Push**：通过 VAPID + 用户的 pushSubscription 推到浏览器 push service → SW 收

SW 端 `amsg-sw` 2.3.0+ 按 `messageId` 在 IndexedDB `rei_amsg_sw_dedupe_v1` / `delivery-dedupe` 里去重，**两路谁先到谁赢，另一条 no-op**。

所以：

> **唯一可信的「送达」信号是 SW 广播的 `active-msg-received` 事件**，不是 SSE 流的 resolve 或 reject。

## 反面教材：2026-06 Miuling iOS 18 PWA bug

### 现象

iOS 18 PWA，online、通知权限给了、SW 活着、~200 条上下文（约 200KB payload）。用户：

- 发消息后切到其他 app 或锁屏
- ~43s 后回来，前端弹红错 `outcome: send-failed, reason: Load failed`
- **但消息后来出现在聊天里**，且 OpenAI 那边扣了费

### 时间线（[devdebug 日志原文](./dev-debug.md)）

| t | 事件 | visibility |
|---|------|-----------|
| 0s | send-start，msgCount 291，~196KB，multipart | visible |
| 0.6s | sse-start | visible |
| **3.65s** | **visibilitychange → hidden**（用户切走） | hidden |
| **43.6s** | **sse-catch: TypeError "Load failed"，waitedMs: 43025** | hidden |
| 43.7s | cleanup → 前端宣告 `send-failed` | hidden |
| **44.15s** | **runtime-inbox-message**（Web Push 经 SW 抵达，距 catch 仅 533ms） | — |
| 44.18s → 55.5s | 10 个 active-msg-received-dispatched + emotion-done | — |

### 根因

1. **iOS 18 Safari WKWebView 在 PWA 进入 hidden 后约 30~45s 会强杀在跑的 fetch**，抛 `TypeError: Load failed`。这是 iOS 的网络栈行为，不是 worker / 网络问题。macOS Safari 不这么干，所以电脑端不复现。
2. **前端 `sendInstantPushAndAwaitReply` 的 catch 把 SSE reject 当总失败抛了**。但 worker 端 `backupPush: 'on'` 一直在并发推 Web Push，push 在 SSE catch 后 **533ms** 就到了 SW —— 消息其实送达了。
3. 「上下文 500 → 报错」/「降到 140 → 不报错」的相关性也由此解释：500 条 payload 大、TTFB 慢，SSE 在 iOS 切后台到 30~45s 之间还没跑完 → 撞上 iOS 寿命；140 条小，SSE 在切后台前就完了 → 不撞。

### 修复（commit `b89dd49`）

前端 catch 不再把 SSE reject 当终态。新的判定流程：

```
            ┌────────────────────────┐
   POST →   │  await Promise.race    │
            │   pushArrived          │ ── 'arrived' ──→ ok, received
            │   streamPromise        │
            │     .then('stream_done')│
            │     .catch(absorb)     │ ── 'stream_done' ──┐
            │   timeout (300s)       │ ── 'timeout' ───→ timeout
            └────────────────────────┘                    │
                                                          ▼
                                              await pushArrived
                                                or 8s grace
                                              ┌────────┴────────┐
                                          push 到了              超时
                                              │                   │
                                              ▼                   ▼
                                            ok, received     是否 sseError?
                                                         ┌──── 是 ────┐
                                                         │             │
                                                         │           ┌─┴─────────┐
                                                         │           │ send-failed│
                                                         │           │ + SW 提示  │
                                                         │           └────────────┘
                                                         否
                                                         │
                                                         ▼
                                                  timeout + SW 自报错文案
```

实现见 [`utils/instantPushClient.ts`](../utils/instantPushClient.ts) `sendInstantPushAndAwaitReply`。

## 写新代码 / 改这条链路时的红线

1. **任何 `consumeInstantStream` 的 catch 都不能直接判 send-failed**。worker 端 backupPush='on' 是强制开的（amsg-instant 0.9+），SSE reject 只意味着「丢了前台便捷副本」，不意味着送达失败。
2. **送达定义只看 `active-msg-received`**（由 SW 在 `saveContentToInbox` 里 fire）。SSE 自然 resolve 也只是「payload 都交给 SW 了」，不等于 SW 已落库 + 客户端已收到信号 —— 还得等 `pushArrived`。
3. **主动 abort 触发的 reject 不算 SSE 错**。用 `abortController.signal.aborted` 判，不用 `err.name === 'AbortError'` 字符串比较，否则包装层 reject 非 DOMException 会漏判。
4. **arrived 路径要主动 abort SSE**。push 赢 race 后 SSE 流还在跑、`onPayload` 还在调 `postSsePayloadToServiceWorker`，浪费带宽 + 制造孤儿 trace。`abortController.abort()` 再 return。
5. **SW 自报错 (`sseBusinessError` / `sseDeliveryFailed`) 是次级现象**，可以穿插进文案给排查线索，**但不能覆盖 outcome**。SSE 死 + SW 也报错的根因仍是 SSE 中断，outcome 应该是 `send-failed`，不是 `timeout` —— 否则「AI 回复已生成」这种文案会在 SSE 中断时撒谎，误导用户去刷新。

## 关键代码位置

| 文件 | 关键点 |
|------|-------|
| [`utils/instantPushClient.ts`](../utils/instantPushClient.ts) | `sendInstantPushAndAwaitReply` —— race 逻辑、grace、错误分类全在这 |
| [`worker/instant-push/src/index.ts`](../worker/instant-push/src/index.ts) | `sse: { backupPush: 'on' }` 配置；不要改成其他值（库会 throw） |
| [`worker/sw-keep-alive.ts`](../worker/sw-keep-alive.ts) | `saveContentToInbox` → `notifyClients('active-msg-received')` —— SSE / push 两路在这里汇成同一条广播 |
| `node_modules/@rei-standard/amsg-sw/dist/index.d.ts` | dedup 实现（dbName `rei_amsg_sw_dedupe_v1`） |
| `node_modules/@rei-standard/amsg-client/dist/index.d.ts` | `consumeInstantStream` JSDoc —— **注意：当前 JSDoc 说「treat rejection as canonical error path」，这条建议跟 backupPush='on' 配合会坑爹，本仓库不能照做**。上游修复在路上 |

## 已知的上游 (amsg-*) 待改进

amsg-client 的 `consumeInstantStream` 当前 JSDoc 在 backupPush 强制开的世界里语义错位。Owner 知道，RFC 在内部讨论（见仓库 owner，不在这份文档展开）。在上游修好之前，本仓库的 `sendInstantPushAndAwaitReply` 是 reference implementation —— 接新功能 / fork 时照它的 race 形态写就行，不要原地 try/catch 直接判 send-failed。
