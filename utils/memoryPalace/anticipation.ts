/**
 * Memory Palace — 期盼生命周期 (Anticipation Lifecycle)
 *
 * 窗台上的期盼经历以下状态流转：
 * - active → 7 天后变成 anchor（人生锚点）
 * - fulfilled → 转化为卧室的温暖记忆
 * - disappointed → 沉入阁楼成为未解心结
 */

import type { Anticipation, MemoryNode } from './types';
import { AnticipationDB, MemoryNodeDB } from './db';

const ANCHOR_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function generateId(): string {
    return `mn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 处理期盼生命周期
 *
 * 定期调用（建议每次聊天后或每小时调用一次）
 * - active 且 age > 7 天 → 变为 anchor
 */
export async function processAnticipationLifecycle(charId: string): Promise<void> {
    const now = Date.now();
    const activeAnts = await AnticipationDB.getByStatus(charId, 'active');

    for (const ant of activeAnts) {
        if (now - ant.createdAt >= ANCHOR_THRESHOLD_MS) {
            ant.status = 'anchor';
            ant.anchoredAt = now;
            await AnticipationDB.save(ant);
            console.log(`🔒 [Anticipation] Anchored: "${ant.content.slice(0, 30)}..."`);
        }
    }
}

/**
 * 标记期盼为已实现 → 转化为卧室温暖记忆
 */
export async function fulfillAnticipation(id: string): Promise<void> {
    const ant = await AnticipationDB.getById(id);
    if (!ant) return;

    ant.status = 'fulfilled';
    ant.resolvedAt = Date.now();
    await AnticipationDB.save(ant);

    // 创建一条温暖的卧室记忆
    const warmMemory: MemoryNode = {
        id: generateId(),
        charId: ant.charId,
        content: `我曾经期盼的事情实现了：${ant.content}`,
        room: 'bedroom',
        tags: ['期盼实现', '温暖'],
        importance: 7,
        mood: 'grateful',
        embedded: false, // 等后续向量化
        boxId: '',
        boxTopic: '期盼实现',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
    };

    await MemoryNodeDB.save(warmMemory);
    console.log(`✨ [Anticipation] Fulfilled → bedroom: "${ant.content.slice(0, 30)}..."`);
}

/**
 * 标记期盼为落空 → 沉入阁楼
 */
export async function disappointAnticipation(id: string): Promise<void> {
    const ant = await AnticipationDB.getById(id);
    if (!ant) return;

    ant.status = 'disappointed';
    ant.resolvedAt = Date.now();
    await AnticipationDB.save(ant);

    // 创建一条阁楼记忆（未解心结）
    const heartknot: MemoryNode = {
        id: generateId(),
        charId: ant.charId,
        content: `我曾经期盼但最终落空了：${ant.content}`,
        room: 'attic',
        tags: ['期盼落空', '遗憾'],
        importance: 6,
        mood: 'sad',
        embedded: false,
        boxId: '',
        boxTopic: '期盼落空',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
    };

    await MemoryNodeDB.save(heartknot);
    console.log(`💔 [Anticipation] Disappointed → attic: "${ant.content.slice(0, 30)}..."`);
}

/**
 * 创建新期盼
 */
export async function createAnticipation(charId: string, content: string): Promise<Anticipation> {
    const ant: Anticipation = {
        id: `ant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        charId,
        content,
        status: 'active',
        createdAt: Date.now(),
        anchoredAt: null,
        resolvedAt: null,
    };

    await AnticipationDB.save(ant);
    console.log(`🌟 [Anticipation] Created: "${content.slice(0, 30)}..."`);
    return ant;
}
