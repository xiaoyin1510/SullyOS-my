/**
 * Memory Palace — 集成管线 (Pipeline)
 *
 * 对外暴露两个主要函数：
 * 1. retrieveMemories() — 检索管线，AI 回复前调用
 * 2. processNewMessages() — 缓冲区机制，AI 回复后后台调用
 *
 * 缓冲区机制（替代旧的 TopicLoom + 封盒方案）：
 * - 热区：最近 200 条消息留在聊天上下文
 * - 缓冲区：热区之前、高水位之后的消息
 * - 缓冲区 >= 50 条时触发：LLM 提取记忆 → Embedding → 更新高水位
 * - 保留缓冲区尾部 15% 作为下次提取的上下文衔接
 *
 * LLM 调用策略：
 * - 记忆提取 → 用 LightLLMConfig（来自 memoryPalaceConfig.lightLLM 全局副 API，
 *   与情绪 API emotionConfig.api 完全独立）
 * - 检索管线 → 纯计算，不调 LLM
 */

import type { Message } from '../../types';
import type { EmbeddingConfig, PersonalityStyle, RemoteVectorConfig, ScoredMemory } from './types';

/** 从 localStorage 读取远程向量配置（避免在每个调用点都传参） */
function getRemoteVectorConfig(): RemoteVectorConfig | undefined {
    try {
        const raw = localStorage.getItem('os_remote_vector_config');
        if (!raw) return undefined;
        const config = JSON.parse(raw) as RemoteVectorConfig;
        return (config.enabled && config.initialized) ? config : undefined;
    } catch { return undefined; }
}

/** 从 localStorage 读取 rerank 配置。关闭或未配齐时返回 undefined，调用方跳过。 */
interface StoredRerankConfig {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    topN?: number;
}
function getRerankConfig(): { baseUrl: string; apiKey: string; model: string; topN: number } | undefined {
    try {
        const raw = localStorage.getItem('os_memory_palace_config');
        if (!raw) return undefined;
        const parsed = JSON.parse(raw);
        const r: StoredRerankConfig | undefined = parsed?.rerank;
        if (!r?.enabled || !r.baseUrl || !r.apiKey || !r.model) return undefined;
        return {
            baseUrl: r.baseUrl,
            apiKey: r.apiKey,
            model: r.model,
            topN: Math.max(1, Math.min(20, r.topN ?? 5)),
        };
    } catch { return undefined; }
}
import { extractMemoriesFromBuffer } from './extraction';
import type { RelatedMemoryRef, PinnedMemoryRef } from './extraction';
import { fetchRelatedMemoriesForExtraction, sampleSnippetsFromMessages, splitMessagesToSpikes } from './relatedMemories';
import { getReceiptIdsInRange } from './recallReceipts';
import { vectorizeAndStore, checkModelConsistency, rebuildAllVectors } from './vectorStore';
import { buildLinks, strengthenCoActivated } from './links';
import { hybridSearch } from './hybridSearch';
import { getEmbeddings } from './embedding';
import { isRemoteSearchBroken } from './vectorSearch';
import { spreadActivation } from './activation';
import { applyPriming, checkRumination } from './priming';
import { expandAndFormat } from './formatter';
import { runConsolidation } from './consolidation';
import { rerankDocuments } from './rerank';
// 认知消化由用户在记忆宫殿 App 手动触发，不在聊天管线中自动运行
import { MemoryNodeDB, MemoryVectorDB, MemoryLinkDB, AnticipationDB } from './db';
import { DB } from '../db';
import { isMessageSemanticallyRelevant, formatMessageForPrompt } from '../messageFormat';

// ─── 轻量 LLM 配置类型 ───────────────────────────────

/**
 * 轻量 LLM 配置，用于记忆提取等后台任务。
 * 来源是 memoryPalaceConfig.lightLLM（全局副 API），与情绪 API（emotionConfig.api）独立。
 * 这样可以用便宜快速的小模型（如 DeepSeek-V2-Lite、GLM-4-Flash）
 * 而不是主聊天模型。
 */
export interface LightLLMConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
}

// ─── 日期区间记忆加载 ────────────────────────────────

/**
 * 按 createdAt 区间从本地取记忆节点。
 * - 过滤当前 charId、仅 embedded、非 summary
 * - archived 节点也参与匹配（它们保留原事件的 createdAt）；命中后路由到其 EventBox 的 summary
 * - 每个 range 最多返回 5 条，整体去重
 */
async function loadMemoriesByDateRanges(
    charId: string,
    ranges: Array<{ start: number; end: number }>,
): Promise<import('./types').MemoryNode[]> {
    if (ranges.length === 0) return [];
    const all = await MemoryNodeDB.getByCharId(charId);
    const out: import('./types').MemoryNode[] = [];
    const seen = new Set<string>();
    for (const range of ranges) {
        const inRange = all.filter(n => n.createdAt >= range.start && n.createdAt < range.end && n.embedded !== false);
        const sorted = inRange.sort((a, b) => b.importance - a.importance).slice(0, 5);
        for (const n of sorted) {
            // archived 节点 → 路由到其 box 的 summary（如果有）
            if (n.archived && n.eventBoxId) {
                const { EventBoxDB } = await import('./db');
                const box = await EventBoxDB.getById(n.eventBoxId);
                if (box?.summaryNodeId) {
                    if (seen.has(box.summaryNodeId)) continue;
                    const sum = await MemoryNodeDB.getById(box.summaryNodeId);
                    if (sum && !sum.archived) {
                        seen.add(sum.id);
                        out.push(sum);
                        continue;
                    }
                }
                // 没有 summary 就跳过（archived 独行条不该返回）
                continue;
            }
            if (seen.has(n.id)) continue;
            seen.add(n.id);
            out.push(n);
        }
    }
    return out;
}

// ─── 自动归档建议构造 ────────────────────────────────

/**
 * 把一批 MemoryNode 按 createdAt 日期 group，合成 YAML bullets 格式的 MemoryFragment 候选。
 *
 * 格式：
 *   date: "2026-04-17"
 *   summary: "- 我今天看 user 跟朋友吵架，心里担了好一会儿\n- 我今晚和 user 聊到了编程"
 *   mood: 'palace'
 *
 * 同日期多条记忆会合并成一条 MemoryFragment（summary 里多行 bullets）。
 * caller 拿到后还要和 char.memories 里已存在的同日期 'palace' 条目 merge，
 * 避免一天多次 buffer 触发产生重复条目。
 *
 * 返回 null：memories 为空（没有新记忆，不需要归档动作）。
 */
