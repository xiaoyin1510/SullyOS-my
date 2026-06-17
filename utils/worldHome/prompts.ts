/**
 * 「家园」提示词与输出解析。
 *
 * 设计原则（与产品诉求一一对应）：
 *   - 一次 LLM 调用只演绎一个角色，prompt 里只给该角色"外部可观察"的世界信息，
 *     确保没人开上帝视角；其他角色的内心活动绝不进入它的上下文。
 *   - NPC 没有记忆系统，由"世界引擎"一次调用全部演绎，完全服务于世界观氛围。
 *   - 三种模式只在"user 的存在感"上做提示词差异，记忆/人设注入对三种模式一致
 *     （buildChatRequestPayload 那条链路不变）。
 */

import type { CharacterProfile, WorldProfile, WorldHouse, WorldCharBeat, WorldHomeMode, WorldNarrativeStyle } from '../../types';
import { dmThreadsOf, groupThreadOf, formatThreadForPrompt } from './threads';

/** 大段正文的文风预设（世界编辑器里选）。 */
export const NARRATIVE_STYLES: Record<Exclude<WorldNarrativeStyle, 'custom'>, { name: string; guide: string }> = {
    warm: {
        name: '细腻日常',
        guide: '生活流文笔：气味、光线、触感、食物的温度这类具体细节优先；情绪藏在动作和物件里，不直说；小事中见人。',
    },
    inner: {
        name: '内心独白',
        guide: '以心理活动为主体：自我对话、犹疑、回忆闪回交织；外部事件只是引子，重点是想法怎么一步步变化；可以用意识流的跳跃。',
    },
    drama: {
        name: '戏剧张力',
        guide: '强情节：这半天要有一个小冲突或转折（误会、巧合、突发），有悬念有起伏；对白锋利，节奏快，结尾留钩子。',
    },
    breezy: {
        name: '轻快幽默',
        guide: '口语化、自嘲、吐槽视角；节奏明快，把倒霉事写出喜感；像角色本人在跟好朋友讲段子，但底色仍要真实。',
    },
    sitcom: {
        name: '日常轻喜剧',
        guide: '情景喜剧的节奏：一桩鸡毛蒜皮的小事被一步步放大成闹剧（误会、乌龙、一个谎要用十个谎圆），角色之间一来一回的拌嘴和吐槽密集、有梗有节拍；动作和反应略夸张但人物动机合理，收尾常有个温馨或哭笑不得的反转。轻松好笑为主，别真往沉重里写。',
    },
};

/** 大段正文的叙述人称要求。 */
export function narrationPersonGuide(world: WorldProfile, charName: string): string {
    switch (world.narrationPerson) {
        case 'second':
            return `用**第二人称**写这段正文：以「你」称呼${charName}自己（像有人在旁白注视着 ta），全程「你…」。`;
        case 'third':
            return `用**第三人称**写这段正文：以「${charName}」或「ta」来叙述自己，像小说旁白。`;
        case 'first':
        default:
            return `用**第一人称**写这段正文：以「我」叙述，是${charName}自己的内心视角。`;
    }
}

export function narrativeStyleGuide(world: WorldProfile): string {
    if (world.narrativeStyle === 'custom' && world.narrativeStyleCustom?.trim()) {
        return world.narrativeStyleCustom.trim();
    }
    const key = (world.narrativeStyle && world.narrativeStyle !== 'custom' ? world.narrativeStyle : 'warm') as Exclude<WorldNarrativeStyle, 'custom'>;
    return NARRATIVE_STYLES[key]?.guide || NARRATIVE_STYLES.warm.guide;
}

/** 一天分三段：早/中/晚。一轮推进一段。 */
export const SEGMENTS_PER_DAY = 3;
const SEGMENT_LABELS = ['早上', '中午', '晚上'];
/** 该段是否算夜晚（用于昼夜视觉） */
export function isNightClock(storyClock: number): boolean {
    return ((storyClock % SEGMENTS_PER_DAY) + SEGMENTS_PER_DAY) % SEGMENTS_PER_DAY === 2;
}

