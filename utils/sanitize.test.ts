import { describe, it, expect } from 'vitest';
import { sanitizeForBubble, sanitizeForNotification, sanitizeIntoSegments } from './sanitize';

// ─── Oracle: 原版 chatParser.sanitize (来自 commit e97f9ed) ─────────────────
// 用来跟 sanitizeForBubble 字节对齐校验. refactor 后改 sanitize.ts 就立刻能
// 看到行为漂移.
function originalSanitize(text: string, options?: { keepCitations?: boolean }): string {
  let result = text
    .replace(/\\n/g, '\n')
    .replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n')
    .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/g, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*/gm, '')
    .replace(/（[上下]午\d{1,2}[：:]\d{2}）/g, '')
    .replace(/\(\d{1,2}:\d{2}\s*[AP]M\)/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[\[(?:ACTION|RECALL|SEARCH|DIARY|READ_DIARY|FS_DIARY|FS_READ_DIARY|DIARY_START|DIARY_END|FS_DIARY_START|FS_DIARY_END|MUSIC_ACTION)[:\s][\s\S]*?\]\]/g, '')
    .replace(/\[schedule_message[^\]]*\]/g, '');
  if (!options?.keepCitations) {
    result = result
      .replace(/\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g, '')
      .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
      .replace(/\[回复\s*[""“][^""”]*?[""”](?:\.{0,3})\]\s*[：:]?\s*/g, '');
  }
  return result
    .replace(/`(\[\[[\s\S]*?\]\])`/g, '$1')
    .replace(/``+/g, '')
    .replace(/(^|\s)`(\s|$)/gm, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*{2,}/g, '')
    .replace(/^\s*---\s*$/gm, '')
    .replace(/^\s*[-*+]\s*$/gm, '')
    .replace(/%%TRANS%%[\s\S]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── sanitizeForNotification: 底层 helper 等价类 ───────────────────────────

describe('sanitizeForNotification', () => {
  it('A1 字面 \\n 还原', () => {
    expect(sanitizeForNotification('a\\nb')).toBe('a\nb');
  });

  it('A2 源标签 → 换行 (replace-with-marker)', () => {
    expect(sanitizeForNotification('你好[聊天]在吗')).toBe('你好\n在吗');
  });

  it('A3 时间戳 4 变体一次过', () => {
    // 注意: English 12h `\(...\)` 不吃 trailing 空格 (跟原版正则保持一致),
    // 所以 `(1:52 PM) hi4` 剥后是 ' hi4'.
    const input = '[2026-05-20 13:52] hi\n2026-05-20 13:52 hi2\n（下午1:52）hi3\n(1:52 PM) hi4';
    expect(sanitizeForNotification(input)).toBe('hi\nhi2\nhi3\n hi4');
  });

  it('A4 业务标签 alternation 全剥', () => {
    const input = 'a[[ACTION:POKE]]b[[RECALL: 2024-05]]c[schedule_message|t1|fixed|x]d';
    expect(sanitizeForNotification(input)).toBe('abcd');
  });

  it('A5 引用三变体 (keepCitations=false)', () => {
    expect(sanitizeForNotification('[[QUOTE：x]]a[QUOTE：y]b[回复 "z"]: c'))
      .toBe('abc');
  });

  it('A5b 模仿历史渲染的引用头 [xx引用了xx「…」，并回复了 ↓] 也剥', () => {
    expect(sanitizeForNotification('[我引用了你说的「昨晚那句话」，并回复了 ↓]\n好啦我错了'))
      .toBe('好啦我错了');
    expect(sanitizeForNotification('[用户引用了你之前说的「截断的摘要…」，并回复了 ↓] 嗯'))
      .toBe('嗯');
    // 非引用格式的普通方括号不误伤
    expect(sanitizeForNotification('我看了[那本书]感觉一般'))
      .toBe('我看了[那本书]感觉一般');
    // 缺闭合 」 的畸形引用头不跨行吞掉后续正文段落
    expect(sanitizeForNotification('[我引用了你说的「没有闭合\n第一行正文\n第二行正文'))
      .toBe('[我引用了你说的「没有闭合\n第一行正文\n第二行正文');
  });

  it('A6 backtick 三变体', () => {
    expect(sanitizeForNotification('a `[[X:1]]` b `` c ` d'))
      .toBe('a [[X:1]] b  c  d');
  });

  it('A7 markdown link → [链接：text]', () => {
    expect(sanitizeForNotification('see [click](https://x.com) here'))
      .toBe('see [链接：click] here');
  });

  it('A9 <think> 闭合 + 未闭合兜底', () => {
    expect(sanitizeForNotification('a<think>x</think>b<thinking>tail'))
      .toBe('ab');
  });

  it('A10 SEND_EMOJI 正向 + 反向 emoji tag', () => {
    expect(sanitizeForNotification('[Sully 发送了表情包: 笑] 然后 [[SEND_EMOJI: 哭]]'))
      .toBe('[表情：笑] 然后 [表情：哭]');
  });

  it('A11 [html] 块屏蔽内部 markdown', () => {
    expect(sanitizeForNotification('前 [html]# h1 **bold**[/html] 后'))
      .toBe('前 [HTML 卡片] 后');
  });

  it('A12 <翻译> 保留原文剥译文 (规范格式 with <原文>)', () => {
    expect(sanitizeForNotification('<翻译><原文>Hi</原文><译文>嗨</译文></翻译>'))
      .toBe('Hi');
  });

  it('A12+ <翻译> LLM 幻觉错误格式 (无 <原文> 包裹) → 兜底剥 <译文> + 标签', () => {
    // T7 实测踩到: LLM 输出 `<翻译>X</翻译><译文>Y</译文>` 而不是规范的
    // `<翻译><原文>X</原文><译文>Y</译文></翻译>`. 必须兜底剥, 否则 banner 上
    // 漏出原始标签字符. 译文整块吞, 残留 open/close tag 剥光, 留原文.
    expect(sanitizeForNotification('<翻译>Hello</翻译><译文>你好</译文>'))
      .toBe('Hello');
    expect(sanitizeForNotification('<翻译>Check the notification.</翻译><译文>检查通知。</译文>'))
      .toBe('Check the notification.');
  });

  it('A12++ 落单的 <译文> / <翻译> 标签也剥干净', () => {
    expect(sanitizeForNotification('before <译文>only translated</译文> after'))
      .toBe('before  after');
    expect(sanitizeForNotification('orphan <翻译> open <原文> tags'))
      .toBe('orphan  open  tags');
  });

  // ─── 顺序依赖 (interaction bugs) ─────────────────────────────────────────

  it('B1 markdown link 在 header strip 之前 (不吃 # frag)', () => {
    expect(sanitizeForNotification('[click](https://x.com/#frag)'))
      .toBe('[链接：click]');
  });

  it('B2 [html] 在 markdown 之前 (内部 # 不被剥)', () => {
    expect(sanitizeForNotification('[html]# h1\n**b**\n[/html]'))
      .toBe('[HTML 卡片]');
  });

  it('B3 <think> 在 INNER_STATE / 业务标签之前 (一次吃光)', () => {
    expect(sanitizeForNotification('<think>[[INNER_STATE: x]][[ACTION:POKE]]</think>real'))
      .toBe('real');
  });

  it('B4 字面 \\n 还原在 line-anchored 之前', () => {
    // 字面 `\n` 还原后, ^锚定的 timestamp 才能命中
    expect(sanitizeForNotification('foo\\n2026-05-20 13:52 hi'))
      .toBe('foo\nhi');
  });

  // ─── 边界 ──────────────────────────────────────────────────────────────

  it('C1 空串', () => {
    expect(sanitizeForNotification('')).toBe('');
  });

  it('C2 全空白', () => {
    expect(sanitizeForNotification('\n\n\n   ')).toBe('');
  });

  it('C3 幂等 (关键不变量)', () => {
    const cases = [
      '<think>x</think>real',
      '[html]内容[/html]',
      '<翻译><原文>A</原文><译文>B</译文></翻译>',
      'a[[ACTION:POKE]]b[[SEND_EMOJI: 笑]]c',
      '[click](https://example.com/#anchor)',
    ];
    for (const x of cases) {
      const once = sanitizeForNotification(x);
      const twice = sanitizeForNotification(once);
      expect(twice).toBe(once);
    }
  });

  // ─── notification 路径独有: READ_NOTE / XHS_* 剥 ───────────────────────

  it('notification 路径额外剥 READ_NOTE / XHS_*', () => {
    expect(sanitizeForNotification('a[[READ_NOTE: key]]b[[XHS_LIKE: 1]]c[[XHS_MY_PROFILE]]d'))
      .toBe('abcd');
  });
});

