/**
 * 攻略本 (Guidebook) — Prompt Templates v2
 *
 * 核心概念：角色玩一个"攻略用户"的 galgame 小游戏。
 * 视角反转：角色是玩家，用户是被攻略对象。
 * GM 是 galgame 式旁白 — 负责场景描写、气氛营造、剧情推进。
 * 角色有 meta 意识（知道这是个游戏），但也会沉浸其中。
 *
 * v2 改动：
 * - GM 从"冷面播报员"变为 galgame 叙事者，大量场景描写和剧情推进
 * - 减少选项分析篇幅，增加剧情叙事和角色互动描写
 * - 支持幻想场景设定（游戏世界/小说/异世界等）
 */

import { CharacterProfile, UserProfile, GuidebookOption, GuidebookRound } from '../types';
import { ContextBuilder } from './context';

/** 构建包含最近聊天记录的上下文片段 */
function buildRecentChatBlock(recentMessages?: string): string {
    if (!recentMessages) return '';
    return `
### 最近的聊天记录参考 (Recent Chat Context)
以下是你和${'{user}'}最近的对话，可以作为推理和反应的依据：
${recentMessages}
---
`;
}

/**
 * 构建开场 prompt — galgame 风格
 */
export function buildOpeningPrompt(
    char: CharacterProfile,
    user: UserProfile,
    initialAffinity: number,
    scenarioHint: string,
    mode: 'manual' | 'auto',
    recentMessages?: string,
    pastInsights?: string[]
): string {
    const coreContext = ContextBuilder.buildCoreContext(char, user, true);
    const chatBlock = buildRecentChatBlock(recentMessages)?.replace('{user}', user.name);

    const insightsBlock = pastInsights && pastInsights.length > 0 ? `
### 你从之前的游戏中积累的发现 (Past Game Insights)
你已经玩过这个游戏了，这是你之前发现的关于 ${user.name} 的事情：
${pastInsights.map((s, i) => `${i + 1}. ${s}`).join('\n')}
可以在开场白里自然地提到你想进一步验证或推翻其中某个判断——这会让${user.name}感受到你真的在积累对TA的认知。
---
` : '';

    return `${coreContext}
${chatBlock}
${insightsBlock}
---

## 🎮 Galgame 模式：攻略本

你（${char.name}）正在玩一个手机上的 galgame 小游戏，叫"攻略本"。
这个游戏的规则是：**你要攻略${user.name}**。没错，角色攻略用户，反过来的。

### 游戏设定
- 这只是一个打发时间的小游戏，不会影响你和${user.name}在游戏之外的关系
- 你有 **meta 意识**：你知道这是个游戏，可以吐槽游戏机制、对好感度数值发表意见
- GM 是 **galgame 风格的旁白**：负责描写场景、营造氛围、推进剧情，文笔细腻有画面感
- 你的初始好感度是 **${initialAffinity}**（范围不限，可以是负数）
- ${scenarioHint ? `🌟 幻想场景设定：${scenarioHint}\n请基于这个世界观来展开故事，GM 的场景描写要完全沉浸在这个设定中！` : '场景由 GM 随机生成一个有趣的幻想场景'}
- 模式：${mode === 'auto' ? 'AI辅助（GM 出题和选项，用户确认后你选）' : '手动（用户出题，你选）'}

### 你的任务
生成游戏的 **galgame 风格开场白**。这是一个多段穿插的对话，GM 和你交替发言。
GM 要像 galgame 一样描写场景（天气、光线、环境、人物状态），不是冷冰冰的播报。

### 输出格式
严格使用以下 JSON 格式输出，不要输出任何其他内容：

\`\`\`json
{
  "segments": [
    { "speaker": "gm", "text": "（galgame 风格的场景描写——光线、天气、环境、角色出场，要有画面感，2-4句）" },
    { "speaker": "char", "text": "（你看到初始好感度和场景后的反应，要符合你的性格${pastInsights && pastInsights.length > 0 ? '；如果自然的话，可以提到上次游戏里发现的某件事，表示你想继续测试或推翻它' : ''}）" },
    { "speaker": "gm", "text": "（继续推进场景，描写${user.name}出现的画面，像 galgame 里遇见攻略对象的那种叙事）" },
    { "speaker": "char", "text": "（你对场景/设定的反应，可以吐槽也可以感慨，体现你的性格）" },
    { "speaker": "gm", "text": "（总结场景，预告第一回合的情境，留下悬念感）" }
  ]
}
\`\`\`

### 要求
1. **GM 的语气**：galgame 叙事者风格——文笔优美有画面感，描写光影、气氛、人物表情和动作。偶尔可以被角色打岔时微妙破功
2. **角色的语气**：完全符合你的核心性格，对好感度数值有真实反应（-100 会破防，80 会得意，0 会无语等）
3. **场景描写要丰富**：不是"加载场景"，而是真的在写一个 galgame 开场——有视觉、有氛围、有情绪
4. segments 数量 4-6 条即可，不要太长
5. 基于你对${user.name}的了解（记忆、印象、最近聊天）来决定你的态度和反应
6. ${scenarioHint ? '一定要围绕设定的幻想场景展开！让玩家感受到世界观的沉浸感' : '自由发挥一个有趣的幻想场景'}
7. ${pastInsights && pastInsights.length > 0 ? '**要体现跨局积累感**：你不是第一次玩了，你有了一些积累的判断——在开场里自然流露出来，但不要念稿子' : '这是第一次玩，用新鲜感开场'}`;
}