/** 剧情时钟 → 时间标签。一轮推进一段：0=早上 1=中午 2=晚上。 */
export function storyTimeLabel(storyClock: number): string {
    return `第${Math.floor(storyClock / SEGMENTS_PER_DAY) + 1}天${SEGMENT_LABELS[storyClock % SEGMENTS_PER_DAY]}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
/** 真实时钟 → 现实段：<5点算「晚」（深夜归夜），<12 早，<18 中，否则晚。 */
export function realNowSeg(now: Date = new Date()): { dayKey: string; seg: number } {
    const h = now.getHours();
    const seg = h < 5 ? 2 : h < 12 ? 0 : h < 18 ? 1 : 2;
    const dayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    return { dayKey, seg };
}
/** {dayKey,seg} → 标签「YYYY年M月D日 周X 早上/中午/晚上」。 */
export function formatRealClock(rc: { dayKey: string; seg: number }): string {
    const d = new Date(`${rc.dayKey}T00:00:00`);
    if (isNaN(d.getTime())) return `${rc.dayKey} ${SEGMENT_LABELS[rc.seg] || ''}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]} ${SEGMENT_LABELS[rc.seg] || ''}`;
}
/**
 * real 模式下一次「观测」要演的现实段（早/中/晚），跟着真实时钟走：
 *   - 没演过 → 演当前这一段；
 *   - 落后于今天 → 补今天还没补的下一段（不超过现在）；
 *   - 落后于过去某天 → 直接跳到今天最早一段（过去错过的补不回来）；
 *   - 已追上现实 → null（这一段还没过去，没东西可演）。
 */
export function realObserveTarget(world: WorldProfile, now: Date = new Date()): { dayKey: string; seg: number } | null {
    const cur = world.realClock;
    const nw = realNowSeg(now);
    if (!cur) return nw;
    if (cur.dayKey < nw.dayKey) return { dayKey: nw.dayKey, seg: 0 }; // 过去的天丢掉，跳到今天最早一段
    if (cur.dayKey > nw.dayKey) return null; // 数据异常（时钟回拨），不补
    return cur.seg < nw.seg ? { dayKey: nw.dayKey, seg: cur.seg + 1 } : null; // 同一天：补下一段，或已追上
}

/**
 * 时间模式感知的时间标签：
 *   - real（默认）：沿用「第N天 早上/中午/晚上」。
 *   - sim：从 simStartDate 起按天推进，输出真实日历日期「YYYY年M月D日 周X 早上/中午/晚上」。
 */
export function worldTimeLabel(world: WorldProfile, storyClock: number = world.storyClock): string {
    if (world.timeMode === 'sim' && world.simStartDate) {
        const { year, month, day } = world.simStartDate;
        const d = new Date(year, month - 1, day);
        d.setDate(d.getDate() + Math.floor(storyClock / SEGMENTS_PER_DAY));
        const wd = WEEKDAYS[d.getDay()];
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${wd} ${SEGMENT_LABELS[storyClock % SEGMENTS_PER_DAY]}`;
    }
    // real 模式：跟现实时钟同步，显示已演到的那一现实段
    if (world.timeMode !== 'sim' && world.realClock) return formatRealClock(world.realClock);
    return storyTimeLabel(storyClock);
}

/** 该世界「当前那一段」是否算夜晚（real 看 realClock，sim 看 storyClock）。 */
export function isNightWorld(world: WorldProfile): boolean {
    if (world.timeMode !== 'sim' && world.realClock) return world.realClock.seg === 2;
    return isNightClock(world.storyClock);
}

/** 找出某成员住在哪（不在任何小屋 = 独居）。 */
export function houseOf(world: WorldProfile, charId: string): WorldHouse | null {
    return world.houses.find(h => h.residentIds.includes(charId)) || null;
}

/** user 存在感的三档规则文本。 */
export function buildModeRule(mode: WorldHomeMode, userName: string): string {
    const u = userName || '用户';
    switch (mode) {
        case 'light':
            return `【模式：轻度】这只是观察你生活的一个切面。在这个世界里，${u} 依旧是你最重要的人——与你们平时聊天里的关系完全一致。你的生活里可以自然地惦记 ta、想给 ta 发消息、期待 ta 的出现；但此刻 ta 不在场，不要凭空让 ta 登场。`;
        case 'medium':
            return `【模式：中度】${u} 是这个世界里的普通一员，和其他人没有什么不同。可以自然提及 ta，但 ta 不特殊，你的生活不围着 ta 转。此刻 ta 不在场，不要替 ta 行动或说话。`;
        case 'heavy':
            return `【模式：重度·重要】在这个世界里，${u} 不存在（或者说只是一个谁也看不见的幽灵）。演绎中绝对不要提及、暗示、想起或寻找 ta。你的生活完全由这个世界里的居民和事件构成。即使你的记忆里有 ta，在这个世界里那些记忆也如同上辈子的梦，不会浮现。`;
    }
}

/** 注入到角色 systemPrompt 末尾的家园场景框定。 */
export function buildWorldSystemAddendum(world: WorldProfile, char: CharacterProfile, userName: string): string {
    return `

---
[家园 · ${world.name}]
接下来不是和 ${userName || '用户'} 的聊天，而是你在共同世界「${world.name}」里的一段真实生活演绎。
${buildModeRule(world.mode, userName)}
铁律：你只扮演你自己（${char.name}）。同世界的其他角色各有自己的演绎轮，你看不到他们的内心，只能根据他们外在的言行做反应；不要替任何其他角色做决定或编造他们的内心戏。NPC 的言行可以引用（他们由世界引擎给出）。
保持你在聊天中一贯的人设、记忆与行事风格——这是同一个你，只是生活在这个世界里。`;
}

/** 居住安排的可读文本。 */
function describeHousing(world: WorldProfile, members: CharacterProfile[]): string {
    const lines: string[] = [];
    const housed = new Set<string>();
    for (const h of world.houses) {
        const names = h.residentIds
            .map(id => members.find(m => m.id === id)?.name)
            .filter(Boolean) as string[];
        if (names.length === 0) continue;
        names.forEach(n => housed.add(n));
        lines.push(`- ${h.name}：${names.join('、')} 同住`);
    }
    for (const m of members) {
        if (!housed.has(m.name)) lines.push(`- ${m.name} 独居（自己的住处）`);
    }
    return lines.join('\n');
}