// ─── sanitizeForBubble: byte-aligned to original chatParser.sanitize ──────

describe('sanitizeForBubble byte-alignment (C4 oracle)', () => {
  const fixtures: Array<{ name: string; input: string; opts?: { keepCitations?: boolean } }> = [
    { name: 'plain text', input: '你好世界' },
    { name: 'business tags', input: 'a[[ACTION:POKE]]b' },
    { name: 'timestamp leak', input: '[2026-05-20 13:52] hi' },
    { name: 'source tag', input: '你好[聊天]在吗' },
    { name: 'backtick wrap', input: 'a `[[X:1]]` b' },
    { name: 'markdown link', input: 'see [click](https://x.com)' },
    { name: 'markdown header', input: '# title\nbody' },
    { name: 'literal newline', input: 'a\\nb' },
    { name: 'bold markers', input: '**hi** **bye**' },
    { name: 'quote keepCitations=false', input: '[[QUOTE：x]] hi', opts: { keepCitations: false } },
    { name: 'quote keepCitations=true', input: '[[QUOTE：x]] hi', opts: { keepCitations: true } },
    { name: '回复 reply quote', input: '[回复 "原话"]: 嗯' },
    { name: 'empty', input: '' },
    { name: 'whitespace only', input: '\n\n\n' },
    { name: 'XHS tag (bubble 保留, notification 剥)', input: '[[XHS_LIKE: 1]] hi' },
    { name: 'SEND_EMOJI (bubble 保留)', input: 'hi [[SEND_EMOJI: 笑]]' },
    { name: '<think> (bubble 保留)', input: '<think>x</think>real' },
  ];

  for (const { name, input, opts } of fixtures) {
    it(`oracle: ${name}`, () => {
      expect(sanitizeForBubble(input, opts)).toBe(originalSanitize(input, opts));
    });
  }
});

