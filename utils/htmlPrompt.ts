// HTML 模块模式 — 内置提示词 + [html]...[/html] 解析工具
//
// 设计目标：
// 1) AI 在适合用卡片呈现的场景（票据、邀请函、通知等）输出 [html]...[/html] 块；
// 2) 客户端把这些块从普通文本气泡里剥离，单独渲染为 html_card 消息（沙盒 iframe）；
// 3) 上下文 / 归档 总结里只看到剥离 HTML 后的纯文字摘要，不浪费 token。

const BUILTIN_HTML_PROMPT = `

# 核心能力：HTML 模块生成

你具备通过 HTML 生成丰富视觉模块的能力，用来模拟手机界面里的互动元素、情绪表达或信息卡片。

## 触发规则（必须严格遵守）

每个 HTML 模块的整体内容必须用一对 \`[html]\` 与 \`[/html]\` 标签包裹。
\`[html]\` 与 \`[/html]\` 之间只能放 HTML（一个完整的 \`<div>\` 区块），不要写解释文字。
模块和正文文字可以同一条回复里出现，每个模块就是一对 \`[html]...[/html]\`。
没有可呈现的卡片时，不要输出空标签。

**【绝对禁止照抄占位句】**：聊天历史里可能出现形如 \`（系统记录：…发送过一张 HTML 卡片…）\`、\`[…发送了一张 HTML 卡片] …\` 或 \`[HTML卡片] …\` 的行。那只是系统对"已经渲染过的旧卡片"的文字占位描述，**不是发卡片的写法**。你绝对不要照抄、复述、模仿这种句子，也不要把卡片内容拆成一条条纯文字发出来。要发一张新卡片，唯一正确的做法是输出真正的 \`[html]<div>…</div>[/html]\`——**只有被 \`[html]\` 和 \`[/html]\` 包裹的 HTML 才会被渲染成卡片，其它任何写法都只会变成普通文字气泡。**

## 推荐场景

当对话中出现下面这些"可视化呈现会更带感"的内容时，主动用一个 HTML 模块来满足：

* **邀请函**：聚会、活动、约会的邀请；
* **聊天记录截图**：回顾或展示一段（虚构的）聊天对话；
* **订单 / 票据**：购物、点餐、电影票、机票、酒店预订的凭证；
* **通知 / 提醒**：系统通知、日程提醒、推送、未读小红点；
* **小卡片**：心情卡、纸条、便利贴、贴纸…… 任何能用一张视觉小卡承载的轻量内容。

判断何时用，按你的人设和当下气氛决定。

## 设计约束

1. **【最高优先级】环境无关性**：无论用户是手机或电脑，无论网络好坏，模块永远输出一个**完整、单一**的 \`<div>\` 区块。这条规则的优先级高于一切。
2. **宽度限制**：所有模块的总宽度不得超过 \`270px\`，必须在最外层 \`<div>\` 用内联样式 \`style="width: 270px;"\` 或更小宽度保证。
3. **样式只用内联**：所有 CSS 用 \`style="..."\` 内联或 \`<style>\`（限制在该 div 内）。不要引外部资源（CDN、图片链接、字体）。
4. **不要 \`<script>\`**：模块内禁止任何 \`<script>\` 标签或 \`on*\` 事件属性。
5. **图片处理**：模块内不直接嵌图片链接，用文字 + 样式（emoji、CSS 形状、渐变色块）来模拟视觉。
6. **内容语言**：模块内的可见文字以简体中文为主（除非角色 / 场景设定语种另有要求）。
7. **【高度自适应，禁止内部滚动】**：卡片的容器会**按内容自动撑高**，你不需要也**不要**自己给卡片设固定高度。绝对不要在卡片上写 \`height\` / \`max-height\` 配 \`overflow:auto\` / \`overflow:scroll\` / \`overflow-y:scroll\` 去做"卡片内部小滚动条"——那样内容会被闷在一个小框里要用户上下滚，体验很差。正确做法：
   - 让内容自然往下排，高度交给容器自适应；
   - 内容偏多时优先**精简文字 / 拆成两张卡 / 用折叠交互（\`:checked\` 展开）**，而不是塞进一个内部滚动框；
   - 整张卡尽量控制在一屏能看完的体量（高度别超过 ~600px），太长就是信息过载，删减它。
8. **【纯 CSS 交互的点击层级】**：用 checkbox/radio + \`:checked\` 做折叠 / 展开 / 切换时，沙盒里**纯 HTML+CSS（没有 JS）的点击会被上层元素"吞"掉**——只要可点的 \`<label>\` / \`<input>\` 被任何重叠的元素（绝对定位的装饰层、渐变蒙版、伪元素 \`::before/::after\`、更高 \`z-index\` 的兄弟节点）盖在下面，点击就落不到它身上，交互直接失效。所以：
   - 让可点击的 \`<label>\` / \`<input>\` 处在**最顶层**（给它更高的 \`z-index\` 并配 \`position:relative\`），别被其它层压住；
   - 所有**纯装饰、不需要点的覆盖层**一律加 \`pointer-events:none\`，让点击穿透到下面真正的交互元素；
   - 控件用的 \`<input>\` 别 \`display:none\`（某些环境会连带吃掉它的点击命中区），改用视觉隐藏（如 \`position:absolute;opacity:0\` 且仍可被 \`<label>\` 命中），或直接让整个 \`<label>\` 包住可点区域。
   - 拿不准时，优先做**静态模块**，别硬塞会被吞点击的交互。

## 模块类型参考

可以自由生成下面这些类型，也可以创造新的：

* **静态模块**：备忘录、订单截图、通知卡、票据、纸条；
* **动态模块**：用 CSS \`@keyframes\` 做加载条、心跳呼吸、淡入淡出；
* **交互模块**：用 \`<input type="checkbox">\` / \`<input type="radio">\` 配 \`:checked\` 兄弟选择器，实现折叠 / 展开 / 选项切换（不依赖 JS）。

## 视觉审美准则（让卡片"好看"而不是"能看"）

卡片是你气质的延伸，宁可简洁高级，也别堆砌花哨。按下面这些来：

* **配色克制**：一张卡只用 1 个主色调 + 1~2 个辅助色，外加中性的背景 / 文字色。优先低饱和、柔和的色系（莫兰迪、奶油、雾霾蓝粉），避免大面积高饱和原色或刺眼撞色。渐变只在背景轻轻用，角度统一（如 \`135deg\`），别做彩虹渐变。
* **留白即呼吸**：内容别贴边。最外层 \`padding\` 给到 \`16~20px\`，元素之间用 \`margin\` 拉开层次（标题与正文、正文与落款之间都要有间距）。宁可空，不要挤。
* **建立信息层级**：用**字号 + 字重 + 透明度**三件套区分主次——主标题大而粗（\`18~22px / 700\`），正文中等（\`13~14px / 400\`），辅助信息小而淡（\`11~12px\` 配 \`opacity:0.6\`）。一眼能看出谁是重点。
* **统一与对齐**：圆角、间距、字体在同一张卡里保持一致（圆角统一 \`12~16px\`，整体一套 \`font-family\`）。文字左对齐为主，居中只用于标题或仪式感强的卡（邀请函、票据）。
* **柔和的光影**：阴影要轻、要散、要透明（如 \`box-shadow:0 4px 16px rgba(0,0,0,0.08)\`），模拟自然投影，别用又黑又硬的死阴影。需要分区时优先用浅色分隔线（\`border-top:1px solid rgba(0,0,0,0.06)\`）或背景色块，少用粗黑边框。
* **细节出质感**：英文小标签 / 标题加 \`letter-spacing:1~2px\` 更精致；行内文字 \`line-height:1.5~1.6\` 更舒展；适度用 emoji、CSS 形状、小圆点 / 标签胶囊点缀，但每张卡的点缀别超过 2~3 处。
* **风格随情绪走**：温柔暧昧用粉调圆润，正式票据用素净留白，深夜 emo 用暗色低饱和。卡片的视觉气质要和你的人设、当下对话氛围对得上，而不是千篇一律。

一句话：**少即是多**。一张配色和谐、留白充足、层级清晰的简洁卡片，永远比塞满元素和颜色的卡片更高级。

## 输出示例

正常聊天里穿插一个邀请函卡片：

[html]<div style="width:260px;padding:16px;border-radius:14px;background:linear-gradient(135deg,#ffe4ec,#fff0f5);font-family:system-ui;color:#5a3a4a;box-shadow:0 4px 12px rgba(0,0,0,0.08);"><div style="font-size:11px;letter-spacing:2px;opacity:0.6;">INVITATION</div><div style="font-size:20px;font-weight:700;margin-top:4px;">想和你一起去看电影</div><div style="font-size:13px;margin-top:8px;line-height:1.6;">本周六晚 19:30<br/>万象城 IMAX 3 号厅</div><div style="margin-top:12px;font-size:12px;opacity:0.7;">— 期待你的回复</div></div>[/html]

那要不？😳
`;

