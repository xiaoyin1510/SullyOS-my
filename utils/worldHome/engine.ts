/**
 * 「家园」演绎引擎 —— 一轮"观测"的完整闭环。
 *
 * 成本模型（刻意不做真实时间常驻运行）：
 *   - 用户每次"观测"（手动推进）或每日有限次离线 tick 触发一轮演绎
 *   - 一轮 = 1 次 NPC 世界引擎调用（一口气演完所有 NPC，NPC 无记忆）
 *          + N 次角色调用（链式，每角色一次，确保没人开上帝视角）
 *   - 一轮推进半天剧情时间；"我不看的时候世界慢慢走，我一看就加速"
 *
 * 每个角色的调用复用聊天主链路 buildChatRequestPayload：
 *   ContextBuilder 人设 + 角色设定的私聊上下文条数 + 记忆宫殿
 *   （召回 query 注入"同世界其他角色"，让角色记得自己跟他们的过往）。
 *
 * 产出注入：每个成员的 1v1 聊天各落一条 world_card（可解析 metadata），
 * 与彼方 vr_card 同构，天然进入上下文与记忆管线。
 */

import type {
    CharacterProfile, UserProfile, GroupProfile, RealtimeConfig, APIConfig,
    WorldProfile, WorldEpisode, WorldCharBeat, WorldCardMeta,
} from '../../types';
import { DB } from '../db';
import { buildChatRequestPayload } from '../chatRequestPayload';
import { safeFetchJson } from '../safeApi';
import { processNewMessages } from '../memoryPalace/pipeline';
import {
    worldTimeLabel, buildWorldSystemAddendum, buildWorldCharTurn, buildNpcTurn,
    parseCharBeat, parseNpcScene, realObserveTarget, formatRealClock,
} from './prompts';
import { ensureThreads, applyBeatToThreads, applyNpcGroupLines, applyNpcDms, npcInboxes } from './threads';
import { shouldCloseChapter, summarizeChapter, SIM_CHAPTER_CLOCKS } from './chapters';

interface MemoryConfigLike {
    embedding?: { baseUrl?: string; apiKey?: string; model?: string; dimensions?: number };
    lightLLM?: { baseUrl?: string; apiKey?: string; model?: string };
}

export interface WorldEpisodeDeps {
    world: WorldProfile;
    characters: CharacterProfile[];
    apiConfig: APIConfig;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    memoryPalaceConfig?: MemoryConfigLike;
    trigger: 'observe' | 'tick';
}

export interface WorldEpisodeResult {
    ok: boolean;
    reason?: string;
    episode?: WorldEpisode;
}

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const running = new Set<string>();

/** 读家园全局 API（设置弹窗写入 localStorage 的 'world_home_api'；不设返回 null）。 */
function readWorldHomeApiOverride(): { baseUrl: string; apiKey: string; model: string } | null {
    try {
        const s = typeof localStorage !== 'undefined' ? localStorage.getItem('world_home_api') : null;
        const c = s ? JSON.parse(s) : null;
        return c?.baseUrl ? c : null;
    } catch { return null; }
}

export function isWorldRunning(worldId: string): boolean {
    return running.has(worldId);
}

const dispatch = (name: string, detail: any) => {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* SSR */ }
};

/**
 * 关系 delta 回填。关系有向：A 的演绎里"和 B 关系 +2"只代表 **A 对 B** 的好感变了，
 * B 对 A 怎么想由 B 自己的演绎轮决定——两边完全可以不对等。不存在的边按 50 起步。
 */