// ─── sanitizeForBubble 跟 sanitizeForNotification 差异点 ───────────────────

describe('bubble vs notification differences', () => {
  it('A8 bubble 路径: markdown link → text (无 [链接：] 包装)', () => {
    // notification 把 [text](url) → [链接：text]; bubble 保留老行为 → text
    expect(sanitizeForBubble('see [click](https://x.com)')).toBe('see click');
  });

  it('bubble 路径保留 SEND_EMOJI / <think> / INNER_STATE (下游 step 用)', () => {
    expect(sanitizeForBubble('[[SEND_EMOJI: 笑]]'))
      .toBe('[[SEND_EMOJI: 笑]]');
    expect(sanitizeForBubble('<think>x</think>real'))
      .toBe('<think>x</think>real');
    expect(sanitizeForBubble('[[INNER_STATE: x]]real'))
      .toBe('[[INNER_STATE: x]]real');
  });

  it('bubble 路径不剥 XHS_* / READ_NOTE (老行为)', () => {
    expect(sanitizeForBubble('[[XHS_LIKE: 1]] hi')).toBe('[[XHS_LIKE: 1]] hi');
    expect(sanitizeForBubble('[[READ_NOTE: key]] hi')).toBe('[[READ_NOTE: key]] hi');
  });
});

// ─── sanitizeIntoSegments (amsg-instant 0.8+ pushPayloads) ─────────────────