function buildAutoArchiveFragments(
    memories: { id: string; content: string; createdAt: number }[],
    hideBeforeMessageId: number,
): NonNullable<PipelineResult['autoArchive']> | null {
    if (memories.length === 0) return null;

    const fmtDate = (ts: number): string => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // 按日期 group；同一天内按 createdAt 升序
    // 零 LLM 调用：palace extraction 那 1 次已经按"基础规则 + 用户追加风格"产出了
    // 第一人称、控制字数的 content（见 extraction.ts 的 buildRulesBlock + 追加风格），
    // 这里直接拼 bullets 就行。想要自定义风格 → 在"记忆归档设置"里选模板即可，
    // extraction 阶段就会把用户模板作为额外风格偏好塞进 palace LLM 系统提示词。
    const byDate = new Map<string, string[]>();
    const sortedMems = [...memories].sort((a, b) => a.createdAt - b.createdAt);
    for (const m of sortedMems) {
        const date = fmtDate(m.createdAt);
        const arr = byDate.get(date) || [];
        arr.push(`- ${m.content.replace(/\n/g, ' ').trim()}`);
        byDate.set(date, arr);
    }

    const fragments: { id: string; date: string; summary: string; mood: string }[] = [];
    for (const [date, bullets] of byDate) {
        fragments.push({
            id: `mp_auto_${date}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            date,
            summary: bullets.join('\n'),
            mood: 'palace',
        });
    }

    fragments.sort((a, b) => a.date.localeCompare(b.date));
    return { fragments, hideBeforeMessageId };
}


/**
 * 把新产出的 palace MemoryFragment 合并进已有 char.memories。
 *
 * 策略：
 *  - 已有同日期的 mood='palace' 条目 → 把新的 bullets 追加到它的 summary 里（合并）
 *  - 没有同日期的 mood='palace' → 作为新条目追加
 *  - 其它 mood（手动归档 'archive' 等）的同日期条目不碰，让它们并存
 *
 * 好处：同一天多次 buffer 触发不会产生多条 palace 记录；手动归档和自动归档互不冲突。
 */
export function mergePalaceFragmentsIntoMemories(
    existing: import('../../types').MemoryFragment[],
    incoming: { id: string; date: string; summary: string; mood: string }[],
): import('../../types').MemoryFragment[] {
    if (incoming.length === 0) return existing;

    // 先按 date 建 index：只关心 mood='palace' 的
    const palaceByDate = new Map<string, number>(); // date → index in result
    const result = existing.slice();
    for (let i = 0; i < result.length; i++) {
        const m = result[i];
        if (m.mood === 'palace') palaceByDate.set(m.date, i);
    }

    for (const frag of incoming) {
        const existingIdx = palaceByDate.get(frag.date);
        if (existingIdx !== undefined) {
            // merge：把新 bullets 直接追加到 summary。
            // 不做字符串去重——LLM 偶尔写出相同短句的合法情况会被误杀，
            // high-water-mark 已保证消息不会被重复处理；尾部 15% 回滚那几条
            // 即使被重提，多一条 bullet 比丢数据强。
            const old = result[existingIdx];
            const existingBullets = old.summary.split('\n').map(s => s.trim()).filter(Boolean);
            const newBullets = frag.summary.split('\n').map(s => s.trim()).filter(Boolean);
            result[existingIdx] = {
                ...old,
                summary: [...existingBullets, ...newBullets].join('\n'),
            };
        } else {
            result.push(frag);
            palaceByDate.set(frag.date, result.length - 1);
        }
    }

    return result;
}

// ─── 检索管线（AI 回复前） ────────────────────────────

/**
 * 从消息列表末尾拆分"当前一轮"的两个语义部分：
 *
 * 调用时机是 AI 回复前，所以消息末尾通常是：
 *   ... [user] [user] [assistant] [user] [user] [user]
 *                                     └─── userIntent ───┘
 *                   └──────── contextTurns ────────┘
 *
 * - userIntent：末尾连续 user 消息 —— 用户刚说的话，是本次检索的真正主语。
 *   作为**主 query**，短而关键的词（"外公"、"2025年11月29日"）不会被
 *   char 的长回复稀释。
 *
 * - contextTurns：更早的 assistant 回复 + 上一轮 user 消息 —— 话题延续语境。
 *   作为**副 query**，提供背景召回，但分数会被折扣，永远不会压过 userIntent。
 *
 * 总计 cap 在 15 条，user 最多占 10 条留出 context 预算。
 */
function splitLastTurnQueries(messages: Message[]): {
    userIntent: Message[];
    contextTurns: Message[];
    /** 旧版拼接形式，仅用于兜底（userIntent 为空时） */
    fallbackAll: Message[];
} {
    if (messages.length === 0) return { userIntent: [], contextTurns: [], fallbackAll: [] };

    const MAX = 15;
    const USER_CAP = 10;
    const userIntent: Message[] = [];
    const contextTurns: Message[] = [];
    let i = messages.length - 1;

    // Phase 1: 末尾连续 user 消息（用户刚发的）→ userIntent
    while (i >= 0 && messages[i].role === 'user' && userIntent.length < USER_CAP) {
        userIntent.unshift(messages[i]);
        i--;
    }

    const contextBudget = MAX - userIntent.length;

    // Phase 2: 紧邻的 assistant 回复（上一轮角色回答）→ contextTurns
    while (i >= 0 && messages[i].role === 'assistant' && contextTurns.length < contextBudget) {
        contextTurns.unshift(messages[i]);
        i--;
    }

    // Phase 3: 再往回收集连续 user 消息（上一轮用户输入）→ contextTurns
    while (i >= 0 && messages[i].role === 'user' && contextTurns.length < contextBudget) {
        contextTurns.unshift(messages[i]);
        i--;
    }

    const fallbackAll = [...contextTurns, ...userIntent];
    return {
        userIntent,
        contextTurns,
        fallbackAll: fallbackAll.length > 0 ? fallbackAll : messages.slice(-3),
    };
}

/**
 * 检索记忆并格式化为可注入 System Prompt 的 Markdown
 *
 * 注意：检索管线全程纯计算 + Embedding API，不调 LLM。
 *
 * @param queryOverride App 自定义上下文（场景、题目等），会与最近一轮对话拼接后一起检索
 */
export async function retrieveMemories(
    recentMessages: Message[],
    charId: string,
    embeddingConfig: EmbeddingConfig,
    currentMood?: string,
    personalityStyle: PersonalityStyle = 'emotional',
    ruminationTendency: number = 0.3,
    queryOverride?: string,
    userName?: string,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<string> {
    // ── 分段计时：定位 memoryPalace 到底是网络慢还是计算慢 ──
    // tag: NET = 远端 API RTT；IDB = IndexedDB 读写；CPU = 纯本地计算
    const perfRetrieveT0 = performance.now();
    const retrieveTimings: Array<{ label: string; ms: number; kind: 'NET' | 'IDB' | 'CPU' }> = [];
    const tRetrieve = async <T>(label: string, kind: 'NET' | 'IDB' | 'CPU', p: Promise<T>): Promise<T> => {
        const t0 = performance.now();
        try { return await p; }
        finally { retrieveTimings.push({ label, kind, ms: Math.round(performance.now() - t0) }); }
    };
    try {
        // 1. 构建查询 —— per-message 多路检索策略：
        //
        //    问题：任何形式的"把多条 user 消息 join 成一段 embedding"都会出现
        //          稀释问题。无论真正的意图在 burst 的开头、中间还是结尾，
        //          短而精的信号都会被周围的闲语/寒暄/语气词淹没。
        //
        //    方案：每条有意义的 user 消息（≥ 4 字，去重）独立跑一次 hybridSearch。
        //          合并时同一条记忆取所有 per-msg 搜索中的最高分，这样：
        //          - "今天我要回家看家人啦" 作为独立 query 时 embedding 质心
        //            直接落在"家/家人"语义空间，命中家庭类记忆
        //          - "晚上好" / "你在做什么" 这些独立 query 只会命中寒暄类
        //            记忆（分数低），不会干扰真正意图的召回
        //
        //    context query：assistant 回复 + 更早 user 消息 + queryOverride。
        //                  （背景话题延续，分数 × 0.5 折扣，不会压过 user 意图）
        const { userIntent, contextTurns, fallbackAll } = splitLastTurnQueries(recentMessages);

        // 抽取每条有意义的 user 消息作为独立 spike + 二次拆分子 spike
        //
        // 过滤原则：
        // 1. 剥离 URL（表情包/图片/外链 URL 在 embedding 里是随机噪声，没有语义）
        // 2. 剥离 URL 后，再剥掉所有标点和空白来计算"有意义字符数"
        // 3. 有意义字符数 < MIN_SPIKE_LEN 的 pass（纯标点/单字语气词/"……"等）
        // 4. 同内容去重
        //
        // MIN_SPIKE_LEN=2 而不是 4：中文里 2 字已经可以成词（"晚安""回家""想你"
        // "外公""生气"），如果阈值设 4 会误伤大量短而关键的中文测试性输入。
        // 被过滤的只有 1 字的"嗯""好""?""哦""哈"类纯语气词，以及"……""。。。"
        // 这类纯标点输入——它们 embedding 方向随机，BM25 也匹配不上任何东西。
        //
        // 注意：query 文本仍然用"剥 URL 后"的原始 trim 版本（保留标点），
        // 只在判长度时才看"剥光标点的有意义字符数"。这样"晚安……"这种
        // 带尾随省略号的合法输入能进池，且 query 里完整保留上下文。
        //
        // 二次拆分（sub-spike）：
        //   一条消息内部如果有标点/空格分隔多段语义（DateApp 见面模式的
        //   叙述格式 `"对白" 旁白 "对白"`、或者用户在一条消息里用逗号/
        //   句号串了多件事），单一 spike 会让真实意图被气泡内的其他片段
        //   稀释。把消息按 [\s\p{P}]+ 拆成子片段，每个 ≥ MIN_SPIKE_LEN 的
        //   子片段也作为独立 spike 入池（label 后缀 a/b/c/...）。原消息
        //   仍保留作 u<N>，捕获跨片段的整体语境。
        //
        //   这不是"扩搜索面"——子 spike 比原 spike 更短更专注，每路 query
        //   质心更精准（不是更宽），所以不会出现 joined / 候选池扩大那种
        //   "泛情感记忆借宽匹配反超"的问题。机制方向相反。
        const MIN_SPIKE_LEN = 2;
        const MAX_SPIKES = 10;
        const MAX_SUB_SPIKES_PER_MSG = 5;
        const URL_RE = /https?:\/\/\S+/gi;
        const PUNCT_WS_RE = /[\s\p{P}]/gu;
        const SPLIT_RE = /[\s\p{P}]+/gu;
        const seenSpike = new Set<string>();
        const userSpikes: { label: string; text: string; originalIdx: number }[] = [];
        userIntent.forEach((m, idx) => {
            const stripped = m.content.replace(URL_RE, ' ').trim();
            const text = stripped.slice(0, 2000);
            const meaningfulChars = text.replace(PUNCT_WS_RE, '');
            if (meaningfulChars.length < MIN_SPIKE_LEN) return;
            if (seenSpike.has(text)) return;
            seenSpike.add(text);
            const baseLabel = `u${idx + 1}`;
            userSpikes.push({ label: baseLabel, text, originalIdx: idx });

            // 二次拆分：消息内部有多段语义时，每段也作为子 spike
            const segments = text.split(SPLIT_RE)
                .map(s => s.trim())
                .filter(s => s.length > 0 && s !== text && s.replace(PUNCT_WS_RE, '').length >= MIN_SPIKE_LEN);
            let subIdx = 0;
            for (const seg of segments) {
                if (subIdx >= MAX_SUB_SPIKES_PER_MSG) break;
                if (seenSpike.has(seg)) continue;
                seenSpike.add(seg);
                subIdx++;
                const subLabel = `${baseLabel}${String.fromCharCode(96 + subIdx)}`; // a,b,c,...
                userSpikes.push({ label: subLabel, text: seg, originalIdx: idx });
            }
        });
        // 保留最后 MAX_SPIKES 条（如果超过上限，优先保留最近的）
        const effectiveSpikes = userSpikes.slice(-MAX_SPIKES);

        const contextQuery = [queryOverride, contextTurns.map(m => m.content).join('\n')]
            .filter(Boolean)
            .join('\n')
            .slice(0, 2000);
        const userQueryJoined = userIntent.map(m => m.content).join('\n'); // 仅用于日志显示原始 userIntent 文本

        // 兜底：极端情况下末尾没有任何可用的 user spike（如冷启动首轮，或全是语气词）
        const fallbackQuery = effectiveSpikes.length > 0
            ? ''
            : [queryOverride, fallbackAll.map(m => m.content).join('\n')]
                  .filter(Boolean)
                  .join('\n')
                  .slice(0, 2000);

        if (effectiveSpikes.length === 0 && !contextQuery.trim() && !fallbackQuery.trim()) return '';

        // ─── 调试日志：打印所有 query ─────────────────────────
        console.groupCollapsed(`🏰 [Retrieve] ═══ 检索开始 ═══`);
        console.log(`👤 userIntent: ${userIntent.length} 条消息，其中 ${effectiveSpikes.length} 条进入 per-msg 搜索`);
        if (userQueryJoined && effectiveSpikes.length < userIntent.length) {
            console.log(`   (被过滤的 ${userIntent.length - effectiveSpikes.length} 条：长度 < ${MIN_SPIKE_LEN} 字或重复内容)`);
        }
        effectiveSpikes.forEach(s => {
            console.log(`  🎯 ${s.label} (${s.text.length} 字): ${s.text.replace(/\n/g, ' ↵ ')}`);
        });
        console.log(`📄 context query (${contextQuery.length} 字，${contextTurns.length} 条 context 消息):`);
        console.log(contextQuery || '(空)');
        if (fallbackQuery) {
            console.log(`⚠️  fallback query (${fallbackQuery.length} 字):`);
            console.log(fallbackQuery);
        }
        console.groupEnd();

        // 2. 混合搜索（并行）
        //    - 每条 user spike：原样打分（权重 1.0）
        //    - context：分数 × CONTEXT_DISCOUNT 折扣
        //    合并时同一条记忆取 max(所有 spike 分, context 分×折扣)
        //
        //    per-query 返回 30 条，最终合并后裁到 15 条。
        //    原因：如果每路只返回 top 15，同一类主题（如"外公"）的多条
        //    记忆中，排名较低的几条会在 per-query 阶段就被切掉，永远
        //    进不到合并池。扩大 per-query 容量让"同主题的次要记忆"
        //    也有机会竞争最终名次。
        const CONTEXT_DISCOUNT = 0.5;
        const PER_QUERY_TOP_K = 30;
        const FINAL_TOP_K = 15;

        // 辅助：把 ScoredMemory 格式化成一行摘要
        const now = Date.now();
        const fmt = (r: ScoredMemory, prefix: string = '') => {
            const ageDays = Math.floor((now - r.node.createdAt) / (1000 * 60 * 60 * 24));
            const preview = r.node.content.slice(0, 50).replace(/\n/g, ' ');
            return `${prefix}[${r.node.room}|imp=${r.node.importance}|${ageDays}d前] `
                + `sim=${r.similarity.toFixed(3)} bm25=${r.bm25Score.toFixed(3)} `
                + `→ final=${r.finalScore.toFixed(3)}  "${preview}${r.node.content.length > 50 ? '...' : ''}"`;
        };

        let results: ScoredMemory[] = [];
        // 记录每条记忆被哪些 spike / context 命中以及各自分数
        type TraceEntry = {
            spikeScores: Map<string, number>; // label → finalScore
            contextScore?: number; // 原始分（未折扣）
        };
        const sourceTrace = new Map<string, TraceEntry>();

        // ── Rerank 并行准备 ──
        // Rerank 原本是主召回彻底跑完才串行启动的独立管线，拖后腿严重。
        // 现在把 rerank 的 embedding 塞进主 prefetch 批、pool hybridSearch 塞进主 Promise.all、
        // rerankDocuments 在 pool 就绪时立即 fire，只在最后 tail 等一下 dedup。
        // 这样 rerank 几乎整段都跟主路后半段并行跑。
        const rerankConfig = getRerankConfig();
        const joinedUserQuery = (rerankConfig && userIntent.length > 0)
            ? userIntent.map(m => m.content).join(' ').trim().slice(0, 2000)
            : '';
        const doRerank = !!(rerankConfig && joinedUserQuery);
        const RERANK_POOL_SIZE = 50;
        type RerankApiResult = {
            pool: ScoredMemory[];
            rrResults: Array<{ index: number; relevance_score: number }>;
        };
        // 由下面的 spike / fallback 分支各自赋值；tail 只 await 这个拿最终结果
        let rerankApiPromise: Promise<RerankApiResult | null> = Promise.resolve(null);

        if (effectiveSpikes.length > 0) {
            // 并行：每条 spike + context
            //
            // 历史教训：曾经加过 joined query 路径（所有 spike 拼成一条长 query
            // 并行检索）期望"BM25 跨气泡叠加"能提升主题收敛场景的召回。但
            // 实测反而变差——长 query 的 BM25 会被**泛情感高 imp 记忆**的
            // 随机 token 碰撞累积到虚高分，挤掉 per-message 本来精准的焦点
            // 命中。这和之前候选池 30→60 被回滚是同一类错误：任何"扩大
            // 搜索面"的机制都让泛情感记忆凭 imp/recency 反超 topic-specific
            // 记忆。回滚。

            // ─── Prefetch：把 K 路 hybridSearch 各自会做的公共 IO 抽上来一次性做完 ───
            //
            // 原实现：每路 hybridSearch 各自 ①调一次 embedding API ②扫一遍
            //         memory_nodes 索引 ③扫一遍 memory_vectors 索引。
            //         K 路 = 3K 倍重复 IO，Embedding API 还每路一次 RTT。
            //
            // 优化：
            //   1. 所有 query 文本合批一次 getEmbeddings → 省 (K-1) 次 RTT。
            //      Embedding API 对 input: [] 数组里的每条独立打向量，数学上等价。
            //   2. allNodes / allVectors 在 pipeline 一次性预取，透传给每路
            //      hybridSearch → K 路看同一份快照，retrieve 内部一致性反而更好。
            //   3. 远程向量路径不消费 allVectors，所以远程开启且没熔断时跳过
            //      allVectors 预取，避免无效 IO。
            const contextQueryTrimmed = contextQuery.trim();
            // 把 rerank 的 joined query 也塞进同一次 getEmbeddings，共享 embedding RTT
            const queriesToEmbed: string[] = [
                ...effectiveSpikes.map(s => s.text),
                ...(contextQueryTrimmed ? [contextQuery] : []),
                ...(doRerank ? [joinedUserQuery] : []),
            ];
            const useRemoteVector = !!(
                remoteVectorConfig?.enabled && remoteVectorConfig.initialized && !isRemoteSearchBroken()
            );
            const [queryVectors, allNodes, allVectors] = await Promise.all([
                tRetrieve(`getEmbeddings(${queriesToEmbed.length})`, 'NET', getEmbeddings(queriesToEmbed, embeddingConfig)),
                tRetrieve('MemoryNodeDB.getByCharId', 'IDB', MemoryNodeDB.getByCharId(charId)),
                useRemoteVector
                    ? Promise.resolve(undefined)
                    : tRetrieve('MemoryVectorDB.getAllByCharId', 'IDB', MemoryVectorDB.getAllByCharId(charId)),
            ]);

            const spikePromises = effectiveSpikes.map((s, i) =>
                hybridSearch(s.text, charId, embeddingConfig, PER_QUERY_TOP_K, remoteVectorConfig, {
                    queryVector: queryVectors[i],
                    allNodes,
                    allVectors,
                })
            );
            const contextPromise = contextQueryTrimmed
                ? hybridSearch(contextQuery, charId, embeddingConfig, PER_QUERY_TOP_K, remoteVectorConfig, {
                    queryVector: queryVectors[effectiveSpikes.length],
                    allNodes,
                    allVectors,
                })
                : Promise.resolve([] as ScoredMemory[]);

            // Rerank 的 pool hybridSearch 跟主路一起发（共享 backend RTT）
            // 不放进主 Promise.all —— 我们要把 pool 回来这事做成独立管线，
            // pool 一到就 fire rerankDocuments，不被主路 post-search 阻塞。
            //
            // ⚠️ 隐式契约：这里和 spikePromises / contextPromise 复用同一份
            //    prefetched allVectors，N 路并发共享一个 ArrayBuffer 池。
            //    这能成立是因为 vectorSearch.ts 的 canTransferCandidates =
            //    !prefetchedVectors 守卫在 prefetch 场景下禁用了 postMessage
            //    的 Transferable 路径，避免首个路径 transfer 把 buffer neuter
            //    成全 0 让后续路径静默返空。如果动 vectorSearch 那段逻辑，
            //    grep 这条注释 —— rerank pool 会是第一个崩的。
            const rerankPoolPromise: Promise<ScoredMemory[]> = doRerank
                ? hybridSearch(joinedUserQuery, charId, embeddingConfig, RERANK_POOL_SIZE, remoteVectorConfig, {
                    queryVector: queryVectors[queriesToEmbed.length - 1],
                    allNodes,
                    allVectors,
                }).catch(e => {
                    console.warn(`🎯 [Rerank] pool 检索失败（主召回不受影响）: ${e?.message || e}`);
                    return [] as ScoredMemory[];
                })
                : Promise.resolve([] as ScoredMemory[]);

            if (doRerank) {
                rerankApiPromise = (async (): Promise<RerankApiResult | null> => {
                    const rrT0 = performance.now();
                    try {
                        const pool = await rerankPoolPromise;
                        if (pool.length === 0) {
                            console.log(`🎯 [Rerank] 独立检索候选池为空，跳过 rerank`);
                            retrieveTimings.push({ label: 'rerankDocuments(skip)', kind: 'NET', ms: Math.round(performance.now() - rrT0) });
                            return null;
                        }
                        const rerankWanted = rerankConfig!.topN;
                        const rerankAskForN = Math.min(pool.length, rerankWanted + 10);
                        const rrResults = await rerankDocuments(
                            { baseUrl: rerankConfig!.baseUrl, apiKey: rerankConfig!.apiKey, model: rerankConfig!.model },
                            joinedUserQuery,
                            pool.map(p => p.node.content),
                            rerankAskForN,
                        );
                        retrieveTimings.push({ label: 'rerankDocuments', kind: 'NET', ms: Math.round(performance.now() - rrT0) });
                        return { pool, rrResults };
                    } catch (e: any) {
                        console.warn(`🎯 [Rerank] 失败（主召回不受影响）: ${e?.message || e}`);
                        retrieveTimings.push({ label: 'rerankDocuments(err)', kind: 'NET', ms: Math.round(performance.now() - rrT0) });
                        return null;
                    }
                })();
            }

            const hybridKind: 'NET' | 'CPU' = useRemoteVector ? 'NET' : 'CPU';
            const [contextResults, ...spikeResultsArr] = await tRetrieve(
                `hybridSearch×${spikePromises.length + (contextQueryTrimmed ? 1 : 0)}`,
                hybridKind,
                Promise.all([contextPromise, ...spikePromises]),
            );

            // ─── 调试日志：每条 spike 的完整结果 ─────────────────
            spikeResultsArr.forEach((spikeResults, idx) => {
                const s = effectiveSpikes[idx];
                console.groupCollapsed(`🏰 [Retrieve] 🎯 ${s.label} 搜命中 ${spikeResults.length} 条 ("${s.text.slice(0, 30).replace(/\n/g, ' ')}${s.text.length > 30 ? '...' : ''}")`);
                spikeResults.forEach((r, i) => console.log(fmt(r, `#${i + 1} `)));
                console.groupEnd();
            });

            if (contextResults.length > 0) {
                console.groupCollapsed(`🏰 [Retrieve] 📄 context 搜命中 ${contextResults.length} 条（下方为折扣前原始分）`);
                contextResults.forEach((r, i) => {
                    console.log(fmt(r, `#${i + 1} `) + `  → 折扣后=${(r.finalScore * CONTEXT_DISCOUNT).toFixed(3)}`);
                });
                console.groupEnd();
            } else {
                console.log(`🏰 [Retrieve] context 搜跳过（context query 为空）`);
            }

            // 合并：每条记忆取 max(所有 spike 分, context 分×折扣)
            const merged = new Map<string, ScoredMemory>();
            spikeResultsArr.forEach((spikeResults, idx) => {
                const label = effectiveSpikes[idx].label;
                for (const r of spikeResults) {
                    const trace = sourceTrace.get(r.node.id) ?? { spikeScores: new Map<string, number>() } as TraceEntry;
                    trace.spikeScores.set(label, r.finalScore);
                    sourceTrace.set(r.node.id, trace);
                    const existing = merged.get(r.node.id);
                    if (!existing || r.finalScore > existing.finalScore) {
                        merged.set(r.node.id, r);
                    }
                }
            });
            for (const r of contextResults) {
                const trace = sourceTrace.get(r.node.id) ?? { spikeScores: new Map<string, number>() } as TraceEntry;
                trace.contextScore = r.finalScore;
                sourceTrace.set(r.node.id, trace);
                const discounted: ScoredMemory = {
                    ...r,
                    finalScore: r.finalScore * CONTEXT_DISCOUNT,
                    roomScore: r.roomScore * CONTEXT_DISCOUNT,
                };
                const existing = merged.get(r.node.id);
                if (!existing || discounted.finalScore > existing.finalScore) {
                    merged.set(r.node.id, discounted);
                }
            }

            results = [...merged.values()]
                .sort((a, b) => b.finalScore - a.finalScore)
                .slice(0, FINAL_TOP_K);

            // ─── 调试日志：合并后最终 top K ───────────────────
            console.groupCollapsed(`🏰 [Retrieve] 合并后 top ${results.length}（扩散激活/启动效应前）`);
            results.forEach((r, i) => {
                const t = sourceTrace.get(r.node.id) ?? { spikeScores: new Map<string, number>() } as TraceEntry;
                const spikeLabels = [...t.spikeScores.keys()];
                const srcTags = spikeLabels.map(l => `🎯${l}`);
                if (t.contextScore !== undefined) srcTags.push('📄');
                const tag = srcTags.join('+');
                const details: string[] = [];
                for (const [label, score] of t.spikeScores) {
                    details.push(`${label}=${score.toFixed(3)}`);
                }
                if (t.contextScore !== undefined) {
                    details.push(`ctx=${t.contextScore.toFixed(3)}×0.5=${(t.contextScore * CONTEXT_DISCOUNT).toFixed(3)}`);
                }
                console.log(fmt(r, `#${i + 1} [${tag}] `) + ` (${details.join(', ')})`);
            });
            console.groupEnd();

            console.log(`🏰 [Retrieve] 多路检索汇总：${effectiveSpikes.length} 个 spike + ${contextResults.length > 0 ? 'context' : '无 context'} → 合并 top ${results.length}`);
        } else {
            // 冷启动兜底：仅用 fallback 单 query
            const useRemoteVector = !!(
                remoteVectorConfig?.enabled && remoteVectorConfig.initialized && !isRemoteSearchBroken()
            );
            // 先 fire fallback 主搜 + rerank pipeline，两个独立管线并行
            const fallbackSearchPromise = hybridSearch(fallbackQuery, charId, embeddingConfig, FINAL_TOP_K, remoteVectorConfig);
            if (doRerank) {
                rerankApiPromise = (async (): Promise<RerankApiResult | null> => {
                    const rrT0 = performance.now();
                    try {
                        const pool = await hybridSearch(joinedUserQuery, charId, embeddingConfig, RERANK_POOL_SIZE, remoteVectorConfig, undefined);
                        if (pool.length === 0) {
                            console.log(`🎯 [Rerank] 独立检索候选池为空，跳过 rerank`);
                            retrieveTimings.push({ label: 'rerankDocuments(skip)', kind: 'NET', ms: Math.round(performance.now() - rrT0) });
                            return null;
                        }
                        const rerankWanted = rerankConfig!.topN;
                        const rerankAskForN = Math.min(pool.length, rerankWanted + 10);
                        const rrResults = await rerankDocuments(
                            { baseUrl: rerankConfig!.baseUrl, apiKey: rerankConfig!.apiKey, model: rerankConfig!.model },
                            joinedUserQuery,
                            pool.map(p => p.node.content),
                            rerankAskForN,
                        );
                        retrieveTimings.push({ label: 'rerankDocuments', kind: 'NET', ms: Math.round(performance.now() - rrT0) });
                        return { pool, rrResults };
                    } catch (e: any) {
                        console.warn(`🎯 [Rerank] 失败（主召回不受影响）: ${e?.message || e}`);
                        retrieveTimings.push({ label: 'rerankDocuments(err)', kind: 'NET', ms: Math.round(performance.now() - rrT0) });
                        return null;
                    }
                })();
            }
            results = await tRetrieve(
                'hybridSearch(fallback)',
                useRemoteVector ? 'NET' : 'CPU',
                fallbackSearchPromise,
            );
            console.groupCollapsed(`🏰 [Retrieve] 单 query 兜底命中 ${results.length} 条（无末尾 user 消息）`);
            results.forEach((r, i) => console.log(fmt(r, `#${i + 1} `)));
            console.groupEnd();
        }

        // 2.5 日期引用路径：从 user 意图里抽"去年12月""3月4号""上周"这类
        //     日期引用，直接按 createdAt 捞对应区间的记忆（vector/BM25 都对不准日期）。
        //     archived 节点参与日期匹配 → 路由到其 EventBox summary 返回。
        const dateT0 = performance.now();
        try {
            const { resolveDateReferences } = await import('./dateResolver');
            const queryForDates = [userQueryJoined, contextQuery, fallbackQuery].filter(Boolean).join('\n');
            const ranges = resolveDateReferences(queryForDates);
            if (ranges.length > 0) {
                console.log(`📅 [Retrieve] 检测到日期引用 ${ranges.length} 个：${ranges.map(r => `${r.label}→[${new Date(r.start).toLocaleDateString('zh-CN')}..${new Date(r.end - 1).toLocaleDateString('zh-CN')}]`).join('、')}`);
                const dateHits = await loadMemoriesByDateRanges(charId, ranges);
                const DATE_BOOST = 0.3;
                const DATE_BASE = 0.5;
                const resultIdx = new Map(results.map((r, i) => [r.node.id, i]));
                let boosted = 0, added = 0;
                for (const node of dateHits) {
                    const idx = resultIdx.get(node.id);
                    if (idx !== undefined) {
                        results[idx].finalScore += DATE_BOOST;
                        results[idx].roomScore += DATE_BOOST;
                        boosted++;
                    } else {
                        results.push({
                            node,
                            finalScore: DATE_BASE + DATE_BOOST,
                            similarity: 0,
                            bm25Score: 0,
                            roomScore: DATE_BASE + DATE_BOOST,
                        });
                        added++;
                    }
                }
                if (boosted + added > 0) {
                    console.log(`📅 [Retrieve] 日期命中加权：${boosted} 条已命中 +${DATE_BOOST}，${added} 条新增`);
                }
            }
        } catch (e: any) {
            console.warn(`📅 [Retrieve] 日期解析失败（不影响常规召回）: ${e?.message || e}`);
        }
        retrieveTimings.push({ label: 'dateResolver', kind: 'IDB', ms: Math.round(performance.now() - dateT0) });

        if (results.length === 0) {
            console.log(`🏰 [Retrieve] 混合搜索 + 日期路径均无结果，跳过记忆注入`);
            return '';
        }

        // 3. 扩散激活
        const beforeActivation = results.length;
        results = await tRetrieve('spreadActivation', 'IDB', spreadActivation(results, charId, personalityStyle));
        if (results.length !== beforeActivation) {
            console.log(`🏰 [Retrieve] 扩散激活后：${beforeActivation} → ${results.length} 条`);
        }

        // 4. 启动效应
        if (currentMood) {
            results = applyPriming(results, currentMood);
            console.log(`🏰 [Retrieve] 启动效应（mood=${currentMood}）已应用`);
        }

        // 重新排序
        results.sort((a, b) => b.finalScore - a.finalScore);

        // ─── 调试日志：扩散+启动后的候选排序
        //    注意：这里是 pipeline 层的 ${results.length} 条候选，但 formatter
        //    (MAX_OUTPUT_MEMORIES=15) 会在格式化时再砍一刀，只有前 15 条真正
        //    写进 system prompt。多出来的会被标 "✂️ cut"。
        const FORMATTER_CUT = 15;
        console.groupCollapsed(
            `🏰 [Retrieve] 扩散+启动后 ${results.length} 条候选（formatter 只注入前 ${Math.min(FORMATTER_CUT, results.length)} 条）`
        );
        results.forEach((r, i) => {
            const marker = i < FORMATTER_CUT ? '✅ 注入' : '✂️ cut';
            console.log(fmt(r, `#${i + 1} [${marker}] `));
        });
        console.groupEnd();

        // 5. 反刍
        const ruminatedNode = await tRetrieve('checkRumination', 'IDB', checkRumination(charId, ruminationTendency));
        if (ruminatedNode) {
            const avgScore = results.length > 0
                ? results.reduce((s, r) => s + r.finalScore, 0) / results.length
                : 0.5;
            results.push({
                node: ruminatedNode,
                finalScore: avgScore * 0.8,
                similarity: 0,
                bm25Score: 0,
                roomScore: avgScore * 0.8,
            });
        }

        // 6+7. 更新访问记录 + 共同激活加强（并发写 IDB）
        const writeT0 = performance.now();
        const retrievedIds = results.map(r => r.node.id);
        await Promise.all([
            ...retrievedIds.map(id => MemoryNodeDB.touchAccess(id)),
            retrievedIds.length >= 2 ? strengthenCoActivated(retrievedIds.slice(0, 5)) : Promise.resolve(),
        ]);
        retrieveTimings.push({ label: `idbWrites(${retrievedIds.length})`, kind: 'IDB', ms: Math.round(performance.now() - writeT0) });

        // 8. Rerank 通道（独立检索 + cross-encoder 二次排序，可选）
        //
        //   Rerank 的 pool hybridSearch 和 rerankDocuments 已经在前面跟主路
        //   一起发射了（见上文 rerankApiPromise）。tail 这里只等它并做最后的
        //   dedup / merge，绝大多数情况下 rerank 已经先主路完成了。
        //
        //   注入层面不做特别对待：rerank 追加的几条直接混入主 results，formatter
        //   按 finalScore 排序渲染。用户/LLM 不会感知是 rerank 推荐的，F12 里能看。
        let formatterCap: number | undefined = undefined;
        if (doRerank) {
            const rerankTailT0 = performance.now();
            const rrData = await rerankApiPromise;
            if (rrData) {
                const { pool, rrResults } = rrData;
                const rerankWanted = rerankConfig!.topN;
                const mainIds = new Set(results.map(r => r.node.id));
                const rerankPicks: Array<{ sm: typeof pool[number]; rerankScore: number }> = [];
                for (const rr of rrResults) {
                    const cand = pool[rr.index];
                    if (!cand || mainIds.has(cand.node.id)) continue;
                    rerankPicks.push({ sm: cand, rerankScore: rr.relevance_score });
                    if (rerankPicks.length >= rerankWanted) break;
                }

                // F12 调试日志：能看到 rerank 选了哪几条、模型打的相关性分、
                // 以及它们原本在 hybrid 里的 finalScore
                console.groupCollapsed(
                    `🎯 [Rerank] ${rerankConfig!.model} · 独立检索池 ${pool.length} 条 · 去重后追加 ${rerankPicks.length} 条 ("${joinedUserQuery.slice(0, 40).replace(/\n/g, ' ')}${joinedUserQuery.length > 40 ? '…' : ''}")`
                );
                rerankPicks.forEach((p, i) => {
                    const preview = p.sm.node.content.slice(0, 50).replace(/\n/g, ' ');
                    const ageDays = Math.floor((Date.now() - p.sm.node.createdAt) / (1000 * 60 * 60 * 24));
                    console.log(
                        `#${i + 1} [${p.sm.node.room}|imp=${p.sm.node.importance}|${ageDays}d前] `
                        + `rerank=${p.rerankScore.toFixed(3)} hybrid=${p.sm.finalScore.toFixed(3)}  `
                        + `"${preview}${p.sm.node.content.length > 50 ? '...' : ''}"`
                    );
                });
                if (rerankPicks.length === 0) {
                    console.log('（rerank 返回的全部 top N 都已在主召回 15 条里，无新增）');
                }
                console.groupEnd();

                // touch 一下让 rerank 选中的也走 accessCount / lastAccessedAt 更新（并发）
                await Promise.all(rerankPicks.map(p => MemoryNodeDB.touchAccess(p.sm.node.id)));

                // 追加到 results；formatter 的 MAX_OUTPUT_ITEMS 上调到 15 + N
                // 不改 finalScore：保留 rerank pick 自己 hybridSearch 里的原始分，
                // 排序自然落位；但通过 formatterCap 保证它们不被切掉。
                if (rerankPicks.length > 0) {
                    results = [...results, ...rerankPicks.map(p => p.sm)];
                    formatterCap = 15 + rerankPicks.length;
                }
            }
            // rerank_tail = 等 rerankApiPromise 落地 + dedup + touch，理想值接近 0
            retrieveTimings.push({ label: 'rerank_tail', kind: 'NET', ms: Math.round(performance.now() - rerankTailT0) });
        }

        // 9. 获取期盼
        const anticipations = await tRetrieve('AnticipationDB.getByCharId', 'IDB', AnticipationDB.getByCharId(charId));

        // 10. 格式化
        const formatted = await tRetrieve('expandAndFormat', 'IDB', expandAndFormat(results, charId, anticipations, userName, formatterCap));

        // ── 汇总打印 ──
        const perfTotal = Math.round(performance.now() - perfRetrieveT0);
        const byKind: Record<'NET' | 'IDB' | 'CPU', number> = { NET: 0, IDB: 0, CPU: 0 };
        retrieveTimings.forEach(t => { byKind[t.kind] += t.ms; });
        const detail = retrieveTimings
            .sort((a, b) => b.ms - a.ms)
            .map(t => `${t.label}[${t.kind}]=${t.ms}ms`)
            .join(' ');
        console.log(`⏱ [retrieveMemories] total=${perfTotal}ms | NET=${byKind.NET}ms IDB=${byKind.IDB}ms CPU=${byKind.CPU}ms | ${detail}`);

        return formatted;

    } catch (err: any) {
        console.error(`❌ [Retrieve] 检索记忆失败:`, err.message);
        return '';
    }
}

