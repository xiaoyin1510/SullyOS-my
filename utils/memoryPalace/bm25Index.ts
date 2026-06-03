/**
 * Memory Palace — BM25 倒排索引
 *
 * 内存常驻、按 charId 隔离、懒构建、增量维护。
 * 不持久化到 IndexedDB —— 启动时按需重建（10k 节点约 1-3s 一次性成本），
 * 换取零持久化漂移风险。
 *
 * 架构要点：
 *   - 索引构建：第一次查询某 charId 时全量 tokenize
 *   - 增量更新：MemoryNodeDB.save/delete/saveMany 内部钩子触发
 *   - 候选过滤：在查询时按调用方传入的 allowedIds 过滤（自动处理
 *     archived/embedded 等节点状态变化，不需要在 archive 翻转时重建）
 *   - 跨 char 查找：维护 nodeId → charId 反查表，支持 delete(id) 不带 charId
 *
 * 与 bm25Search() 的等价性：
 *   - 同一 tokenizer
 *   - 同一公式（K1, B 来自 bm25.ts）
 *   - 同一统计口径：search() 内的 docCount / avgDl / df 全部按 allowedIds
 *     候选集计算（与朴素版传入 nodes 的口径一致）→ top K 与分数完全等价，
 *     可被 bm25SearchDualRun 验证
 *
 * 已知未挂钩的写入路径（v1 接受的风险）：
 *   - 备份恢复：utils/db.ts 的 clearAndAdd('memory_nodes', ...) 直接写 IDB，
 *     不经 MemoryNodeDB → 索引会变脏。缓解：恢复后通常会刷页面，新会话自动
 *     重建；若用户报告异常召回，在恢复成功后显式调 bm25Index.dropAll()
 */

import type { MemoryNode } from './types';
import { tokenize, K1, B } from './bm25';

interface DocMeta {
    length: number;
    charId: string;
    /** 内容指纹（length + 简单 hash），用于 save 时判断是否需要重新 tokenize */
    contentSig: number;
}

interface CharIndex {
    /** token → (nodeId → tf) 倒排表 */
    postings: Map<string, Map<string, number>>;
    /** nodeId → 文档元信息 */
    docMeta: Map<string, DocMeta>;
    /** 总 token 数（用于 avgDl 计算） */
    totalTokens: number;
}

export interface BM25IndexedResult {
    nodeId: string;
    score: number;
}

// ─── 内容指纹 ──────────────────────────────────────────

/**
 * 廉价的字符串指纹，用于检测 content 是否变更。
 * 不需要密码学强度——只要变了就大概率不同就行。
 */
function contentSig(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return h ^ s.length;
}

// ─── 索引管理器（singleton） ───────────────────────────

class BM25IndexManager {
    /** charId → 该角色的倒排索引 */
    private indices = new Map<string, CharIndex>();
    /** nodeId → charId（用于 delete 时反查） */
    private nodeToChar = new Map<string, string>();

    /** 是否已为某 charId 构建索引 */
    has(charId: string): boolean {
        return this.indices.has(charId);
    }

    /**
     * 确保索引已构建。已存在则跳过；未存在则用传入的 nodes 全量构建。
     * 调用方应传入该 charId 的"全量节点"（含 archived / 未 embedded），
     * 不要预过滤——查询时按候选集过滤即可。这样 archive 翻转无需重建。
     */
    ensureBuilt(charId: string, allNodes: MemoryNode[]): void {
        if (this.indices.has(charId)) return;
        const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
        const index: CharIndex = {
            postings: new Map(),
            docMeta: new Map(),
            totalTokens: 0,
        };
        for (const node of allNodes) {
            this.addToIndex(index, node);
            this.nodeToChar.set(node.id, charId);
        }
        this.indices.set(charId, index);
        if (t0) {
            const dt = performance.now() - t0;
            console.log(`[bm25Index] built ${charId} (${allNodes.length} nodes, ${index.postings.size} postings, ${(index.totalTokens / 1000).toFixed(1)}k tokens) in ${dt.toFixed(0)}ms`);
        }
    }

