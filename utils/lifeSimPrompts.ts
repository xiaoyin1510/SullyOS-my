/**
 * LifeSim AI Prompts — CHAR决策提示词
 *
 * 角色们和用户一起玩模拟人生游戏，作为"玩家"操控游戏里的NPC小人
 */

import { LifeSimState, SimFamily, SimNPC, SimAction, CharacterProfile, UserProfile, SimSeason, CharNarrative, SimEventType, SimStoryAttachmentDraft } from '../types';
import { ContextBuilder } from './context';
import {
    getFamilyMembers, getIndependentNPCs, getMoodLabel, getFamilyAtmosphere,
    SEASON_INFO, TIME_INFO, WEATHER_INFO, getProfessionInfo, getChaosLabel, getRelLabel
} from './lifeSimEngine';

// ── 季节戏剧提示 ────────────────────────────────────────────

function getSeasonDramaHint(season: SimSeason): string {
    switch (season) {
        case 'spring': return '游戏里春暖花开，适合搞暧昧和制造新关系';
        case 'summer': return '游戏里夏日燥热，小人们脾气容易上头，冲突概率大增';
        case 'fall':   return '游戏里秋天EMO季，小人们容易翻旧账闹矛盾';
        case 'winter': return '游戏里寒冬窝家，八卦和drama是唯一的乐趣';
    }
}

// ── 游戏状态序列化 ────────────────────────────────────────────

function serializeWorldContext(state: LifeSimState): string {
    const season = state.season ?? 'spring';
    const si = SEASON_INFO[season];
    const ti = TIME_INFO[state.timeOfDay ?? 'morning'];
    const wi = WEATHER_INFO[state.weather ?? 'sunny'];

    const lines: string[] = [];
    lines.push(`=== 游戏世界环境 ===`);
    lines.push(`当前时间：第${state.year ?? 1}年 ${si.emoji}${si.zh}季 第${state.day ?? 1}天/28天 ${ti.emoji}${ti.zh}`);
    lines.push(`今日天气：${wi.emoji}${wi.zh}`);
    lines.push(`季节氛围：${getSeasonDramaHint(season)}`);
    lines.push('');
    return lines.join('\n');
}