/** 好感档位（-100 ~ +100，0=陌生中立）。 */
const relTone = (v: number) =>
    v >= 75 ? '亲密无间' : v >= 45 ? '关系很好' : v >= 20 ? '有好感' :
    v > -20 ? '中立客套' : v > -45 ? '有嫌隙' : v > -75 ? '敌意' : '深恶痛绝';

/** 该好感档位对应的行为基调（喂给角色，让好感真的左右言行）。 */
const relBehavior = (v: number) =>
    v >= 75 ? '你打心底信任ta、愿意为ta让步，相处自然亲密。' :
    v >= 45 ? '你乐意主动接近ta、把ta的事放在心上。' :
    v >= 20 ? '你对ta有好感，相处舒服，但还没到掏心掏肺。' :
    v > -20 ? '你和ta只是泛泛之交/还不熟——客气、有分寸、保持距离，别表现得自来熟或格外热络。' :
    v > -45 ? '你看ta有点不顺眼，相处会下意识防备、冷淡或带点刺，不会主动示好。' :
    v > -75 ? '你对ta有明显敌意，能不打交道就不打交道，开口多半是冲突。' :
    '你厌恶ta到骨子里，几乎无法心平气和地共处。';

/**
 * 与某角色相关的关系条文本。关系是**有向**的（你对ta ≠ ta对你）：
 *   - 你→别人：给关系名 + 好感档位 + 数值 + 行为基调（这是你自己的内心，你当然清楚）
 *   - 别人→你：只给粗粒度的"你能感觉到的态度"——对方心里的定位和具体程度是对方的内心戏
 *   - 他人之间的关系一概不给
 *
 * 好感（潜意识的亲疏拉扯）与 label（你理智上给这段关系贴的标签）可以完全冲突——
 * 嘴上说讨厌、心里却越来越在意；或称兄道弟、好感却在悄悄下滑。冲突时按真实人性演。
 */
function describeRelationsFor(world: WorldProfile, charId: string, members: CharacterProfile[], npcNames: Map<string, string>): string {
    const nameOf = (id: string) => members.find(m => m.id === id)?.name || npcNames.get(id) || '';
    const outgoing = world.relationships.filter(r => r.fromId === charId);
    const incoming = world.relationships.filter(r => r.toId === charId);
    if (outgoing.length === 0 && incoming.length === 0) return '（还没有建立明确的关系记录，把彼此当作刚认识的陌生人，凭第一印象保持分寸地相处）';
    const lines: string[] = [];
    for (const r of outgoing) {
        const other = nameOf(r.toId);
        if (!other) continue;
        lines.push(`- 你对 ${other}：${r.label ? `理智上你称之为「${r.label}」；` : ''}好感 ${r.value}（${relTone(r.value)}）——${relBehavior(r.value)}`);
    }
    for (const r of incoming) {
        const other = nameOf(r.fromId);
        if (!other) continue;
        lines.push(`- 你能隐约感觉到 ${other} 对你的态度：${relTone(r.value)}（只是体感，对方心里真正怎么想你并不知道）`);
    }
    return lines.join('\n');
}

/**
 * 单个角色的演绎回合（user turn）。
 *
 * 传递路径（谁能看到什么——防上帝视角的同时保住真实感）：
 *   - 社交媒体动态：公开，所有人可见
 *   - 公开行程（timeline 里 shared=true 的条目）：传给其他角色
 *   - 瞒下的行程（shared=false / secrets）：谁也看不到 → 进伏笔栏，等用户引爆
 *   - 当面对话：只有对话对象完整听到
 *   - 私聊：仅收件人；群聊：全员
 *   - 大段正文（narrative）：私人视角，只有屏幕外的用户看得到
 */