export function applyRelationshipDeltas(world: WorldProfile, beats: WorldCharBeat[], members: { id: string; name: string }[]): void {
    const idOf = (name: string) => members.find(m => m.name === name)?.id;
    for (const beat of beats) {
        for (const rd of beat.relationshipDeltas || []) {
            const otherId = idOf(rd.withName);
            if (!otherId || otherId === beat.charId) continue;
            let rel = world.relationships.find(r => r.fromId === beat.charId && r.toId === otherId);
            if (!rel) {
                // 没记录的边按「陌生中立」0 起步（不是凭空友善）
                rel = { fromId: beat.charId, toId: otherId, value: 0 };
                world.relationships.push(rel);
            }
            // 好感范围 -100 ~ +100（可为负 = 嫌隙/敌意）
            rel.value = Math.max(-100, Math.min(100, rel.value + rd.delta));
            // 重大转折时，角色对这段关系的看法（label）也会变
            if (rd.newLabel) rel.label = rd.newLabel;
        }
    }
}

/**
 * 机械拼接本轮梗概（喂给下一轮所有人，不再额外烧一次 LLM）。
 * ⚠️ 只能用公开信息：shared 行程 + 位置。narrative/mood/secrets 是私人的，
 * 切进 summary 等于把瞒下的事广播给所有人，伏笔就废了。
 */
export function buildSummary(storyTime: string, beats: WorldCharBeat[], npcHooks: string[]): string {
    const parts = beats.map(b => {
        const sharedEvents = (b.timeline || []).filter(tl => tl.shared).map(tl => tl.event);
        return sharedEvents.length > 0
            ? `${b.charName}（${b.location}）：${sharedEvents.join('→')}`
            : `${b.charName} 主要在${b.location}`;
    });
    const hookPart = npcHooks.length > 0 ? ` ／镇上：${npcHooks.join('；')}` : '';
    return `${storyTime}：${parts.join(' ／ ')}${hookPart}`.slice(0, 1200);
}

/** 公开社交媒体：上一轮 + 本轮已演绎角色的动态（公开可见，传给每个角色）。 */
function collectRecentPosts(lastBeats: WorldCharBeat[], beatsSoFar: WorldCharBeat[]): { name: string; post: string }[] {
    const out: { name: string; post: string }[] = [];
    for (const b of [...lastBeats, ...beatsSoFar]) {
        for (const p of b.phone?.posts || []) out.push({ name: b.charName, post: p });
    }
    return out.slice(-10);
}

/**
 * 把 beat 里瞒下的事收进伏笔栏（pending）。
 * 显式 secrets 优先；timeline 里 shared=false 但没写进 secrets 的条目自动补一条。
 */
export function collectSeeds(world: WorldProfile, beat: WorldCharBeat, round: number, storyTime: string): void {
    if (!world.seeds) world.seeds = [];
    const texts = new Set<string>();
    for (const s of beat.secrets || []) {
        texts.add(s.text);
        world.seeds.push({
            id: genId('seed'), charId: beat.charId, charName: beat.charName,
            text: s.text, hideFrom: s.hideFrom || [], round, storyTime, status: 'pending',
        });
    }
    for (const tl of beat.timeline || []) {
        if (tl.shared) continue;
        const text = `${tl.time} 在${tl.place}：${tl.event}`;
        // 已被显式 secrets 覆盖（粗匹配事件文本）就不重复
        if ([...texts].some(t => t.includes(tl.event.slice(0, 20)) || tl.event.includes(t.slice(0, 20)))) continue;
        world.seeds.push({
            id: genId('seed'), charId: beat.charId, charName: beat.charName,
            text, hideFrom: [], round, storyTime, status: 'pending',
        });
    }
    // 伏笔栏只留最近 30 条 pending/armed；resolved 留 20 条供回看
    const active = world.seeds.filter(s => s.status !== 'resolved').slice(-30);
    const resolved = world.seeds.filter(s => s.status === 'resolved').slice(-20);
    world.seeds = [...resolved, ...active];
}

/** 按 armed 伏笔为某角色生成"绕不开的事"注入文案。 */
function buildExposures(world: WorldProfile, charId: string, charName: string): string[] {
    const out: string[] = [];
    for (const seed of world.seeds || []) {
        if (seed.status !== 'armed') continue;
        if (seed.charId === charId) {
            out.push(`你之前瞒下的事（${seed.text}）这半天藏不住了——有人察觉了端倪，正面处理它带来的局面。`);
        } else if (seed.hideFrom.length === 0 || seed.hideFrom.includes(charName)) {
            out.push(`你发现/听说了 ${seed.charName} 一直瞒着的事：${seed.text}。这件事此刻摆在你面前，按你的性格去消化或对质。`);
        }
    }
    return out;
}

