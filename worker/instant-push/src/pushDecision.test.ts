import { describe, it, expect, vi } from 'vitest';
import { buildPushDecision, type PushDecisionInput } from './index';

// ─── 测试 fixture helpers ────────────────────────────────────────────────

function baseInput(overrides: Partial<PushDecisionInput> = {}): PushDecisionInput {
  return {
    llmOutputText: '',
    sessionId: 'sess_test',
    iteration: 0,
    contactName: 'X',
    avatarUrl: null,
    callerMetadata: {},
    ...overrides,
  };
}

type AnyPushPayload = {
  message?: string;
  messageKind?: string;
  messageId?: string;
  notification?: { show?: string; title?: string; body?: string };
  metadata?: Record<string, unknown>;
  toolCalls?: Array<{ function: { name: string } }>;
};

function pushes(r: ReturnType<typeof buildPushDecision>): AnyPushPayload[] {
  if (r.decision === 'skip-push') return [];
  return r.pushPayloads as AnyPushPayload[];
}

// ─── D 系列: push payload 三条路径 (0.8+ pushPayloads) ───────────────────────

describe('buildPushDecision D 系列 (pushPayloads 数组)', () => {
  it('D1 finish 单行干净文本 → 1 个 segment, 1 条 push', () => {
    const r = buildPushDecision(baseInput({ llmOutputText: '你好' }));
    expect(r.decision).toBe('finish');
    const ps = pushes(r);
    expect(ps).toHaveLength(1);
    // raw 跟 sanitized 在普通文本上一样, 但都塞 notification.body (0.8+ 不再
    // 用条件去重, lib 不 clone notification 跨 chunk, 每条独立)
    expect(ps[0].message).toBe('你好');
    expect(ps[0].notification).toEqual({ show: 'when-hidden', title: '来自 X', body: '你好' });
    expect(ps[0].metadata?.directives).toEqual([]);
  });

  it('D1+ finish 多行文本 → chunkText 切 N 个 segment, N 条 push', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你看\n看来昨天忙的还是机密啊。\n我没事的',
    }));
    expect(r.decision).toBe('finish');
    const ps = pushes(r);
    expect(ps).toHaveLength(3);
    expect(ps.map((p) => p.message)).toEqual([
      '你看',
      '看来昨天忙的还是机密啊。',
      '我没事的',
    ]);
    // notification.body 跟 message 一致 (普通文本 sanitized === raw)
    expect(ps[0].notification?.body).toBe('你看');
  });

  it('D2 finish 含 SEND_EMOJI → emoji 独立 segment, message 留 raw 给客户端 Step 9', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你看\n[[SEND_EMOJI: 笑]]\n我没事的',
    }));
    expect(r.decision).toBe('finish');
    const ps = pushes(r);
    expect(ps).toHaveLength(3);
    // emoji 这条: message 是 raw [[SEND_EMOJI:]] (客户端 Step 9 渲染 sticker),
    // notification.body 是可读 placeholder
    expect(ps[1].message).toBe('[[SEND_EMOJI: 笑]]');
    expect(ps[1].notification?.body).toBe('[表情：笑]');
  });

  it('D2+ inline SEND_EMOJI 在文字中间 → 拆 3 段 (text/emoji/text)', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你看 [[SEND_EMOJI: 笑]] 我没事的',
    }));
    expect(r.decision).toBe('finish');
    const ps = pushes(r);
    expect(ps).toHaveLength(3);
    expect(ps[0].message).toBe('你看');
    expect(ps[1].message).toBe('[[SEND_EMOJI: 笑]]');
    expect(ps[1].notification?.body).toBe('[表情：笑]');
    expect(ps[2].message).toBe('我没事的');
  });

  it('D3 finish 仅 <think> → sanitize 全 strip → skip-push (无任何 banner / bubble)', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '<think>internal monologue</think>',
    }));
    // 0.8+: 0 segments → skip-push (放弃这一轮, 不弹通知)
    // 跟 next.3 的 ZWSP 占位是设计差异 — 多 push 模式下没必要强行占位
    expect(r.decision).toBe('skip-push');
  });

  it('D4 tool-request 含 prefix → narration push + toolReq push 各一条', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '让我查查[[RECALL: 2024-05]]',
    }));
    expect(r.decision).toBe('tool-request');
    const ps = pushes(r);
    expect(ps).toHaveLength(2);
    // narration push: content kind, 显示 banner
    expect(ps[0].message).toBe('让我查查');
    expect(ps[0].notification?.body).toBe('让我查查');
    // toolReq push: tool_request kind, 不带 notification (SW 分轨, 不弹 OS banner)
    expect(ps[1].messageKind).toBe('tool_request');
    expect(ps[1].toolCalls).toHaveLength(1);
    expect(ps[1].toolCalls?.[0].function.name).toBe('recall');
    expect(ps[1].notification).toBeUndefined();
  });

  it('D5 tool-request 空 prefix (LLM 直接吐数据标签) → 只有 toolReq 一条', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '[[SEARCH: weather]]',
    }));
    expect(r.decision).toBe('tool-request');
    const ps = pushes(r);
    expect(ps).toHaveLength(1);
    expect(ps[0].messageKind).toBe('tool_request');
    expect(ps[0].toolCalls?.[0].function.name).toBe('web_search');
  });

  it('D6 finish + ACTION:POKE → message 剥光, directives 挂在最后一条 push', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: 'OK[[ACTION:POKE]]',
    }));
    expect(r.decision).toBe('finish');
    const ps = pushes(r);
    expect(ps).toHaveLength(1);
    expect(ps[0].message).toBe('OK');
    expect(ps[0].metadata?.directives).toEqual([{ type: 'poke' }]);
  });

  it('D6+ finish 多 chunk + directives → 只在最后一条 push 上挂 directives', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你好\nOK\n再见[[ACTION:POKE]]',
    }));
    expect(r.decision).toBe('finish');
    const ps = pushes(r);
    expect(ps).toHaveLength(3);
    // 前 2 条不带 directives
    expect(ps[0].metadata?.directives).toBeUndefined();
    expect(ps[1].metadata?.directives).toBeUndefined();
    // 最后一条带, 防客户端 replay 多次
    expect(ps[2].metadata?.directives).toEqual([{ type: 'poke' }]);
  });
});