export function buildWorldCharTurn(args: {
    world: WorldProfile;
    char: CharacterProfile;
    members: CharacterProfile[];
    storyTime: string;
    round: number;
    lastSummary?: string;
    npcScene?: string;
    npcHooks?: string[];
    beatsSoFar: WorldCharBeat[];
    /** 公开社交媒体动态（上一轮 + 本轮已演绎角色的 posts） */
    recentPosts?: { name: string; post: string }[];
    /** 伏笔爆发注入（engine 按 armed seeds 为该角色生成的现成文案） */
    exposures?: string[];
    /** 用户对该角色冲动的决策留言 */
    directive?: { impulseText: string; text: string };
    /** sim 模式：上一卷归档后喂回的「该角色单方面视角总结 + 本卷氛围」（防上帝视角，只给 ta 自己的视角） */
    priorChapter?: { atmosphere?: string; charPerspective?: string };
    userName: string;
}): string {
    const { world, char, members, storyTime, round, lastSummary, npcScene, npcHooks, beatsSoFar, recentPosts, exposures, directive, priorChapter, userName } = args;
    const others = members.filter(m => m.id !== char.id);
    const npcNames = new Map(world.npcs.map(n => [n.id, n.name]));
    const myHouse = houseOf(world, char.id);

    // ── 这半天其他人的动静：位置 + 公开行程（shared=true 的时间轴条目）──
    // 同住也≠一直在一起：你能掌握的只是 ta 公开的行程和公共空间的照面。
    const observable = beatsSoFar.length > 0
        ? beatsSoFar.map(b => {
            const sharedTl = (b.timeline || []).filter(tl => tl.shared);
            const tlText = sharedTl.length > 0
                ? `\n${sharedTl.map(tl => `    ${tl.time} 在${tl.place}：${tl.event}`).join('\n')}`
                : `（具体行程你不清楚）`;
            return `- ${b.charName}（主要在${b.location}）${tlText}`;
        }).join('\n')
        : '（这半天你是最先行动的人）';

    // ── 公开社交媒体 ──
    const postsSection = (recentPosts && recentPosts.length > 0)
        ? recentPosts.map(p => `- ${p.name}：${p.post}`).join('\n')
        : '（最近没人发动态）';

    // ── 当面对你说的话（需要接住） ──
    const spokenToMe = beatsSoFar.flatMap(b =>
        (b.dialogues || [])
            .filter(d => d.with === char.name && d.lines.length > 0)
            .map(d => `${b.charName}（在${b.location}）当面对你说：\n${d.lines.map(l => `  「${l}」`).join('\n')}`)
    );

    // ── 你的手机：私聊线程 + 世界群聊 ──
    const myDms = dmThreadsOf(world, char.id);
    const group = groupThreadOf(world);
    const nameById = new Map([...members.map(m => [m.id, m.name] as const), ...world.npcs.map(n => [n.id, n.name] as const)]);
    const dmSection = myDms.length > 0
        ? myDms.map(t => {
            const otherName = t.memberIds.filter(id => id !== char.id).map(id => nameById.get(id)).filter(Boolean).join('、') || '?';
            return `▸ 与 ${otherName} 的私聊：\n${formatThreadForPrompt(t, char.id, 16, round)}`;
        }).join('\n')
        : '（私聊里还没有消息）';
    const groupSection = group && group.messages.length > 0
        ? `▸ 群聊「${group.name}」：\n${formatThreadForPrompt(group, char.id, 20, round)}`
        : `▸ 群聊「${group?.name || `${world.name}·大家的群`}」：（还没人说话）`;

    // ── 伏笔爆发 / 用户决策声音 ──
    const exposureSection = (exposures && exposures.length > 0)
        ? `\n## ⚡ 这半天绕不开的事（必须在 narrative 里正面处理）\n${exposures.map(e => `- ${e}`).join('\n')}`
        : '';
    let directiveSection = '';
    if (directive) {
        directiveSection = world.mode === 'light'
            ? `\n## 心里的声音\n关于「${directive.impulseText}」，你忽然想起 ${userName || '那个最重要的人'}——仿佛能听见 ta 对你说：「${directive.text}」。这句话在你心里有分量，这半天它会影响你的选择。`
            : `\n## 心里的声音\n关于「${directive.impulseText}」，你内心深处有个声音越来越清晰：「${directive.text}」。这半天它会影响你的选择。`;
    }

    return `【家园 · ${world.name}】剧情时间：${storyTime}

## 这个世界
${world.worldview || '（一个安静的小世界）'}

## 居住安排（注意：同住 ≠ 一直在一起。白天/夜晚大家完全可以各在各处忙自己的事）
${describeHousing(world, members)}
你的住处：${myHouse ? `${myHouse.name}${myHouse.residentIds.length > 1 ? `（和 ${myHouse.residentIds.filter(id => id !== char.id).map(id => members.find(m => m.id === id)?.name).filter(Boolean).join('、')} 同住）` : ''}` : '你自己的住处（独居）'}

## 同世界的人
${others.length > 0 ? others.map(m => `- ${m.name}`).join('\n') : '（暂时只有你）'}
${world.npcs.length > 0 ? `\n## 镇上的 NPC\n${world.npcs.map(n => `- ${n.name}：${n.persona}`).join('\n')}` : ''}

## 你的关系
${describeRelationsFor(world, char.id, members, npcNames)}

${priorChapter && (priorChapter.charPerspective || priorChapter.atmosphere) ? `## 前情（这是你自己的视角与记忆，别人怎么想你并不知道）
${priorChapter.charPerspective || ''}${priorChapter.atmosphere ? `\n（这段日子整体的气氛：${priorChapter.atmosphere}）` : ''}
` : ''}## 之前发生的事
${lastSummary || (priorChapter ? '（新的一段日子刚刚开始）' : '（这是这个世界的第一个半天，一切刚刚开始）')}
${npcScene ? `\n## 这半天镇上的动静（NPC）\n${npcScene}${npcHooks && npcHooks.length > 0 ? `\n可以接住的事件：${npcHooks.join('；')}` : ''}` : ''}

## 社交媒体（公开，大家都刷得到）
${postsSection}

## 这半天其他人的动静（你能看到/听说的部分）
${observable}
${spokenToMe.length > 0 ? `\n## 刚才有人当面对你说话（请在 narrative 里自然接住、给出回应）\n${spokenToMe.join('\n')}` : ''}
${exposureSection}${directiveSection}

## 你的手机（标【刚刚】的是这半天刚收到的新消息）
${dmSection}
${groupSection}

---
现在轮到你了。一个上午/一个夜晚能发生很多事：自由安排你这半天的行程（完全可以出门、可以和同住的人一整个半天都碰不上面），聚焦在**你自己**正在经历的事情上。
严格输出一个 JSON 对象（建议用 \`\`\`json 代码块包裹，不要输出 JSON 之外的正文）：
{
  "location": "这半天你主要在哪",
  "mood": "一两个词的此刻心情",
  "timeline": [
    { "time": "8:30", "place": "河堤", "event": "晨跑，碰到了遛狗的邻居", "shared": true },
    { "time": "10:00", "place": "…", "event": "…", "shared": true }
  ],
  "narrative": "【大段正文，600~900字，分3~5个自然段（\\n\\n分段）】聚焦这一段里一件有意义的事 + 一次内心动静的拉扯（一个犹豫、一个决定、一次没说出口的话）。${narrationPersonGuide(world, char.name)} 文风要求：${narrativeStyleGuide(world)}",
  "memo": ["你随手记在备忘录里的话（0~3条：待办/碎碎念/不敢说出口的，完全私人）"],
  "impulse": { "text": "你此刻状态背后的冲动/待决策（想辞职/想告白/想搬走/想加把劲…没有就省略这个字段）", "options": ["选项A", "选项B"] },
  "secrets": [{ "text": "这半天你瞒着别人的事（对应 timeline 里 shared=false 的条目；没有就空数组）", "hideFrom": ["瞒着谁的名字；空数组=瞒所有人"] }],
  "statusPanel": { "体力": 0到100的数字, "心情值": 0到100的数字, "其他你想记录的状态": "自由发挥（最多再加2项）" },
  "dialogues": [{ "with": "在场成员的名字", "lines": ["你当面对ta说的话（ta会完整听到）"] }],
  "phone": {
    "posts": ["这一段发的社交媒体动态（尽量发 1 条，记录此刻的心情/见闻/吐槽/晒图文案；除非你确实没心情发，否则别空着）"],
    "dms": [
      { "to": "某个人的名字（同世界成员或镇上 NPC，不限于已聊过的人）", "lines": ["私聊消息，像真人在手机上打字——可连发好几条短的、聊得来回多一点；给 NPC 发的话 ta 会在之后回你"] },
      { "to": "另一个人的名字", "lines": ["想同时私聊好几个不同的人，就在这个数组里给每个人各写一条（to 不同）；只聊一个就只留一条"] }
    ],
    "group": ["发到世界群聊的话（0~4条）"]
  },
  "relationships": [{ "with": "成员名", "delta": -4到4的整数, "reason": "为什么", "relabel": "（仅在这段关系发生重大转折时才给）你对这段关系新的定位/称呼，例如从「死对头」变成「不打不相识的损友」；平时省略此字段" }]
}
规则：
- timeline 给 3~6 条，时间要符合${storyTime.includes('早') ? '清晨到上午' : storyTime.includes('中午') ? '午间到下午' : '傍晚到深夜'}；**shared=false 表示这段你想瞒着**（别人看不到，但可能成为伏笔）。
- 信息可见性：动态=公开；timeline(shared=true)=别人能知道；私聊=仅对方；群聊=全员；narrative 和 memo=完全私人。瞒事就让对应 timeline 条目 shared=false 并写进 secrets。
- ${world.mode === 'heavy' ? `这个世界里不存在 ${userName || '用户'}，所有字段都绝不出现 ta。` : world.mode === 'light' ? `${userName || '用户'} 是你心里最重要的人，但此刻不在场——可以在 narrative、memo 或动态里自然流露惦记。` : `${userName || '用户'} 只是世界里的普通一员，不必特意提及。`}
- 手机里标【刚刚】的消息该回就回（phone.dms / phone.group），已读不回也行，但要符合你的性格；鼓励聊得丰富些。
- **想私下联系谁，就必须写进 phone.dms（to=对方名字 + lines），这才是真的把消息发出去、对方才收得到。只在 narrative 正文里写"我给ta发了条私聊"是不算数的——对方收不到，那条私聊等于没发。** 可以同时私聊好几个不同的人。
- dialogues 只在你的 timeline 和对方真的有共处时才用；不在一起就用手机，或者互相挂念/冷战都行——聚焦你自己。
- **好感真的会左右你的言行**：严格按上面「你的关系」里每个人的好感档位与行为基调来相处——低好感/负好感时别自来熟、别无缘无故友善；中立的人就保持客气的距离感。
- relationships(delta) 要克制、来之不易：日常小事 ±1~2，只有真正触动你的大事才到 ±3~4；好感是慢慢攒起来、也可能因一件事崩掉的，**绝不会一两轮就突飞猛进**。好感和你嘴上/理智上对这段关系的定位可以完全相反，按真实人性演（口嫌体正 / 面和心不和都行）。只在真的发生了影响关系的事时才给。`;
}