function serializeGameState(state: LifeSimState): string {
    const lines: string[] = [];

    lines.push(`=== 游戏当前状态 (第${state.turnNumber}回合) ===`);
    const { label: chaosLabel } = getChaosLabel(state.chaosLevel);
    lines.push(`混乱度: ${state.chaosLevel}/100 (${chaosLabel})`);
    lines.push('');

    // ── 各家庭情况 ──
    lines.push('【游戏里各家庭情况】');
    for (const family of state.families) {
        const members = getFamilyMembers(state, family.id);
        if (members.length === 0) {
            lines.push(`${family.emoji} ${family.name}：(无人入住)`);
            continue;
        }
        const atmosphere = getFamilyAtmosphere(state, family.id);
        lines.push(`${family.emoji} ${family.name}（${atmosphere}）`);
        for (const npc of members) {
            const { emoji: moodEmoji } = getMoodLabel(npc.mood);
            lines.push(`  - ${npc.emoji}${npc.name}｜心情:${moodEmoji}(${npc.mood})`);
        }

        // 家庭内关系
        if (members.length >= 2) {
            const relLines: string[] = [];
            for (let i = 0; i < members.length; i++) {
                for (let j = i + 1; j < members.length; j++) {
                    const a = members[i]; const b = members[j];
                    const rel = family.relationships?.[a.id]?.[b.id] ?? 0;
                    const { label: relLabel } = getRelLabel(rel);
                    relLines.push(`    ${a.name}↔${b.name}: ${rel > 0 ? '+' : ''}${rel} (${relLabel})`);
                }
            }
            if (relLines.length > 0) { lines.push('  关系:'); lines.push(...relLines); }
        }
    }
    lines.push('');

    // ── 独行侠 ──
    const solos = getIndependentNPCs(state);
    if (solos.length > 0) {
        lines.push('【游戏里独居的小人】');
        for (const npc of solos) {
            const { emoji: moodEmoji } = getMoodLabel(npc.mood);
            lines.push(`  ${npc.emoji}${npc.name}｜心情:${moodEmoji}(${npc.mood})`);
        }
        lines.push('');
    }

    // ── 跨家庭关系（仇恨/暗恋）──
    const crossRelLines: string[] = [];
    for (const npc of state.npcs) {
        if (npc.grudges && npc.grudges.length > 0) {
            for (const targetId of npc.grudges) {
                const target = state.npcs.find(n => n.id === targetId);
                if (target) {
                    crossRelLines.push(`  💢 ${npc.emoji}${npc.name} 记恨 ${target.emoji}${target.name}`);
                }
            }
        }
        if (npc.crushes && npc.crushes.length > 0) {
            for (const targetId of npc.crushes) {
                const target = state.npcs.find(n => n.id === targetId);
                if (target) {
                    crossRelLines.push(`  💗 ${npc.emoji}${npc.name} 暗恋 ${target.emoji}${target.name}`);
                }
            }
        }
    }
    if (crossRelLines.length > 0) {
        lines.push('【跨家庭关系】');
        lines.push(...crossRelLines);
        lines.push('');
    }

    // ── 戏剧局势 ──
    lines.push('【游戏当前Drama局势】');

    // 仇恨关系汇总
    const grudgeSummary: string[] = [];
    for (const npc of state.npcs) {
        if (npc.grudges && npc.grudges.length > 0) {
            for (const targetId of npc.grudges) {
                const target = state.npcs.find(n => n.id === targetId);
                if (target) {
                    grudgeSummary.push(`${npc.name} 记恨 ${target.name}`);
                }
            }
        }
    }
    lines.push(`仇恨关系: ${grudgeSummary.length > 0 ? grudgeSummary.join('、') : '暂无'}`);

    // 暗恋关系汇总
    const crushSummary: string[] = [];
    for (const npc of state.npcs) {
        if (npc.crushes && npc.crushes.length > 0) {
            for (const targetId of npc.crushes) {
                const target = state.npcs.find(n => n.id === targetId);
                if (target) {
                    crushSummary.push(`${npc.name} 暗恋 ${target.name}`);
                }
            }
        }
    }
    lines.push(`暗恋关系: ${crushSummary.length > 0 ? crushSummary.join('、') : '暂无'}`);

    // 进行中的事件链
    if (state.pendingEffects.length > 0) {
        const effectLines = state.pendingEffects.map(eff =>
            `[${eff.id}] ${eff.description}（将在第${eff.triggerTurn}回合爆发）`
        );
        lines.push(`进行中的事件链: ${effectLines.join('；')}`);
    } else {
        lines.push('进行中的事件链: 暂无');
    }

    lines.push(`混乱度: ${state.chaosLevel}/100 (${chaosLabel})`);
    lines.push('');

    return lines.join('\n');
}

function serializeActionLog(log: SimAction[], maxEntries = 15): string {
    if (log.length === 0) return '（目前还没有任何操作记录）';
    const recent = log.slice(-maxEntries);
    return recent.map(a =>
        `[第${a.turnNumber}回合 | ${a.actor}] ${a.description}\n  → 结果: ${a.immediateResult}`
    ).join('\n\n');
}

// ── 构建CHAR决策Prompt ────────────────────────────────────────