// ─── E 系列: title fallback ──────────────────────────────────────────────

describe('buildPushDecision E 系列 (title fallback)', () => {
  it('E1 contactName="Sully" → 每条 push title="来自 Sully"', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你好\n再见',
      contactName: 'Sully',
    }));
    const ps = pushes(r);
    for (const p of ps) {
      expect(p.notification?.title).toBe('来自 Sully');
    }
  });

  it.each([
    { name: '空字符串', value: '' },
    { name: '全空白', value: '   ' },
    { name: '混合空白 (tab + 全角空格 + nbsp)', value: '\t　 ' },
  ])('E2 contactName=$name → fallback 到 "来自 主动消息"', ({ value }) => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你好',
      contactName: value,
    }));
    const ps = pushes(r);
    expect(ps[0].notification?.title).toBe('来自 主动消息');
  });
});

// ─── F 系列: size warn ──────────────────────────────────────────────────

describe('buildPushDecision F 系列 (size warn per-push)', () => {
  it('F1 短 message → onSizeWarn 不被调用', () => {
    const onSizeWarn = vi.fn();
    buildPushDecision(baseInput({ llmOutputText: '你好' }), { onSizeWarn });
    expect(onSizeWarn).not.toHaveBeenCalled();
  });

  it('F2 ~3000B 长 message (单 chunk) → onSizeWarn 调 1 次, bytes > 2300', () => {
    const onSizeWarn = vi.fn();
    // 用单段超长文本 (无换行避免被 chunkText 切碎)
    const longText = 'x'.repeat(3000);
    buildPushDecision(baseInput({ llmOutputText: longText }), { onSizeWarn });
    expect(onSizeWarn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onSizeWarn).mock.calls[0][0]).toBeGreaterThan(2300);
  });

  it('F3 不传 onSizeWarn + 长 message → 默认 console.warn 被调用', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      buildPushDecision(baseInput({ llmOutputText: 'x'.repeat(3000) }));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('[instant-push]');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('F2+ 多 push 都很短 → onSizeWarn 不被调用', () => {
    const onSizeWarn = vi.fn();
    buildPushDecision(baseInput({ llmOutputText: '你好\n再见\n好的' }), { onSizeWarn });
    expect(onSizeWarn).not.toHaveBeenCalled();
  });
});

// ─── metadata 透传 ──────────────────────────────────────────────────────