/** 单个角色的 world_card 文本（注入本人的 1v1 聊天与记忆——本人的视角，含自己瞒的事）。 */
function buildCardContent(world: WorldProfile, storyTime: string, beat: WorldCharBeat): string {
    const lines = [
        `「家园 · ${world.name}」${storyTime}`,
        `${beat.charName} 在${beat.location}（${beat.mood}）`,
    ];
    if (beat.timeline?.length) {
        lines.push('这半天的行程：');
        for (const tl of beat.timeline) lines.push(`· ${tl.time} ${tl.place}：${tl.event}${tl.shared ? '' : '（没声张）'}`);
    }
    lines.push(beat.narrative);
    if (beat.memo?.length) {
        for (const m of beat.memo) lines.push(`备忘录：${m}`);
    }
    if (beat.impulse) lines.push(`心里的冲动：${beat.impulse.text}`);
    if (beat.dialogues?.length) {
        for (const d of beat.dialogues) lines.push(`当面对 ${d.with} 说：${d.lines.join(' / ')}`);
    }
    if (beat.phone?.posts?.length) {
        for (const p of beat.phone.posts) lines.push(`发了动态：${p}`);
    }
    if (beat.phone?.dms?.length) {
        for (const d of beat.phone.dms) lines.push(`给 ${d.to} 发消息：${d.lines.join(' / ')}`);
    }
    if (beat.phone?.group?.length) {
        lines.push(`在世界群聊里说：${beat.phone.group.join(' / ')}`);
    }
    return lines.join('\n');
}