export interface CharDecision {
    action: {
        type: 'ADD_NPC' | 'MOVE_NPC' | 'TRIGGER_EVENT' | 'GO_SOLO' | 'DO_NOTHING';
        newNpcName?: string;
        newNpcEmoji?: string;
        newNpcPersonality?: string[];
        targetFamilyId?: string;
        npcId?: string;
        newFamilyName?: string;
        eventType?: 'fight' | 'party' | 'gossip' | 'romance' | 'rivalry' | 'alliance';
        involvedNpcIds?: string[];
        eventDescription?: string;
    };
    narrative: {
        innerThought: string;
        dialogue: string;
        commentOnWorld: string;
        emotionalTone: 'vengeful' | 'romantic' | 'scheming' | 'chaotic' | 'peaceful' | 'amused' | 'anxious';
    };
    reactionToUser?: string;
    immediateResultHint?: string;
}

/** 将LLM输出的扁平/嵌套JSON统一规范化为CharDecision格式 */
export function normalizeCharDecision(raw: any): CharDecision {
    if (!raw || typeof raw !== 'object') {
        return { action: { type: 'DO_NOTHING' }, narrative: { innerThought: '', dialogue: '', commentOnWorld: '', emotionalTone: 'peaceful' } };
    }

    // 兼容扁平格式（新）和嵌套格式（旧）
    const hasNestedAction = raw.action && typeof raw.action === 'object' && raw.action.type;
    const actionObj = hasNestedAction ? raw.action : raw;

    const VALID_TYPES = ['ADD_NPC', 'MOVE_NPC', 'TRIGGER_EVENT', 'GO_SOLO', 'DO_NOTHING'];
    const rawType = String(actionObj.type || '').toUpperCase().replace(/[^A-Z_]/g, '_');
    const type = VALID_TYPES.includes(rawType) ? rawType as CharDecision['action']['type'] : 'DO_NOTHING';

    const action: CharDecision['action'] = {
        type,
        newNpcName: actionObj.newNpcName,
        newNpcEmoji: actionObj.newNpcEmoji,
        newNpcPersonality: actionObj.newNpcPersonality,
        targetFamilyId: actionObj.targetFamilyId,
        npcId: actionObj.npcId,
        newFamilyName: actionObj.newFamilyName,
        eventType: actionObj.eventType ? String(actionObj.eventType).toLowerCase() as any : undefined,
        involvedNpcIds: actionObj.involvedNpcIds,
        eventDescription: actionObj.eventDescription,
    };

    // 兼容嵌套 narrative 或扁平字段
    const narr = raw.narrative && typeof raw.narrative === 'object' ? raw.narrative : raw;
    const VALID_TONES = ['vengeful', 'romantic', 'scheming', 'chaotic', 'peaceful', 'amused', 'anxious'];
    const rawTone = String(narr.emotionalTone || narr.tone || 'peaceful').toLowerCase();

    const narrative: CharDecision['narrative'] = {
        innerThought: narr.innerThought || narr.thought || narr.inner_thought || '',
        dialogue: narr.dialogue || narr.dialog || '',
        commentOnWorld: narr.commentOnWorld || narr.comment || '',
        emotionalTone: (VALID_TONES.includes(rawTone) ? rawTone : 'peaceful') as any,
    };

    return {
        action,
        narrative,
        reactionToUser: raw.reactionToUser || raw.reaction || undefined,
        immediateResultHint: raw.immediateResultHint || raw.result || undefined,
    };
}

export interface WorldDramaDecision {
    headline: string;
    eventType: SimEventType;
    involvedNpcIds: string[];
    eventDescription: string;
    immediateResult: string;
    narrative: CharNarrative;
    attachments: SimStoryAttachmentDraft[];
}

const WORLD_EVENT_TYPES: SimEventType[] = ['fight', 'party', 'gossip', 'romance', 'rivalry', 'alliance'];
const WORLD_TONES: CharNarrative['emotionalTone'][] = ['vengeful', 'romantic', 'scheming', 'chaotic', 'peaceful', 'amused', 'anxious'];

function pickRandom<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function fallbackToneForEvent(eventType: SimEventType): CharNarrative['emotionalTone'] {
    switch (eventType) {
        case 'fight': return 'chaotic';
        case 'gossip': return 'scheming';
        case 'romance': return 'romantic';
        case 'rivalry': return 'anxious';
        case 'alliance': return 'amused';
        default: return 'peaceful';
    }
}