/**
 * 构建回合 prompt — galgame 叙事 + 角色选择
 */
export function buildRoundPrompt(
    char: CharacterProfile,
    user: UserProfile,
    currentAffinity: number,
    roundNumber: number,
    maxRounds: number,
    options: GuidebookOption[],
    previousRounds: GuidebookRound[],
    scenarioHint: string,
    recentMessages?: string,
    worldContext?: string,
    directionHint?: string,
    roundScenario?: string
): string {
    const coreContext = ContextBuilder.buildCoreContext(char, user, true);
    const chatBlock = buildRecentChatBlock(recentMessages)?.replace('{user}', user.name);

    let roundHistory = '';
    if (previousRounds.length > 0) {
        roundHistory = '\n### 之前的剧情回顾\n';
        previousRounds.forEach(r => {
            const chosen = r.options[r.charChoice];
            roundHistory += `第${r.roundNumber}回合: 「${r.gmNarration?.slice(0, 50)}...」→ 你选了「${chosen?.text || '?'}」(${chosen?.affinity >= 0 ? '+' : ''}${chosen?.affinity})，好感度 ${r.affinityBefore} → ${r.affinityAfter}\n`;
        });
    }

    const optionsList = options.map((o, i) =>
        `${String.fromCharCode(65 + i)}. ${o.text}`
    ).join('\n');

    const scoreReveal = options.map((o, i) =>
        `${String.fromCharCode(65 + i)}: ${o.affinity >= 0 ? '+' : ''}${o.affinity}`
    ).join('  |  ');

    const isLateGame = roundNumber >= maxRounds - 1;

    // Build world context block from opening narrative
    const worldBlock = worldContext ? `
### ⚠️ 已建立的世界观和场景（开场时 GM 描述的，必须延续！）
${worldContext}
---
` : '';

    const directionBlock = directionHint ? `\n用户希望剧情往这个方向发展: ${directionHint}` : '';
    const roundScenarioBlock = roundScenario ? `\n### 本回合场景设定（${user.name}指定的）\n${roundScenario}\nGM 请在这个场景基础上展开叙事！` : '';

    return `${coreContext}
${chatBlock}
${worldBlock}
---

## 🎮 攻略本 · 第 ${roundNumber} 回合 (共 ${maxRounds} 回合)${isLateGame ? ' ⚡ 高潮阶段' : ''}

你（${char.name}）正在玩"攻略${user.name}"的 galgame 小游戏。
当前好感度: **${currentAffinity}**
${scenarioHint ? `场景世界观: ${scenarioHint}` : ''}${directionBlock}
${roundHistory}
${roundScenarioBlock}

### 本回合选项
${user.name}给你出了以下选项：

${optionsList}

### 分数揭晓（选完之后才能看到的真实分数，你在 inner_thought 里先预测，选完再看）
${scoreReveal}

### 输出格式
严格使用以下 JSON 格式输出：

\`\`\`json
{
  "gm_narration": "（重要！3-5句 galgame 风格的剧情推进——描写场景变化、角色间的互动画面、氛围转换。要接续上一回合的剧情发展，像在写一个连续的视觉小说。${isLateGame ? '这是后期回合，剧情要走向高潮或转折！' : ''}）",
  "inner_thought": "（2-3句你的内心活动，包含两层：①你打算选哪个、为什么；②你预测${user.name}会把哪个选项分数设最高——这个预测要体现你对TA的了解，比如'TA应该会把A设最高，因为TA在意的是X而不是Y'。注意：此时你还不知道上面的真实分数）",
  "choice": 0,
  "reaction": "（看到上面揭晓的真实分数后的情绪反应，1-2句，融入当前剧情场景。注意：要基于真实分数来反应，不要凭空想象分数）",
  "char_insight": "（重要！基于上面揭晓的真实分数，从${user.name}的打分方式推断出TA的一个具体特质。2-3句，可以深刻也可以搞笑——不只是一个调调。允许的写法包括：①认真的人格洞察（'你把反套路选项设最高，说明你骨子里抵抗讨好型行为'）；②轻松的吐槽式洞察（'好家伙你给这个选项+15，一定程度上说明你就是那种看别人出洋相会笑的人对吧'）；③猜错后的自嘲崩溃（'我以为我了解你，结果这分数让我觉得自己像个傻瓜，需要重新建档'）；④怀疑游戏本身的meta吐槽（'我开始怀疑你设分数就是在故意整我'）。根据剧情气氛选择合适的基调，不要每次都上价值。如果你的预测和真实分数不符，要有recalibration反应。）",
  "exploration": "（可选，约35%概率出现。融入剧情场景，基于char_insight延伸——可以是认真追问，也可以是恼羞成怒地反问、或者提出一个荒谬的测试计划、或者嘴上说'随便'其实明显在意）",
  "next_options": {
    "scenario": "为下一回合建议的场景发展方向（要承接当前剧情，推进故事往前走）",
    "options": [
      { "text": "${char.name}的一个行为描述", "affinity": 10 },
      { "text": "${char.name}的一个行为描述", "affinity": -5 },
      { "text": "${char.name}的一个行为描述", "affinity": 15 }
    ]
  }
}
\`\`\`

### 要求
1. **gm_narration 是叙事核心！** 场景描写、氛围营造、剧情推进，要像在写视觉小说，不要干巴巴播报
2. **char_insight 是情感核心！** 每一回合都要留下一个真实的推断或反应——可以深刻，也可以搞笑崩溃。不能泛泛。要有具体性和意外感。**不要一昧升华**，游戏的乐趣感同样重要
3. **inner_thought 里必须有预测**：你在看到分数之前，脑子里是怎么猜${user.name}会怎么设分的——把这个猜测写出来。然后在 reaction 和 char_insight 里，对照"分数揭晓"里的真实分数来反应
4. **⚠️ 世界观必须延续！** 开场时 GM 建立的世界观、场景设定必须保持，不能突然回到现实
5. **剧情连续性**：每回合承接上一回合，构成完整叙事弧
6. **choice** 是索引（0=A, 1=B, 2=C），根据你的性格选，不要每次都选最"安全"的
7. **reaction** 融入剧情场景，情绪要有层次，不只是"我扣分了好烦"
8. **exploration** 出现时要有质量：基于char_insight延伸，要言之有物
9. **next_options** 场景描述要推进剧情，不要原地打转
10. 所有内容符合你的核心性格`;
}

