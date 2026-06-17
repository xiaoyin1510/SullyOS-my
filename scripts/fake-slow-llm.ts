// fake-slow-llm — OpenAI-compatible 慢速假 LLM，纯测试用。
//
// 干什么的: 假装是一个 chat completions 端点, 收到请求后干等一段时间
// (默认 120 秒) 再吐回复。用来测 instant-push worker 在「LLM 很慢 +
// 客户端断开/杀 App」场景下的存活窗口与推送兜底, 不消耗任何真实 token。
//
// 跑法 (二选一):
//   - 本地:      deno run --allow-net --allow-env scripts/fake-slow-llm.ts
//   - 线上:      整个文件贴进 app.deno.com 的 Playground
//
// 配置 (全部可选):
//   - 环境变量 FAKE_DELAY_MS    默认 120000 (两分钟)
//   - 请求头   x-fake-delay-ms  单次覆盖, 方便不同场景混测
//
// 端点:
//   - GET  …/models, …/v1/models          → 模型列表 (过前端「测试连接」)
//   - POST …/chat/completions (任意前缀)   → 等 delay 后回非流式 JSON;
//                                           body 带 stream:true 时回 SSE
//   - 其余路径 404
//
// API key 随便填, 不校验。

export {};

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

const DEFAULT_DELAY_MS = 120_000;
const MODEL_ID = 'fake-slow-llm';

// 多句回复, 让 instant-push 的分句器能切出多条推送来测 multipart 链路。
const REPLY_SENTENCES = [
  '这是一条来自假 LLM 的慢速测试回复。',
  '如果你看到这条消息, 说明 worker 熬过了漫长的等待。',
  '现在可以确认推送链路在慢响应下依然完整。',
  '测试完成, 辛苦啦。',
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-fake-delay-ms',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function parseDelay(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === '') return null; // Number(null/'') 会变 0, 必须先挡掉
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function resolveDelayMs(request: Request): number {
  return (
    parseDelay(request.headers.get('x-fake-delay-ms')) ??
    parseDelay(Deno.env.get('FAKE_DELAY_MS')) ??
    DEFAULT_DELAY_MS
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function completionPayload(content: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `chatcmpl-fake-${now}`,
    object: 'chat.completion',
    created: now,
    model: MODEL_ID,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

/**
 * 非流式慢响应。不能傻等再一次性返回: Deno Deploy 边缘网关对 ~105s 内
 * 不出首字节的响应直接回 502 (实测)。JSON 允许任意前导空白 —— 等待期间
 * 每 5s 滴一个空格保活, 最后吐完整 JSON, res.json() 照常解析。
 */
function slowJsonResponse(delayMs: number): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        const startedAt = Date.now();
        controller.enqueue(encoder.encode(' '));
        let remaining = delayMs - (Date.now() - startedAt);
        while (remaining > 0) {
          await sleep(Math.min(5000, remaining));
          controller.enqueue(encoder.encode(' '));
          remaining = delayMs - (Date.now() - startedAt);
        }
        controller.enqueue(
          encoder.encode(JSON.stringify(completionPayload(REPLY_SENTENCES.join('')))),
        );
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS } },
  );
}

/** stream:true 时: 等完 delay 再逐句吐 SSE chunk, 模拟慢首字 + 正常流速。 */
function streamResponse(delayMs: number): Response {
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: `chatcmpl-fake-${now}`,
      object: 'chat.completion.chunk',
      created: now,
      model: MODEL_ID,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  return new Response(
    new ReadableStream({
      async start(controller) {
        // 等待期间用 SSE 注释行保活, 防边缘网关掐首字节超时 (同 slowJsonResponse)
        const startedAt = Date.now();
        let remaining = delayMs;
        while (remaining > 0) {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
          await sleep(Math.min(5000, remaining));
          remaining = delayMs - (Date.now() - startedAt);
        }
        controller.enqueue(encoder.encode(chunk({ role: 'assistant' }, null)));
        for (const sentence of REPLY_SENTENCES) {
          controller.enqueue(encoder.encode(chunk({ content: sentence }, null)));
          await sleep(200);
        }
        controller.enqueue(encoder.encode(chunk({}, 'stop')));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS } },
  );
}

Deno.serve(async (request: Request) => {
  const { pathname } = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // /models, /v1/models — 前端「测试连接」拉模型列表
  if (request.method === 'GET' && /\/models\/?$/.test(pathname)) {
    return json({
      object: 'list',
      data: [{ id: MODEL_ID, object: 'model', created: 0, owned_by: 'fake' }],
    });
  }

  // 任意前缀的 /chat/completions — amsg-instant 会按 apiUrl 形态自动拼路径
  if (request.method === 'POST' && /\/chat\/completions\/?$/.test(pathname)) {
    const delayMs = resolveDelayMs(request);
    let wantsStream = false;
    try {
      const body = await request.json();
      wantsStream = body?.stream === true;
    } catch {
      // body 不是 JSON 也无所谓, 反正是假的
    }

    if (wantsStream) return streamResponse(delayMs);
    return slowJsonResponse(delayMs);
  }

  return json({ error: { message: `no such route: ${request.method} ${pathname}` } }, 404);
});