    /** 删除某 charId 的索引（用于 wipe / 角色切换等场景） */
    drop(charId: string): void {
        const idx = this.indices.get(charId);
        if (!idx) return;
        for (const id of idx.docMeta.keys()) {
            this.nodeToChar.delete(id);
        }
        this.indices.delete(charId);
    }

    /** 清空所有索引（wipe 全量数据时用） */
    dropAll(): void {
        this.indices.clear();
        this.nodeToChar.clear();
    }

    // ─── 增量维护钩子 ──────────────────────────────────

    /**
     * 节点写入钩子。
     *
     * 决策：
     *   - 索引未构建 → 直接跳过（懒构建会在首次查询时全量扫一次，
     *     这里不抢跑，避免 save 路径承担 1-3s 的代价）
     *   - 节点已存在且 contentSig 未变 → 跳过（touchAccess 等仅更新
     *     metadata 的写入不需要重新 tokenize）
     *   - 节点已存在且 contentSig 变了 → 旧 tf 全删，新 tf 插入
     *   - 节点不存在 → 直接插入
     */
    onNodeSaved(node: MemoryNode): void {
        const index = this.indices.get(node.charId);
        if (!index) return;

        const sig = contentSig(node.content);
        const existing = index.docMeta.get(node.id);
        if (existing && existing.contentSig === sig) return;

        if (existing) {
            this.removeFromIndex(index, node.id);
        }
        this.addToIndex(index, node);
        this.nodeToChar.set(node.id, node.charId);
    }

    /** 节点删除钩子（不需要 charId，内部反查） */
    onNodeDeleted(nodeId: string): void {
        const charId = this.nodeToChar.get(nodeId);
        if (!charId) return;
        const index = this.indices.get(charId);
        if (!index) return;
        this.removeFromIndex(index, nodeId);
        this.nodeToChar.delete(nodeId);
    }

    /** 批量写入钩子（按 charId 分组后逐一更新对应索引） */
    onNodesSaved(nodes: MemoryNode[]): void {
        for (const node of nodes) this.onNodeSaved(node);
    }

    // ─── 内部：索引读写 ────────────────────────────────

    private addToIndex(index: CharIndex, node: MemoryNode): void {
        const tokens = tokenize(node.content);
        const length = tokens.length;
        if (length === 0) {
            // 仍然记录 docMeta，避免反复尝试 tokenize 空内容；不进 postings
            index.docMeta.set(node.id, {
                length: 0,
                charId: node.charId,
                contentSig: contentSig(node.content),
            });
            return;
        }

        // 累计 tf
        const tfMap = new Map<string, number>();
        for (const t of tokens) {
            tfMap.set(t, (tfMap.get(t) || 0) + 1);
        }

        for (const [token, tf] of tfMap) {
            let bucket = index.postings.get(token);
            if (!bucket) {
                bucket = new Map();
                index.postings.set(token, bucket);
            }
            bucket.set(node.id, tf);
        }

        index.docMeta.set(node.id, {
            length,
            charId: node.charId,
            contentSig: contentSig(node.content),
        });
        index.totalTokens += length;
    }

    private removeFromIndex(index: CharIndex, nodeId: string): void {
        const meta = index.docMeta.get(nodeId);
        if (!meta) return;

        // 扫一遍 postings 把含 nodeId 的桶里抹掉。
        // 这里没有 doc→tokens 的反向表（避免双倍内存），所以是 O(unique tokens)
        // 而非 O(doc length)；对中文 2-gram，差距不大。
        // 优化：只遍历该文档实际包含的 token —— 但需要重新 tokenize 一次内容。
        // 取舍：假设内容已被外部修改过，重新 tokenize 不一定还原原始 token 集。
        // 因此保险走全 postings 扫描。后续若成为瓶颈，再加 doc→tokens 反向表。
        for (const [token, bucket] of index.postings) {
            if (bucket.delete(nodeId) && bucket.size === 0) {
                index.postings.delete(token);
            }
        }

        index.totalTokens -= meta.length;
        index.docMeta.delete(nodeId);
    }

