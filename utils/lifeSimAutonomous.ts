/**
 * LifeSim Autonomous Behavior System — 都市版
 * 居民自主行为引擎 — 基于性格/心情/关系生成都市Drama事件，无需LLM调用
 */

import { LifeSimState, SimNPC, SimAction, SimEventType, NPCDesire } from '../types';
import { getNPC, getFamily, getFamilyMembers, getIndependentNPCs, getRelationship, clamp, applyTriggerEvent, deepClone } from './lifeSimEngine';
// evaluateEventChains will be imported when that module is created
// import { evaluateEventChains } from './lifeSimEventChains';

const genId = () => Math.random().toString(36).slice(2, 10);

// ── Desire Generation ──────────────────────────────────────────

/**
 * 根据NPC当前状态更新其内驱力列表
 */
function updateDesires(state: LifeSimState, npc: SimNPC): NPCDesire[] {
    const desires: NPCDesire[] = [];
    const grudges = npc.grudges ?? [];
    const crushes = npc.crushes ?? [];

    // 记仇 + 心情差 → 复仇欲
    if (grudges.length > 0 && npc.mood < 0) {
        for (const targetId of grudges) {
            desires.push({ type: 'revenge', targetNpcId: targetId });
        }
    }

    // 关系好 + 没暗恋对象 → 可能产生暧昧
    if (crushes.length === 0) {
        for (const fam of state.families) {
            if (!fam.memberIds.includes(npc.id)) continue;
            for (const otherId of fam.memberIds) {
                if (otherId === npc.id) continue;
                const rel = getRelationship(fam, npc.id, otherId);
                if (rel > 60 && Math.random() < 0.30) {
                    desires.push({ type: 'romance', targetNpcId: otherId });
                }
            }
        }
    }

    // 心情极差 + 家庭中有讨厌的人 → 想离家
    if (npc.mood < -40 && npc.familyId) {
        const fam = getFamily(state, npc.familyId);
        if (fam) {
            for (const otherId of fam.memberIds) {
                if (otherId === npc.id) continue;
                const rel = getRelationship(fam, npc.id, otherId);
                if (rel < -30) {
                    desires.push({ type: 'leave_family' });
                    break; // 只需要一个 leave_family desire
                }
            }
        }
    }

    // 腹黑/聪明 + 关系差 → 搬弄是非
    const isScheming = npc.personality.some(p => p === '腹黑' || p === '聪明');
    if (isScheming) {
        for (const fam of state.families) {
            if (!fam.memberIds.includes(npc.id)) continue;
            for (const otherId of fam.memberIds) {
                if (otherId === npc.id) continue;
                const rel = getRelationship(fam, npc.id, otherId);
                if (rel < -20 && Math.random() < 0.20) {
                    desires.push({ type: 'gossip_about', targetNpcId: otherId });
                }
            }
        }
    }

    // 热情/活泼 → 社交
    const isSocial = npc.personality.some(p => p === '热情' || p === '活泼');
    if (isSocial && npc.familyId) {
        const fam = getFamily(state, npc.familyId);
        if (fam && fam.memberIds.length > 1 && Math.random() < 0.15) {
            const candidates = fam.memberIds.filter(id => id !== npc.id);
            const targetId = candidates[Math.floor(Math.random() * candidates.length)];
            desires.push({ type: 'socialize', targetNpcId: targetId });
        }
    }

    // 暴躁/冲动 + 心情不好 + 有仇 → 开战
    const isAggressive = npc.personality.some(p => p === '暴躁' || p === '冲动');
    if (isAggressive && npc.mood < -10 && grudges.length > 0 && Math.random() < 0.40) {
        for (const targetId of grudges) {
            desires.push({ type: 'start_rivalry', targetNpcId: targetId });
        }
    }

    return desires;
}

// ── Action Generation ──────────────────────────────────────────

interface WeightedAction {
    weight: number;
    execute: () => { eventType: SimEventType; involvedIds: string[]; description: string } | null;
}

/**
 * 为有欲望的NPC生成加权行动列表
 */