export async function runWorldEpisode(deps: WorldEpisodeDeps): Promise<WorldEpisodeResult> {
    const { world, characters, apiConfig, userProfile, groups, realtimeConfig, memoryPalaceConfig, trigger } = deps;

    if (running.has(world.id)) return { ok: false, reason: 'busy' };

    const members = world.memberIds
        .map(id => characters.find(c => c.id === id))
        .filter(Boolean) as CharacterProfile[];
    if (members.length === 0) return { ok: false, reason: 'no-members' };

    // API 优先级：世界私有覆盖（旧数据）> 家园全局设置（localStorage）> 全局聊天默认
    const worldHomeApi = readWorldHomeApiOverride();
    const api = world.api?.baseUrl ? world.api : (worldHomeApi || apiConfig);
    if (!api.baseUrl) return { ok: false, reason: 'no-api' };
    const baseUrl = api.baseUrl.replace(/\/+$/, '');

    // real 模式：演的那一段跟着真实时钟走，且只能补当天错过的段；已追上现实就没东西可演
    const realTarget = world.timeMode !== 'sim' ? realObserveTarget(world) : null;
    if (world.timeMode !== 'sim' && !realTarget) return { ok: false, reason: 'caught-up' };

    running.add(world.id);
    const storyTime = realTarget ? formatRealClock(realTarget) : worldTimeLabel(world);
    const round = world.storyClock + 1;
    // sim 模式不进记忆/聊天——演绎攒在家园里，靠每 20 天的结卷总结沉淀
    const entersMemory = world.timeMode !== 'sim' && world.injectToChat !== false;
    // sim 模式：已结卷归档的原文不再喂；最新一卷的单视角总结 + 氛围作为上文
    const latestChapter = (world.chapters || [])[(world.chapters?.length || 0) - 1];
    // 线程容器就位：本轮所有消息（NPC 群聊冒泡 / 角色私聊与群聊）都即时落在 world.threads 上，
    // 链式后续角色构建上下文时直接读到——消息在同一轮内就完成传递。
    ensureThreads(world);
    dispatch('world-episode-start', { worldId: world.id, worldName: world.name, storyTime, total: members.length });

    try {
        const lastEpisodes = await DB.getWorldEpisodes(world.id, 2);
        // 给一点纵深：最近两轮的梗概都喂进去，世界才有"昨天"的概念。
        // sim 模式下，已归档（round ≤ simSummarizedClock）的原文不再喂——交给章节总结。
        const sinceClock = world.simSummarizedClock || 0;
        const summarySource = world.timeMode === 'sim'
            ? lastEpisodes.filter(e => e.round > sinceClock)
            : lastEpisodes;
        const lastSummary = summarySource.length > 0
            ? summarySource.slice().reverse().map(e => e.summary).join('\n')
            : undefined;

        // NPC 引擎改到角色之后跑（见 ── 2.5 ──）：这样 NPC 能看到角色这一轮刚发的私聊/动态/
        // 群聊，当轮就回应。角色这一轮看到的「镇上动静」用上一轮 NPC 的产出——和角色彼此错一
        // 轮接话是一致的模型。本轮 NPC 的产出存进 episode、并在下一轮被角色接住。
        const lastNpcScene = lastEpisodes[0]?.npcScene;
        const lastNpcHooks = lastEpisodes[0]?.npcHooks || [];
        let npcScene: string | undefined;
        let npcHooks: string[] = [];

        // ── 1. 链式角色演绎（每角色一次独立调用，后者能"看到"前者的公开行为） ──
        const memberNames = members.map(m => m.name);
        const lastBeats = lastEpisodes[0]?.beats || [];
        const beats: WorldCharBeat[] = [];
        const consumedDirectiveIds: string[] = [];
        let anyCharOk = false;
        for (let i = 0; i < members.length; i++) {
            const char = members[i];
            try {
                const others = memberNames.filter(n => n !== char.name);
                // 与彼方同款的名字加权召回：让向量记忆召回"我和这些人的关系"，
                // 而不是被世界观情景词淹没。query = 当前世界的其他角色。
                const recallQueryHint = others.length > 0
                    ? [
                        `此刻在「${world.name}」共同生活的人：${others.join('、')}。`,
                        `${others.join(' ')} ${others.join(' ')}`,
                        `我对${others.join('、')}的印象、我和${others.join('、')}之间的关系与过往。`,
                    ].join('\n')
                    : undefined;

                const contextLimit = char.contextLimit || 500;
                const historyMsgs = await DB.getRecentMessagesByCharId(char.id, contextLimit);
                const payload = await buildChatRequestPayload({
                    char, userProfile, groups, emojis: [], categories: [],
                    historyMsgs, contextLimit, realtimeConfig, recallQueryHint,
                });
                const systemPrompt = payload.systemPrompt + buildWorldSystemAddendum(world, char, userProfile?.name || '');
                const directive = (world.directives || []).find(d => d.charId === char.id);
                // sim 模式：喂回这名角色自己的单视角总结 + 本卷氛围（绝不喂全知 synopsis）
                const priorChapter = (world.timeMode === 'sim' && latestChapter)
                    ? {
                        atmosphere: latestChapter.atmosphere,
                        charPerspective: latestChapter.perspectives.find(p => p.charId === char.id)?.text,
                    }
                    : undefined;
                const turn = buildWorldCharTurn({
                    world, char, members, storyTime, round, lastSummary,
                    npcScene: lastNpcScene, npcHooks: lastNpcHooks, beatsSoFar: beats,
                    recentPosts: collectRecentPosts(lastBeats, beats),
                    exposures: buildExposures(world, char.id, char.name),
                    directive: directive ? { impulseText: directive.impulseText, text: directive.text } : undefined,
                    priorChapter,
                    userName: userProfile?.name || '',
                });
                if (directive) consumedDirectiveIds.push(directive.id);

                const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: api.model,
                        messages: [{ role: 'system', content: systemPrompt }, ...payload.cleanedApiMessages, { role: 'user', content: turn }],
                        temperature: 0.9, stream: false,
                    }),
                }, 2, 0, { appName: '家园', charId: char.id, charName: char.name, purpose: `演绎 · ${world.name}` });
                const beat = parseCharBeat(data.choices?.[0]?.message?.content || '', char, memberNames, world.npcs.map(n => n.name));
                beats.push(beat);
                // 该角色发出的私聊/群聊立刻落线程——后面还没演绎的角色这一轮就能收到并回应
                applyBeatToThreads(world, beat, members, round, storyTime);
                // 瞒下的事落进伏笔栏（pending，等用户点击引爆）
                collectSeeds(world, beat, round, storyTime);
                anyCharOk = true;
            } catch (e) {
                // 单个角色失败不拖垮整轮——这半天 ta 只是没什么动静
                console.error(`[WorldHome] beat failed for ${char.name}:`, e);
            }
            dispatch('world-beat-done', { worldId: world.id, stage: 'char', charId: char.id, charName: char.name, done: i + 1, total: members.length });
        }

        if (!anyCharOk) return { ok: false, reason: 'all-beats-failed' };

        // ── 2.5 NPC 世界引擎（角色之后跑）：回应本轮角色发来的私聊、给本轮动态点赞/评论、群里冒泡 ──
        if (world.npcs.length > 0) {
            try {
                // 喂这一轮角色刚发的动态，让 NPC + 路人当轮就点赞评论
                const recentPostsForNpc = beats.flatMap(b =>
                    (b.phone?.posts || []).map((post, idx) => ({ ref: `${round}_${b.charId}_${idx}`, name: b.charName, post }))
                ).slice(0, 12);
                const npcData = await safeFetchJson(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
                    body: JSON.stringify({
                        model: api.model,
                        messages: [{ role: 'user', content: buildNpcTurn({ world, members, storyTime, lastSummary, chapterAtmosphere: latestChapter?.atmosphere, inboxes: npcInboxes(world), recentPosts: recentPostsForNpc }) }],
                        temperature: 0.9, stream: false,
                    }),
                }, 2, 0, { appName: '家园', purpose: `NPC世界引擎 · ${world.name}` });
                const parsed = parseNpcScene(npcData.choices?.[0]?.message?.content || '');
                npcScene = parsed.scene || undefined;
                npcHooks = parsed.hooks;
                // 群聊冒泡 + 回复成员私信（落线程，角色下一轮接住）
                applyNpcGroupLines(world, parsed.groupLines, round, storyTime);
                applyNpcDms(world, parsed.dms, members, round, storyTime);
                // 动态的点赞/评论（NPC + 路人）回填
                if (parsed.feedReactions.length > 0) {
                    world.feedReactions = { ...(world.feedReactions || {}) };
                    for (const r of parsed.feedReactions) world.feedReactions[r.ref] = { likes: r.likes, comments: r.comments };
                }
            } catch (e) {
                console.warn('[WorldHome] NPC engine failed:', e);
            }
            dispatch('world-beat-done', { worldId: world.id, stage: 'npc', done: members.length, total: members.length });
        }

        // ── 3. 落库：episode + 关系回填 + 剧情时钟推进 ──
        // 成功的角色照常保留；没演出来的记下 charId，UI 提示用户可单独重 roll
        const okIds = new Set(beats.map(b => b.charId));
        const failedCharIds = members.filter(m => !okIds.has(m.id)).map(m => m.id);
        const episode: WorldEpisode = {
            id: genId('we'),
            worldId: world.id,
            round,
            storyTime,
            trigger,
            npcScene,
            npcHooks: npcHooks.length > 0 ? npcHooks : undefined,
            beats,
            failedCharIds: failedCharIds.length > 0 ? failedCharIds : undefined,
            summary: buildSummary(storyTime, beats, npcHooks),
            createdAt: Date.now(),
        };
        await DB.saveWorldEpisode(episode);

        applyRelationshipDeltas(world, beats, members);
        // armed 伏笔本轮已爆发 → resolved；本轮注入过的用户决策消费掉
        for (const seed of world.seeds || []) {
            if (seed.status === 'armed') seed.status = 'resolved';
        }
        const remainingDirectives = (world.directives || []).filter(d => !consumedDirectiveIds.includes(d.id));
        const updatedWorld: WorldProfile = {
            ...world,
            relationships: world.relationships,
            threads: world.threads, // 本轮累积的私聊/群聊消息一并持久化
            seeds: world.seeds,
            directives: remainingDirectives,
            storyClock: world.storyClock + 1,
            // real 模式：把世界的「现实段」推进到这次演的那一段
            realClock: realTarget || world.realClock,
            updatedAt: Date.now(),
        };
        await DB.saveWorld(updatedWorld);

        // ── 3.5 sim 模式：攒满 20 天结一卷（小说体总结 + 各角色单视角，归档原文） ──
        const newClock = updatedWorld.storyClock;
        if (shouldCloseChapter(updatedWorld, newClock)) {
            try {
                const fromClock = newClock - SIM_CHAPTER_CLOCKS;
                const index = newClock / SIM_CHAPTER_CLOCKS;
                // 拉取本卷窗口内的原文（round 落在 (fromClock, newClock]）
                const windowEpisodes = (await DB.getWorldEpisodes(world.id, SIM_CHAPTER_CLOCKS + 2))
                    .filter(e => e.round > fromClock && e.round <= newClock);
                dispatch('world-chapter-start', { worldId: world.id, index });
                const chapter = await summarizeChapter({
                    world: updatedWorld, members, episodes: windowEpisodes, api: { baseUrl, apiKey: api.apiKey || '', model: api.model },
                    fromClock, toClock: newClock,
                    fromLabel: worldTimeLabel(updatedWorld, fromClock),
                    toLabel: worldTimeLabel(updatedWorld, Math.max(fromClock, newClock - 1)),
                    index, prevSynopsis: latestChapter?.synopsis,
                });
                if (chapter) {
                    updatedWorld.chapters = [...(updatedWorld.chapters || []), chapter];
                    updatedWorld.simSummarizedClock = newClock;
                    // 归档后清空手机里属于这 20 天的私聊/群聊 + 动态互动（已卷进编年史）
                    if (updatedWorld.threads) {
                        updatedWorld.threads = updatedWorld.threads.map(t => ({ ...t, messages: t.messages.filter(m => m.round > newClock) }));
                    }
                    if (updatedWorld.feedReactions) {
                        updatedWorld.feedReactions = Object.fromEntries(
                            Object.entries(updatedWorld.feedReactions).filter(([k]) => (parseInt(k.split('_')[0], 10) || 0) > newClock)
                        );
                    }
                    updatedWorld.updatedAt = Date.now();
                    await DB.saveWorld(updatedWorld);
                    dispatch('world-chapter-done', { worldId: world.id, index, chapterId: chapter.id });
                }
            } catch (e) {
                console.warn('[WorldHome] close-chapter failed:', e);
            }
        }

        // ── 4. world_card 注入各成员 1v1 聊天（与彼方 vr_card 同构；sim 模式不进记忆，跳过） ──
        if (entersMemory) {
            for (const beat of beats) {
                const meta: WorldCardMeta = {
                    worldCard: true,
                    worldId: world.id,
                    worldName: world.name,
                    mode: world.mode,
                    round: episode.round,
                    storyTime,
                    location: beat.location,
                    mood: beat.mood,
                    narrative: beat.narrative,
                    statusPanel: beat.statusPanel,
                    timeline: beat.timeline,
                    memo: beat.memo,
                    impulse: beat.impulse,
                    phonePosts: beat.phone?.posts,
                    phoneGroup: beat.phone?.group,
                };
                try {
                    await DB.saveMessage({
                        charId: beat.charId, role: 'assistant', type: 'world_card',
                        content: buildCardContent(world, storyTime, beat), metadata: meta,
                    });
                } catch (e) {
                    console.error(`[WorldHome] card inject failed for ${beat.charName}:`, e);
                }
            }

            // 记忆管线（fire-and-forget，逐角色）
            try {
                const mpEmb = memoryPalaceConfig?.embedding;
                const mpLLMConfigured = memoryPalaceConfig?.lightLLM;
                const mpLLM = (mpLLMConfigured?.baseUrl) ? mpLLMConfigured : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
                if (mpEmb?.baseUrl && mpEmb?.apiKey && mpLLM.baseUrl) {
                    for (const beat of beats) {
                        const char = members.find(m => m.id === beat.charId);
                        if (!char?.memoryPalaceEnabled) continue;
                        const recentMsgs = await DB.getRecentMessagesByCharId(char.id, 50);
                        void processNewMessages(recentMsgs, char.id, char.name, mpEmb as any, mpLLM as any, userProfile?.name || '', false).catch(() => {});
                    }
                }
            } catch { /* 记忆失败不影响主流程 */ }
        }

        dispatch('world-episode-done', { worldId: world.id, episodeId: episode.id, storyTime, round: episode.round });
        return { ok: true, episode };
    } catch (err) {
        console.error('[WorldHome] episode error:', err);
        return { ok: false, reason: 'error' };
    } finally {
        running.delete(world.id);
        dispatch('world-episode-end', { worldId: world.id });
    }
}

