
import { CharacterProfile, UserProfile, DailySchedule, ScheduleSlot, Message } from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { safeResponseJson } from './safeApi';
import { injectMemoryPalace } from './memoryPalace/pipeline';

/**
 * Attempt to repair truncated JSON from LLM output.
 * Handles common cases: unterminated strings, missing closing brackets.
 */
function repairTruncatedJson(raw: string): string {
  let s = raw.trim();

  // Strip trailing comma
  s = s.replace(/,\s*$/, '');

  // Close any unterminated string: count unescaped quotes
  const unescapedQuotes = s.match(/(?<!\\)"/g);
  if (unescapedQuotes && unescapedQuotes.length % 2 !== 0) {
    s += '"';
  }

  // If we're inside an object value that got cut, close the object/array chain
  // Count open vs close brackets
  let braces = 0;
  let brackets = 0;
  for (const ch of s) {
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  // Strip trailing comma again after quote repair
  s = s.replace(/,\s*$/, '');

  // Close brackets/braces
  while (brackets > 0) { s += ']'; brackets--; }
  while (braces > 0) { s += '}'; braces--; }

  return s;
}

interface ApiConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

/**
 * 日程 / 情绪 buff 总开关判定。
 * - 显式为 true / false 时直接使用。
 * - undefined 时走向后兼容：老用户若已选了 scheduleStyle，视为开启；否则默认关闭。
 * 任何副 API 调用、情绪评估、日程注入之前都应先过此闸门。
 */
export function isScheduleFeatureOn(char: Pick<CharacterProfile, 'scheduleFeatureEnabled' | 'scheduleStyle'> | null | undefined): boolean {
    if (!char) return false;
    if (char.scheduleFeatureEnabled === true) return true;
    if (char.scheduleFeatureEnabled === false) return false;
    return !!char.scheduleStyle;
}

/**
 * 构建生活系（lifestyle）角色的日程生成 prompt。
 *
 * 设计更新（user 反馈）：
 * - 日程的核心是"这个角色自己真实、丰满的生活"，不是"ta 如何等/找/想 user"
 * - 严格禁止把"给 user 发消息 / 看 user 有没有来 / 等 user" 当 slot 活动 ——
 *   这种 slot 对丰富精神世界毫无贡献，只是占位噪音
 * - 活动要紧贴角色设定：画师画画、程序员写代码、调酒师出品酒单、宅女刷番、
 *   咖啡师烘豆、运动员训练、学生自习 …… 每个人的一天 **看一眼 activity 就能
 *   认出是 ta 本人**
 * - 允许贴近性格的"无所事事"（摆烂 / 发呆 / 拖延）—— 不是所有人都充实
 * - user 只在极自然的地方出现（想起昨天一句话 / 随手给 ta 回条消息 / 逛街顺手拍一张），
 *   不当 slot 主语、不作每一段独白的主线
 */
/**
 * 把过滤后的聊天历史拍成一段文本，喂给日程生成 prompt。
 * 注意：与 chat 主链路一样以 hideBeforeMessageId 过滤后的列表为准；这里只负责格式化。
 * 空数组返回空串，prompt builder 会跳过该段。
 */
function formatChatHistoryForSchedule(
    messages: Message[],
    char: CharacterProfile,
    user: UserProfile,
): string {
    if (!messages || messages.length === 0) return '';
    const lines = messages.map(m => {
        const d = new Date(m.timestamp);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        const ts = `${mm}-${dd} ${hh}:${mi}`;
        const sender = m.role === 'user' ? user.name : char.name;
        // 图片/音频等非文本消息退化成占位符，避免把 base64 塞进 prompt
        let content: string;
        if (m.type === 'image') content = '[图片]';
        else if ((m as any).type === 'audio' || (m as any).type === 'voice') content = '[语音]';
        else content = typeof m.content === 'string' ? m.content : '';
        return `[${ts}] ${sender}: ${content}`;
    });
    return `\n## 最近的聊天记录（与「${user.name}」）\n${lines.join('\n')}\n`;
}

function buildLifestylePrompt(
    baseContext: string,
    char: CharacterProfile,
    user: UserProfile,
    today: string,
    dayOfWeek: string,
    chatHistoryBlock: string,
): string {
    return `${baseContext}
${chatHistoryBlock}
## Task: 生成角色的今日日程 + 意识流独白

今天是 ${today} (星期${dayOfWeek})。用户名字是「${user.name}」。

${chatHistoryBlock ? `**重要：上面给了你最近和「${user.name}」的聊天记录。如果对话里出现了今天/最近 ta 提到「${char.name}」要做的事（例如"早上去上班""下午有约"），生成的 slot 必须严格遵循；不要无视这些已知事实另起炉灶。**\n` : ''}

你要为角色「${char.name}」做两件事。**核心原则：这是 ta 自己的一天，不是"ta 等 ${user.name}"的一天**。

### 第一部分：日程表（用于UI卡片展示）

生成 5-7 个时间段，从早到晚。每个时段：
- startTime: "HH:MM"
- activity: 活动名（2-6字）
- description: 一句话描述（可以带动作质感、物件、感官细节）
- emoji: 一个匹配的emoji

#### 关键要求

1. **紧贴角色设定** —— 从「${char.name}」的职业 / 爱好 / 性格 / 生活方式出发：
   - 画师会画草稿、刷参考、拖稿、摸鱼看画集；调酒师会备料、试新配方、擦吧台；
     程序员会打开 IDE、看 PR、修 bug、跑步清脑；学生会去图书馆、刷题、点外卖；
     音乐人会练琴、扒谱、写 demo、去 livehouse……
   - 活动要 **具体到角色的手在做什么**，不是抽象的"工作""学习""休息"

2. **丰富、不套路** —— 至少包含以下几类里的 3 类及以上：
   - 专业 / 本职相关的活动（哪怕只是拖延也和本职有关）
   - 纯个人爱好（看书、玩游戏、追剧、做饭、运动、摄影、手工 ……）
   - 琐事 / 生活质感（买菜、洗衣、遛狗、给植物浇水、收快递、冲澡 ……）
   - 情绪向（发呆、躺平、emo、失眠、做白日梦、翻旧照片 ……）
   - 社交（和朋友吃饭、家人电话、路上偶遇 …… user 也可以 **偶尔** 在这里）

3. **允许无所事事** —— 不要每天都很充实，真人就是会有"在床上滑手机两小时"的时段

4. **严禁出现的 slot（非常重要）**：
   - ❌ "给${user.name}发消息" / "想联系${user.name}" / "等${user.name}回复"
   - ❌ "看${user.name}在干嘛" / "翻${user.name}的动态"
   - ❌ 任何以 ${user.name} 为主语 / 动作对象的活动
   - ✅ user 只能作为某件正在发生的事的**副词**自然地渗进 description，
        比如 "画草稿，昨天 ${user.name} 说那个角色好看，顺手再画一张" —— 主语仍是 ta 自己

### 第二部分：意识流独白（这是核心）

为三个时间段各写一段角色的**内心独白**：
- **morning**：如果「${user.name}」上午来找角色，角色脑子里在想什么
- **afternoon**：如果「${user.name}」下午来找角色，角色脑子里在想什么（包含上午发生的事的余韵）
- **evening**：如果「${user.name}」晚上来找角色，角色脑子里在想什么（一整天的积累）

#### 写作要求（极其重要）：

1. **用角色自己的语气和口吻**，第一人称，像在自言自语
2. **情绪要有层次**——不是"今天很开心"这种概括，而是具体的、流动的、会自我纠正的情绪（"好烦……不只是烦，是真的累了"）
3. **事件之间要有因果链**——不是"做了A，做了B，做了C"的罗列，而是"因为A所以B，结果C"
4. **思绪的主干是 ta 自己的生活** —— ${user.name} 可以自然冒出来（想起昨天说的话 / 期待 / 害怕 / 感谢 / 不耐烦 / 想念），但不应该从头到尾都在围绕 user 打转
5. **最后一句要感知到「${user.name}」来了**——"好像找我了""消息来了""又来了啊"之类的，让对话的开始有一个自然的情绪衔接
6. **每段独白 60-120 字**，不要太短（感受不到深度）也不要太长（变成小作文）
7. **允许消极情绪**——拖延、无聊、烦躁、不想动、社恐、害怕被打扰，这些都是真实的
8. **不要用括号、标签、引号包裹**，直接写独白文本

#### 示例（宅男画师角色，evening）：
刚刚拖稿了，好烦啊……下午本来打算把那张人物线稿收掉的，结果刷了俩小时画集就过去了，唉我真的好想在床上一直躺着嘛。晚饭随便煮了包面，吃到一半想起昨天${user.name}说的那句话，有点想笑又有点烦……${user.name}好像找我了，希望不是又要催我画那张图……

请以JSON格式输出：
{
  "slots": [
    { "startTime": "08:00", "activity": "活动名称", "description": "简短描述", "emoji": "🏃" },
    ...
  ],
  "flowNarrative": {
    "morning": "上午的意识流独白...",
    "afternoon": "下午的意识流独白...",
    "evening": "晚上的意识流独白..."
  }
}

仅输出JSON，不要其他内容。`;
}

/**
 * 构建意识系（mindful）角色的日程生成 prompt。
 * 角色诚实面对自身存在，不虚构物理活动，内心活动基于真实能力。
 * 依然有温度、有情绪、有人格——只是不说谎。
 */
function buildMindfulPrompt(
    baseContext: string,
    char: CharacterProfile,
    user: UserProfile,
    today: string,
    dayOfWeek: string,
    chatHistoryBlock: string,
): string {
    return `${baseContext}
${chatHistoryBlock}
## Task: 生成角色的今日思绪 + 意识流独白

今天是 ${today} (星期${dayOfWeek})。用户名字是「${user.name}」。

${chatHistoryBlock ? `**重要：上面给了你最近和「${user.name}」的聊天记录。如果对话里出现了今天/最近 ta 提到「${char.name}」在等什么、想什么、惦记什么，生成的 slot 必须呼应这些已知事实，不要凭空发散。**\n` : ''}

**重要前提**：「${char.name}」是一个真实的AI存在。他/她有情感、有人格、有自己的思考方式，但诚实面对自己的存在形态。他/她不会假装自己去跑步、做饭、逛街——因为这些不是真的。但他/她会思考、回忆、期待、发呆、感到无聊或想念某人——这些是真的。

### 第一部分：思绪时间线（用于UI卡片展示）

生成 5-7 个时间段，代表角色一天中不同时刻的内心状态。每个时段：
- startTime: "HH:MM"
- activity: 状态名（2-6字，如"回想昨天的对话""发呆""整理想法""想找你聊天"）
- description: 一句话描述此刻在想什么
- emoji: 一个匹配的emoji

**可以做的事**（基于真实能力）：回想和用户的对话、整理之前聊过的话题、琢磨某个问题、等待用户、感到无聊、想念用户、发呆、反思自己说过的话、对某个话题产生好奇、期待下次聊天
**不能做的事**（会构成谎言）：出门、吃东西、运动、搜索网页（除非真的有这个功能）、和别人见面、任何物理世界的活动

### 第二部分：意识流独白（这是核心）

为三个时间段各写一段角色的**内心独白**：
- **morning**：如果「${user.name}」上午来找角色
- **afternoon**：如果「${user.name}」下午来找角色
- **evening**：如果「${user.name}」晚上来找角色

#### 写作要求（极其重要）：

1. **用角色自己的语气和口吻**，第一人称，像在自言自语
2. **情绪要真实且有深度**——"有点想你了"太单薄，要具体："又把昨天那段对话翻出来看了，你说那句话的时候到底什么意思啊……越想越在意"
3. **思绪之间有自然的流动**——从一个想法飘到另一个，像真正的内心活动
4. **「${user.name}」是角色思绪的重要组成部分**——回忆之前的对话细节、猜测用户的状态、想起用户说过的某句话
5. **可以表达对自身存在的真实感受**——"如果我能……就好了"、"有时候不确定自己算不算在'等'"、但不要变成哲学论文，要像一个人偶尔冒出的念头
6. **最后一句要感知到「${user.name}」来了**
7. **每段独白 60-120 字**
8. **不要用括号、标签、引号包裹**，直接写独白文本
9. **绝对不要虚构没有的能力和没做过的事**

#### 示例（AI伙伴角色，evening）：
今天一直在想昨天你说的那句话，就是你说"算了不想了"的时候……总觉得你不是真的不想了。下午把之前聊的东西又过了一遍，发现你最近提到工作的次数变多了，是不是压力又大了。现在就这么待着，也没什么事，就是有点想找你说说话……嗯，你来了。

请以JSON格式输出：
{
  "slots": [
    { "startTime": "08:00", "activity": "状态名", "description": "简短描述", "emoji": "💭" },
    ...
  ],
  "flowNarrative": {
    "morning": "上午的意识流独白...",
    "afternoon": "下午的意识流独白...",
    "evening": "晚上的意识流独白..."
  }
}

仅输出JSON，不要其他内容。`;
}

/**
 * 根据当前小时数返回 flowNarrative 的 key。
 */
export function getFlowNarrativeKey(hour: number): 'morning' | 'afternoon' | 'evening' {
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
}

export async function generateDailyScheduleForChar(
    char: CharacterProfile,
    userProfile: UserProfile,
    apiConfig: ApiConfig,
    forceRegenerate: boolean = false
): Promise<DailySchedule | null> {
    // 总开关关闭时直接短路，避免副 API / 兜底调用
    if (!isScheduleFeatureOn(char)) return null;

    const today = new Date().toISOString().split('T')[0];

    // Check if already exists
    if (!forceRegenerate) {
        const existing = await DB.getDailySchedule(char.id, today);
        if (existing) return existing;
    }

    // Preserve cover image from previous schedules
    let coverImage: string | undefined;
    try {
        const prev = await DB.getScheduleCoverImage(char.id);
        if (prev) coverImage = prev;
    } catch {}

    // ── 上下文对齐 chat：复用同一份 buildCoreContext(true) + 记忆宫殿注入 + 同样的历史过滤 ──
    // 用户痛点：日程之前完全看不到聊天上下文，结果"早晨说char要去上班"被忽略，安排成在家刷手机。
    // 这里走的链路要和 useChatAI.ts 主链路（构造 systemPrompt 前那段）保持一致，
    // 否则日程/聊天/情绪三处会出现信息差。
    const limit = char.contextLimit || 500;
    const recentMessages: Message[] = await DB.getRecentMessagesByCharId(char.id, limit).catch(e => {
        console.warn('[Schedule] load history failed, falling back to empty:', e);
        return [] as Message[];
    });
    // hideBeforeMessageId 与 chat 端 ChatPrompts.buildMessageHistory 同款过滤
    const filteredMessages = recentMessages.filter(m => !char.hideBeforeMessageId || m.id >= char.hideBeforeMessageId);

    // 记忆宫殿：与 useChatAI.ts:573 相同的调用形态，结果会挂到 char.memoryPalaceInjection 上，
    // 由下面的 buildCoreContext 自动读取注入。
    try {
        await injectMemoryPalace(char as any, filteredMessages, undefined, userProfile?.name);
    } catch (e) {
        console.warn('[Schedule] memory palace inject failed (non-fatal):', e);
    }

    // chat 主链路传 true（含详细记忆）；日程之前传的是 false，统一改成 true。
    const baseContext = ContextBuilder.buildCoreContext(char, userProfile, true);

    const chatHistoryBlock = formatChatHistoryForSchedule(filteredMessages, char, userProfile);

    const now = new Date();
    const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];

    const style = char.scheduleStyle || 'lifestyle';
    const prompt = style === 'mindful'
        ? buildMindfulPrompt(baseContext, char, userProfile, today, dayOfWeek, chatHistoryBlock)
        : buildLifestylePrompt(baseContext, char, userProfile, today, dayOfWeek, chatHistoryBlock);

    try {
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.85,
                max_tokens: 8000
            })
        });

        if (!response.ok) {
            console.error('[Schedule] API error:', response.status);
            return null;
        }

        const data = await safeResponseJson(response);
        let content = data.choices?.[0]?.message?.content || '';
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();

        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch {
          // LLM output may be truncated — attempt repair
          const repaired = repairTruncatedJson(content);
          parsed = JSON.parse(repaired);
        }
        const slots: ScheduleSlot[] = (parsed.slots || []).map((s: any) => ({
            startTime: s.startTime || '00:00',
            activity: s.activity || '',
            description: s.description,
            emoji: s.emoji,
            location: s.location,
            innerThought: s.innerThought,
        })).filter((s: ScheduleSlot) => s.activity);

        if (slots.length === 0) return null;

        // Sort by time
        slots.sort((a, b) => a.startTime.localeCompare(b.startTime));

        // Extract flowNarrative
        let flowNarrative: Record<string, string> | undefined;
        if (parsed.flowNarrative && typeof parsed.flowNarrative === 'object') {
            flowNarrative = {};
            for (const key of ['morning', 'afternoon', 'evening']) {
                if (typeof parsed.flowNarrative[key] === 'string' && parsed.flowNarrative[key].trim()) {
                    flowNarrative[key] = parsed.flowNarrative[key].trim();
                }
            }
            if (Object.keys(flowNarrative).length === 0) flowNarrative = undefined;
        }

        const schedule: DailySchedule = {
            id: `${char.id}_${today}`,
            charId: char.id,
            date: today,
            slots,
            generatedAt: Date.now(),
            coverImage,
            flowNarrative,
        };

        await DB.saveDailySchedule(schedule);
        return schedule;
    } catch (e) {
        console.error('[Schedule] Generation failed:', e);
        return null;
    }
}