function buildActionCandidates(
    state: LifeSimState,
    npc: SimNPC,
    desires: NPCDesire[]
): WeightedAction[] {
    const candidates: WeightedAction[] = [];

    for (const desire of desires) {
        switch (desire.type) {
            case 'revenge': {
                const target = getNPC(state, desire.targetNpcId);
                if (target) {
                    candidates.push({
                        weight: npc.mood < -20 ? 50 : 25,
                        execute: () => ({
                            eventType: 'fight' as SimEventType,
                            involvedIds: [npc.id, desire.targetNpcId],
                            description: `${npc.emoji}${npc.name}忍无可忍，在公寓群里@了${target.emoji}${target.name}公开撕逼！`,
                        }),
                    });
                }
                break;
            }
            case 'romance': {
                const target = getNPC(state, desire.targetNpcId);
                if (target) {
                    candidates.push({
                        weight: 30,
                        execute: () => ({
                            eventType: 'romance' as SimEventType,
                            involvedIds: [npc.id, desire.targetNpcId],
                            description: `${npc.emoji}${npc.name}在电梯里"偶遇"了${target.emoji}${target.name}，暧昧值直线飙升……`,
                        }),
                    });
                }
                break;
            }
            case 'leave_family':
                candidates.push({
                    weight: npc.mood < -40 ? 20 : 8,
                    execute: () => null, // GO_SOLO 特殊处理
                });
                break;
            case 'gossip_about': {
                const target = getNPC(state, desire.targetNpcId);
                if (target) {
                    candidates.push({
                        weight: 25,
                        execute: () => ({
                            eventType: 'gossip' as SimEventType,
                            involvedIds: [desire.targetNpcId],
                            description: `${npc.emoji}${npc.name}在小群里疯狂输出关于${target.emoji}${target.name}的八卦……`,
                        }),
                    });
                }
                break;
            }
            case 'socialize': {
                const target = getNPC(state, desire.targetNpcId);
                if (target) {
                    candidates.push({
                        weight: 20,
                        execute: () => ({
                            eventType: 'party' as SimEventType,
                            involvedIds: [npc.id, desire.targetNpcId],
                            description: `${npc.emoji}${npc.name}约${target.emoji}${target.name}去楼下酒吧小酌一杯！`,
                        }),
                    });
                }
                break;
            }
            case 'start_rivalry': {
                const target = getNPC(state, desire.targetNpcId);
                if (target) {
                    candidates.push({
                        weight: 25,
                        execute: () => ({
                            eventType: 'rivalry' as SimEventType,
                            involvedIds: [npc.id, desire.targetNpcId],
                            description: `${npc.emoji}${npc.name}在朋友圈阴阳怪气了${target.emoji}${target.name}，公开宣战！`,
                        }),
                    });
                }
                break;
            }
        }
    }

    return candidates;
}

/**
 * 加权随机选择
 */
function weightedRandom<T extends { weight: number }>(items: T[]): T | null {
    if (items.length === 0) return null;
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const item of items) {
        roll -= item.weight;
        if (roll <= 0) return item;
    }
    return items[items.length - 1];
}

/**
 * 当NPC没有匹配的欲望时，生成默认行为
 */
function generateDefaultAction(
    state: LifeSimState,
    npc: SimNPC
): { eventType: SimEventType; involvedIds: string[]; description: string } | null {
    const roll = Math.random();

    // 50% 什么都不做
    if (roll < 0.50) return null;

    // 30% 随机和家庭成员聚会
    if (roll < 0.80 && npc.familyId) {
        const fam = getFamily(state, npc.familyId);
        if (fam && fam.memberIds.length > 1) {
            const others = fam.memberIds.filter(id => id !== npc.id);
            const targetId = others[Math.floor(Math.random() * others.length)];
            const target = getNPC(state, targetId);
            if (target) {
                return {
                    eventType: 'party',
                    involvedIds: [npc.id, targetId],
                    description: `${npc.emoji}${npc.name}叫上${target.emoji}${target.name}一起点外卖追剧~`,
                };
            }
        }
    }

    // 20% 随机八卦
    const allOtherNpcs = state.npcs.filter(n => n.id !== npc.id);
    if (allOtherNpcs.length > 0) {
        const target = allOtherNpcs[Math.floor(Math.random() * allOtherNpcs.length)];
        return {
            eventType: 'gossip',
            involvedIds: [target.id],
            description: `${npc.emoji}${npc.name}在公寓群里聊起了${target.emoji}${target.name}的私事……`,
        };
    }

    return null;
}

// ── Grudge & Crush Update ──────────────────────────────────────

/**
 * 根据事件类型更新NPC的仇恨和暗恋关系
 */