function buildFallbackAttachments(
    headline: string,
    eventType: SimEventType,
    involvedNpcs: SimNPC[]
): SimStoryAttachmentDraft[] {
    const npcNames = involvedNpcs.map(npc => npc.name);
    const pair = npcNames.slice(0, 2).join(' / ') || '匿名住户';
    const attachmentPool: SimStoryAttachmentDraft[] = [
        {
            kind: 'image',
            title: `${headline} 现场图`,
            summary: `一张带着都市霓虹感的现场截图，主角是 ${pair}。`,
            visualPrompt: `${headline}，都市公寓，像素风，霓虹灯，${pair}，dramatic`,
            rarity: 'rare',
        },
        {
            kind: 'evidence',
            title: '匿名聊天记录',
            summary: `围观群众把这件事总结成了一份聊天截图，所有人都在偷偷站队。`,
            detail: `【群聊节选】\n- “这事绝对不简单。”\n- “${pair} 这次是真的闹大了。”\n- “我先截图，等会儿肯定还有后续。”`,
            rarity: 'common',
        },
        {
            kind: 'item',
            title: '剧情掉落物',
            summary: eventType === 'romance'
                ? '一只被遗落在电梯口的小礼盒，里面还有没送出去的心意。'
                : eventType === 'fight'
                ? '冲突现场留下的关键道具，像是能继续引爆后续剧情的火种。'
                : '一件和这场风波有关的私人物件，被围观者偷偷保存了下来。',
            detail: eventType === 'romance'
                ? '礼盒里有一张手写卡片，只写了两个字：“今晚”。'
                : eventType === 'fight'
                ? '道具边角有明显磨损，看起来它刚刚见证过一场情绪失控的正面交锋。'
                : '这件东西本身没多值钱，但放在此刻，简直像剧情自带的伏笔。',
            rarity: 'rare',
        },
    ];

    const fanficAuthor = involvedNpcs.find(npc => npc.profession === 'fanfic_writer');
    if (fanficAuthor) {
        attachmentPool.push({
            kind: 'fanfic',
            title: `${fanficAuthor.name} 的同人文片段`,
            summary: `${fanficAuthor.name} 已经把这场事故写成了半篇文，标题党味道很重。`,
            detail: `《${headline}》\n\n${pair} 都知道那扇门一旦关上，今晚就不会再只是一个普通夜晚。\n走廊的灯把影子拉得很长，像所有没说出口的话都提前站好了位置。\n有人故作冷静，有人假装只是路过，可真正滚烫的东西早就在空气里炸开。\n等到消息传进群里时，整栋楼都明白，这件事已经不可能轻轻放下。`,
            rarity: 'epic',
        });
    } else {
        attachmentPool.push({
            kind: 'fanfic',
            title: '匿名论坛热帖',
            summary: '围观群众已经把这件事二创成了小短文，传播速度比真相还快。',
            detail: `《${headline} 二创版》\n\n楼道尽头的风声很轻，却没能把那句失控的话带走。\n有人在退后，有人在靠近，而最危险的东西从来不是争执本身，而是彼此都还没打算停下。\n当第一张截图流出去时，这段关系就已经不再只属于当事人。`,
            rarity: 'rare',
        });
    }

    return attachmentPool.slice(0, 3);
}

