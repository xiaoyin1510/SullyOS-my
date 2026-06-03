/**
 * Memory Palace — 混合搜索 + 房间评分
 *
 * 85% 向量 + 15% BM25 融合，然后按房间特性调整评分。
 */

import type { EmbeddingConfig, MemoryNode, MemoryRoom, MemoryVector, ScoredMemory, RemoteVectorConfig } from './types';
import { MemoryNodeDB } from './db';
import { getEmbedding } from './embedding';
import { vectorSearch } from './vectorSearch';
import { bm25Search, bm25SearchIndexed, bm25SearchDualRun } from './bm25';
import { bm25Index } from './bm25Index';
import { calculateEffectiveImportance } from './consolidation';

// ─── BM25 灰度开关 ────────────────────────────────────
//
// localStorage 'bm25_mode'：
//   未设置 / 'naive'  → 朴素全量扫描（默认，行为与改造前一致）
//   'indexed'         → 倒排索引版（O(Q×postings)，需 ensureBuilt）
//   'dual'            → 双跑校验：跑两版对比 top K，返回朴素版结果
//
// 灰度路径：默认 naive → 开发/灰度 dual → 验证无 mismatch 切 indexed →
// 一两个版本周期后删除朴素版。
type BM25Mode = 'naive' | 'indexed' | 'dual';
function getBM25Mode(): BM25Mode {
    try {
        const v = localStorage.getItem('bm25_mode');
        if (v === 'indexed' || v === 'dual') return v;
    } catch { /* SSR / 隐私模式 */ }
    return 'naive';
}

// ─── 房间评分权重 ─────────────────────────────────────

interface RoomWeights {
    similarity: number;
    recency: number;
    importance: number;
}

const ROOM_WEIGHTS: Record<MemoryRoom, RoomWeights> = {
    living_room: { similarity: 0.50, recency: 0.30, importance: 0.20 },
    bedroom:     { similarity: 0.60, recency: 0.10, importance: 0.30 },
    study:       { similarity: 0.55, recency: 0.15, importance: 0.30 },
    user_room:   { similarity: 0.55, recency: 0.15, importance: 0.30 },
    self_room:   { similarity: 0.55, recency: 0.15, importance: 0.30 },
    attic:       { similarity: 0.70, recency: 0.00, importance: 0.30 },
    windowsill:  { similarity: 0.55, recency: 0.15, importance: 0.30 },
};

const VECTOR_WEIGHT = 0.85;
const BM25_WEIGHT = 0.15;
const RECENCY_DECAY = 0.999; // per hour

// ─── 熟悉度加成（accessCount）──────────────────────
//
// 设计原则：AI 不该像人一样自然遗忘（遗忘在产品里是 bug），
// 所以 accessCount 不用来"保护记忆不衰减"，而是用来给常被想起的
// 话题一个轻度浮现加成——越熟的话题越容易被想起来。
//
// 公式：familiarity = min(1, (max(0, accessCount - 1))^0.3 / 4)
//   - count=0/1 (从未被检索到) → 0
//   - count=3  →  0.31
//   - count=10 →  0.48
//   - count=100 → 1.0（封顶）
//
// 最终加成：finalScore += FAMILIARITY_WEIGHT * familiarity
// 权重 0.05 —— 足够让熟悉话题冒头，不会压过 similarity / importance。
const FAMILIARITY_WEIGHT = 0.05;

function familiarityBonus(accessCount: number): number {
    const n = Math.max(0, (accessCount || 0) - 1);
    if (n === 0) return 0;
    return Math.min(1, Math.pow(n, 0.3) / 4);
}

// ─── 混合搜索 ─────────────────────────────────────────

/**
 * 同次 retrieve 内 K 路 hybridSearch 共享的预取数据。
 * 由 pipeline 在发起并行搜索前一次性取好，避免 K 倍的
 * Embedding API 调用和 K 倍的全量 IDB 扫表。
 */
export interface HybridSearchPrefetch {
    /** 已经向量化好的 query — 跳过本路的 getEmbedding 调用 */
    queryVector?: Float32Array;
    /** 角色全量 MemoryNode（含 archived / 未 embedded，由 hybridSearch 内部过滤） */
    allNodes?: MemoryNode[];
    /** 角色全量 MemoryVector；仅用于本地向量路径，远程路径不消费 */
    allVectors?: MemoryVector[];
}

/**
 * 混合搜索：向量 + BM25 + 房间评分
 *
 * @param query 查询文本（通常为最近 3 条消息拼接）
 * @param charId 角色 ID
 * @param embeddingConfig Embedding 配置
 * @param topK 最终返回数量
 */