/**
 * 便捷函数：检索记忆并挂到 char.memoryPalaceInjection 上。
 *
 * 各 App 在构建 System Prompt 前调用一次即可，
 * 之后 buildCoreContext 会自动读取并注入。
 *
 * @param recentMessages 可选，不传则自动从 DB 加载
 * @param queryHint 可选，App 自定义检索词（如场景描述、游戏叙事）。
 *                  传了就直接用这个检索，不走 getLastTurnMessages。
 */
/**
 * 获取全局记忆宫殿 embedding 配置。
 * 优先使用全局配置（localStorage），如果没有则回退到角色级别配置。
 */
function getEmbeddingConfig(charEmbeddingConfig?: any): EmbeddingConfig | null {
    try {
        const raw = localStorage.getItem('os_memory_palace_config');
        if (raw) {
            const global = JSON.parse(raw);
            if (global.embedding?.baseUrl && global.embedding?.apiKey) {
                return global.embedding as EmbeddingConfig;
            }
        }
    } catch {}
    // 回退到角色级别（兼容旧数据）
    if (charEmbeddingConfig?.baseUrl && charEmbeddingConfig?.apiKey) {
        return charEmbeddingConfig as EmbeddingConfig;
    }
    return null;
}

export async function injectMemoryPalace(
    char: { memoryPalaceEnabled?: boolean; embeddingConfig?: any; activeBuffs?: any[]; personalityStyle?: string; ruminationTendency?: number; id: string; memoryPalaceInjection?: string },
    recentMessages?: Message[],
    queryHint?: string,
    userName?: string,
): Promise<void> {
    if (!char.memoryPalaceEnabled) return;
    const embeddingConfig = getEmbeddingConfig(char.embeddingConfig);
    if (!embeddingConfig) return;
    try {
        const msgs = recentMessages ?? await DB.getMessagesByCharId(char.id);
        const currentMood = char.activeBuffs?.[0]?.name;
        const context = await retrieveMemories(
            msgs, char.id, embeddingConfig,
            currentMood,
            (char.personalityStyle as PersonalityStyle) || 'emotional',
            char.ruminationTendency ?? 0.3,
            queryHint,
            userName,
            getRemoteVectorConfig(),
        );
        if (context) {
            char.memoryPalaceInjection = context;
        }
    } catch (e: any) {
        console.warn(`🏰 [MemoryPalace] injectMemoryPalace failed: ${e.message}`);
    }
}