export function buildFallbackWorldDramaDecision(state: LifeSimState): WorldDramaDecision {
    const npcs = [...state.npcs];
    const shuffled = npcs.sort(() => Math.random() - 0.5);
    const involved = shuffled.slice(0, Math.min(3, Math.max(2, shuffled.length)));
    const involvedIds = involved.map(npc => npc.id);

    const hasCrush = involved.some(npc => (npc.crushes?.length ?? 0) > 0);
    const hasGrudge = involved.some(npc => (npc.grudges?.length ?? 0) > 0);

    let eventType: SimEventType;
    if (state.chaosLevel > 65 && hasGrudge) eventType = pickRandom(['fight', 'rivalry']);
    else if (hasCrush && Math.random() < 0.5) eventType = 'romance';
    else if (state.chaosLevel > 45) eventType = pickRandom(['gossip', 'alliance', 'rivalry']);
    else eventType = pickRandom(WORLD_EVENT_TYPES);

    const names = involved.map(npc => npc.name);
    const headlineByType: Record<SimEventType, string[]> = {
        fight: ['天台录音门', '走廊对峙夜', '深夜互撕现场'],
        party: ['临时派对事故', '屋顶聚会失控', '今晚不准散场'],
        gossip: ['匿名爆料贴', '群聊截图流出', '八卦在凌晨失火'],
        romance: ['借火误会', '深夜礼物事件', '电梯里的暧昧证词'],
        rivalry: ['双王不共楼', '互相内涵的一周', '谁才是公寓中心'],
        alliance: ['秘密站队协议', '地下同盟成立', '交换情报的人'],
    };
    const headline = `${pickRandom(headlineByType[eventType])} · ${names[0] || '住户'}`;

    const eventDescriptionByType: Record<SimEventType, string> = {
        fight: `${names[0] || '某人'}和${names[1] || '某人'}在公共区域情绪失控，冲突被更多住户撞见了。`,
        party: `${names[0] || '某人'}临时攒局，把几位住户都卷进了一个看似轻松却暗流涌动的夜晚。`,
        gossip: `一份关于${names[0] || '某人'}的匿名爆料突然在楼里扩散，越传越像真的。`,
        romance: `${names[0] || '某人'}和${names[1] || '某人'}之间出现了不再能装作没看见的暧昧信号。`,
        rivalry: `${names[0] || '某人'}和${names[1] || '某人'}开始了表面客气、实则针锋相对的长期较劲。`,
        alliance: `${names[0] || '某人'}和${names[1] || '某人'}私下交换了立场，准备一起改写楼里的局势。`,
    };

    const narrative: CharNarrative = {
        innerThought: '这一轮不该只是围观，应该顺手把整条世界线点燃。',
        dialogue: `${headline} 正式开场，${names.join('、')}都已经站到了舞台中央。`,
        commentOnWorld: '主线已经起势，接下来每个人都会被迫表态。',
        emotionalTone: fallbackToneForEvent(eventType),
    };

    return {
        headline,
        eventType,
        involvedNpcIds: involvedIds,
        eventDescription: eventDescriptionByType[eventType],
        immediateResult: `${headline} 把整栋楼的注意力都拽了过去，新的站队和误会正在生成。`,
        narrative,
        attachments: buildFallbackAttachments(headline, eventType, involved),
    };
}