export async function hybridSearch(
    query: string,
    charId: string,
    embeddingConfig: EmbeddingConfig,
    topK: number = 15,
    remoteVectorConfig?: RemoteVectorConfig,
    prefetch?: HybridSearchPrefetch,
): Promise<ScoredMemory[]> {
    // 1. 向量化查询（优先用 pipeline 预取好的，省掉 K 次 API 调用）
    const queryVector = prefetch?.queryVector ?? await getEmbedding(query, embeddingConfig);

    // 2. 向量搜索（远程优先，本地兜底）
    //
    // 历史教训：曾经把这个候选池从 30 扩到 60 试图放大同主题召回广度，
    // 结果反而变差——sim 0.35-0.45 的"泛情感高 imp"记忆被放进来，
    // 在房间评分（sim 权重 55%、imp/recency 合计 45%）里凭借 imp 和
    // recency 反超了 sim 更精准但 imp_eff 偏低的话题目标记忆（如"外公"
    // 落在 study 房间，imp 衰减过）。
    // 结论：候选池不应作为召回广度的旋钮。精准度靠 per-message 多路搜
    // + imp floor 在 pipeline 层解决，候选池 30 已足够。
    const vectorResults = await vectorSearch(queryVector, charId, 0.3, 30, remoteVectorConfig, prefetch?.allVectors);

    // 3. BM25 搜索（排除 archived 节点 —— 它们已被压入 EventBox summary）
    const allNodes = prefetch?.allNodes ?? await MemoryNodeDB.getByCharId(charId);
    const searchableNodes = allNodes.filter(n => n.embedded && !n.archived);

    // 倒排索引按"全量节点"构建（含 archived / 未 embedded），unarchive 后立即可搜，
    // 实际过滤交给 bm25SearchIndexed 用 searchableNodes 的 id 集做白名单。
    // ensureBuilt 已存在则秒返。
    const bm25Mode = getBM25Mode();
    if (bm25Mode !== 'naive') {
        bm25Index.ensureBuilt(charId, allNodes);
    }
    const bm25Results =
        bm25Mode === 'indexed' ? bm25SearchIndexed(query, searchableNodes, 30) :
        bm25Mode === 'dual'    ? bm25SearchDualRun(query, searchableNodes, 30) :
                                 bm25Search(query, searchableNodes, 30);

    // 3b. 本地节点索引：用于将云端返回的轻量 node 补全为完整 node
    //     （allNodes 已在内存中，零额外开销）
    const localNodeMap = new Map(allNodes.map(n => [n.id, n]));

    // 4. 融合：构建 nodeId → scores 映射
    const scoreMap = new Map<string, {
        node: MemoryNode;
        vectorSim: number;
        bm25Score: number;
    }>();

    // 归一化 BM25 分数到 0-1
    const maxBm25 = bm25Results.length > 0 ? bm25Results[0].score : 1;

    for (const vr of vectorResults) {
        // 优先使用本地完整 node（含 eventBoxId / archived 等最新状态）
        const fullNode = localNodeMap.get(vr.node.id) || vr.node;
        // 二次保险：本地态显示 archived → 跳过（远程刚被 archive 但 RPC 未及时反映的情况）
        if (fullNode.archived) continue;
        scoreMap.set(vr.node.id, {
            node: fullNode,
            vectorSim: vr.similarity,
            bm25Score: 0,
        });
    }

    for (const br of bm25Results) {
        const normalized = maxBm25 > 0 ? br.score / maxBm25 : 0;
        const existing = scoreMap.get(br.node.id);
        if (existing) {
            existing.bm25Score = normalized;
        } else {
            scoreMap.set(br.node.id, {
                node: br.node,
                vectorSim: 0,
                bm25Score: normalized,
            });
        }
    }

    // 5. 计算混合分数 + 房间评分
    const now = Date.now();
    const results: ScoredMemory[] = [];

    for (const [, entry] of scoreMap) {
        const { node, vectorSim, bm25Score } = entry;

        // 混合相似度
        const hybridSim = VECTOR_WEIGHT * vectorSim + BM25_WEIGHT * bm25Score;

        // 新近度（指数衰减）
        const hoursAgo = (now - node.lastAccessedAt) / (1000 * 60 * 60);
        const recency = Math.pow(RECENCY_DECAY, hoursAgo);

        // 有效重要性（归一化到 0-1）
        const effectiveImp = calculateEffectiveImportance(node, now) / 10;

        // 房间权重
        const weights = ROOM_WEIGHTS[node.room];

        // 老记忆 recency 回收（所有有 recency 权重的房间）：
        //   recency = RECENCY_DECAY^hoursAgo，约 100 天后会降到 0.1 以下，再往后
        //   这个信号对排序几乎无贡献。但房间权重里 recency 份额没归零（living_room 0.30、
        //   study/user_room/self_room/windowsill 0.15、bedroom 0.10），这部分权重
        //   等于白送——同一条记忆 sim/imp 再高也被少算一截。
        //
        //   规则：任意房间 recency < 0.1 时，把 recency 的权重平均分配给 similarity
        //   和 importance（各 +weights.recency/2），recency 权重归零。这条规则对 attic
        //   天然无影响（它 recency 权重本来就是 0），对其它房间等于"旧记忆时把白送的
        //   权重还给 sim/imp"，让旧而精准的记忆不被衰减吃掉。
        let simW = weights.similarity;
        let recW = weights.recency;
        let impW = weights.importance;
        if (weights.recency > 0 && recency < 0.1) {
            const redistribute = weights.recency / 2;
            simW += redistribute;
            impW += redistribute;
            recW = 0;
        }

        const baseScore = simW * hybridSim + recW * recency + impW * effectiveImp;

        // 熟悉度加成（轻权重，防止常聊话题沉底）
        const familiarity = familiarityBonus(node.accessCount);
        const roomScore = baseScore + FAMILIARITY_WEIGHT * familiarity;

        results.push({
            node,
            finalScore: roomScore,
            similarity: vectorSim,
            bm25Score,
            roomScore,
        });
    }

    // 6. 按 finalScore 降序
    results.sort((a, b) => b.finalScore - a.finalScore);

    return results.slice(0, topK);
}