// ─── 输入管线（AI 回复后，后台） ──────────────────────

// ─── 高水位标记：记录每个角色处理到的最后消息 ID ────────

const LAST_MSG_KEY = (charId: string) => `mp_lastMsgId_${charId}`;

function getLastProcessedId(charId: string): number {
    try {
        const val = parseInt(localStorage.getItem(LAST_MSG_KEY(charId)) || '0', 10);
        return isNaN(val) || val < 0 ? 0 : val;
    } catch { return 0; }
}

function setLastProcessedId(charId: string, msgId: number): void {
    try { localStorage.setItem(LAST_MSG_KEY(charId), String(msgId)); } catch {}
}

/** 获取当前高水位标记（供外部上下文过滤使用） */
export function getMemoryPalaceHighWaterMark(charId: string): number {
    return getLastProcessedId(charId);
}

// ─── 缓冲区配置 ─────────────────────────────────────

/** 热区大小：最近 N 条消息始终留在聊天上下文，不处理 */
const HOT_ZONE_SIZE = 200;
/** 缓冲区阈值：累积超过 N 条消息后触发处理 */
const BUFFER_THRESHOLD = 100;
/** 处理比例：取缓冲区前 85%，保留尾部 15% 作为下次总结的上下文 */
const PROCESS_RATIO = 0.85;