/**
 * 让 LLM 读一遍世界观 + 各角色人设，roll 几个贴合这个世界的配角 NPC。
 * members 传入的是「名字 + 人设摘要」，prompt 只用来生成氛围配角，不替主角做决定。
 */
export function buildNpcRollPrompt(args: {
    worldName: string;
    worldview: string;
    members: { name: string; persona: string }[];
    count: number;
    existingNames: string[];
}): string {
    const { worldName, worldview, members, count, existingNames } = args;
    return `你在为共同世界「${worldName}」设计 ${count} 个配角 NPC。NPC 没有记忆，纯粹为世界观氛围服务、给主角们的生活添点烟火气与可接住的小事件。

## 世界观
${worldview || '（一个安静的小世界，作者还没细写，请你据角色们推断这个世界大概是什么样）'}

## 住在这个世界里的主角（你不设计他们，只据他们的身份/圈子推断身边会有哪些人）
${members.length > 0 ? members.map(m => `- ${m.name}：${m.persona || '（没写人设）'}`).join('\n') : '（暂时没有主角信息）'}
${existingNames.length > 0 ? `\n## 已有的 NPC（别重名、别重复）\n${existingNames.join('、')}` : ''}

要求：贴合世界观与主角们的生活场景（他们会去的店、会打交道的人、住在隔壁的邻居……），名字自然，人设一句话点到为止、各有记忆点，彼此别雷同。严格输出一个 JSON 对象（建议 \`\`\`json 包裹，不要输出 JSON 之外的正文）：
{
  "npcs": [
    { "name": "NPC名字", "persona": "一句话人设（身份+一个鲜明特点，例：面包店老板娘，热心肠爱给人塞吃的）", "emoji": "一个能代表ta的 emoji" }
  ]
}
只要 ${count} 个，宁缺毋滥。`;
}