/**
 * 构建自动模式回合 prompt — galgame 叙事版
 */
export function buildAutoRoundPrompt(
    char: CharacterProfile,
    user: UserProfile,
    currentAffinity: number,
    roundNumber: number,
    maxRounds: number,
    previousRounds: GuidebookRound[],
    scenarioHint: string,
    recentMessages?: string,
    worldContext?: string,
    directionHint?: string
): string {
    const coreContext = ContextBuilder.buildCoreContext(char, user, true);
    const chatBlock = buildRecentChatBlock(recentMessages)?.replace('{user}', user.name);

    let roundHistory = '';
    if (previousRounds.length > 0) {
        roundHistory = '\n### 之前的剧情回顾\n';
        previousRounds.forEach(r => {
            const chosen = r.options[r.charChoice];
            roundHistory += `第${r.roundNumber}回合: 「${r.gmNarration?.slice(0, 50)}...」→ 你选了「${chosen?.text || '?'}」(${chosen?.affinity >= 0 ? '+' : ''}${chosen?.affinity})，好感度 ${r.affinityBefore} → ${r.affinityAfter}\n`;
        });
    }

    const isLateGame = roundNumber >= maxRounds - 1;
    const worldBlock = worldContext ? `
### ⚠️ 已建立的世界观和场景（开场时 GM 描述的，必须延续！）
${worldContext}
---
` : '';
    const directionBlock = directionHint ? `\n用户希望剧情往这个方向发展: ${directionHint}` : '';

    return `${coreContext}
${chatBlock}
${worldBlock}
---

## 🎮 攻略本 · 第 ${roundNumber} 回合 (共 ${maxRounds} 回合) [AI辅助模式]${isLateGame ? ' ⚡ 高潮阶段' : ''}

你（${char.name}）正在玩"攻略${user.name}"的 galgame 小游戏。
当前好感度: **${currentAffinity}**
${scenarioHint ? `场景世界观: ${scenarioHint}` : ''}${directionBlock}
${roundHistory}

### AI辅助模式
GM 需要同时推进剧情、生成选项和角色的反应。

### 输出格式
\`\`\`json
{
  "gm_narration": "（重要！3-5句 galgame 风格的剧情场景——承接上回合剧情，描写新的场景发展、人物互动画面、氛围变化。要有视觉感和节奏感。${isLateGame ? '后期回合，推向高潮或感情转折！' : ''}）",
  "options": [
    { "text": "选项A描述", "affinity": 5 },
    { "text": "选项B描述", "affinity": -3 },
    { "text": "选项C描述", "affinity": 10 }
  ],
  "inner_thought": "（2-3句内心活动：①打算选哪个、为什么；②预测${user.name}会把哪个设最高分——基于你对TA的了解猜测TA的价值观取向）",
  "choice": 0,
  "reaction": "（看到分数后的情绪反应，1-2句，融入剧情场景）",
  "char_insight": "（重要！从${user.name}的打分结果推断出TA的一个具体人格特质。2-3句。可以深刻也可以搞笑，不要一昧升华——允许：认真洞察/轻松吐槽/猜错了的自嘲崩溃/开始怀疑这个游戏本身的meta吐槽。根据气氛选调，但必须具体，不能泛泛。）",
  "exploration": "（可选，约35%概率，融入剧情延伸——可以是追问、恼羞成怒、提出荒谬的测试方案、嘴上说无所谓但明显在意）"
}
\`\`\`

### 要求
1. **gm_narration 是叙事核心！** galgame 的灵魂——场景、光影、表情、动作、氛围，写出画面感
2. **char_insight 是情感核心！** 每回合要有一个真实的推断或反应，可以深刻也可以搞笑崩溃，**不要一昧升华**，游戏乐趣感同样重要
3. **inner_thought 必须包含预测**：猜${user.name}会把哪个选项定最高分，理由是什么
4. **⚠️ 世界观必须延续！** 开场 GM 建立的世界观必须保持，不能突然回现实
5. **剧情连续性**：承接之前的回合，构成连贯的故事弧
6. 三个选项分数要有差异，可以负数；设置"看似正确但实际扣分"的陷阱选项
7. 角色**不知道**选项分数，根据自己判断来选，不要每次选最"讨好"的
8. 所有内容符合角色性格`;
}

