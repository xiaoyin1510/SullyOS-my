/**
 * 共享 sanitize 工具 — 零依赖纯字符串处理.
 *
 * 两个 facade:
 *  - sanitizeForBubble(text, opts)  — chatParser.sanitize 的实现, 给客户端 13 步管线**预处理**用.
 *    保留 SEND_EMOJI / [html] / <翻译> / <think> / [[INNER_STATE:...]] 等标签, 因为
 *    applyAssistantPostProcessing Step 4 (think chain) / Step 5 (html card) /
 *    Step 8 (双语) / Step 9 (sticker) 还要靠这些标签接管.
 *  - sanitizeForNotification(text)  — worker push 之前的**终态**处理, 没有下游 step,
 *    所以剥得更彻底: think 块 / INNER_STATE 全删, SEND_EMOJI → [表情：名称],
 *    [html]...[/html] → [HTML 卡片], <翻译> 只保留原文, 链接 → [链接：text].
 *
 * 真理来源:
 *  - 共享底层规则: utils/chatParser.ts:sanitize 原版正则 (lines 207-252)
 *  - notification 专用 / Step 9-相关规则: utils/applyAssistantPostProcessing.ts:normalizeAiContent
 */

import { segmentTextWithProtectedBlocks } from '@rei-standard/amsg-instant';

// ─── 底层 helper (共享, 无歧义清理) ─────────────────────────────────────────

/** `\\n` 字面 → 真实换行. 必须先跑, 否则后续 ^ 行锚定失效. */
const stripLiteralBackslashN = (t: string): string => t.replace(/\\n/g, '\n');

/** 源标签 `[聊天]/[通话]/[约会]` → 换行 (保留分隔语义) */
const stripSourceTags = (t: string): string => t.replace(/\s*\[(?:聊天|通话|约会)\]\s*/g, '\n');

/** 4 种时间格式: 带括号 ISO / 行首裸 ISO / 中文 12h / 英文 12h */
const stripTimestamps = (t: string): string =>
  t
    .replace(/\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/g, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*/gm, '')
    .replace(/（[上下]午\d{1,2}[：:]\d{2}）/g, '')
    .replace(/\(\d{1,2}:\d{2}\s*[AP]M\)/gi, '');

/** `[2024年5月20]` / `[2024/5/20...]` 中文或斜杠日期 (兼容 normalizeAiContent 的更宽松匹配) */
const stripChineseDate = (t: string): string => t.replace(/\[\d{4}[-/年]\d{1,2}[-/月]\d{1,2}.*?\]/g, '');

/**
 * 整个字符串首行的角色名 prefix `Sully:` / `User:` (无 m flag — 跟
 * applyAssistantPostProcessing.ts:normalizeAiContent 行为对齐).
 */
const stripRoleNamePrefix = (t: string): string => t.replace(/^[\w一-龥]+:\s*/, '');

/**
 * 业务标签 (ACTION / RECALL / SEARCH / DIARY / READ_DIARY / FS_DIARY / FS_READ_DIARY /
 * DIARY_START / DIARY_END / FS_DIARY_START / FS_DIARY_END / MUSIC_ACTION) + schedule_message.
 * 保持跟 chatParser.sanitize 原版字节对齐 — 不含 READ_NOTE / XHS_x (那些只在 notification 路径剥).
 */
const stripBusinessTagsForBubble = (t: string): string =>
  t
    .replace(/\[\[(?:ACTION|RECALL|SEARCH|DIARY|READ_DIARY|FS_DIARY|FS_READ_DIARY|DIARY_START|DIARY_END|FS_DIARY_START|FS_DIARY_END|MUSIC_ACTION)[:\s][\s\S]*?\]\]/g, '')
    .replace(/\[schedule_message[^\]]*\]/g, '');

/**
 * notification 路径专用 — 在 stripBusinessTagsForBubble 基础上额外剥 READ_NOTE / XHS_x.
 * 这些标签在 chatParser.sanitize 老路径里被保留 (downstream 由 applyAssistantPostProcessing
 * 重新扫描+执行), 但 push notification 是终态, 不会再有 downstream, 所以剥得更狠.
 */
