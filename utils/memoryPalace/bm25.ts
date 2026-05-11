/**
 * Memory Palace — BM25 搜索
 *
 * 关键词精确匹配，补偿向量搜索对专有名词的弱点。
 * 中文 2-gram 分词 + 英文空格分词 + TF-IDF 评分。
 * 纯前端计算，无需外部服务。
 */

import type { MemoryNode } from './types';
import { bm25Index } from './bm25Index';

// BM25 参数
export const K1 = 1.2;
export const B = 0.75;

// ─── 分词 ──────────────────────────────────────────────

/**
 * 中文 2-gram + 英文按空格分词
 *
 * 示例：
 * "小明去了北京" → ["小明", "明去", "去了", "了北", "北京"]
 * "hello world" → ["hello", "world"]
 * "小明说hello" → ["小明", "明说", "hello"]
 */
export function tokenize(text: string): string[] {
    const tokens: string[] = [];
    // 先按非中文字符分割，提取英文 token
    const parts = text.split(/([a-zA-Z0-9]+)/);

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (/^[a-zA-Z0-9]+$/.test(trimmed)) {
            // 英文/数字：整词
            tokens.push(trimmed.toLowerCase());
        } else {
            // 中文：2-gram
            const cleaned = trimmed.replace(/[\s\p{P}]/gu, ''); // 去掉标点和空白
            for (let i = 0; i < cleaned.length - 1; i++) {
                tokens.push(cleaned.slice(i, i + 2));
            }
            // 如果只有 1 个字，也加入
            if (cleaned.length === 1) {
                tokens.push(cleaned);
            }
        }
    }

    return tokens;
}

// ─── BM25 搜索引擎 ────────────────────────────────────

interface BM25Result {
    node: MemoryNode;
    score: number;
}

/**
 * BM25 搜索
 *
 * @param query 搜索查询文本
 * @param nodes 候选记忆节点
 * @param topK 返回最多 topK 条
 */