describe('sanitizeIntoSegments', () => {
  it('单行普通文本 → 1 个 segment, raw === sanitized', () => {
    const segs = sanitizeIntoSegments('你好');
    expect(segs).toEqual([{ raw: '你好', sanitized: '你好' }]);
  });

  it('多行 (换行切) → N 个 segments', () => {
    const segs = sanitizeIntoSegments('你看\n看来昨天忙的还是机密啊。\n我没事的');
    expect(segs.map((s) => s.raw)).toEqual([
      '你看',
      '看来昨天忙的还是机密啊。',
      '我没事的',
    ]);
  });

  it('SEND_EMOJI 单独成行 → 独立 segment, raw 是 raw tag, sanitized 是 [表情：x]', () => {
    const segs = sanitizeIntoSegments('你看\n[[SEND_EMOJI: 笑]]\n我没事的');
    expect(segs).toEqual([
      { raw: '你看', sanitized: '你看' },
      { raw: '[[SEND_EMOJI: 笑]]', sanitized: '[表情：笑]' },
      { raw: '我没事的', sanitized: '我没事的' },
    ]);
  });

  it('inline SEND_EMOJI 在文字中间 → 拆 3 段 (text/emoji/text)', () => {
    const segs = sanitizeIntoSegments('你看 [[SEND_EMOJI: 笑]] 我没事的');
    expect(segs).toEqual([
      { raw: '你看', sanitized: '你看' },
      { raw: '[[SEND_EMOJI: 笑]]', sanitized: '[表情：笑]' },
      { raw: '我没事的', sanitized: '我没事的' },
    ]);
  });

  it('CJK 字符之间空格 → 切 (中文里本不该有空格 = LLM 想断行)', () => {
    const segs = sanitizeIntoSegments('汉字 汉字');
    expect(segs.map((s) => s.raw)).toEqual(['汉字', '汉字']);
  });

  it('<think> 整段被剥, 只剩 think 时 → 空数组 (skip-push 触发)', () => {
    const segs = sanitizeIntoSegments('<think>internal monologue</think>');
    expect(segs).toEqual([]);
  });

  it('<think> 跟正文混合 → think 剥光, 正文按 chunkText 切', () => {
    const segs = sanitizeIntoSegments('<think>internal</think>你好\n再见');
    expect(segs.map((s) => s.raw)).toEqual(['你好', '再见']);
  });

  it('业务标签 + INNER_STATE 全 strip → 留下纯文字', () => {
    const segs = sanitizeIntoSegments('[[INNER_STATE: x]]你好[[ACTION:POKE]]\n再见');
    expect(segs.map((s) => s.raw)).toEqual(['你好', '再见']);
  });

  it('整段只有业务标签 → 空数组', () => {
    const segs = sanitizeIntoSegments('[[ACTION:POKE]][[INNER_STATE: y]]');
    expect(segs).toEqual([]);
  });

  it('markdown link 行内 → raw 保留 [text](url), sanitized 是 [链接：text]', () => {
    const segs = sanitizeIntoSegments('see [click](https://x.com) here');
    expect(segs).toHaveLength(1);
    expect(segs[0].raw).toBe('see [click](https://x.com) here');
    expect(segs[0].sanitized).toBe('see [链接：click] here');
  });

  it('[html] 单独成行 → raw 保留 [html] 块给客户端 Step 5, sanitized 是 [HTML 卡片]', () => {
    const segs = sanitizeIntoSegments('前\n[html]<div>x</div>[/html]\n后');
    expect(segs).toEqual([
      { raw: '前', sanitized: '前' },
      { raw: '[html]<div>x</div>[/html]', sanitized: '[HTML 卡片]' },
      { raw: '后', sanitized: '后' },
    ]);
  });

  it('[html] 多行 HTML → 整块单 segment, 不被 chunkText 按 \\n 切碎', () => {
    // Regression: 在没有 Phase 1.5 保护时, chunkText 会把多行 HTML 按 \n 拆成
    // 多个 segment, 每个 segment 都是 HTML 碎片, 客户端 extractHtmlBlocks 匹配不
    // 到完整 [html]...[/html] 对儿, 渲染成一条条裸标签气泡.
    const input = '前\n[html]<div>\n  hello\n  <span>world</span>\n</div>[/html]\n后';
    const segs = sanitizeIntoSegments(input);
    expect(segs).toEqual([
      { raw: '前', sanitized: '前' },
      {
        raw: '[html]<div>\n  hello\n  <span>world</span>\n</div>[/html]',
        sanitized: '[HTML 卡片]',
      },
      { raw: '后', sanitized: '后' },
    ]);
  });

  it('[html] 连续两个多行块 → 各自独立成 segment, 内容不交叉', () => {
    const input = '[html]<div>\nA\n</div>[/html]\n[html]<div>\nB\n</div>[/html]';
    const segs = sanitizeIntoSegments(input);
    expect(segs).toEqual([
      { raw: '[html]<div>\nA\n</div>[/html]', sanitized: '[HTML 卡片]' },
      { raw: '[html]<div>\nB\n</div>[/html]', sanitized: '[HTML 卡片]' },
    ]);
  });

  it('<翻译> 整块保留给客户端 Step 8 双语渲染; banner 只显示原文', () => {
    // raw 必须带完整 <翻译><原文>X</原文><译文>Y</译文></翻译>, 否则客户端
    // applyAssistantPostProcessing.ts:1564 hasTranslationTags 配不上, 译文丢失.
    const segs = sanitizeIntoSegments('<翻译><原文>Hi</原文><译文>嗨</译文></翻译>');
    expect(segs).toEqual([
      {
        raw: '<翻译><原文>Hi</原文><译文>嗨</译文></翻译>',
        sanitized: 'Hi',
      },
    ]);
  });

  it('<翻译> 多行块 + 前后文 → 翻译整块独立成 segment, 不被 chunkText 切碎', () => {
    const input = '前\n<翻译>\n<原文>Wait... seriously?</原文>\n<译文>等等… 你认真的吗？</译文>\n</翻译>\n后';
    const segs = sanitizeIntoSegments(input);
    expect(segs).toEqual([
      { raw: '前', sanitized: '前' },
      {
        raw: '<翻译>\n<原文>Wait... seriously?</原文>\n<译文>等等… 你认真的吗？</译文>\n</翻译>',
        sanitized: 'Wait... seriously?',
      },
      { raw: '后', sanitized: '后' },
    ]);
  });

  it('残留 <译文> sibling tag (LLM 幻觉) → 兜底剥光, 不会产 segment', () => {
    // 没被规范 <翻译> 包住的孤立 <译文> 仍按 extractTranslationOriginal 兜底剥
    const segs = sanitizeIntoSegments('你好<译文>嗨</译文>再见');
    expect(segs.map((s) => s.raw)).toEqual(['你好再见']);
  });

  it('<语音> 整块保留给客户端 extractVoiceTag 触发 auto-TTS', () => {
    const segs = sanitizeIntoSegments('<语音>Hello world</语音>');
    expect(segs).toEqual([
      { raw: '<语音>Hello world</语音>', sanitized: 'Hello world' },
    ]);
  });

  it('<语音 emotion="…"> 带情绪属性也整块保留 + banner 取内部文字', () => {
    const segs = sanitizeIntoSegments('<语音 emotion="sad">Hello world</语音>');
    expect(segs).toEqual([
      { raw: '<语音 emotion="sad">Hello world</语音>', sanitized: 'Hello world' },
    ]);
  });

  it('<语音> 多行内容 → 整块单 segment, 不被 chunkText 按 \\n 切碎', () => {
    const input = '前面文字\n<语音>\nWait...\nare you serious?\n</语音>\n后面文字';
    const segs = sanitizeIntoSegments(input);
    expect(segs).toEqual([
      { raw: '前面文字', sanitized: '前面文字' },
      {
        raw: '<语音>\nWait...\nare you serious?\n</语音>',
        sanitized: 'Wait...\nare you serious?',
      },
      { raw: '后面文字', sanitized: '后面文字' },
    ]);
  });

  it('引用 [[QUOTE:...]] 保留给客户端 Step 7 配 aiReplyTarget; banner 剥光', () => {
    // worker 不再剥引用 — 否则客户端 firstQuoteMatch 配不上 → 没回复目标.
    // 但 sanitizeTextForBanner 仍剥, 通知干净.
    const segs = sanitizeIntoSegments('[[QUOTE: 用户的话]] 我的回复');
    expect(segs).toHaveLength(1);
    expect(segs[0].raw).toBe('[[QUOTE: 用户的话]] 我的回复');
    expect(segs[0].sanitized).toBe('我的回复');
  });

  it('引用 [回复 "..."]  中文形态同样保留 raw', () => {
    // stripQuotes 的 REPLY_CLEAN_CN 正则把 `[回复 "..."]:` (含冒号) 一起吃掉, 所以
    // banner 是干净的正文; raw 留全, 客户端 Step 7 用 REPLY_RE_CN 配出 aiReplyTarget.
    const segs = sanitizeIntoSegments('[回复 "在干嘛"]: 在工作呀');
    expect(segs).toHaveLength(1);
    expect(segs[0].raw).toBe('[回复 "在干嘛"]: 在工作呀');
    expect(segs[0].sanitized).toBe('在工作呀');
  });

  it('空串 / 全空白 → 空数组', () => {
    expect(sanitizeIntoSegments('')).toEqual([]);
    expect(sanitizeIntoSegments('   \n\n  ')).toEqual([]);
  });

  it('时间戳 leak 跟正文混 → 时间戳 strip 后正文按 chunkText 切', () => {
    const segs = sanitizeIntoSegments('[2026-05-20 13:52] 你好\n（下午1:52）再见');
    expect(segs.map((s) => s.raw)).toEqual(['你好', '再见']);
  });

  it('幂等: sanitizeIntoSegments(joinAll) 跟原结果在等价 input 上保持稳定', () => {
    // 不是严格幂等 (raw 跟 sanitized 不同就不能直接 join 还原), 但对 sanitized-only
    // 视角应该幂等
    const input = '你好\n[[SEND_EMOJI: 笑]]\n再见';
    const segs1 = sanitizeIntoSegments(input);
    const joinedSanitized = segs1.map((s) => s.sanitized).join('\n');
    const segs2 = sanitizeIntoSegments(joinedSanitized);
    // segs2 的 sanitized 应该等于 segs1 的 sanitized (经过一次 emoji 替换后已经是
    // [表情：笑] placeholder, 再过一遍 sanitize 不会变)
    expect(segs2.map((s) => s.sanitized)).toEqual(segs1.map((s) => s.sanitized));
  });
});
