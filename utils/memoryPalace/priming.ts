/**
 * Memory Palace — 启动效应 (Priming) + 反刍 (Rumination)
 *
 * 启动效应：当前情绪偏置检索结果（开心时更容易想起开心的事）
 * 反刍：阁楼里的记忆有概率"不请自来"地浮现
 */

import type { MemoryNode, ScoredMemory } from './types';
import { MemoryNodeDB } from './db';
import { getEmotionVA, moodToVA, emotionDistance } from './emotionSpace';

/** 距离为 0 时的最大加成；距离 >= PRIMING_RADIUS 时不加成 */
const PRIMING_MAX_BOOST = 1.3;
/** 视作"情感相关"的距离阈值。范围粗略 0 ~ 2.83，0.5 覆盖约 1/4 情感平面 */
const PRIMING_RADIUS = 0.5;

/**
 * 启动效应：当前情绪匹配的记忆提升分数
 *
 * 升级后使用 Russell 情感空间的二维距离，而非字符串精确匹配。
 * 好处：'happy' 角色能唤起 'grateful' / 'excited' 等邻近情绪的记忆，
 * 不再卡 LLM 刚好用同一个词。
 *
 * 距离衰减：线性。距离 0 → ×1.3；距离 = RADIUS → ×1.0。
 *
 * @param results 候选记忆
 * @param currentMood 角色当前情绪字符串（通过 moodToVA 转为坐标），
 *                    或直接传入 { v, a } 坐标对象。
 */
export function applyPriming(
    results: ScoredMemory[],
    currentMood: string | { v: number; a: number } | undefined,
): ScoredMemory[] {
    if (!currentMood) return results;

    const cur = typeof currentMood === 'string' ? moodToVA(currentMood) : currentMood;
    // 坐标在原点（neutral）就不做加成，避免全局抬分
    if (cur.v === 0 && cur.a === 0) return results;

    return results.map(r => {
        const memVA = getEmotionVA(r.node);
        const dist = emotionDistance(memVA, cur);
        if (dist >= PRIMING_RADIUS) return r;
        // 距离 0 → 满加成；距离 = RADIUS → 无加成
        const boost = 1 + (PRIMING_MAX_BOOST - 1) * (1 - dist / PRIMING_RADIUS);
        return { ...r, finalScore: r.finalScore * boost };
    });
}

/**
 * 反刍检查：阁楼记忆有概率随机浮现
 *
 * 反刍概率 = tendency × 0.2（最高 20%）
 *
 * @param charId 角色 ID
 * @param tendency 反刍倾向 0-1，默认 0.3
 * @returns 一条随机阁楼记忆，或 null
 */
export async function checkRumination(
    charId: string,
    tendency: number = 0.3,
): Promise<MemoryNode | null> {
    const probability = Math.min(tendency, 1) * 0.2;

    if (Math.random() > probability) return null;

    // 从阁楼随机取一条
    const atticNodes = await MemoryNodeDB.getByRoom(charId, 'attic');
    if (atticNodes.length === 0) return null;

    const randomIndex = Math.floor(Math.random() * atticNodes.length);
    return atticNodes[randomIndex];
}