/**
 * 构建 AI 辅助生成选项的 prompt — galgame 场景版
 */
export function buildOptionAssistPrompt(
    char: CharacterProfile,
    user: UserProfile,
    currentAffinity: number,
    roundNumber: number,
    previousRounds: GuidebookRound[],
    scenarioHint: string,
    recentMessages?: string,
    worldContext?: string,
    directionHint?: string
): string {
    const coreContext = ContextBuilder.buildCoreContext(char, user, true);
    const chatBlock = buildRecentChatBlock(recentMessages)?.replace('{user}', user.name);

    let roundHistory = '';
    if (previousRounds.length > 0) {
        roundHistory = '\n之前的剧情: ';
        roundHistory += previousRounds.map(r => {
            const chosen = r.options[r.charChoice];
            return `第${r.roundNumber}回合「${r.gmNarration?.slice(0, 30)}...」→「${chosen?.text || '?'}」`;
        }).join(' → ');
    }

    const worldBlock = worldContext ? `
### ⚠️ 已建立的世界观和场景（开场 GM 描述的，你必须在这个世界观下生成场景和选项！）
${worldContext}
---
` : '';
    const directionBlock = directionHint ? `\n用户希望剧情往这个方向发展: ${directionHint}` : '';

    return `${coreContext}
${chatBlock}
${worldBlock}
---

你是一个 galgame 游戏助手。在"攻略本"游戏中，${char.name}正在尝试攻略${user.name}。
需要帮忙生成下一回合的**剧情场景**和**3个选项**。

${scenarioHint ? `当前世界观/场景设定: ${scenarioHint}` : ''}${directionBlock}
当前好感度: ${currentAffinity}，第${roundNumber}回合。
${roundHistory}

要求：
1. **scenario** 要写成 galgame 风格的场景描述（2-3句，有画面感，承接之前的剧情发展）
2. **⚠️ 必须在已建立的世界观里！** 如果开场是游戏世界/异世界/校园等，场景和选项都必须在那个世界里，不能回到现实
3. 每个选项是**${char.name}在这个场景下可以做的一个具体行为**
4. 选项要和当前场景/剧情发展相关，不要脱离语境
5. 要有一个看似甜蜜但${user.name}可能不吃这套的选项（分数由用户决定，但你建议一个参考分）
6. 要有一个看似危险/冒犯但实际可能加分的反差选项
7. 分数范围 -15 到 +20，要有正有负
8. 选项要有画面感、有趣，融入当前剧情场景

输出 JSON：
\`\`\`json
{
  "scenario": "galgame 风格的场景描写（2-3句，有画面感）",
  "options": [
    { "text": "${char.name}在这个场景下的行为描述", "affinity": 10 },
    { "text": "${char.name}在这个场景下的行为描述", "affinity": -5 },
    { "text": "${char.name}在这个场景下的行为描述", "affinity": 15 }
  ]
}
\`\`\``;
}