describe('buildPushDecision metadata 透传', () => {
  it('finish 单 push: callerMetadata 全字段透传 + iteration + directives', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你好',
      iteration: 3,
      callerMetadata: { charId: 'c1', extra: 'val' },
    }));
    const ps = pushes(r);
    expect(ps[0].metadata).toEqual({
      charId: 'c1',
      extra: 'val',
      directives: [],
      iteration: 3,
    });
  });

  it('finish 多 push: 每条都带 callerMetadata, 只最后一条带 directives', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你好\n再见',
      iteration: 1,
      callerMetadata: { charId: 'c1' },
    }));
    const ps = pushes(r);
    expect(ps).toHaveLength(2);
    expect(ps[0].metadata).toMatchObject({ charId: 'c1', iteration: 1 });
    expect(ps[0].metadata?.directives).toBeUndefined();
    expect(ps[1].metadata).toMatchObject({ charId: 'c1', iteration: 1, directives: [] });
  });

  it('tool-request 路径: narration + toolReq 都带 callerMetadata + iteration', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '让我查查\n[[SEARCH: weather]]',
      iteration: 2,
      callerMetadata: { charId: 'c1' },
    }));
    const ps = pushes(r);
    expect(ps).toHaveLength(2);
    expect(ps[0].metadata).toMatchObject({ charId: 'c1', iteration: 2 });
    expect(ps[1].metadata).toMatchObject({ charId: 'c1', iteration: 2 });
    // tool-request 路径无 directives (那是 finish 独有)
    expect(ps[0].metadata?.directives).toBeUndefined();
    expect(ps[1].metadata?.directives).toBeUndefined();
  });

  it('caller 后注入的 iteration 覆盖 caller 自带的 (spread 顺序防回归)', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '你好',
      iteration: 5,
      callerMetadata: { iteration: 999, charId: 'c1' },
    }));
    const ps = pushes(r);
    expect(ps[0].metadata?.iteration).toBe(5);
    expect(ps[0].metadata?.charId).toBe('c1');
  });
});

// ─── messageId per-chunk ────────────────────────────────────────────────

describe('buildPushDecision messageId per-chunk uniqueness', () => {
  it('多 chunk push 每条 messageId 含 _chunk_${i} 后缀, 两两不同', () => {
    const r = buildPushDecision(baseInput({
      sessionId: 'sess_abc',
      iteration: 1,
      llmOutputText: '你好\n再见\n好的',
    }));
    const ps = pushes(r);
    expect(ps).toHaveLength(3);
    const ids = ps.map((p) => p.messageId);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toContain('_chunk_0');
    expect(ids[1]).toContain('_chunk_1');
    expect(ids[2]).toContain('_chunk_2');
  });

  it('tool-request 路径: narration 用 chunk 后缀, toolReq 用 toolreq 后缀', () => {
    const r = buildPushDecision(baseInput({
      sessionId: 'sess_xyz',
      iteration: 0,
      llmOutputText: '让我查查\n[[RECALL: 2024-05]]',
    }));
    const ps = pushes(r);
    expect(ps).toHaveLength(2);
    expect(ps[0].messageId).toContain('_chunk_0');
    expect(ps[1].messageId).toContain('_toolreq');
  });
});

// ─── skip-push edge case ────────────────────────────────────────────────

describe('buildPushDecision skip-push (空内容)', () => {
  it('空字符串 → skip-push', () => {
    const r = buildPushDecision(baseInput({ llmOutputText: '' }));
    expect(r.decision).toBe('skip-push');
  });

  it('全空白 → skip-push', () => {
    const r = buildPushDecision(baseInput({ llmOutputText: '   \n\n  ' }));
    expect(r.decision).toBe('skip-push');
  });

  it('只有 INNER_STATE → skip-push (无 directive 无内容)', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '[[INNER_STATE: confused]]',
    }));
    // INNER_STATE 被剥, 无 directive 也无 segment → skip-push
    expect(r.decision).toBe('skip-push');
  });

  it('只有副作用 directive 无 narration → finish + directive-only push', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '[[ACTION:POKE]]',
    }));
    // 改: classifier 把 ACTION:POKE 提成 directive, cleanedText 空 → segments 空,
    // 但 directives.length > 0, buildPushDecision 不再 skip-push, emit 一条
    // directive-only push (message:'', 不带 notification, metadata.directives 携带).
    expect(r.decision).toBe('finish');
    const ps = (r as Extract<typeof r, { decision: 'finish' }>).pushPayloads;
    expect(ps).toHaveLength(1);
    const push = ps[0] as { message: string; metadata: { directives: unknown[] }; notification?: unknown };
    expect(push.message).toBe('');
    expect(push.metadata.directives).toEqual([{ type: 'poke' }]);
    expect(push.notification).toBeUndefined();
  });

  it('INNER_STATE + 副作用 directive → finish + directive-only push', () => {
    const r = buildPushDecision(baseInput({
      llmOutputText: '[[INNER_STATE: confused]][[ACTION:POKE]]',
    }));
    // INNER_STATE 被剥 + ACTION:POKE 提成 directive → segments=[] + directives=[poke]
    // → finish (directive-only). 跟上面 case 等价, 多 INNER_STATE 不影响.
    expect(r.decision).toBe('finish');
    const ps = (r as Extract<typeof r, { decision: 'finish' }>).pushPayloads;
    expect(ps).toHaveLength(1);
    expect((ps[0] as { metadata: { directives: unknown[] } }).metadata.directives).toEqual([{ type: 'poke' }]);
  });
});
