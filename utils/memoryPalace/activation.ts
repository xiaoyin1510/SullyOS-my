/**
 * Memory Palace — 扩散激活 (Spreading Activation)
 *
 * 检索命中的记忆沿关联网络"联想"到相关记忆。
 * 人格风格影响不同关联类型的权重。
 */

import type { MemoryNode, PersonalityStyle, ScoredMemory } from './types';
import { PERSONALITY_WEIGHTS } from './types';
import { MemoryNodeDB, MemoryLinkDB } from './db';

// 注意：EventBox 接管了"同一事件"的强绑定职责后，MemoryLink 退化为"背景联想"。
// 这里把 decay 从 0.5 → 0.3，maxExpand 默认从 5 → 3，让弱关联活着但不主导召回。
const ACTIVATION_DECAY = 0.3;

/**
 * 沿关联网络扩散激活
 *
 * 对每个种子记忆，沿 memory_links 找到邻居，
 * 计算激活值 = seed_score × link_strength × type_weight × decay
 *
 * @param seeds 初始检索命中的记忆（带分数）
 * @param charId 角色 ID
 * @param style 人格风格（影响关联类型权重）
 * @param maxExpand 最多额外扩展的记忆数量
 */
export async function spreadActivation(
    seeds: ScoredMemory[],
    charId: string,
    style: PersonalityStyle = 'emotional',
    maxExpand: number = 3,
): Promise<ScoredMemory[]> {
    const weights = PERSONALITY_WEIGHTS[style];
    const seedIds = new Set(seeds.map(s => s.node.id));
    const activated = new Map<string, number>(); // nodeId → activation score

    // 对每个种子，找到它的邻居并计算激活值
    for (const seed of seeds) {
        const links = await MemoryLinkDB.getByNodeId(seed.node.id);

        for (const link of links) {
            // 确定邻居 ID
            const neighborId = link.sourceId === seed.node.id ? link.targetId : link.sourceId;

            // 跳过已经是种子的
            if (seedIds.has(neighborId)) continue;

            // 计算激活值
            const typeWeight = weights[link.type] || 0.2;
            const activationScore = seed.finalScore * link.strength * typeWeight * ACTIVATION_DECAY;

            // 取最高激活值
            const existing = activated.get(neighborId) || 0;
            if (activationScore > existing) {
                activated.set(neighborId, activationScore);
            }
        }
    }

    // 按激活值排序，取 topN
    const sortedActivations = [...activated.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, maxExpand);

    // 加载被激活的 MemoryNode（跳过 archived —— 它们已被压入 box summary）
    const expandedResults: ScoredMemory[] = [];
    for (const [nodeId, score] of sortedActivations) {
        const node = await MemoryNodeDB.getById(nodeId);
        if (node && !node.archived) {
            expandedResults.push({
                node,
                finalScore: score,
                similarity: 0,
                bm25Score: 0,
                roomScore: score,
            });
        }
    }

    // 合并：seeds + 扩展结果
    return [...seeds, ...expandedResults];
}