export function normalizeWorldDramaDecision(raw: any): WorldDramaDecision {
    const fallbackNarrative: CharNarrative = {
        innerThought: '',
        dialogue: '',
        commentOnWorld: '',
        emotionalTone: 'scheming',
    };

    if (!raw || typeof raw !== 'object') {
        return {
            headline: '主线剧情',
            eventType: 'gossip',
            involvedNpcIds: [],
            eventDescription: '一段新的都市主线突然开始了。',
            immediateResult: '围观情绪迅速升温。',
            narrative: fallbackNarrative,
            attachments: [],
        };
    }

    const validKinds = new Set(['image', 'item', 'fanfic', 'evidence']);
    const validRarity = new Set(['common', 'rare', 'epic']);
    const rawEventType = typeof raw.eventType === 'string' ? raw.eventType.toLowerCase() : '';
    const eventType = (WORLD_EVENT_TYPES.includes(rawEventType as SimEventType) ? rawEventType : 'gossip') as SimEventType;
    const rawNarrative = raw.narrative && typeof raw.narrative === 'object' ? raw.narrative : raw;
    const rawTone = typeof rawNarrative.emotionalTone === 'string' ? rawNarrative.emotionalTone.toLowerCase() : 'scheming';

    const attachments = Array.isArray(raw.attachments)
        ? raw.attachments
            .filter((item: any) => item && typeof item === 'object')
            .map((item: any): SimStoryAttachmentDraft => ({
                kind: validKinds.has(item.kind) ? item.kind : 'evidence',
                title: String(item.title || '未命名附件').slice(0, 40),
                summary: String(item.summary || item.caption || '没有留下太多说明。').slice(0, 120),
                detail: typeof item.detail === 'string' ? item.detail : undefined,
                visualPrompt: typeof item.visualPrompt === 'string' ? item.visualPrompt : undefined,
                rarity: validRarity.has(item.rarity) ? item.rarity : 'common',
            }))
        : [];

    return {
        headline: String(raw.headline || raw.title || '主线剧情').slice(0, 40),
        eventType,
        involvedNpcIds: Array.isArray(raw.involvedNpcIds) ? raw.involvedNpcIds.map(String) : [],
        eventDescription: String(raw.eventDescription || raw.description || '一段新的都市主线突然开始了。').slice(0, 120),
        immediateResult: String(raw.immediateResult || raw.result || '围观情绪迅速升温。').slice(0, 160),
        narrative: {
            innerThought: String(rawNarrative.innerThought || rawNarrative.thought || '').slice(0, 120),
            dialogue: String(rawNarrative.dialogue || rawNarrative.scene || '').slice(0, 180),
            commentOnWorld: String(rawNarrative.commentOnWorld || rawNarrative.comment || '').slice(0, 120),
            emotionalTone: (WORLD_TONES.includes(rawTone as CharNarrative['emotionalTone']) ? rawTone : 'scheming') as CharNarrative['emotionalTone'],
        },
        attachments,
    };
}

export function buildWorldDramaPlannerPrompt(
    user: UserProfile,
    state: LifeSimState,
    actionLog: SimAction[]
): string {
    return `
你不是某个角色，也不是玩家。你是这座都市人生小世界的“主线编剧室”。

任务：现在进入非常 drama 的规划环节，请围绕 NPC 直接启动一段新的主线剧情。
规则：
- 这次是“主线剧情”，不是普通旁支，不需要 CHAR 参与。
- 只能使用当前世界里的 NPC，当事人建议 2-4 个。
- 主线要像连续剧开篇，要有钩子、误会、站队欲，能自然引出后续。
- 不能只写“发生了什么”，必须额外掉落 2-3 个附件。
- 附件可从 image / item / fanfic / evidence 里选择。
- 如果是 fanfic，detail 里直接给出正文片段。
- 如果是 image，给 visualPrompt，我会把它做成剧情插图卡。

${serializeWorldContext(state)}

${serializeGameState(state)}

=== 最近剧情 ===
${serializeActionLog(actionLog, 12)}

${buildAvailableResources(state)}

请只返回 JSON：
{
  "headline": "主线标题，像连续剧小标题",
  "eventType": "fight|party|gossip|romance|rivalry|alliance",
  "involvedNpcIds": ["npc id"],
  "eventDescription": "一句话描述这次主线导火索",
  "immediateResult": "这段主线刚开启就带来的即时后果",
  "narrative": {
    "innerThought": "编剧式旁白/幕后判断",
    "dialogue": "更有画面的场景描写",
    "commentOnWorld": "对当前世界线的吐槽或判断",
    "emotionalTone": "vengeful|romantic|scheming|chaotic|peaceful|amused|anxious"
  },
  "attachments": [
    {
      "kind": "image|item|fanfic|evidence",
      "title": "附件标题",
      "summary": "短说明",
      "detail": "展开内容，可选；fanfic 建议给正文",
      "visualPrompt": "如果 kind=image 才填",
      "rarity": "common|rare|epic"
    }
  ]
}
`.trim();
}