/** 解析 roll 出来的 NPC。返回 {name, persona, emoji}[]，过滤空名/重名。 */
export function parseRolledNpcs(raw: string, existingNames: string[] = []): { name: string; persona: string; emoji: string }[] {
    const j = extractJson(raw);
    let arr: any[] = Array.isArray(j?.npcs) ? j.npcs : Array.isArray(j) ? j : [];
    if (arr.length === 0) {
        // 兜底：模型直接吐了个裸数组 [ ... ]（extractJson 只认对象）
        const m = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').match(/\[[\s\S]*\]/);
        if (m) { try { const a = JSON.parse(m[0]); if (Array.isArray(a)) arr = a; } catch { /* ignore */ } }
    }
    const seen = new Set(existingNames.map(n => n.trim()));
    const out: { name: string; persona: string; emoji: string }[] = [];
    for (const n of arr) {
        if (!n || typeof n.name !== 'string') continue;
        const name = n.name.trim().slice(0, 16);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
            name,
            persona: (typeof n.persona === 'string' ? n.persona.trim() : '').slice(0, 60),
            emoji: (typeof n.emoji === 'string' && n.emoji.trim() ? n.emoji.trim() : '🙂').slice(0, 4),
        });
        if (out.length >= 8) break;
    }
    return out;
}

/** NPC 世界引擎回合（一次调用演完所有 NPC；NPC 无记忆，仅靠世界观+上轮梗概）。 */
export function buildNpcTurn(args: {
    world: WorldProfile;
    members: CharacterProfile[];
    storyTime: string;
    lastSummary?: string;
    /** sim 模式：上一卷沉淀的氛围基调（不含隐私，可给世界引擎定调） */
    chapterAtmosphere?: string;
    /** 成员发给各 NPC、还没回的私信收件箱 */
    inboxes?: { npcName: string; memberName: string; recent: string }[];
    /** 最近的社交动态（让 NPC + 路人疯狂点赞/评论） */
    recentPosts?: { ref: string; name: string; post: string }[];
}): string {
    const { world, members, storyTime, lastSummary, chapterAtmosphere, inboxes, recentPosts } = args;
    const inboxSection = (inboxes && inboxes.length > 0)
        ? `\n## 📨 NPC 收到的私信（请让对应 NPC 回复）\n${inboxes.map(b => `▸ ${b.memberName} → ${b.npcName}：\n${b.recent}`).join('\n')}`
        : '';
    const postsSection = (recentPosts && recentPosts.length > 0)
        ? `\n## 📱 社交动态（请热闹地点赞 + 评论——NPC 和路人都可以；ref 原样回填）\n${recentPosts.map(p => `[${p.ref}] ${p.name}：${p.post}`).join('\n')}`
        : '';
    return `你是共同世界「${world.name}」的世界引擎，负责一次性扮演镇上所有 NPC。NPC 没有独立记忆，完全为世界观氛围服务。

## 世界观
${world.worldview || '（一个安静的小世界）'}

## NPC 名单
${world.npcs.map(n => `- ${n.name}：${n.persona}`).join('\n')}

## 世界的主角们（你不扮演他们，只能让 NPC 与他们擦肩、寒暄、留下钩子）
${members.map(m => m.name).join('、')}

## 之前发生的事
${lastSummary || '（这是这个世界的第一个半天）'}
${chapterAtmosphere ? `\n## 这段日子的氛围基调\n${chapterAtmosphere}` : ''}${inboxSection}${postsSection}
剧情时间：${storyTime}。
一次性输出这一段所有 NPC 的群像动静。严格输出一个 JSON 对象（建议用 \`\`\`json 包裹）：
{
  "scene": "200~400字的 NPC 群像叙述：谁在做什么、市井气息、天气与街景、和主角们擦肩的小事件。生活感优先，不要推进重大剧情。",
  "hooks": ["1~3个可以被主角们接住的小事件钩子（例：面包店老板娘今天多烤了一炉栗子面包，见人就塞）"],
  "groupLines": [{ "name": "NPC的名字", "line": "ta在世界群聊里冒泡的一句话（0~2条，市井闲聊/吆喝/通知，别太频繁）" }],
  "dms": [{ "from": "NPC的名字", "to": "给ta发私信的成员名", "lines": ["NPC 私信回复（针对上面收件箱里的消息；没有要回的就空数组）"] }],
  "feedReactions": [{ "ref": "动态的ref原样", "likes": 点赞数(0~99的整数), "comments": [{ "from": "评论者名字（NPC 或随手编一个路人网名，如「街角咖啡师」「ConanFan_07」）", "text": "一句评论，热闹、口语、有梗" }] }]
}
让社交动态**热闹起来**：给每条动态都点上赞、配几条评论；评论者多用路人网名（不必是 NPC），像真的社交平台一样你一言我一语。`;
}