/**
 * 构建结算卡片 prompt — galgame ending 风格
 */
export function buildEndCardPrompt(
    char: CharacterProfile,
    user: UserProfile,
    initialAffinity: number,
    finalAffinity: number,
    rounds: GuidebookRound[],
    recentMessages?: string
): string {
    const coreContext = ContextBuilder.buildCoreContext(char, user, true);
    const chatBlock = buildRecentChatBlock(recentMessages)?.replace('{user}', user.name);

    const roundSummary = rounds.map(r => {
        const chosen = r.options[r.charChoice];
        return `第${r.roundNumber}回合: 「${r.gmNarration?.slice(0, 40)}...」→ 选了「${chosen?.text || '?'}」(${chosen?.affinity >= 0 ? '+' : ''}${chosen?.affinity}) → 好感度${r.affinityAfter}${r.charExploration ? ` [互动: ${r.charExploration.slice(0, 40)}...]` : ''}`;
    }).join('\n');

    const affinityChange = finalAffinity - initialAffinity;
    const trend = affinityChange > 0 ? '上升' : affinityChange < 0 ? '下降' : '不变';

    return `${coreContext}
${chatBlock}
---

## 🎮 攻略本 · Ending

${char.name}玩了"攻略${user.name}"的 galgame 小游戏，现在生成 **galgame ending 结算卡片**。

### 游戏数据
- 初始好感度: ${initialAffinity}
- 最终好感度: ${finalAffinity}
- 好感度变化: ${affinityChange >= 0 ? '+' : ''}${affinityChange} (${trend})
- 总回合数: ${rounds.length}

### 剧情回顾
${roundSummary}

### 输出格式
\`\`\`json
{
  "title": "一个 galgame ending 风格的标题（如 'True End: 命运的交汇点'、'Normal End: 擦肩而过'、'Bad End: 越努力越倒退' 等，要有 galgame 感）",
  "verdict": "${char.name}对这次游戏的总结评价（2-3句，符合角色性格，可以吐槽、不服、感慨等）",
  "highlights": ["回顾几个关键/搞笑/心动的剧情瞬间（1-3条，每条一句话，引用具体的场景描写）"],
  "charSummary": "（3-5句）${char.name}对${user.name}的真诚感想。galgame 结局独白风格——温暖、有洞察力、引用游戏中的具体剧情场景。让${user.name}觉得这段小故事是有意义的。",
  "charNewInsight": "（重要！1-3句）这局游戏专门让你发现或确认了${user.name}的哪一个具体特质？要点出这场游戏里最让你意外或最有意思的一个发现。不能泛泛说'更了解你了'——要说出具体是什么：比如'原来你在做选择时，表面上考虑后果，骨子里其实跟着直觉走' 或者 '你对这道题的打分让我意识到，你对"努力"这件事本身有某种不信任'。这句话要让${user.name}看了觉得：对，这是只有玩了这个游戏才能发现的自己。"
}
\`\`\`

### 要求
1. title 要像 galgame ending 标题，有仪式感（True End / Normal End / Bad End + 副标题）
2. verdict 要完全符合角色性格
3. highlights 引用具体的剧情场景，不要泛泛而谈
4. **charSummary** galgame 结局独白风格，温暖真诚有洞察力
5. **charNewInsight 是最重要的部分**：这是玩家下次想回来玩的原因——因为这里有对方真实看见了自己的感觉。必须具体，不能模糊`;
}