function updateGrudgesAndCrushes(
    state: LifeSimState,
    actorId: string,
    eventType: SimEventType,
    involvedIds: string[]
): void {
    const actor = state.npcs.find(n => n.id === actorId);
    if (!actor) return;

    if (!actor.grudges) actor.grudges = [];
    if (!actor.crushes) actor.crushes = [];

    switch (eventType) {
        case 'fight': {
            // 打架目标加入仇恨列表
            for (const id of involvedIds) {
                if (id !== actorId && !actor.grudges.includes(id)) {
                    actor.grudges.push(id);
                }
                // 被打的人也记仇
                const target = state.npcs.find(n => n.id === id);
                if (target && target.id !== actorId) {
                    if (!target.grudges) target.grudges = [];
                    if (!target.grudges.includes(actorId)) {
                        target.grudges.push(actorId);
                    }
                }
            }
            break;
        }
        case 'romance': {
            // 暧昧目标加入暗恋列表
            for (const id of involvedIds) {
                if (id !== actorId && !actor.crushes.includes(id)) {
                    actor.crushes.push(id);
                }
            }
            break;
        }
        case 'party': {
            // 聚会 → 原谅仇恨 (通过party化解矛盾)
            for (const id of involvedIds) {
                if (id !== actorId) {
                    actor.grudges = actor.grudges.filter(g => g !== id);
                    // 对方也原谅
                    const other = state.npcs.find(n => n.id === id);
                    if (other && other.grudges) {
                        other.grudges = other.grudges.filter(g => g !== actorId);
                    }
                }
            }
            break;
        }
    }
}

// ── Main Autonomous Turn ───────────────────────────────────────

/**
 * 执行一回合NPC自主行为
 * 遍历所有NPC（随机顺序），根据性格/欲望/心情概率性生成事件
 */
export function runAutonomousTurn(state: LifeSimState): {
    newState: LifeSimState;
    events: SimAction[];
} {
    let s = deepClone(state);
    const events: SimAction[] = [];

    // 随机排列NPC顺序
    const shuffledNpcs = [...s.npcs].sort(() => Math.random() - 0.5);

    // 基础行动概率: 25% + chaos/200 (chaos=100时75%)
    const baseProbability = 0.25 + s.chaosLevel / 200;

    for (const npcRef of shuffledNpcs) {
        // 获取最新版NPC（因为前面的NPC行动可能修改了状态）
        const npc = s.npcs.find(n => n.id === npcRef.id);
        if (!npc) continue;

        // Step 1: 更新欲望
        npc.desires = updateDesires(s, npc);

        // Step 2: 掷骰决定是否行动
        if (Math.random() > baseProbability) continue;

        // Step 3: 根据欲望生成行动
        const candidates = buildActionCandidates(s, npc, npc.desires);

        let actionResult: { eventType: SimEventType; involvedIds: string[]; description: string } | null = null;
        let isGoSolo = false;

        if (candidates.length > 0) {
            const chosen = weightedRandom(candidates);
            if (chosen) {
                const result = chosen.execute();
                if (result === null) {
                    // GO_SOLO (leave_family)
                    isGoSolo = true;
                } else {
                    actionResult = result;
                }
            }
        } else {
            // 没有欲望驱动 → 默认行为
            actionResult = generateDefaultAction(s, npc);
        }

        // Step 4: 执行行动
        if (isGoSolo && npc.familyId) {
            // 离家出走
            const oldFamily = getFamily(s, npc.familyId);
            const oldFamilyName = oldFamily?.name ?? '家庭';

            // 从旧家庭移除
            if (oldFamily) {
                oldFamily.memberIds = oldFamily.memberIds.filter(id => id !== npc.id);
                // 清理关系
                delete oldFamily.relationships[npc.id];
                for (const otherId of Object.keys(oldFamily.relationships)) {
                    if (oldFamily.relationships[otherId]) delete oldFamily.relationships[otherId][npc.id];
                }
            }
            npc.familyId = null;

            const action: SimAction = {
                id: genId(),
                turnNumber: s.turnNumber,
                actor: npc.name,
                actorAvatar: npc.emoji,
                actorId: 'autonomous',
                type: 'GO_SOLO',
                description: `${npc.emoji}${npc.name}受够了${oldFamilyName}的室友，连夜搬走了！`,
                immediateResult: `${npc.name}现在独居了。`,
                timestamp: Date.now(),
            };
            s.actionLog.push(action);
            events.push(action);

            s.chaosLevel = clamp(s.chaosLevel + 10, 0, 100);
            npc.mood = clamp(npc.mood + 10); // 离开后稍微舒服一点

        } else if (actionResult) {
            // 正常事件
            const { newState, immediateResult } = applyTriggerEvent(
                s,
                actionResult.eventType,
                actionResult.involvedIds,
                actionResult.description
            );
            s = newState;

            const action: SimAction = {
                id: genId(),
                turnNumber: s.turnNumber,
                actor: npc.name,
                actorAvatar: npc.emoji,
                actorId: 'autonomous',
                type: 'TRIGGER_EVENT',
                description: actionResult.description,
                immediateResult,
                timestamp: Date.now(),
            };
            s.actionLog.push(action);
            events.push(action);

            // Step 5: 更新仇恨/暗恋
            updateGrudgesAndCrushes(s, npc.id, actionResult.eventType, actionResult.involvedIds);
        }
        // else: DO_NOTHING — NPC此回合按兵不动
    }

    return { newState: s, events };
}
