/**
 * 「家园 · 模拟时间」章节总结 —— 每 20 天结一卷。
 *
 * sim（模拟时间）模式不进记忆，演绎一直留在家园里慢慢攒。攒满 20 天（= 40 个半天/轮）
 * 就结一卷：
 *   1. 用一次 LLM 调用把这 20 天的原文揉成一份**小说体梗概**（给屏幕外的用户看，图一乐），
 *      连带人物关系动态走向与评价、本卷沉淀的氛围基调；
 *   2. 同一次调用顺带产出**每个角色单方面视角**的回顾——往后单独喂回各自，避免角色开上帝视角；
 *   3. 归档这 20 天原文（标记 simSummarizedClock），往后只把「该角色的单视角总结 + ta 最后一天
 *      的 beat + 氛围基调」作为上文喂回——原文不再逐轮喂。
 *
 * 成本：一卷 = 1 次额外 LLM 调用（不是 N 次），用最便宜的方式拿到全员视角。
 */

import type { APIConfig, CharacterProfile, WorldProfile, WorldEpisode, WorldChapter, WorldCharBeat } from '../../types';
import { safeFetchJson } from '../safeApi';
import { extractJson } from './prompts';

/** 一天三段（早/中/晚），20 天结一卷。 */
export const SEGMENTS_PER_DAY = 3;
export const SIM_CHAPTER_DAYS = 20;
export const SIM_CHAPTER_CLOCKS = SIM_CHAPTER_DAYS * SEGMENTS_PER_DAY; // 60

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * sim 模式下，本轮推进后是否正好结满一卷。
 * round（= 推进后的 storyClock）落在 40 的整数倍上即结卷。
 */
export function shouldCloseChapter(world: WorldProfile, newClock: number): boolean {
    if (world.timeMode !== 'sim') return false;
    if (newClock <= (world.simSummarizedClock || 0)) return false;
    return newClock % SIM_CHAPTER_CLOCKS === 0;
}

/** 一个角色一轮的浓缩文摘（喂给总结器，控制体量）。只用本人产出，公私都给（总结器是全知的）。 */
function digestBeat(b: WorldCharBeat): string {
    const parts = [`${b.charName}（${b.location}・${b.mood}）`];
    if (b.timeline?.length) parts.push(b.timeline.map(tl => `${tl.time}${tl.place}：${tl.event}${tl.shared ? '' : '〔瞒〕'}`).join('；'));
    if (b.narrative) parts.push(`内心：${b.narrative.slice(0, 220)}`);
    if (b.dialogues?.length) parts.push(b.dialogues.map(d => `对${d.with}说「${d.lines.join('/')}」`).join('；'));
    if (b.relationshipDeltas?.length) parts.push(b.relationshipDeltas.map(r => `对${r.withName} ${r.delta > 0 ? '+' : ''}${r.delta}${r.reason ? `(${r.reason})` : ''}`).join('；'));
    return parts.join(' ｜ ');
}

/** 把窗口内的原文揉成喂给总结器的文摘（按时间正序）。 */
export function buildChapterDigest(episodes: WorldEpisode[]): string {
    return episodes
        .slice()
        .sort((a, b) => a.round - b.round)
        .map(ep => {
            const lines = [`【${ep.storyTime}】`];
            if (ep.npcScene) lines.push(`镇上：${ep.npcScene.slice(0, 160)}`);
            for (const b of ep.beats) lines.push(`- ${digestBeat(b)}`);
            return lines.join('\n');
        })
        .join('\n\n')
        .slice(0, 12000);
}

/** 总结器提示词。 */
export function buildChapterSummaryPrompt(args: {
    world: WorldProfile;
    members: CharacterProfile[];
    fromLabel: string;
    toLabel: string;
    digest: string;
    prevSynopsis?: string;
}): string {
    const { world, members, fromLabel, toLabel, digest, prevSynopsis } = args;
    const names = members.map(m => m.name);
    return `你是共同世界「${world.name}」的编年史官。下面是这个世界从「${fromLabel}」到「${toLabel}」这 ${SIM_CHAPTER_DAYS} 天里，每个角色每半天的原始演绎记录（含他们各自瞒下的事，用〔瞒〕标出）。

## 世界观
${world.worldview || '（一个安静的小世界）'}

## 角色名单
${names.join('、')}
${prevSynopsis ? `\n## 上一卷梗概（承接，不要重复）\n${prevSynopsis.slice(0, 800)}` : ''}

## 这 ${SIM_CHAPTER_DAYS} 天的原文
${digest}

请像写连载小说的「本卷小结」一样，结出这一卷。严格输出一个 JSON 对象（建议 \`\`\`json 包裹，不要输出 JSON 之外的正文）：
{
  "synopsis": "800~1500字的小说体梗概：这 ${SIM_CHAPTER_DAYS} 天的主线与重要转折，谁经历了什么、暗流与高潮。可以全知视角（你看得到所有人瞒下的事），写给屏幕外的观众看。分3~6段（用\\n\\n分段）。",
  "relationshipEval": "200~400字：这一卷里人物关系网的动态变化方向与评价——谁和谁更近/更远了、新生的暗流或裂痕、几条关系线的走向预判。",
  "atmosphere": "一两句话：这一卷沉淀下来、会延续到下一卷的整体氛围基调（例：表面平静下暗藏几段心照不宣的紧张）。",
  "perspectives": [
    { "name": "角色名", "text": "300~500字，**只从这个角色单方面的视角**回顾这 ${SIM_CHAPTER_DAYS} 天：ta 亲历了什么、ta 知道/听说了什么、ta 对别人怎么看、心里留下了什么。**绝对不能写 ta 不可能知道的别人内心戏或别人瞒着 ta 的事**——这是要喂回 ta 自己的记忆的，写漏了就等于让 ta 开了上帝视角。" }
  ]
}
要求：perspectives 必须为每个角色（${names.join('、')}）各出一条，name 用上面的原名。`;
}