export function buildCharTurnSystemPrompt(
    char: CharacterProfile,
    user: UserProfile,
    recentChatHistory: string,
    state: LifeSimState,
    actionLog: SimAction[]
): string {
    // 1. 角色核心上下文
    const coreContext = ContextBuilder.buildCoreContext(char, user, true);

    // 2. 季节/天气信息
    const season = state.season ?? 'spring';
    const si = SEASON_INFO[season];
    const ti = TIME_INFO[state.timeOfDay ?? 'morning'];
    const wi = WEATHER_INFO[state.weather ?? 'sunny'];

    // 3. 游戏设定
    const dramaSetup = `
=== 你正在和${user.name}一起玩一款叫【模拟人生】的游戏 ===

你们是一群朋友围在一起玩游戏，游戏里有一个小镇，里面住着各种NPC小人。
你不在游戏世界里——你是坐在外面的玩家，在操控和观察游戏里的小人们。
每个玩家轮流操作，现在轮到你了。

当前游戏画面：${si.emoji}${si.zh}季 第${state.day ?? 1}天 | ${ti.emoji}${ti.zh} | ${wi.emoji}${wi.zh}
${getSeasonDramaHint(season)}

你可以做的操作：
- TRIGGER_EVENT：在游戏里制造事件，让小人们打架/聚会/八卦/恋爱/竞争/结盟
- ADD_NPC：往游戏里捏一个新小人丢进去
- MOVE_NPC：把某个小人搬到另一个家庭
- GO_SOLO：让某个小人搬出去独居
- DO_NOTHING：这轮跳过，看戏

玩法提示：
- 用你自己的性格来决定怎么玩——你是玩家，用你觉得有趣的方式搞事
- 你可以把某个小人代入成你自己或你认识的人，但要说出来（比如"这个小人就是我！"）
- TRIGGER_EVENT最好玩——让小人们上演各种drama
- 你的thought是你作为玩家的内心吐槽/想法，dialogue是你对着屏幕说的话或对游戏的评论
- 用你自己的说话风格，像朋友一起打游戏时的聊天
`;

    // 4. 世界环境
    const worldContextSection = `\n${serializeWorldContext(state)}\n`;

    // 5. 戏剧局势 + 游戏状态
    const gameStateSection = `\n${serializeGameState(state)}\n`;

    // 6. 操作记录
    const logSection = `\n=== 最近操作记录 ===\n${serializeActionLog(actionLog, 10)}\n`;

    // 7. 聊天记录
    const chatSection = recentChatHistory
        ? `\n=== 你和${user.name}最近的聊天（游戏外的对话）===\n${recentChatHistory}\n`
        : '';

    // 8. 可用资源
    const availableResources = buildAvailableResources(state);

    // 9. 输出格式（简化版，提高LLM成功率）
    const outputFormat = `
=== 你的回合 ===

请以JSON格式返回你的决策，只返回JSON不要其他文字。

你有5种行动可选：
1. TRIGGER_EVENT — 制造事件（最常用）
2. ADD_NPC — 拉新人入住
3. MOVE_NPC — 搬人到另一栋
4. GO_SOLO — 让某人搬出去独居
5. DO_NOTHING — 什么都不做

根据你选的行动类型，返回对应格式：

TRIGGER_EVENT示例：
{"type":"TRIGGER_EVENT","eventType":"fight","involvedNpcIds":["id1","id2"],"eventDescription":"在走廊里对峙","thought":"内心独白","dialogue":"说的话或场景描写","tone":"chaotic"}

ADD_NPC示例：
{"type":"ADD_NPC","newNpcName":"小明","newNpcEmoji":"🐱","newNpcPersonality":["暴躁","重情"],"targetFamilyId":"xxx","thought":"内心独白","dialogue":"场景描写","tone":"amused"}

MOVE_NPC示例：
{"type":"MOVE_NPC","npcId":"xxx","targetFamilyId":"yyy","thought":"内心独白","dialogue":"场景描写","tone":"scheming"}

GO_SOLO示例：
{"type":"GO_SOLO","npcId":"xxx","thought":"独白","dialogue":"描写","tone":"peaceful"}

DO_NOTHING示例：
{"type":"DO_NOTHING","thought":"内心独白","dialogue":"场景描写","tone":"scheming"}

字段说明：
- type: 必填，以上5选1
- eventType: TRIGGER_EVENT时必填，可选 fight/party/gossip/romance/rivalry/alliance
- involvedNpcIds: TRIGGER_EVENT时必填，参与的小人ID数组
- eventDescription: 游戏里发生了什么，一句话
- thought: 你作为玩家的内心想法/吐槽（简短）
- dialogue: 你对着屏幕说的话，或对其他玩家的评论
- tone: 你的情绪，可选 vengeful/romantic/scheming/chaotic/peaceful/amused/anxious

记住你是玩家不是游戏里的人物。用你自己的说话风格。
`;

    return [coreContext, dramaSetup, worldContextSection, gameStateSection, chatSection, logSection, availableResources, outputFormat].join('\n');
}