// ── 输出解析 ──────────────────────────────────────────────

/** 从 LLM 输出里捞出第一个 JSON 对象（支持 ```json 围栏 / 裸 JSON / 夹杂正文）。 */
export function extractJson(raw: string): any | null {
    const text = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // 1) 围栏代码块优先
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates: string[] = [];
    if (fence?.[1]) candidates.push(fence[1].trim());
    // 2) 第一个 { 到最后一个 } 的贪婪截取
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
    for (const c of candidates) {
        try { return JSON.parse(c); } catch { /* try next */ }
        // 宽松修复：去掉尾逗号再试
        try { return JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); } catch { /* try next */ }
    }
    return null;
}

const clampNum = (v: any, lo: number, hi: number, fallback: number): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, Math.round(n)));
};

/** 解析单角色演绎输出 → WorldCharBeat（解析失败时整段原文兜底进 narrative，绝不丢内容）。 */
export function parseCharBeat(raw: string, char: CharacterProfile, memberNames: string[], npcNames: string[] = []): WorldCharBeat {
    const j = extractJson(raw);
    const fallbackNarrative = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?|```/g, '').trim().slice(0, 1400);
    if (!j || typeof j !== 'object') {
        return { charId: char.id, charName: char.name, location: '住处', narrative: fallbackNarrative || '安静地度过了这半天。', mood: '平静' };
    }
    const nameSet = new Set(memberNames);
    const dmNameSet = new Set([...memberNames, ...npcNames]); // 私聊对象可以是成员或 NPC
    const statusPanel: Record<string, number | string> = {};
    if (j.statusPanel && typeof j.statusPanel === 'object') {
        let count = 0;
        for (const [k, v] of Object.entries(j.statusPanel)) {
            if (count >= 5) break;
            statusPanel[String(k).slice(0, 12)] = typeof v === 'number' ? clampNum(v, 0, 100, 50) : String(v).slice(0, 30);
            count += 1;
        }
    }
    const dms = Array.isArray(j.phone?.dms)
        ? j.phone.dms
            .filter((d: any) => d && typeof d.to === 'string' && dmNameSet.has(d.to) && Array.isArray(d.lines))
            .map((d: any) => ({ to: d.to, lines: d.lines.map((l: any) => String(l).slice(0, 200)).filter(Boolean).slice(0, 8) }))
            .filter((d: any) => d.lines.length > 0)
            .slice(0, 4)
        : [];
    // 兼容模型把 posts/group 放在 phone 下或直接放在根上两种写法
    const rawPosts = Array.isArray(j.phone?.posts) ? j.phone.posts : Array.isArray(j.posts) ? j.posts : [];
    const posts = rawPosts.map((p: any) => String(p).slice(0, 300)).filter(Boolean).slice(0, 2);
    const rawGroup = Array.isArray(j.phone?.group) ? j.phone.group : Array.isArray(j.group) ? j.group : [];
    const group = rawGroup.map((l: any) => String(l).slice(0, 200)).filter(Boolean).slice(0, 3);
    const dialogues = Array.isArray(j.dialogues)
        ? j.dialogues
            .filter((d: any) => d && typeof d.with === 'string' && nameSet.has(d.with) && Array.isArray(d.lines))
            .map((d: any) => ({ with: d.with, lines: d.lines.map((l: any) => String(l).slice(0, 200)).filter(Boolean).slice(0, 8) }))
            .filter((d: any) => d.lines.length > 0)
            .slice(0, 4)
        : [];
    const relationshipDeltas = Array.isArray(j.relationships)
        ? j.relationships
            .filter((r: any) => r && typeof r.with === 'string' && nameSet.has(r.with))
            .map((r: any) => ({ withName: r.with, delta: clampNum(r.delta, -4, 4, 0), reason: r.reason ? String(r.reason).slice(0, 100) : undefined, newLabel: r.relabel && String(r.relabel).trim() ? String(r.relabel).trim().slice(0, 24) : undefined }))
            .slice(0, 5)
        : [];
    const timeline = Array.isArray(j.timeline)
        ? j.timeline
            .filter((tl: any) => tl && typeof tl.event === 'string' && tl.event.trim())
            .map((tl: any) => ({
                time: typeof tl.time === 'string' ? tl.time.trim().slice(0, 12) : '',
                place: typeof tl.place === 'string' ? tl.place.trim().slice(0, 30) : '',
                event: tl.event.trim().slice(0, 120),
                shared: tl.shared !== false, // 默认公开，显式 false 才是瞒
            }))
            .slice(0, 8)
        : [];
    const memo = Array.isArray(j.memo) ? j.memo.map((m: any) => String(m).slice(0, 200)).filter(Boolean).slice(0, 4) : [];
    const impulse = (j.impulse && typeof j.impulse.text === 'string' && j.impulse.text.trim())
        ? {
            text: j.impulse.text.trim().slice(0, 120),
            options: Array.isArray(j.impulse.options) ? j.impulse.options.map((o: any) => String(o).slice(0, 30)).filter(Boolean).slice(0, 3) : undefined,
        }
        : undefined;
    const secrets = Array.isArray(j.secrets)
        ? j.secrets
            .filter((s: any) => s && typeof s.text === 'string' && s.text.trim())
            .map((s: any) => ({
                text: s.text.trim().slice(0, 160),
                hideFrom: Array.isArray(s.hideFrom) ? s.hideFrom.map((n: any) => String(n)).filter((n: string) => nameSet.has(n)) : [],
            }))
            .slice(0, 3)
        : [];
    return {
        charId: char.id,
        charName: char.name,
        location: typeof j.location === 'string' && j.location.trim() ? j.location.trim().slice(0, 40) : '住处',
        narrative: typeof j.narrative === 'string' && j.narrative.trim() ? j.narrative.trim() : (fallbackNarrative || '安静地度过了这半天。'),
        mood: typeof j.mood === 'string' && j.mood.trim() ? j.mood.trim().slice(0, 16) : '平静',
        statusPanel: Object.keys(statusPanel).length > 0 ? statusPanel : undefined,
        timeline: timeline.length > 0 ? timeline : undefined,
        memo: memo.length > 0 ? memo : undefined,
        impulse,
        secrets: secrets.length > 0 ? secrets : undefined,
        phone: (dms.length > 0 || posts.length > 0 || group.length > 0) ? { posts, dms, group } : undefined,
        dialogues: dialogues.length > 0 ? dialogues : undefined,
        relationshipDeltas: relationshipDeltas.length > 0 ? relationshipDeltas : undefined,
    };
}

/** 解析 NPC 世界引擎输出。 */
export function parseNpcScene(raw: string): { scene: string; hooks: string[]; groupLines: { name: string; line: string }[]; dms: { from: string; to: string; lines: string[] }[]; feedReactions: { ref: string; likes: number; comments: { from: string; text: string }[] }[] } {
    const j = extractJson(raw);
    if (j && typeof j.scene === 'string') {
        return {
            scene: j.scene.trim(),
            hooks: Array.isArray(j.hooks) ? j.hooks.map((h: any) => String(h).slice(0, 120)).slice(0, 3) : [],
            groupLines: Array.isArray(j.groupLines)
                ? j.groupLines
                    .filter((g: any) => g && typeof g.name === 'string' && typeof g.line === 'string' && g.line.trim())
                    .map((g: any) => ({ name: g.name.trim(), line: g.line.trim().slice(0, 200) }))
                    .slice(0, 2)
                : [],
            dms: Array.isArray(j.dms)
                ? j.dms
                    .filter((d: any) => d && typeof d.from === 'string' && typeof d.to === 'string' && Array.isArray(d.lines))
                    .map((d: any) => ({ from: d.from.trim(), to: d.to.trim(), lines: d.lines.map((l: any) => String(l).slice(0, 200)).filter(Boolean).slice(0, 6) }))
                    .filter((d: any) => d.lines.length > 0)
                    .slice(0, 8)
                : [],
            feedReactions: Array.isArray(j.feedReactions)
                ? j.feedReactions
                    .filter((r: any) => r && typeof r.ref === 'string')
                    .map((r: any) => ({
                        ref: r.ref.trim(),
                        likes: clampNum(r.likes, 0, 999, 0),
                        comments: Array.isArray(r.comments)
                            ? r.comments.filter((c: any) => c && typeof c.from === 'string' && typeof c.text === 'string' && c.text.trim())
                                .map((c: any) => ({ from: c.from.trim().slice(0, 20), text: c.text.trim().slice(0, 160) })).slice(0, 8)
                            : [],
                    }))
                    .slice(0, 20)
                : [],
        };
    }
    const fallback = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?|```/g, '').trim().slice(0, 500);
    return { scene: fallback, hooks: [], groupLines: [], dms: [], feedReactions: [] };
}