/** 并发锁：防止多次 AI 回复同时触发 processNewMessages 产生竞态 */
const processingLocks = new Set<string>();

/**
 * 缓冲区机制处理聊天消息：
 *
 * 1. 热区 = 最近 200 条消息（留在聊天上下文，不处理）
 * 2. 缓冲区 = 高水位标记之后、热区之前的消息
 * 3. 缓冲区 >= 阈值时：取前 85% → LLM 提取记忆 → Embedding → 更新高水位
 * 4. 保留尾部 15%，避免下次总结时事件没有起因
 *
 * 相比旧方案（每轮 TopicLoom + 封盒），LLM 调用频率大幅降低：
 * 只在缓冲区满时触发，且只需 1 次 LLM 提取 + Embedding。
 */
/** Pipeline 处理结果 */
export interface PipelineResult {
    stored: number;
    skipped: number;
    memories: { content: string; room: string; importance: number; mood: string; tags: string[] }[];
    batches: { index: number; total: number; extracted: number; ok: boolean; error?: string }[];
    /**
     * 自动归档建议（供 React 层调用 updateCharacter 应用到 char.memories + hideBeforeMessageId）。
     * null = 本轮没产出新记忆或没更新水位线，caller 不需要做任何事。
     */
    autoArchive?: {
        /** 按日期切好的新 MemoryFragment 列表，id 已生成，mood='palace' */
        fragments: { id: string; date: string; summary: string; mood: string }[];
        /** 这一批 buffer 处理完后的水位线（= 最后一条被处理 Message.id），应设到 char.hideBeforeMessageId */
        hideBeforeMessageId: number;
    } | null;
    /**
     * 软跳过原因（非错误）：LLM 根本没跑，原因可能是缓冲区未到阈值 / 热区还没被挤出 / 已有任务在跑。
     * caller 看到这个字段就应当提示"聊天还不够，继续聊"，而不是报"LLM 提取失败"。
     */
    skipReason?: 'lock' | 'hot_zone' | 'threshold';
}