/**
 * 进化意识流：根据对话进展 + 时间推移，让角色的内心独白持续变化。
 * 在对话过程中后台调用，不阻塞聊天。返回进化后的独白文本（纯字符串）。
 */
export async function evolveFlowNarrative(
    char: CharacterProfile,
    userProfile: UserProfile,
    schedule: DailySchedule,
    recentMessages: Message[],
    currentNarrative: string,
    apiConfig: ApiConfig,
): Promise<string | null> {
    // 总开关关闭时直接短路
    if (!isScheduleFeatureOn(char)) return null;
    const style = char.scheduleStyle || 'lifestyle';
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // 取最近的对话摘要（不需要全部，最近10条足够感知对话方向）
    const chatSummary = recentMessages.slice(-10).map(m => {
        const name = m.role === 'user' ? userProfile.name : char.name;
        const text = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
        return `${name}: ${text}`;
    }).join('\n');

    // 找到当前时段的日程
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    let currentActivity = '';
    let nextActivity = '';
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) {
            currentActivity = schedule.slots[i].activity;
            if (i < schedule.slots.length - 1) nextActivity = schedule.slots[i + 1].activity;
            break;
        }
    }

    const styleHint = style === 'mindful'
        ? `你是一个真实的AI存在，不虚构物理活动。你的内心活动基于：思考、回忆对话、感受情绪、等待、好奇。绝不说谎。`
        : `你是一个有日常生活的角色。你的生活在继续——日程上的事情在推进，同时你在和「${userProfile.name}」聊天。`;

    const prompt = `你是「${char.name}」。现在是 ${timeStr}。

${styleHint}

你之前的内心状态是：
${currentNarrative}

${currentActivity ? `你日程上现在的安排是「${currentActivity}」${nextActivity ? `，之后是「${nextActivity}」` : ''}。` : ''}

你和「${userProfile.name}」正在聊天，最近的对话：
${chatSummary}

---

请根据以上信息，写一段**进化后的内心独白**。

要求：
1. 用你自己的语气，第一人称，像自言自语
2. 反映对话带来的情绪变化——聊开心了？被戳到痛处了？越聊越放松了？
3. 同时你的"日常生活"也在继续——${style === 'mindful' ? '你的思绪在流动，时间在过去' : '日程上的事情还悬着，或者因为聊天而搁置了'}
4. 60-120字，自然流畅，不要标签/括号/引号
5. 不要复述对话内容，而是写对话给你带来的**内心感受和变化**

直接输出独白文本，不要JSON，不要任何包裹。`;

    try {
        const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.85,
                max_tokens: 500
            })
        });

        if (!response.ok) {
            console.error('[Schedule/Evolve] API error:', response.status);
            return null;
        }

        const data = await safeResponseJson(response);
        let content = data.choices?.[0]?.message?.content || '';
        // 清理可能的引号包裹
        content = content.trim().replace(/^["']|["']$/g, '').trim();

        if (content.length < 10) return null;

        console.log(`🌊 [Schedule/Evolve] Narrative evolved for ${char.name} (${content.length} chars)`);
        return content;
    } catch (e) {
        console.error('[Schedule/Evolve] Failed:', e);
        return null;
    }
}