    // ─── 查询 ──────────────────────────────────────────

    /**
     * 在某 charId 的索引上做 BM25 查询。
     *
     * 统计口径：docCount / avgDl / df 全部按 allowedIds 候选集计算，
     * 与朴素 bm25Search(query, candidates) 的口径一致 —— 这样切到倒排
     * 版后排序与分数完全等价（验证：bm25SearchDualRun）。
     *
     * @param charId  角色 ID
     * @param queryTokens  已分词的查询 token
     * @param allowedIds  候选 ID 集（必须传，对应朴素版的 nodes 参数）
     * @returns 排序后的 (nodeId, score) 列表（不截断 topK，由调用方处理）
     */
    search(
        charId: string,
        queryTokens: string[],
        allowedIds: Set<string>,
    ): BM25IndexedResult[] {
        const index = this.indices.get(charId);
        if (!index || queryTokens.length === 0 || allowedIds.size === 0) return [];

        // 候选集统计：docCount = 候选集大小，avgDl = 候选集平均长度
        // 注意：朴素版用 nodes.length 当 docCount，无论 dl 是否为 0；
        // avgDl 也用 reduce 求和 / nodes.length（含 dl=0 节点）。这里照搬。
        let totalLen = 0;
        const docCount = allowedIds.size;
        for (const id of allowedIds) {
            const meta = index.docMeta.get(id);
            if (meta) totalLen += meta.length;
        }
        const avgDl = totalLen / docCount;
        if (avgDl === 0) return [];

        // 去重 query token，按候选集算 df → IDF
        const uniqueQTokens = Array.from(new Set(queryTokens));
        const idf = new Map<string, number>();
        for (const qt of uniqueQTokens) {
            const bucket = index.postings.get(qt);
            let df = 0;
            if (bucket) {
                // 只数候选集内的命中
                if (bucket.size <= allowedIds.size) {
                    for (const id of bucket.keys()) {
                        if (allowedIds.has(id)) df++;
                    }
                } else {
                    // 候选集小很多时反向迭代更快
                    for (const id of allowedIds) {
                        if (bucket.has(id)) df++;
                    }
                }
            }
            // BM25 IDF：与 bm25.ts 的公式逐字符一致
            idf.set(qt, Math.log((docCount - df + 0.5) / (df + 0.5) + 1));
        }

        // 评分：仅遍历命中文档（与原实现的 score>0 过滤等价）
        const scores = new Map<string, number>();
        for (const qt of uniqueQTokens) {
            const bucket = index.postings.get(qt);
            if (!bucket) continue;
            const idfQ = idf.get(qt)!;

            for (const [nodeId, tf] of bucket) {
                if (!allowedIds.has(nodeId)) continue;
                const meta = index.docMeta.get(nodeId);
                if (!meta || meta.length === 0) continue;  // 朴素版 dl===0 时 continue

                const tfNorm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * meta.length / avgDl));
                const contrib = idfQ * tfNorm;
                scores.set(nodeId, (scores.get(nodeId) || 0) + contrib);
            }
        }

        const results: BM25IndexedResult[] = [];
        for (const [nodeId, score] of scores) {
            if (score > 0) results.push({ nodeId, score });
        }
        results.sort((a, b) => b.score - a.score);
        return results;
    }

    // ─── 调试/校验 ─────────────────────────────────────

    stats(charId: string): { docCount: number; postings: number; totalTokens: number } | null {
        const idx = this.indices.get(charId);
        if (!idx) return null;
        return {
            docCount: idx.docMeta.size,
            postings: idx.postings.size,
            totalTokens: idx.totalTokens,
        };
    }
}

export const bm25Index = new BM25IndexManager();