/** 解析总结器输出 → 章节字段（缺字段时尽量兜底，不抛错）。 */
export function parseChapterSummary(raw: string, members: CharacterProfile[]): {
    synopsis: string;
    relationshipEval?: string;
    atmosphere?: string;
    perspectives: { charId: string; charName: string; text: string }[];
} {
    const j = extractJson(raw);
    const fallback = (raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?|```/g, '').trim();
    const byName = new Map(members.map(m => [m.name, m]));
    const perspectives: { charId: string; charName: string; text: string }[] = [];
    if (j && Array.isArray(j.perspectives)) {
        for (const p of j.perspectives) {
            if (!p || typeof p.name !== 'string' || typeof p.text !== 'string' || !p.text.trim()) continue;
            const char = byName.get(p.name.trim());
            if (!char) continue;
            if (perspectives.some(x => x.charId === char.id)) continue;
            perspectives.push({ charId: char.id, charName: char.name, text: p.text.trim().slice(0, 1200) });
        }
    }
    return {
        synopsis: (j && typeof j.synopsis === 'string' && j.synopsis.trim() ? j.synopsis.trim() : fallback).slice(0, 4000),
        relationshipEval: j && typeof j.relationshipEval === 'string' && j.relationshipEval.trim() ? j.relationshipEval.trim().slice(0, 1200) : undefined,
        atmosphere: j && typeof j.atmosphere === 'string' && j.atmosphere.trim() ? j.atmosphere.trim().slice(0, 300) : undefined,
        perspectives,
    };
}

/**
 * 结一卷：调用总结器，产出 WorldChapter。
 * 失败返回 null（结卷失败不应该拖垮主演绎流程，下一卷照常累积）。
 */
export async function summarizeChapter(args: {
    world: WorldProfile;
    members: CharacterProfile[];
    episodes: WorldEpisode[];     // 本卷窗口内的原文（任意顺序）
    api: { baseUrl: string; apiKey: string; model: string };
    fromClock: number;
    toClock: number;
    fromLabel: string;
    toLabel: string;
    index: number;
    prevSynopsis?: string;
}): Promise<WorldChapter | null> {
    const { world, members, episodes, api, fromClock, toClock, fromLabel, toLabel, index, prevSynopsis } = args;
    if (episodes.length === 0) return null;
    const baseUrl = api.baseUrl.replace(/\/+$/, '');
    const digest = buildChapterDigest(episodes);
    try {
        const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: api.model,
                messages: [{ role: 'user', content: buildChapterSummaryPrompt({ world, members, fromLabel, toLabel, digest, prevSynopsis }) }],
                temperature: 0.8, stream: false,
            }),
        }, 2, 0, { appName: '家园', purpose: `结卷总结 · ${world.name} 第${index}卷` });
        const parsed = parseChapterSummary(data.choices?.[0]?.message?.content || '', members);
        // 每个角色这一卷「最后一天」的 beat：取窗口内 round 最大的那条 episode 里各自的 beat
        const lastEp = episodes.slice().sort((a, b) => b.round - a.round)[0];
        const lastDayBeats = lastEp?.beats || [];
        return {
            id: genId('wc'),
            worldId: world.id,
            index,
            fromClock,
            toClock,
            fromLabel,
            toLabel,
            synopsis: parsed.synopsis,
            relationshipEval: parsed.relationshipEval,
            atmosphere: parsed.atmosphere,
            perspectives: parsed.perspectives,
            lastDayBeats,
            createdAt: Date.now(),
        };
    } catch (e) {
        console.warn('[WorldHome] chapter summary failed:', e);
        return null;
    }
}