export function bm25Search(
    query: string,
    nodes: MemoryNode[],
    topK: number = 20,
): BM25Result[] {
    if (nodes.length === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;

    // 预处理：为每个文档建立 token 频率表
    const docTokens: string[][] = nodes.map(n => tokenize(n.content));

    // 计算平均文档长度
    const avgDl = docTokens.reduce((sum, t) => sum + t.length, 0) / docTokens.length;

    // 构建 IDF（Inverse Document Frequency）
    const docCount = nodes.length;
    const idf: Record<string, number> = {};

    for (const qt of queryTokens) {
        if (idf[qt] !== undefined) continue;
        // 包含该 token 的文档数
        const df = docTokens.filter(dt => dt.includes(qt)).length;
        // BM25 IDF 公式
        idf[qt] = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
    }

    // 计算每个文档的 BM25 分数
    const results: BM25Result[] = [];

    for (let i = 0; i < nodes.length; i++) {
        const dl = docTokens[i].length;
        if (dl === 0) continue;

        let score = 0;

        // 构建该文档的 token 频率表
        const tf: Record<string, number> = {};
        for (const t of docTokens[i]) {
            tf[t] = (tf[t] || 0) + 1;
        }

        for (const qt of queryTokens) {
            const termFreq = tf[qt] || 0;
            if (termFreq === 0) continue;

            const tfNorm = (termFreq * (K1 + 1)) / (termFreq + K1 * (1 - B + B * dl / avgDl));
            score += (idf[qt] || 0) * tfNorm;
        }

        if (score > 0) {
            results.push({ node: nodes[i], score });
        }
    }

    // 按分数降序
    results.sort((a, b) => b.score - a.score);

    if (t0 && nodes.length >= 500) {
        const dt = performance.now() - t0;
        console.log(`[bm25:naive] ${nodes.length} nodes / ${queryTokens.length} qtokens → ${dt.toFixed(1)}ms`);
    }

    return results.slice(0, topK);
}

// ─── 倒排索引版（行为等价，复杂度从 O(Q×N×L) 降到 O(Q×postings)） ──

/**
 * BM25 搜索 —— 倒排索引版
 *
 * 与 bm25Search() 行为等价（同 tokenizer / 公式 / IDF / 候选集），
 * 但避免对全量节点重新分词。索引由 bm25Index 模块在 MemoryNodeDB
 * 写入路径中增量维护，首次查询某 charId 时按需全量构建。
 *
 * 候选过滤策略：把传入的 nodes 当作"白名单"，索引中超出此集合的
 * 节点（如 archived / 未 embedded）被排除。这样 archive 翻转无需
 * 触发索引重建。
 */
export function bm25SearchIndexed(
    query: string,
    nodes: MemoryNode[],
    topK: number = 20,
): BM25Result[] {
    if (nodes.length === 0) return [];
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const charId = nodes[0].charId;
    // 索引必须已由调用方通过 bm25Index.ensureBuilt(charId, allNodes) 构建好
    // （allNodes 含 archived/未 embedded 节点，保证 unarchive 后能搜到）。
    // 这里若未命中只能退化为按候选集构建，会丢 unarchive 节点 —— 打 warn 暴露问题。
    if (!bm25Index.has(charId)) {
        console.warn('[bm25:indexed] index not built for', charId, '— building from filtered candidates (may miss unarchived nodes). Caller should ensureBuilt() with full charId nodes.');
        bm25Index.ensureBuilt(charId, nodes);
    }

    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;

    const allowed = new Set(nodes.map(n => n.id));
    const raw = bm25Index.search(charId, queryTokens, allowed);

    // 重建 (node, score) 并用与朴素版一致的 tie-break：
    // 朴素版结果保留 nodes[i] 输入顺序，sort 是稳定的 → 同分时按 i 升序。
    // 这里给每个 raw 命中绑上对应 nodes[] 的下标，二级排序键。
    const nodeIndexMap = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) nodeIndexMap.set(nodes[i].id, i);

    const enriched = raw.map(r => ({
        node: nodes[nodeIndexMap.get(r.nodeId)!],
        score: r.score,
        idx: nodeIndexMap.get(r.nodeId)!,
    }));
    enriched.sort((a, b) => b.score - a.score || a.idx - b.idx);

    const results: BM25Result[] = enriched.slice(0, topK).map(e => ({ node: e.node, score: e.score }));

    if (t0 && nodes.length >= 500) {
        const dt = performance.now() - t0;
        console.log(`[bm25:indexed] ${nodes.length} candidates / ${queryTokens.length} qtokens → ${dt.toFixed(1)}ms`);
    }

    return results;
}

/**
 * 双跑校验：同时调用朴素版与倒排版，对比 top K 是否一致。
 * 不一致时打警告（含差异详情），返回值始终是朴素版结果（保证灰度期行为不变）。
 */
export function bm25SearchDualRun(
    query: string,
    nodes: MemoryNode[],
    topK: number = 20,
): BM25Result[] {
    const naive = bm25Search(query, nodes, topK);
    const indexed = bm25SearchIndexed(query, nodes, topK);

    // 比较 top K 的 nodeId 序列与分数（容许浮点 1e-6 误差）
    const len = Math.min(naive.length, indexed.length);
    let mismatch = false;
    if (naive.length !== indexed.length) mismatch = true;
    for (let i = 0; i < len && !mismatch; i++) {
        if (naive[i].node.id !== indexed[i].node.id) { mismatch = true; break; }
        if (Math.abs(naive[i].score - indexed[i].score) > 1e-6) { mismatch = true; break; }
    }

    if (mismatch) {
        console.warn('[bm25:dual-run] mismatch detected', {
            query: query.slice(0, 50),
            nodeCount: nodes.length,
            naiveTop: naive.slice(0, 5).map(r => ({ id: r.node.id, s: r.score.toFixed(4) })),
            indexedTop: indexed.slice(0, 5).map(r => ({ id: r.node.id, s: r.score.toFixed(4) })),
        });
    }

    return naive;
}