const stripBusinessTagsForNotification = (t: string): string =>
  stripBusinessTagsForBubble(t)
    .replace(/\[\[(?:READ_NOTE|XHS_[A-Z_]+)[:\s][\s\S]*?\]\]/g, '')
    .replace(/\[\[XHS_[A-Z_]+\]\]/g, '');

/** 引用类: `[[QUOTE|引用]] / [QUOTE|引用] / [回复 "..."]` */
const stripQuotes = (t: string): string =>
  t
    .replace(/\[\[(?:QU[OA]TE|引用)[：:][\s\S]*?\]\]/g, '')
    .replace(/\[(?:QU[OA]TE|引用)[：:][^\]]*\]/g, '')
    .replace(/\[回复\s*[""“][^""”]*?[""”](?:\.{0,3})\]\s*[：:]?\s*/g, '');

/** markdown 标题 `# heading` → `heading` (保留文字) */
const stripMarkdownHeaders = (t: string): string => t.replace(/^#{1,6}\s+/gm, '');

/** markdown 加粗 `**bold**` → `bold` (聊天里粗体没用, 直接吃掉星号) */
const stripMarkdownBold = (t: string): string => t.replace(/\*{2,}/g, '');

/** `---` / 空 bullet 行 */
const stripMarkdownDividers = (t: string): string =>
  t.replace(/^\s*---\s*$/gm, '').replace(/^\s*[-*+]\s*$/gm, '');

/** backtick: 保留 ``` `[[...]]` ``` 内部, 剥 ``` `` ``` 和单 backtick */
const stripBackticks = (t: string): string =>
  t
    .replace(/`(\[\[[\s\S]*?\]\])`/g, '$1')
    .replace(/``+/g, '')
    .replace(/(^|\s)`(\s|$)/gm, '$1$2');

/** `%%TRANS%%...` 老翻译标记 (保留 `%%BILINGUAL%%` 跟 `<翻译>` XML) */
const stripLegacyTrans = (t: string): string => t.replace(/%%TRANS%%[\s\S]*/gi, '');

/** `\n{3,}` → `\n\n` + trim */
const collapseWhitespace = (t: string): string => t.replace(/\n{3,}/g, '\n\n').trim();

// ─── notification 专用 helper ──────────────────────────────────────────────

/** `<think|thinking|thought>...</...>` 整块, 含未闭合兜底 */
const stripThinkBlocks = (t: string): string =>
  t
    .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:think|thinking|thought)>[\s\S]*$/gi, '');

/** `[[INNER_STATE:...]]` */
const stripInnerState = (t: string): string => t.replace(/\[\[INNER_STATE:\s*[\s\S]*?\]\]/g, '');

/** `[text](url)` → `[链接：text]` (全角冒号) */
const replaceMarkdownLinks = (t: string): string =>
  t.replace(/\[([^\]]+)\]\([^)]+\)/g, '[链接：$1]');

/** `[[SEND_EMOJI: 名称]]` → `[表情：名称]` */
const replaceSendEmoji = (t: string): string =>
  t.replace(/\[\[SEND_EMOJI:\s*(.+?)\]\]/g, '[表情：$1]');

/** `[xxx 发送了表情包: 名称]` → `[表情：名称]` (直接转最终展示, 跳过 SEND_EMOJI 中间形态) */
const replaceEmojiReverseTag = (t: string): string =>
  t.replace(/\[(?:你|User|用户|System|[\w一-龥]+)\s*发送了表情包[:：]\s*(.*?)\]/g, '[表情：$1]');

/** `[html]...[/html]` → `[HTML 卡片]` */
const replaceHtmlBlocks = (t: string): string =>
  t.replace(/\[html\][\s\S]*?\[\/html\]/gi, '[HTML 卡片]');

/** `<翻译>...</翻译>` → `<原文>` 内容 (banner 用; segment 路径里有专门 sentinel 保护跳过这条) */
const replaceTranslationForBanner = (t: string): string =>
  t
    .replace(/<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g, '$1')
    .replace(/<译文>[\s\S]*?<\/译文>/g, '')
    .replace(/<\/?(?:翻译|原文)>/g, '');

/** `<语音>...</语音>` → 内部文字 (banner 用; segment 路径里有 sentinel 保护跳过这条) */
const replaceVoiceForBanner = (t: string): string =>
  t.replace(/<(语音|語音)>([\s\S]*?)<\/\1>/g, (_m, _tag, inner) => (inner || '').trim());

/**
 * 翻译块只保留原文.
 *
 * 两种格式都处理:
 *  - 规范 (chatRequestPayload.ts prompt 教 LLM 用的): `<翻译><原文>X</原文><译文>Y</译文></翻译>` → `X`
 *  - LLM 幻觉常见错误:                                  `<翻译>X</翻译><译文>Y</译文>`             → `X`
 *
 * 第二种 LLM 偶尔会写, 严格 regex 不命中就会让 banner 上漏出原始 `<翻译>` 标签字符.
 * 处理顺序: 先吃规范形态, 再兜底吃 `<译文>` 整块 + 残留的 `<翻译>` / `<原文>` 标签.
 */
const extractTranslationOriginal = (t: string): string => {
  let result = t.replace(
    /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/g,
    '$1',
  );
  // 兜底: 先剥光 <译文>...</译文> 整块 (LLM 直接 sibling tag 的形态), 再剥残留的开/闭合标签
  result = result.replace(/<译文>[\s\S]*?<\/译文>/g, '');
  result = result.replace(/<\/?(?:翻译|原文)>/g, '');
  return result;
};

// ─── facade 高层 API ───────────────────────────────────────────────────────

/**
 * worker push notification.body 终态处理:
 *  - 剥光 <think> / INNER_STATE / 业务标签 / 引用 / 时间戳 / 历史 leak
 *  - 替换 SEND_EMOJI / [html] / [text](url) 为可读 placeholder
 *  - <翻译> 只保留原文
 *
 * 顺序很重要 — 见处理顺序注释.
 */
export function sanitizeForNotification(text: string): string {
  let result = text;
  // 1. 字面 \n 还原 — 否则后续 ^ 锚定失效
  result = stripLiteralBackslashN(result);
  // 2. think 块最早剥 — 里面可能含其他 tag 影响后续匹配
  result = stripThinkBlocks(result);
  // 3. HTML 块替换 — 内部 markdown/tag 不应被处理
  result = replaceHtmlBlocks(result);
  // 4. 反向 emoji tag 先于正向 SEND_EMOJI (反向可能也走 SEND_EMOJI 重写, 但这里直接转最终展示)
  result = replaceEmojiReverseTag(result);
  result = replaceSendEmoji(result);
  // 5. 翻译块保留原文剥译文
  result = extractTranslationOriginal(result);
  // 6. LLM mimicking 历史的 leak: 时间戳 / 日期 / 角色名 prefix
  result = stripTimestamps(result);
  result = stripChineseDate(result);
  result = stripRoleNamePrefix(result);
  // 7. 源标签 [聊天] 等
  result = stripSourceTags(result);
  // 8. 内部状态 / 业务标签 / 引用
  result = stripInnerState(result);
  result = stripBusinessTagsForNotification(result);
  result = stripQuotes(result);
  // 9. 链接 → [链接：text] (必须先于 markdown header/bold strip, 避免 [text](url) 内的 # 被误剥)
  result = replaceMarkdownLinks(result);
  // 10. markdown 修饰
  result = stripMarkdownHeaders(result);
  result = stripMarkdownBold(result);
  result = stripMarkdownDividers(result);
  // 11. backtick
  result = stripBackticks(result);
  // 12. 老翻译标记
  result = stripLegacyTrans(result);
  // 13. 空白收尾
  result = collapseWhitespace(result);
  return result;
}

/**
 * chatParser.sanitize 实现 — 客户端 13 步管线**预处理**.
 *
 * 跟 sanitizeForNotification 的差异:
 *  - 保留 SEND_EMOJI / [html] / <翻译> / <think> / [[INNER_STATE:...]] (后续 step 接管)
 *  - 保留 markdown 链接 text(url) (chatParser 老行为是只剥 url 留 text, 这里也保持一致)
 *  - keepCitations 选项控制 `[[QUOTE|引用]]` 是否保留 (chunking 用)
 */
export function sanitizeForBubble(
  text: string,
  options?: { keepCitations?: boolean },
): string {
  let result = text;
  // 1. 字面 \n 还原
  result = stripLiteralBackslashN(result);
  // 2. 源标签 / 时间戳 / 业务标签
  result = stripSourceTags(result);
  result = stripTimestamps(result);
  result = stripMarkdownHeaders(result);
  result = stripBusinessTagsForBubble(result);
  if (!options?.keepCitations) {
    result = stripQuotes(result);
  }
  // 3. backtick / markdown link (chatParser 老行为: 剥 url 留 text)
  result = stripBackticks(result);
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 4. markdown bold / dividers
  result = stripMarkdownBold(result);
  result = stripMarkdownDividers(result);
  // 5. 老翻译标记
  result = stripLegacyTrans(result);
  // 6. 收尾
  result = collapseWhitespace(result);
  return result;
}

// ─── Segments API (amsg-instant 0.8+ pushPayloads) ─────────────────────────

/**
 * 一段内容 → 一条 push.
 *  - `raw`: 给客户端 `message` 字段, 保留 SEND_EMOJI / [html] / <翻译> / <语音> /
 *           [[QUOTE|引用]] 等业务标签让 applyAssistantPostProcessing Step 5/7/8/9 +
 *           Chat.tsx extractVoiceTag 正确接管 (HTML 卡 / 引用回复 / 双语气泡 / sticker / 语音条)
 *  - `sanitized`: 给 `notification.body`, OS banner 显示用的可读 placeholder
 *
 * 两个字段在大多数 chunk 上是一样的 (普通文本); 只有原子单元 (SEND_EMOJI / [html] /
 * <翻译> / <语音>) 时两者才分叉.
 */
export interface Segment {
  raw: string;
  sanitized: string;
}

interface ProtectedAtomSegment {
  raw: string;
  sanitized: unknown;
  protect: boolean;
}

/**
 * worker push notification + bubble 共用的分段器.
 *
 * 算法:
 *  1. Phase 1   — 全文 strip suppress content (think 块 / INNER_STATE / 业务标签 /
 *                  时间戳 leak / source tag / 历史 leak / divider / 老 trans). 必须先全文
 *                  跑, 因为 think 跨多行, 单行 chunk 看不到完整块.
 *  1.5. Phase 1.5 — 用 amsg-instant 标准保护分段器识别客户端要二次消费的"原子语义块",
 *                   防止 chunkText 按 \n 把它们切碎: [html]...[/html] / <翻译>...</翻译> /
 *                   <语音>...</语音>. 保护块两侧按旧逻辑补 \n, 让 chunkText 必把它独立成 chunk.
 *  2. Phase 2   — chunkText: 按 `\n` 切 + 按 CJK 字符之间的空格切, 跟客户端
 *                  `chatParser.chunkText` 字节对齐 (LLM 在 prompt 引导下用换行断句).
 *  3. Phase 3   — 还原占位符 (独占 chunk → 直接成单 segment; 同行 inline → 替换回原文 +
 *                  banner 兜底). 每个文字 chunk 内拆 SEND_EMOJI 独立成段, 文字段跑
 *                  banner-only 替换 (markdown link / [html] / markdown header/bold/backtick /
 *                  引用 / <翻译> / <语音>).
 *
 * 不切句号 — 客户端 chunkText 也不切, 保持气泡数 == banner 数.
 *
 * 引用 ([[QUOTE|引用]] / [回复 "..."]) 跟 SEND_EMOJI 一样**不**剥, 留给客户端
 * applyAssistantPostProcessing Step 7 / per-chunk QUOTE_RE 配对设置 aiReplyTarget.
 * banner 那边在 sanitizeTextForBanner 里单独剥, 保证通知干净.
 *
 * 返回空数组的情况: LLM 整段输出 sanitize 完只剩 think / 业务标签 / 空白 — 此时
 * 不发任何 banner / bubble (skip-push 语义).
 */
export function sanitizeIntoSegments(text: string): Segment[] {
  // Phase 1: 全文 suppress
  let cleaned = stripLiteralBackslashN(text);
  cleaned = stripThinkBlocks(cleaned);

  // Phase 1.5: 原子语义块交给 amsg-instant 标准 protected-block splitter 识别,
  // 再桥回旧 pipeline。这样只替换"如何保护原子块", 不改变后续清洗/分段语义。
  const ATOM_MARKER = String.fromCharCode(2);
  const atomBlocks: Segment[] = [];
  const atomSegments = segmentTextWithProtectedBlocks(cleaned, {
    splitText: (plainText: string) => [plainText],
    protectedPatterns: [
      {
        pattern: /\[html\][\s\S]*?\[\/html\]/i,
        preview: '[HTML 卡片]',
      },
      {
        pattern: /<翻译>\s*<原文>([\s\S]*?)<\/原文>\s*<译文>[\s\S]*?<\/译文>\s*<\/翻译>/,
        preview: (_raw: string, match: RegExpMatchArray) => (match[1] || '').trim() || '[翻译]',
      },
      {
        pattern: /<(语音|語音)>([\s\S]*?)<\/\1>/,
        preview: (_raw: string, match: RegExpMatchArray) => (match[2] || '').trim() || '[语音]',
      },
    ],
  }) as ProtectedAtomSegment[];
  cleaned = atomSegments.map((seg) => {
    if (!seg.protect) return seg.raw;
    const idx = atomBlocks.length;
    atomBlocks.push({
      raw: seg.raw,
      sanitized: typeof seg.sanitized === 'string'
        ? seg.sanitized
        : sanitizeTextForBanner(seg.raw),
    });
    return `\n${ATOM_MARKER}B${idx}${ATOM_MARKER}\n`;
  }).join('');

  cleaned = extractTranslationOriginal(cleaned); // 兜底吃残留的 <译文> / <翻译> 标签
  cleaned = stripInnerState(cleaned);
  cleaned = stripBusinessTagsForNotification(cleaned);
  cleaned = stripTimestamps(cleaned);
  cleaned = stripChineseDate(cleaned);
  cleaned = stripRoleNamePrefix(cleaned);
  cleaned = stripSourceTags(cleaned);
  // 注意: 这里**不**剥 stripQuotes — 引用要带到客户端让 Step 7 配 aiReplyTarget.
  // sanitizeTextForBanner 单独剥引用给 notification.
  cleaned = stripLegacyTrans(cleaned);
  cleaned = stripMarkdownDividers(cleaned);

  // Phase 2: chunk 跟客户端 chatParser.chunkText 同算法 (内联避免 import chatParser
  // 把 DB / React / Capacitor 依赖拖进 worker bundle)
  const rawChunks = chunkText(cleaned);

  // Phase 3: 还原原子块占位符 + 拆 SEND_EMOJI + banner-only 替换
  const SOLO_RE = new RegExp(`^${ATOM_MARKER}B(\\d+)${ATOM_MARKER}$`);
  const GLOBAL_RE = new RegExp(`${ATOM_MARKER}B(\\d+)${ATOM_MARKER}`, 'g');
  const segments: Segment[] = [];
  for (const rawChunk of rawChunks) {
    const soloMatch = rawChunk.trim().match(SOLO_RE);
    if (soloMatch) {
      const blk = atomBlocks[Number(soloMatch[1])];
      if (blk) segments.push({ raw: blk.raw, sanitized: blk.sanitized });
      continue;
    }
    const parts = splitOnSendEmoji(rawChunk);
    for (const part of parts) {
      if (part.kind === 'emoji') {
        segments.push({
          raw: `[[SEND_EMOJI: ${part.name}]]`,
          sanitized: `[表情：${part.name}]`,
        });
        continue;
      }
      // 安全网: 占位符跟正文同行 (chunkText 没拆开) 时把整块还原回 raw,
      // sanitized 路径 sanitizeTextForBanner 会再把 [html]/<翻译>/<语音>/引用 折成 placeholder.
      let rawText = part.text.replace(
        GLOBAL_RE,
        (_m, n) => atomBlocks[Number(n)]?.raw || '',
      );
      rawText = rawText.trim();
      if (!rawText) continue;
      const sanitized = sanitizeTextForBanner(rawText).trim();
      if (!sanitized) continue;
      segments.push({ raw: rawText, sanitized });
    }
  }
  return segments;
}

/**
 * 单个文字 chunk 的 banner-side 替换. 不动 raw 文字, 只产 sanitized 版本.
 * SEND_EMOJI 已经在 splitOnSendEmoji 阶段独立成段, 这里不处理.
 *
 * 注意: 引用 / <翻译> / <语音> 在 sanitizeIntoSegments Phase 1.5 protect 路径里
 * 已经被占位符兜走, 走到这里的只可能是同行 inline / 残留 / 老格式 — 这里全部
 * 强制剥成 banner 友好的形态, 保证通知干净.
 */
function sanitizeTextForBanner(text: string): string {
  let result = text;
  result = replaceHtmlBlocks(result);            // [html]...[/html] → [HTML 卡片]
  result = replaceTranslationForBanner(result);  // <翻译>...</翻译> → 原文
  result = replaceVoiceForBanner(result);        // <语音>...</语音> → 内部文字
  result = stripQuotes(result);                  // 引用 / 回复 → ''
  result = replaceEmojiReverseTag(result);       // [xxx 发送了表情包: yyy] → [表情：yyy]
  result = replaceMarkdownLinks(result);         // [text](url) → [链接：text]
  result = stripMarkdownHeaders(result);
  result = stripMarkdownBold(result);
  result = stripBackticks(result);
  result = collapseWhitespace(result);
  return result;
}

/**
 * `chatParser.chunkText` 的无依赖版本. 行为字节对齐:
 *  1. 按换行符切 (\n / \r\n / \r /   /  )
 *  2. 每个 chunk 再按 CJK 字符之间的空格切 (中文里本不该有空格 = LLM 想断行)
 *  3. trim + filter empty
 */
function chunkText(text: string): string[] {
  const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef\\u2000-\\u206f\\u2e80-\\u2eff\\u3001-\\u3003\\u2018-\\u201f\\u300a-\\u300f\\uff01-\\uff0f\\uff1a-\\uff20';
  // No lookbehind (?<=): iOS Safari <16.4 JSC doesn't support it; old devices throw
  // "invalid group specifier name" at new RegExp. Capture the left CJK char + zero-width
  // lookahead on the right, restore via $1. Byte-equivalent (see utils/lookbehindFree.test.ts).
  const cjkSplitRe = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');
  const SPLIT = String.fromCharCode(1);  // CJK split marker (distinct slot from SPACE_SENTINEL below)

  const lineChunks = text.split(/(?:\r\n|\r|\n|\u2028|\u2029)+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  // 括号内的空格要保护: 否则裸括号表情包 / 标签 (如 "[你 交给我吧]" 或 "[[SEND_EMOJI: a b]]")
  // 会被 CJK-空格断行规则劈成 "[你" + "交给我吧]" 掉格式. 先把 [...] / [[...]] 内空格换成
  // 占位符, split 后再换回. 跟 chatParser.chunkText 同一份逻辑, 保持字节对齐.
  const SPACE_SENTINEL = String.fromCharCode(0);
  const out: string[] = [];
  for (const chunk of lineChunks) {
    const guarded = chunk.replace(/\[{1,2}[^\[\]]*\]{1,2}/g, (m) => m.replace(/\s/g, SPACE_SENTINEL));
    const sub = guarded.replace(cjkSplitRe, `$1${SPLIT}`).split(SPLIT)
      .map((c) => c.split(SPACE_SENTINEL).join(' ').trim())
      .filter((c) => c.length > 0);
    out.push(...sub);
  }
  return out;
}

/**
 * 把 chunk 里的 `[[SEND_EMOJI: 名称]]` 拆出来当独立 part. 跟客户端
 * `chatParser.splitResponse` 行为对齐 (输出 shape 不同, 这里用 kind 字段区分).
 */
function splitOnSendEmoji(chunk: string): Array<
  | { kind: 'text'; text: string }
  | { kind: 'emoji'; name: string }
> {
  const re = /\[\[SEND_EMOJI:\s*(.*?)\]\]/g;
  const parts: Array<{ kind: 'text'; text: string } | { kind: 'emoji'; name: string }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ kind: 'text', text: chunk.slice(lastIndex, m.index) });
    }
    parts.push({ kind: 'emoji', name: m[1].trim() });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < chunk.length) {
    parts.push({ kind: 'text', text: chunk.slice(lastIndex) });
  }
  if (parts.length === 0 && chunk) parts.push({ kind: 'text', text: chunk });
  return parts;
}