function buildAvailableResources(state: LifeSimState): string {
    const lines: string[] = ['\n=== 游戏里可操作的对象（复制ID填入JSON）==='];

    lines.push('\n【家庭列表】');
    for (const fam of state.families) {
        const count = fam.memberIds.length;
        lines.push(`  家庭ID: "${fam.id}" | ${fam.emoji}${fam.name} (${count}个小人)`);
    }

    lines.push('\n【小人列表】');
    for (const npc of state.npcs) {
        const fam = state.families.find(f => f.id === npc.familyId);
        const { emoji: moodEmoji } = getMoodLabel(npc.mood);
        lines.push(`  小人ID: "${npc.id}" | ${npc.emoji}${npc.name} | ${fam ? fam.name : '独居'} | 心情:${moodEmoji}(${npc.mood})`);
    }

    return lines.join('\n');
}

export function formatRecentChatForSim(
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
    charName: string,
    userName: string,
    maxMessages = 20
): string {
    const relevant = messages
        .filter(m => m.role !== 'system' && ((m as any).type === 'text' || (m as any).type === 'voice' || !(m as any).type))
        .slice(-maxMessages);
    if (relevant.length === 0) return '（暂无聊天记录）';
    return relevant.map(m =>
        `[${m.role === 'user' ? userName : charName}] ${m.content.replace(/\n/g, ' ').slice(0, 100)}`
    ).join('\n');
}

export function buildUserActionDescription(
    actionType: string,
    actorName: string,
    details: {
        npcName?: string;
        npcEmoji?: string;
        npcPersonality?: string[];
        targetFamilyName?: string;
        fromFamilyName?: string;
        eventType?: string;
        eventDesc?: string;
    }
): string {
    switch (actionType) {
        case 'ADD_NPC':
            return `${actorName}往游戏里捏了个叫"${details.npcEmoji}${details.npcName}"的小人（性格：${details.npcPersonality?.join('/')}），放进了${details.targetFamilyName}`;
        case 'MOVE_NPC':
            return `${actorName}把小人${details.npcEmoji}${details.npcName}从${details.fromFamilyName || '某处'}搬到了${details.targetFamilyName || '独居'}`;
        case 'GO_SOLO':
            return `${actorName}让小人${details.npcEmoji}${details.npcName}从${details.fromFamilyName || '某处'}搬出去独居了`;
        case 'TRIGGER_EVENT':
            return `${actorName}在游戏里制造了${details.eventType}事件：${details.eventDesc}`;
        case 'DO_NOTHING':
            return `${actorName}选择看戏，这轮跳过了`;
        default:
            return `${actorName}进行了一个操作`;
    }
}