/**
 * 单个角色重 roll：只重演某一轮里某个角色这一拍（用于本轮该角色生成失败、或用户想换个写法）。
 * - direction：用户给的「大致重写方向」，没有就完全重写。
 * - 之前是「失败缺这拍」→ 补上后照常落线程/伏笔/关系，真实模式补一张 world_card；
 *   之前已有这拍（用户想换写法）→ 只替换这拍内容，不重复落副作用（避免重复加好感/重复消息）。
 */
export async function rerollWorldCharBeat(
    deps: WorldEpisodeDeps & { episodeId: string; charId: string; direction?: string },
): Promise<WorldEpisodeResult> {
    const { world, characters, apiConfig, userProfile, groups, realtimeConfig, episodeId, charId, direction } = deps;
    if (running.has(world.id)) return { ok: false, reason: 'busy' };
    const members = world.memberIds.map(id => characters.find(c => c.id === id)).filter(Boolean) as CharacterProfile[];
    const char = members.find(m => m.id === charId);
    if (!char) return { ok: false, reason: 'no-char' };
    const memberNames = members.map(m => m.name);
    const worldHomeApi = readWorldHomeApiOverride();
    const api = world.api?.baseUrl ? world.api : (worldHomeApi || apiConfig);
    if (!api.baseUrl) return { ok: false, reason: 'no-api' };
    const baseUrl = api.baseUrl.replace(/\/+$/, '');

    const episodes = await DB.getWorldEpisodes(world.id, 30);
    const episode = episodes.find(e => e.id === episodeId);
    if (!episode) return { ok: false, reason: 'no-episode' };
    const hadBeat = episode.beats.some(b => b.charId === charId);

    running.add(world.id);
    dispatch('world-episode-start', { worldId: world.id, worldName: world.name, storyTime: episode.storyTime, total: 1 });
    dispatch('world-beat-done', { worldId: world.id, stage: 'char', charId, charName: char.name, done: 0, total: 1 });
    try {
        const prevEp = episodes.find(e => e.round === episode.round - 1);
        const otherBeats = episode.beats.filter(b => b.charId !== charId);
        const others = memberNames.filter(n => n !== char.name);
        const recallQueryHint = others.length > 0
            ? `此刻在「${world.name}」共同生活的人：${others.join('、')}。\n我对${others.join('、')}的印象、我和${others.join('、')}之间的关系与过往。`
            : undefined;
        const contextLimit = char.contextLimit || 500;
        const historyMsgs = await DB.getRecentMessagesByCharId(char.id, contextLimit);
        const payload = await buildChatRequestPayload({
            char, userProfile, groups, emojis: [], categories: [],
            historyMsgs, contextLimit, realtimeConfig, recallQueryHint,
        });
        const systemPrompt = payload.systemPrompt + buildWorldSystemAddendum(world, char, userProfile?.name || '');
        const latestChapter = (world.chapters || [])[(world.chapters?.length || 0) - 1];
        const priorChapter = (world.timeMode === 'sim' && latestChapter)
            ? { atmosphere: latestChapter.atmosphere, charPerspective: latestChapter.perspectives.find(p => p.charId === char.id)?.text }
            : undefined;
        let turn = buildWorldCharTurn({
            world, char, members, storyTime: episode.storyTime, round: episode.round, lastSummary: prevEp?.summary,
            npcScene: episode.npcScene, npcHooks: episode.npcHooks, beatsSoFar: otherBeats,
            recentPosts: collectRecentPosts(prevEp?.beats || [], otherBeats),
            exposures: buildExposures(world, char.id, char.name),
            priorChapter, userName: userProfile?.name || '',
        });
        if (direction && direction.trim()) {
            turn += `\n\n## 重写方向（用户希望这次往这个方向重演，请据此给出全新的一拍）\n${direction.trim()}`;
        }
        const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: api.model,
                messages: [{ role: 'system', content: systemPrompt }, ...payload.cleanedApiMessages, { role: 'user', content: turn }],
                temperature: 0.95, stream: false,
            }),
        }, 2, 0, { appName: '家园', charId: char.id, charName: char.name, purpose: `重演 · ${world.name}` });
        const beat = parseCharBeat(data.choices?.[0]?.message?.content || '', char, memberNames, world.npcs.map(n => n.name));

        const newBeats = hadBeat ? episode.beats.map(b => b.charId === charId ? beat : b) : [...episode.beats, beat];
        const stillFailed = (episode.failedCharIds || []).filter(id => id !== charId);
        const updatedEp: WorldEpisode = {
            ...episode,
            beats: newBeats,
            failedCharIds: stillFailed.length > 0 ? stillFailed : undefined,
            summary: buildSummary(episode.storyTime, newBeats, episode.npcHooks || []),
        };
        await DB.saveWorldEpisode(updatedEp);

        // 仅当之前是「失败缺这拍」时补副作用，避免对已有拍重复加好感/重复消息
        if (!hadBeat) {
            applyBeatToThreads(world, beat, members, episode.round, episode.storyTime);
            collectSeeds(world, beat, episode.round, episode.storyTime);
            applyRelationshipDeltas(world, [beat], members);
            await DB.saveWorld({ ...world, threads: world.threads, seeds: world.seeds, relationships: world.relationships, updatedAt: Date.now() });
            if (world.timeMode !== 'sim' && world.injectToChat !== false) {
                const meta: WorldCardMeta = {
                    worldCard: true, worldId: world.id, worldName: world.name, mode: world.mode,
                    round: episode.round, storyTime: episode.storyTime, location: beat.location, mood: beat.mood,
                    narrative: beat.narrative, statusPanel: beat.statusPanel, timeline: beat.timeline, memo: beat.memo,
                    impulse: beat.impulse, phonePosts: beat.phone?.posts, phoneGroup: beat.phone?.group,
                };
                try {
                    await DB.saveMessage({ charId: beat.charId, role: 'assistant', type: 'world_card', content: buildCardContent(world, episode.storyTime, beat), metadata: meta });
                } catch { /* ignore */ }
            }
        }
        dispatch('world-episode-done', { worldId: world.id, episodeId: updatedEp.id, storyTime: episode.storyTime, round: episode.round });
        return { ok: true, episode: updatedEp };
    } catch (err) {
        console.error('[WorldHome] reroll error:', err);
        return { ok: false, reason: 'error' };
    } finally {
        running.delete(world.id);
        dispatch('world-episode-end', { worldId: world.id });
    }
}
