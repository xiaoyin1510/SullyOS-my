/**
 * Deno Deploy 入口 — 复用 index.ts 的 CF 形态 fetch handler, 零改动。
 *
 * 与 CF 入口的差异只有三点:
 *   - env 从 Deno.env 读取 (Playground / Deploy 的环境变量 UI)。没有 D1 binding,
 *     /capabilities 会如实报告 d1 不可用, 前台自动落到 multipart。
 *   - waitUntil: Deno 没有这个生命周期 API。这里用一个 Set 把后台 promise
 *     拽住防 GC + 吞错。Deno Deploy 是常驻进程模型, 实例存活时浮空 promise
 *     会继续跑 —— 没有 CF 那条书面的「断开后最多 30s」上限, 但也没有书面保证,
 *     「发完立刻杀 App」场景的实际存活窗口以实测为准。
 *   - scheduled 不接: 它只服务 D1 过期清理, Deno 入口永远没有 D1。
 *
 * 打包: scripts/build-workers.mjs 产出 worker/instant-push/worker.deno.bundle.js,
 * 整份贴进 dash.deno.com 的 Playground 即可运行。
 */

import worker, { type Env } from './index';
import { INSTANT_WORKER_VERSION } from '../../../utils/instantWorkerVersion';

/** 入口自身的修订号: 部署后看启动日志确认 Playground 实际跑的是哪一版。 */
const DENO_ENTRY_REVISION = 'keeper-v1';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

/** 每个请求现读一遍 env, 与 CF 入口「secrets 按请求注入」的语义保持一致。 */
function readEnv(): Env {
  return {
    VAPID_PUBLIC_KEY: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    VAPID_PRIVATE_KEY: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    VAPID_EMAIL: Deno.env.get('VAPID_EMAIL'),
    AMSG_CLIENT_TOKEN: Deno.env.get('AMSG_CLIENT_TOKEN'),
    AMSG_OVERSIZE_TRANSPORT: Deno.env.get('AMSG_OVERSIZE_TRANSPORT'),
    AMSG_ENABLE_D1_BLOBSTORE: Deno.env.get('AMSG_ENABLE_D1_BLOBSTORE'),
    // DB 不给: D1 路径在 Deno 入口永远关闭
  };
}

// --- waitUntil shim + 自我陪跑 ---------------------------------------------
//
// Deno Deploy 没有 waitUntil, 且实测「最后一个在途请求结束后 <10s」实例就被
// 回收 (杀 App 断开 SSE 后连第一条 post_abort_alive 心跳都打不出来)。
// 对策是「自我陪跑」: 只要还有后台工作没跑完, 就向自己的公网地址发一个
// 慢响应请求 —— 平台看到仍有在途入站请求就不会回收实例; 工作清零后陪跑
// 请求立即结束, 不留常驻负担。
//
// 防御性设计:
//   - 陪跑响应每 5s 滴一个字节, 防边缘网关 ~105s 首字节超时 (实测会 502)
//   - 单次陪跑最长 10 分钟, 连续续期最多 3 次 — 万一有 promise 卡死,
//     不至于无限自我请求烧配额
//   - 自我请求失败 (平台禁止?) 则永久放弃陪跑, 避免失败重试空转

const KEEPER_PATH = '/__amsg-keepalive';
const KEEPER_TICK_MS = 5_000;
const KEEPER_MAX_MS = 10 * 60_000;
const KEEPER_MAX_CHAIN = 3;

const pendingBackgroundWork = new Set<Promise<unknown>>();
let keeperInFlight = false;
let keeperBroken = false;
let keeperChain = 0;

function ensureKeeper(requestUrl: string): void {
  if (keeperInFlight || keeperBroken || keeperChain >= KEEPER_MAX_CHAIN) return;
  keeperInFlight = true;
  keeperChain += 1;
  fetch(new URL(KEEPER_PATH, requestUrl), { method: 'POST' })
    .then(async (res) => {
      if (!res.ok) {
        // Deno Deploy 边缘对自请求回 508 Loop Detected (实测) —— 被平台
        // 识破就别再试了, 每次都会被拒, 纯烧配额。
        keeperBroken = true;
        console.error('[deno-entry] keepalive self-request rejected; giving up', {
          status: res.status,
        });
        return;
      }
      await res.text(); // 读完 body = 陪跑到对端把工作熬完
      if (pendingBackgroundWork.size > 0) {
        keeperInFlight = false;
        ensureKeeper(requestUrl); // 还有活: 续期
        return;
      }
      keeperChain = 0;
    })
    .catch((e) => {
      keeperBroken = true;
      console.error('[deno-entry] keepalive self-request failed; giving up', e);
    })
    .finally(() => {
      keeperInFlight = false;
    });
}

function keeperResponse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        const deadline = Date.now() + KEEPER_MAX_MS;
        console.log('[deno-entry] keeper attached', { pending: pendingBackgroundWork.size });
        while (pendingBackgroundWork.size > 0 && Date.now() < deadline) {
          controller.enqueue(encoder.encode(': alive\n'));
          await Promise.race([
            Promise.allSettled([...pendingBackgroundWork]),
            new Promise((resolve) => setTimeout(resolve, KEEPER_TICK_MS)),
          ]);
        }
        console.log('[deno-entry] keeper released', { pending: pendingBackgroundWork.size });
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}

console.log('[deno-entry] boot', {
  revision: DENO_ENTRY_REVISION,
  workerVersion: INSTANT_WORKER_VERSION,
});

Deno.serve((request: Request) => {
  if (new URL(request.url).pathname === KEEPER_PATH) {
    return keeperResponse();
  }
  // 每个请求一个 ctx: waitUntil 在收纳后台工作的同时拉起陪跑。
  // amsg-instant 在请求一进来就注册整个 start() 的完成信号, 所以陪跑
  // 覆盖的正是「LLM 生成 → 切段 → 推送全部送达」的完整窗口。
  const ctx = {
    waitUntil(work: Promise<unknown>): void {
      const tracked = work.catch(() => {});
      pendingBackgroundWork.add(tracked);
      tracked.finally(() => pendingBackgroundWork.delete(tracked));
      ensureKeeper(request.url);
    },
  };
  return worker.fetch(request, readEnv(), ctx);
});
