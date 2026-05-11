/**
 * Memory Palace — 向量化 + 存储 + 去重
 *
 * 将提取出的 MemoryNode 批量向量化，
 * 与已有向量做去重（余弦 > 0.9 跳过），
 * 然后存入 memory_nodes 和 memory_vectors。
 */

import type { EmbeddingConfig, MemoryNode, MemoryVector, RemoteVectorConfig } from './types';
import { MemoryNodeDB, MemoryVectorDB, ensureFloat32 } from './db';
import { getEmbeddings, cosineSimilarity } from './embedding';
import { upsertVector as remoteUpsert } from './supabaseVector';

const DEDUP_THRESHOLD = 0.9;

/**
 * 向量化并存储记忆节点
 *
 * 流程：
 * 1. 批量向量化 nodes 的 content
 * 2. 与已有向量做去重（cosine > 0.9 的跳过）
 * 3. 保存 MemoryNode (embedded=true) + MemoryVector
 *
 * skipDedup 保留给那些"入口就保证不会重"的路径用（比如 EventBox 压缩后写回
 * summary 节点 —— summary 是 LLM 新合成的唯一结果，不会和已有记忆撞）。
 * 迁移路径**不要**传 skipDedup —— 语义去重能挡掉 sub-batch 之间对同一件事的
 * 重复提取（比如"7-12 号某天回忆起 3 号那件事"）。
 */
export async function vectorizeAndStore(
    nodes: MemoryNode[],
    embeddingConfig: EmbeddingConfig,
    remoteVectorConfig?: RemoteVectorConfig,
    options: { skipDedup?: boolean } = {},
): Promise<{ stored: number; skipped: number }> {
    if (nodes.length === 0) return { stored: 0, skipped: 0 };

    // 1. 批量向量化
    const texts = nodes.map(n => n.content);
    const vectors = await getEmbeddings(texts, embeddingConfig);

    // 2. 加载已有向量用于去重（EventBox summary / 迁移等场景跳过）
    const charId = nodes[0].charId;
    const existingVectors = options.skipDedup ? [] : await MemoryVectorDB.getAllByCharId(charId);

    let stored = 0;
    let skipped = 0;

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const vector = vectors[i];

        // 去重检查 — ensureFloat32 兼容三种存储形态（number[] / Float32Array
        // / Uint8Array），同时保护 cosineSimilarity 不被 Uint8Array 误读字节当数。
        const queryF32 = ensureFloat32(vector);
        const isDuplicate = !options.skipDedup && existingVectors.some(
            ev => cosineSimilarity(queryF32, ensureFloat32(ev.vector)) > DEDUP_THRESHOLD
        );

        if (isDuplicate) {
            console.log(`♻️ [VectorStore] Skipping duplicate memory: "${node.content.slice(0, 30)}..."`);
            skipped++;
            continue;
        }

        // 3. 保存
        node.embedded = true;
        await MemoryNodeDB.save(node);

        const memoryVector: MemoryVector = {
            memoryId: node.id,
            charId: node.charId,
            vector,
            dimensions: embeddingConfig.dimensions,
            model: embeddingConfig.model,
        };
        await MemoryVectorDB.save(memoryVector);

        // 同步写入远程（fire-and-forget，不阻塞本地流程）
        if (remoteVectorConfig?.enabled && remoteVectorConfig.initialized) {
            remoteUpsert(remoteVectorConfig, node.id, node.charId, vector, node, embeddingConfig.dimensions, embeddingConfig.model).catch(() => {});
        }

        // 将新向量也加入已有列表，后续去重时可以检测同批次内的重复
        existingVectors.push(memoryVector);

        stored++;
    }

    console.log(`✅ [VectorStore] Stored ${stored}, skipped ${skipped} duplicates`);
    return { stored, skipped };
}

/**
 * 检测当前 embedding 模型是否与已有向量的模型一致。
 * 如果不一致，说明用户换了模型，需要重新向量化。
 *
 * @returns 'match' | 'mismatch' | 'empty' (无已有向量)
 */
export async function checkModelConsistency(
    charId: string,
    currentModel: string,
): Promise<'match' | 'mismatch' | 'empty'> {
    const existing = await MemoryVectorDB.getAllByCharId(charId);
    if (existing.length === 0) return 'empty';

    // 取第一条有 model 字段的向量做比对（旧数据可能没有 model 字段）
    const sample = existing.find(v => v.model);
    if (!sample) return 'match'; // 旧数据无 model 字段，不触发重建，兼容过渡

    return sample.model === currentModel ? 'match' : 'mismatch';
}

/**
 * 重新向量化：用新模型重新 embedding 所有已有记忆。
 * 保留 MemoryNode 不动，只替换 MemoryVector。
 */
export async function rebuildAllVectors(
    charId: string,
    embeddingConfig: EmbeddingConfig,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<{ rebuilt: number }> {
    const nodes = await MemoryNodeDB.getByCharId(charId);
    const embeddedNodes = nodes.filter(n => n.embedded);

    if (embeddedNodes.length === 0) return { rebuilt: 0 };

    console.log(`🔄 [VectorStore] 开始重建 ${embeddedNodes.length} 条向量（${embeddingConfig.model}）...`);

    // 批量 embedding
    const texts = embeddedNodes.map(n => n.content);
    const vectors = await getEmbeddings(texts, embeddingConfig);

    // 逐条替换
    for (let i = 0; i < embeddedNodes.length; i++) {
        const mv: MemoryVector = {
            memoryId: embeddedNodes[i].id,
            charId,
            vector: vectors[i],
            dimensions: embeddingConfig.dimensions,
            model: embeddingConfig.model,
        };
        await MemoryVectorDB.save(mv);

        // 同步到远程
        if (remoteVectorConfig?.enabled && remoteVectorConfig.initialized) {
            remoteUpsert(remoteVectorConfig, embeddedNodes[i].id, charId, vectors[i], embeddedNodes[i], embeddingConfig.dimensions, embeddingConfig.model).catch(() => {});
        }
    }

    console.log(`✅ [VectorStore] 重建完成：${embeddedNodes.length} 条向量已更新为 ${embeddingConfig.model}`);
    return { rebuilt: embeddedNodes.length };
}