/** 构造一个"软跳过"结果，统一 caller 的分支处理 */
function makeSkipResult(reason: 'lock' | 'hot_zone' | 'threshold'): PipelineResult {
    return { stored: 0, skipped: 0, memories: [], batches: [], skipReason: reason };
}

export async function processNewMessages(
    _allRecentMessages: Message[], // 保留参数兼容，但内部直接从 DB 加载
    charId: string,
    charName: string,
    embeddingConfig: EmbeddingConfig,
    llmConfig: LightLLMConfig,
    userName: string = '',
    /** 强制模式：跳过缓冲区阈值检查，用于一键向量化 */
    force: boolean = false,
    /** 进度回调：通知调用方当前阶段 */
    onProgress?: (stage: string) => void,
): Promise<PipelineResult | null> {
    // 并发锁：同一角色同时只能跑一次
    if (processingLocks.has(charId)) {
        console.log(`🏰 [Pipeline] 跳过：${charName} 已有处理任务在运行`);
        return makeSkipResult('lock');
    }
    processingLocks.add(charId);

    try {
        // 1. 加载全部消息（含已处理的），计算热区和缓冲区
        //    过滤：保留任何有语义的消息类型（text / score_card / system / transfer / interaction），
        //    只排除纯视觉/音频类（image / emoji / voice）—— 后者经 normalize 变短占位，对 LLM 无增益
        const allMessages = await DB.getMessagesByCharId(charId, true);
        const textMessages = allMessages
            .filter(m => isMessageSemanticallyRelevant(m))
            .sort((a, b) => a.id - b.id);

        const totalCount = textMessages.length;

        if (totalCount <= HOT_ZONE_SIZE) {
            console.log(`🏰 [Pipeline] 跳过：消息总数 ${totalCount} <= 热区 ${HOT_ZONE_SIZE}，无需处理`);
            return makeSkipResult('hot_zone');
        }

        // 2. 热区 = 最后 HOT_ZONE_SIZE 条
        const hotZoneStartIdx = totalCount - HOT_ZONE_SIZE;
        const hotZoneStartId = textMessages[hotZoneStartIdx].id;

        // 3. 缓冲区 = 高水位标记之后、热区之前
        const lastProcessedId = getLastProcessedId(charId);
        const buffer = textMessages.filter(m => m.id > lastProcessedId && m.id < hotZoneStartId);

        const minThreshold = force ? 10 : BUFFER_THRESHOLD;
        if (buffer.length < minThreshold) {
            console.log(`🏰 [Pipeline] 跳过：缓冲区 ${buffer.length} 条 < 阈值 ${minThreshold}（hwm=${lastProcessedId}, hotZone起始id=${hotZoneStartId}）`);
            return makeSkipResult('threshold');
        }

        // 4. 取前 85% 处理，保留尾部 15%
        const processCount = Math.ceil(buffer.length * PROCESS_RATIO);
        const toProcess = buffer.slice(0, processCount);
        const keptTail = buffer.length - processCount;

        if (toProcess.length === 0) return makeSkipResult('threshold');

        console.log(`🏰 [Pipeline] 开始处理缓冲区：${toProcess.length} 条消息（保留尾部 ${keptTail} 条）`);
        console.log(`🏰 [Pipeline]   消息ID范围: ${toProcess[0].id} ~ ${toProcess[toProcess.length - 1].id}`);
        console.log(`🏰 [Pipeline]   总消息: ${totalCount}, 热区: ${HOT_ZONE_SIZE}, 缓冲区: ${buffer.length}, hwm: ${lastProcessedId}`);
        onProgress?.(`正在整理 ${toProcess.length} 条对话...`);

        // 5. 构建精简上下文：角色档案 + 用户档案 + 相关已有记忆
        let charContext = '';
        let relatedMemoryRefs: RelatedMemoryRef[] = [];
        try {
            const chars = await DB.getAllCharacters();
            const charProfile = chars.find(c => c.id === charId);
            const userProfile = await DB.getUserProfile();

            // 5a. 精简角色档案（姓名、设定、世界观）
            if (charProfile) {
                charContext += `[角色档案]\n`;
                charContext += `名字: ${charProfile.name}\n`;
                charContext += `核心设定:\n${charProfile.systemPrompt || '无'}\n`;
                if (charProfile.worldview?.trim()) {
                    charContext += `世界观: ${charProfile.worldview}\n`;
                }
                charContext += `\n`;
            }

            // 5b. 精简用户档案（姓名、设定）
            if (userProfile) {
                charContext += `[用户档案]\n`;
                charContext += `名字: ${userProfile.name}\n`;
                charContext += `设定: ${userProfile.bio || '无'}\n\n`;
            }

            // 5c. 向量检索相关已有记忆，用于两个目的：
            //     ① 为 LLM 提取提供上下文（防止误解隐式指代）
            //     ② 收集结构化引用供 LLM 标注 relatedTo → EventBox 绑定
            //     细粒度策略：每条 ≥4 字的 user 消息独立 query（和 retrieval spike 对齐，避免把
            //     一整段 chat 揉成 3 段 embed 导致语义平均稀释）；消息太少时 fallback 3 段切法
            let snippets = splitMessagesToSpikes(toProcess);
            let strategy = 'per-msg';
            if (snippets.length === 0) {
                snippets = sampleSnippetsFromMessages(toProcess, 5, 300);
                strategy = 'fallback-3seg';
            }
            relatedMemoryRefs = await fetchRelatedMemoriesForExtraction(snippets, charId, embeddingConfig);
            if (relatedMemoryRefs.length > 0) {
                console.log(`🏰 [Pipeline] 检索到 ${relatedMemoryRefs.length} 条相关记忆作为提取上下文（${strategy}，${snippets.length} 段 query）`);
            }

            // 5d. 召回回执补强：路径①召回时被实际注入 prompt 的 memoryId 一定
            //     参与了角色这段对话——这是判断"用户纠正了哪条旧记忆"的可靠线索。
            //     向量召回经常漏掉这类目标（纠正话题离原记忆语义已偏移），所以用
            //     回执查表保底。配额 5 条优先，剩余格子留给向量召回。
            try {
                const RECEIPT_QUOTA = 5;
                const RECEIPT_TIME_TOLERANCE_MS = 10 * 60 * 1000; // 消息 ts 与 receipt ts 的容差
                const tsList = toProcess.map(m => m.timestamp).filter(t => t > 0);
                if (tsList.length > 0) {
                    const fromTs = Math.min(...tsList) - RECEIPT_TIME_TOLERANCE_MS;
                    const toTs = Math.max(...tsList) + RECEIPT_TIME_TOLERANCE_MS;
                    const receiptIds = getReceiptIdsInRange(charId, fromTs, toTs, RECEIPT_QUOTA);
                    if (receiptIds.length > 0) {
                        // 已经在向量召回里出现的就不重复加
                        const existingIds = new Set(relatedMemoryRefs.map(r => r.id));
                        const receiptRefs: RelatedMemoryRef[] = [];
                        for (const id of receiptIds) {
                            if (existingIds.has(id)) continue;
                            const node = await MemoryNodeDB.getById(id);
                            // 不喂 archived 节点（早被压缩归档了，纠正它没意义；该纠正
                            // 的是 box 的 summary，summary 是非 archived，能正常进来）
                            if (!node || node.archived) continue;
                            receiptRefs.push({
                                id: node.id,
                                room: node.room,
                                content: (node.content || '').slice(0, 100),
                            });
                        }
                        if (receiptRefs.length > 0) {
                            // 回执优先放前面（O0..On），向量召回继续往后排
                            relatedMemoryRefs = [...receiptRefs, ...relatedMemoryRefs];
                            console.log(`🧾 [Pipeline] 召回回执补强：从最近注入历史拉回 ${receiptRefs.length} 条记忆作为高优先级 relatedMemories`);
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`🧾 [Pipeline] 召回回执查询失败（不影响提取）: ${e.message}`);
            }
        } catch (e: any) {
            console.warn(`🏰 [Pipeline] 加载角色上下文失败（不影响提取）: ${e.message}`);
        }

        // 6. 收集当前便利贴（供 LLM 判断是否需要提前摘除）
        const now = Date.now();
        const allCharNodes = await MemoryNodeDB.getByCharId(charId);
        const pinnedRefs: PinnedMemoryRef[] = allCharNodes
            .filter(n => n.pinnedUntil && n.pinnedUntil > now)
            .map(n => ({ id: n.id, content: n.content.slice(0, 80) }));

        // 7. LLM 提取记忆 — 大缓冲区分批处理（每批 ~250 条消息）
        //    避免一次喂太多消息导致 LLM 偷懒只提取几条
        const CHUNK_SIZE = 250;
        const chunks: Message[][] = [];
        for (let i = 0; i < toProcess.length; i += CHUNK_SIZE) {
            chunks.push(toProcess.slice(i, i + CHUNK_SIZE));
        }

        console.log(`🏰 [Pipeline] 开始提取记忆：${toProcess.length} 条消息，分 ${chunks.length} 批（每批 ~${CHUNK_SIZE} 条）`);

        const allMemories: import('./types').MemoryNode[] = [];
        const allCrossTimeLinks: { newMemoryId: string; existingMemoryId: string }[] = [];
        const allEventBoxHints: import('./extraction').EventBoxHint[] = [];
        const allCorrections: { targetId: string; note: string }[] = [];
        const batchResults: PipelineResult['batches'] = [];

        for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            onProgress?.(`正在提取记忆 (${ci + 1}/${chunks.length})...`);
            console.log(`🏰 [Pipeline] 调用 LLM 提取 batch ${ci + 1}/${chunks.length}（${chunk.length} 条消息 → ${llmConfig.model}）`);

            try {
                const extractionResult = await extractMemoriesFromBuffer(
                    chunk, charId, charName, llmConfig, charContext, userName, relatedMemoryRefs, pinnedRefs,
                );
                allMemories.push(...extractionResult.memories);
                allCrossTimeLinks.push(...extractionResult.crossTimeLinks);
                allEventBoxHints.push(...extractionResult.eventBoxHints);
                allCorrections.push(...extractionResult.corrections);
                batchResults.push({ index: ci + 1, total: chunks.length, extracted: extractionResult.memories.length, ok: true });

                // 处理便利贴摘除
                if (extractionResult.unpinIds.length > 0) {
                    for (const unpinId of extractionResult.unpinIds) {
                        const node = allCharNodes.find(n => n.id === unpinId);
                        if (node) {
                            node.pinnedUntil = null;
                            await MemoryNodeDB.save(node);
                        }
                    }
                    console.log(`📌 [Pipeline] batch ${ci + 1}: 摘除 ${extractionResult.unpinIds.length} 条便利贴`);
                }
            } catch (e: any) {
                console.warn(`🏰 [Pipeline] batch ${ci + 1} 提取失败: ${e.message}（继续下一批）`);
                batchResults.push({ index: ci + 1, total: chunks.length, extracted: 0, ok: false, error: e.message });
            }
        }

        const memories = allMemories;

        if (memories.length === 0) {
            console.warn(`🏰 [Pipeline] 所有批次共提取 0 条记忆（${toProcess.length} 条消息），不更新高水位，下次重试`);
            return { stored: 0, skipped: 0, memories: [], batches: batchResults };
        }

        console.log(`🏰 [Pipeline] 提取完成：${chunks.length} 批共 ${memories.length} 条记忆`);

        // 7. 检测 embedding 模型是否变更，如果变了则重建所有已有向量
        try {
            const consistency = await checkModelConsistency(charId, embeddingConfig.model);
            if (consistency === 'mismatch') {
                console.warn(`🔄 [Pipeline] 检测到 embedding 模型变更，开始重建已有向量...`);
                const result = await rebuildAllVectors(charId, embeddingConfig, getRemoteVectorConfig());
                console.log(`🔄 [Pipeline] 重建完成：${result.rebuilt} 条向量已更新`);
            }
        } catch (e: any) {
            console.warn(`🔄 [Pipeline] 模型一致性检查失败（不影响新记忆存储）: ${e.message}`);
        }

        // 8. 向量化（Embedding API，按批次）
        //    向量化失败则不更新高水位，下次重试 LLM 会重新提取。
        //    skipDedup=true：聊天总结里"上周担心工作 / 这周担心工作"cosine 完全可能 > 0.9
        //    但是两件不同时间的事，cosine 去重会精准误杀；而 high-water-mark 已保证
        //    消息不会被重复处理，去重在这条路径上收益小、误伤大。
        console.log(`🏰 [Pipeline] 开始向量化 ${memories.length} 条记忆...`);
        onProgress?.(`正在向量化 ${memories.length} 条记忆...`);
        const vectorResult = await vectorizeAndStore(memories, embeddingConfig, getRemoteVectorConfig(), { skipDedup: true });
        console.log(`🏰 [Pipeline] 向量化完成：${vectorResult.stored} 条存储, ${vectorResult.skipped} 条去重跳过`);

        // 9. 只有真的存成功了才更新高水位
        if (vectorResult.stored === 0) {
            console.warn(`🏰 [Pipeline] 向量化后 0 条存储成功，不更新高水位`);
            return { stored: 0, skipped: vectorResult.skipped, memories: [], batches: batchResults };
        }
        const newHighWaterMark = toProcess[toProcess.length - 1].id;
        setLastProcessedId(charId, newHighWaterMark);
        console.log(`✅ [Pipeline] 缓冲区处理完成：${vectorResult.stored} 条记忆, hwm ${lastProcessedId} → ${newHighWaterMark}`);
        onProgress?.(`记忆整理完成！新增 ${vectorResult.stored} 条记忆`);

        // 9b. 自动归档建议：按日期 group 新记忆 → YAML bullets → 合成 MemoryFragment
        //     caller（useChatAI / Chat）拿到后做"同日期 merge 进 char.memories + 推 hideBeforeMessageId"
        //     这条路径让 palace 成功后自动同步到传统归档+聊天水位线
        //     零 LLM 调用——风格化已经在 palace extraction 那次 LLM 调用里完成
        const autoArchive = buildAutoArchiveFragments(memories, newHighWaterMark);

        // 构建返回结果
        const pipelineResult: PipelineResult = {
            stored: vectorResult.stored,
            skipped: vectorResult.skipped,
            memories: memories.map(m => ({ content: m.content, room: m.room, importance: m.importance, mood: m.mood, tags: m.tags })),
            batches: batchResults,
            autoArchive,
        };

        // 10. 建关联（仅规则，不调 LLM，省钱）— 失败不影响已保存的记忆
        try {
            const existingNodes = await MemoryNodeDB.getByCharId(charId);
            const justStored = existingNodes.filter(n => memories.some(nn => nn.id === n.id));
            const others = existingNodes.filter(n => !memories.some(nn => nn.id === n.id));
            await buildLinks(justStored, others);
            console.log(`🏰 [Pipeline] 关联建立完成（${justStored.length} 新节点 vs ${Math.min(others.length, 50)} 已有节点）`);
        } catch (e: any) {
            console.warn(`🏰 [Pipeline] 关联建立失败（不影响已保存记忆）: ${e.message}`);
        }

        // 10b. EventBox 绑定：把 LLM 标注的 relatedTo 转为 EventBox 收纳
        //      （旧逻辑：转 causal MemoryLink 已废弃，让位给更强的 EventBox 机制）
        const touchedBoxIds = new Set<string>();
        if (allCrossTimeLinks.length > 0) {
            try {
                const { bindMemoriesIntoEventBox } = await import('./eventBox');
                const touched = await bindMemoriesIntoEventBox(charId, allCrossTimeLinks, allEventBoxHints);
                for (const id of touched) touchedBoxIds.add(id);
                console.log(`📦 [Pipeline] EventBox 绑定：${allCrossTimeLinks.length} 条关联 → 触达 ${touched.size} 个事件盒`);
            } catch (e: any) {
                console.warn(`📦 [Pipeline] EventBox 绑定失败（不影响已保存记忆）: ${e.message}`);
            }
        }

        // 10c. EventBox 压缩：扫描刚被触达的盒，活节点 ≥ 4 → LLM 二次总结
        if (touchedBoxIds.size > 0) {
            try {
                const { maybeCompressEventBoxes } = await import('./eventBoxCompression');
                await maybeCompressEventBoxes(touchedBoxIds, llmConfig, embeddingConfig, charName, userName);
            } catch (e: any) {
                console.warn(`🗜️ [Pipeline] EventBox 压缩失败（不影响已保存记忆）: ${e.message}`);
            }
        }

        // 10d. 应用纠正：把 LLM 标的"用户纠正了 OX"翻译成对原节点 content 的追加。
        //     设计：不新增节点、不动 EventBox 结构、不删原内容——只在 content 末尾
        //     追加一行"（YYYY-MM-DD 纠正：xxx）"，重新向量化即可。下次召回时 LLM
        //     看到带纠正标签的内容会自然采用新版本。
        //     放在压缩之后：避免刚改完 content 的节点被同轮压缩当 live 节点吞掉。
        if (allCorrections.length > 0) {
            try {
                // 同一目标多次纠正：合并成一条多分号 note，避免追加多次
                const merged = new Map<string, string[]>();
                for (const c of allCorrections) {
                    const arr = merged.get(c.targetId) || [];
                    arr.push(c.note);
                    merged.set(c.targetId, arr);
                }

                const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                const toRevectorize: import('./types').MemoryNode[] = [];
                for (const [targetId, notes] of merged) {
                    const node = await MemoryNodeDB.getById(targetId);
                    if (!node) {
                        console.warn(`✏️ [Pipeline] 纠正目标 ${targetId} 已不存在，跳过`);
                        continue;
                    }
                    if (node.archived) {
                        // archived 节点不参与召回，纠正它没意义
                        console.warn(`✏️ [Pipeline] 纠正目标 ${targetId} 已归档，跳过`);
                        continue;
                    }
                    const noteText = notes.map(n => n.trim()).filter(Boolean).join('；');
                    if (!noteText) continue;
                    node.content = `${node.content}\n（${dateStr} 纠正：${noteText}）`;
                    node.embedded = false; // 触发重新向量化
                    node.lastAccessedAt = Date.now();
                    await MemoryNodeDB.save(node);
                    toRevectorize.push(node);
                    console.log(`✏️ [Pipeline] 纠正应用 ${targetId}: "${noteText.slice(0, 40)}…"`);
                }

                if (toRevectorize.length > 0) {
                    // skipDedup：内容刚改的节点必然和原向量"很像"，去重会误杀自己
                    await vectorizeAndStore(toRevectorize, embeddingConfig, getRemoteVectorConfig(), { skipDedup: true });
                    console.log(`✏️ [Pipeline] ${toRevectorize.length} 条纠正记忆已重新向量化`);
                }
            } catch (e: any) {
                console.warn(`✏️ [Pipeline] 应用纠正失败（不影响已保存记忆）: ${e.message}`);
            }
        }

        // 11. 巩固（纯计算）— 失败不影响已保存的记忆
        //     传 remoteConfig 让 room 变更同步到 Supabase，跨设备一致
        try {
            await runConsolidation(charId, getRemoteVectorConfig());
        } catch (e: any) {
            console.warn(`🏰 [Pipeline] 巩固失败（不影响已保存记忆）: ${e.message}`);
        }

        return pipelineResult;

    } catch (err: any) {
        console.error(`❌ [Pipeline] processNewMessages 失败 (charId=${charId}):`, err.message, err.stack?.split('\n')[1] || '');
        return null;
    } finally {
        processingLocks.delete(charId);
    }
}