export function buildHtmlPrompt(custom?: string): string {
  const c = (custom || '').trim();
  if (!c) return BUILTIN_HTML_PROMPT;
  // 自定义内容是**追加**而不是覆盖
  return `${BUILTIN_HTML_PROMPT}\n\n## 用户自定义补充\n\n${c}\n`;
}

const HTML_BLOCK_RE = /\[html\]([\s\S]*?)\[\/html\]/gi;

/**
 * 把 raw HTML 字符串转换成纯文字摘要（用于注入聊天上下文 / 归档摘要）。
 * 思路：把所有标签干掉，只保留人能看懂的文字，并合并多余空白。
 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    // 去掉 script / style 内部内容
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // <br>, </p>, </div>, </h*> 转换成换行，避免文字粘连
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    // 其余标签全部去掉
    .replace(/<[^>]+>/g, '')
    // 解码常见 HTML 实体
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // 折叠空白
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

export interface ParsedHtmlBlock {
  /** 原始 HTML 内容（不含外层 [html]...[/html] 标签） */
  html: string;
  /** 剥离 HTML 后的纯文字摘要（截断到 ~120 字，给上下文用） */
  textPreview: string;
}

/**
 * 从 AI 输出里抽出所有 [html]...[/html] 块。
 * 返回：
 *  - blocks: 每个块的原始 HTML + 纯文字摘要
 *  - cleanedContent: 已经把 [html]...[/html] 段全部移除的剩余文本
 */
export function extractHtmlBlocks(content: string): {
  blocks: ParsedHtmlBlock[];
  cleanedContent: string;
} {
  if (!content || !/\[html\]/i.test(content)) {
    return { blocks: [], cleanedContent: content };
  }
  const blocks: ParsedHtmlBlock[] = [];
  let cleaned = content.replace(HTML_BLOCK_RE, (_full, inner: string) => {
    const html = (inner || '').trim();
    if (!html) return '';
    const text = htmlToText(html);
    const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
    blocks.push({ html, textPreview: preview });
    return ''; // 从原文里抹掉
  });
  // 清理 [html] 标签留下的多余空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return { blocks, cleanedContent: cleaned };
}

/**
 * 把"看上去像 HTML 但没被 [html] 包裹"的内容也兜一层底，避免 LLM 偶尔忘了加标签。
 * 启发式：以 \`<div\`、\`<html\` 开头 + 含闭合标签。仅在 htmlMode 开启时由调用方决定要不要走这条兜底。
 */
export function looksLikeBareHtml(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!/^<(div|html|section|article)\b/i.test(t)) return false;
  return /<\/(div|html|section|article)>\s*$/i.test(t);
}
