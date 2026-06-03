import { describe, it, expect } from 'vitest';
import { classifyLLMOutput } from './classifier';

describe('classifyLLMOutput', () => {
  it('D1 finish 干净文本 → sanitize 不改字符', () => {
    const r = classifyLLMOutput('你好');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('你好');
      expect(r.sanitizedBody).toBe('你好');
      // sanitize 跟原文相等, 上层 onLLMOutput 不会塞 notification.body
      expect(r.sanitizedBody).toBe(r.cleanedText);
      expect(r.directives).toEqual([]);
    }
  });

  it('D2 finish 含 SEND_EMOJI → sanitize 改字符 (notification 路径替换)', () => {
    const r = classifyLLMOutput('测试[[SEND_EMOJI: 笑]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      // cleanedText: classifier 只剥 DATA + SIDE_EFFECT 标签, SEND_EMOJI 不在里面 → 原文留给客户端 Step 9
      expect(r.cleanedText).toBe('测试[[SEND_EMOJI: 笑]]');
      // sanitizedBody: 走 sanitizeForNotification, 替换成 [表情：笑]
      expect(r.sanitizedBody).toBe('测试[表情：笑]');
      expect(r.sanitizedBody).not.toBe(r.cleanedText);
    }
  });

  it('D3 finish 仅 <think> → sanitize 空串 (触发 ZWSP 守护)', () => {
    const r = classifyLLMOutput('<think>internal monologue</think>');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('<think>internal monologue</think>');
      expect(r.sanitizedBody).toBe('');
      expect(r.sanitizedBody).not.toBe(r.cleanedText);
      // 上层 index.ts 会用 ZWSP 占位防 amsg-sw fallthrough
    }
  });

  it('D4 tool-request 含 prefix narration', () => {
    const r = classifyLLMOutput('让我查查[[RECALL: 2024-05]]');
    expect(r.kind).toBe('tool-request');
    if (r.kind === 'tool-request') {
      expect(r.prefix).toBe('让我查查');
      expect(r.sanitizedPrefix).toBe('让我查查');
      expect(r.toolCalls).toHaveLength(1);
      expect(r.toolCalls[0].function.name).toBe('recall');
      expect(JSON.parse(r.toolCalls[0].function.arguments)).toEqual({ year: '2024', month: '05' });
    }
  });

  it('D5 tool-request prefix 为空 (LLM 直接吐数据标签)', () => {
    const r = classifyLLMOutput('[[SEARCH: weather]]');
    expect(r.kind).toBe('tool-request');
    if (r.kind === 'tool-request') {
      expect(r.prefix).toBe('');
      expect(r.sanitizedPrefix).toBe('');
      // 两者相等, 上层不塞 notification.body, OS banner 显示 title-only
      expect(r.sanitizedPrefix).toBe(r.prefix);
      expect(r.toolCalls[0].function.name).toBe('web_search');
    }
  });

  it('D6 finish + directives (side-effect tag)', () => {
    const r = classifyLLMOutput('OK[[ACTION:POKE]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('OK');
      expect(r.directives).toEqual([{ type: 'poke' }]);
    }
  });

  it('D6+ finish + 多个 directives', () => {
    const r = classifyLLMOutput('收到[[ACTION:POKE]] 转你[[ACTION:TRANSFER:100]]');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('收到 转你');
      expect(r.directives).toEqual([
        { type: 'poke' },
        { type: 'transfer', amount: 100 },
      ]);
    }
  });

  it('tool-request 多个 DATA tag 一次性收集', () => {
    const r = classifyLLMOutput('[[SEARCH: a]][[SEARCH: b]]');
    if (r.kind === 'tool-request') {
      expect(r.toolCalls).toHaveLength(2);
      expect(r.toolCalls.every(t => t.function.name === 'web_search')).toBe(true);
    }
  });

  it('空输入 → finish + 空 cleanedText', () => {
    const r = classifyLLMOutput('');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('');
      expect(r.sanitizedBody).toBe('');
      expect(r.directives).toEqual([]);
    }
  });

  // ─── 写日记 directive ─────────────────────────────────────────────────────

  it('Notion 短日记 title|content → notion_write_diary directive', () => {
    const r = classifyLLMOutput('好啊[[DIARY: 今天的事|窝在沙发吃西瓜]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.cleanedText).toBe('好啊');
      expect(r.directives).toEqual([{
        type: 'notion_write_diary',
        title: '今天的事',
        content: '窝在沙发吃西瓜',
      }]);
    }
  });

  it('Notion 短日记 无 title (无 |) → content 字段拿到整段', () => {
    const r = classifyLLMOutput('[[DIARY: 只是普通的一段]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.directives).toEqual([{
        type: 'notion_write_diary',
        title: '',
        content: '只是普通的一段',
      }]);
    }
  });

  it('Notion 长日记 [[DIARY_START: title|mood]]...[[DIARY_END]] → notion_write_diary + mood', () => {
    const r = classifyLLMOutput('开始写[[DIARY_START: 雨天|惆怅]]\n下了一整天的雨，\n我看着窗外发呆。\n[[DIARY_END]]后记');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      // strip 后剥光长日记整段, 两侧文字直接相连 (跟客户端本地 fetch 路径行为一致, 见
      // applyAssistantPostProcessing.ts:534 同模式 trim).
      expect(r.cleanedText).toBe('开始写后记');
      expect(r.directives).toEqual([{
        type: 'notion_write_diary',
        title: '雨天',
        mood: '惆怅',
        content: '下了一整天的雨，\n我看着窗外发呆。',
      }]);
    }
  });

  it('Notion 长日记 仅 title (无 |) → mood undefined', () => {
    const r = classifyLLMOutput('[[DIARY_START: 标题]]\n内容\n[[DIARY_END]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      const d = r.directives[0] as { type: string; title: string; content: string; mood?: string };
      expect(d.type).toBe('notion_write_diary');
      expect(d.title).toBe('标题');
      expect(d.mood).toBeUndefined();
      expect(d.content).toBe('内容');
    }
  });

  it('飞书短日记 [[FS_DIARY: ...]] → feishu_write_diary', () => {
    const r = classifyLLMOutput('[[FS_DIARY: 飞书标题|飞书内容]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.directives).toEqual([{
        type: 'feishu_write_diary',
        title: '飞书标题',
        content: '飞书内容',
      }]);
    }
  });

  it('飞书长日记 [[FS_DIARY_START..FS_DIARY_END]] → feishu_write_diary + mood', () => {
    const r = classifyLLMOutput('[[FS_DIARY_START: 周末|轻松]]\n睡到自然醒\n[[FS_DIARY_END]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.directives).toEqual([{
        type: 'feishu_write_diary',
        title: '周末',
        mood: '轻松',
        content: '睡到自然醒',
      }]);
    }
  });

  it('Notion 长 + 飞书短同时存在 → 两个 directive 都收', () => {
    const r = classifyLLMOutput('[[DIARY_START: a]]\nx\n[[DIARY_END]]\n[[FS_DIARY: b|y]]');
    expect(r.kind).toBe('finish');
    if (r.kind === 'finish') {
      expect(r.directives).toHaveLength(2);
      const types = r.directives.map(d => d.type);
      expect(types).toContain('notion_write_diary');
      expect(types).toContain('feishu_write_diary');
    }
  });
});
