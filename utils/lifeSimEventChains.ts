/**
 * LifeSim Event Chain System — 事件连锁引擎
 *
 * When an event (fight, romance, gossip …) fires, this module evaluates a
 * table of chain rules to decide whether delayed follow-up effects should
 * be spawned.  The chaos level acts as a drama amplifier: higher chaos makes
 * negative chain events more likely and positive ones less likely.
 */

import {
    LifeSimState, SimNPC, SimEventType, SimEffectCode, SimPendingEffect
} from '../types';

import {
    getNPC, getFamily, getFamilyMembers, clamp, getRelationship
} from './lifeSimEngine';

// ── helpers ────────────────────────────────────────────────────

const genId = () => Math.random().toString(36).slice(2, 10);

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Positive-leaning effect codes (get suppressed by high chaos). */
const POSITIVE_EFFECTS: SimEffectCode[] = ['reconciliation', 'romantic_confession'];

export function getChaosMultiplier(chaosLevel: number): number {
    // At chaos 0: 1.0×, at chaos 50: 1.5×, at chaos 100: 2.0×
    return 1 + chaosLevel / 100;
}

// ── ChainRule interface ────────────────────────────────────────

interface ChainRule {
    trigger: SimEventType | SimEffectCode;
    conditions: (state: LifeSimState, involvedNpcIds: string[], triggerEffect?: SimPendingEffect) => boolean;
    probability: number; // 0-1
    spawn: SimEffectCode;
    delayTurns: [number, number]; // [min, max]
    severityDelta: number; // +1 = escalation
    buildDescription: (state: LifeSimState, involvedNpcIds: string[]) => string;
    selectInvolved?: (state: LifeSimState, involvedNpcIds: string[]) => string[];
}

// ── helper predicates used across rules ────────────────────────

function hasPersonality(npc: SimNPC | undefined, ...traits: string[]): boolean {
    if (!npc) return false;
    return npc.personality.some(p => traits.includes(p));
}

/** Return the SimFamily that contains *both* NPCs, or undefined. */
function sharedFamily(state: LifeSimState, a: string, b: string) {
    const npcA = getNPC(state, a);
    const npcB = getNPC(state, b);
    if (!npcA?.familyId || !npcB?.familyId) return undefined;
    if (npcA.familyId !== npcB.familyId) return undefined;
    return getFamily(state, npcA.familyId);
}

function areDifferentFamilies(state: LifeSimState, ids: string[]): boolean {
    const familyIds = new Set<string>();
    for (const id of ids) {
        const npc = getNPC(state, id);
        if (npc?.familyId) familyIds.add(npc.familyId);
    }
    return familyIds.size > 1;
}

function npcName(state: LifeSimState, id: string): string {
    return getNPC(state, id)?.name ?? '???';
}

// ── the 25 chain rules ────────────────────────────────────────

const CHAIN_RULES: ChainRule[] = [
    // ============================
    // From fight (rules 1-4)
    // ============================

    // 1. fight → revenge_plot (60% if relationship < -20 after fight)
    {
        trigger: 'fight',
        probability: 0.6,
        spawn: 'revenge_plot',
        delayTurns: [2, 4],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            const fam = sharedFamily(state, ids[0], ids[1]);
            if (fam) {
                return getRelationship(fam, ids[0], ids[1]) < -20;
            }
            // Different families — check both directions
            for (const id of ids) {
                const npc = getNPC(state, id);
                if (!npc?.familyId) continue;
                const f = getFamily(state, npc.familyId);
                if (!f) continue;
                for (const otherId of ids) {
                    if (otherId === id) continue;
                    if (getRelationship(f, id, otherId) < -20) return true;
                }
            }
            return false;
        },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 对 ${npcName(state, ids[1])} 暗自策划复仇……`;
        },
    },

    // 2. fight → reconciliation (20% if both NPCs are 善良 or 温柔)
    {
        trigger: 'fight',
        probability: 0.2,
        spawn: 'reconciliation',
        delayTurns: [2, 4],
        severityDelta: -1,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            const a = getNPC(state, ids[0]);
            const b = getNPC(state, ids[1]);
            return hasPersonality(a, '善良', '温柔') && hasPersonality(b, '善良', '温柔');
        },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 与 ${npcName(state, ids[1])} 可能冰释前嫌`;
        },
    },

    // 3. fight → gossip_wildfire (40% if witnesses in same family with 3+ members)
    {
        trigger: 'fight',
        probability: 0.4,
        spawn: 'gossip_wildfire',
        delayTurns: [1, 2],
        severityDelta: 0,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            const npc = getNPC(state, ids[0]);
            if (!npc?.familyId) return false;
            const members = getFamilyMembers(state, npc.familyId);
            return members.length >= 3;
        },
        buildDescription(state, ids) {
            return `吵架被目击！八卦开始在家族里传播……`;
        },
        selectInvolved(state, ids) {
            // All family members who witnessed (same family)
            const npc = getNPC(state, ids[0]);
            if (!npc?.familyId) return ids;
            return getFamilyMembers(state, npc.familyId).map(n => n.id);
        },
    },

    // 4. fight → family_feud (30% if from different families AND chaos > 40)
    {
        trigger: 'fight',
        probability: 0.3,
        spawn: 'family_feud',
        delayTurns: [2, 5],
        severityDelta: 2,
        conditions(state, ids) {
            return areDifferentFamilies(state, ids) && state.chaosLevel > 40;
        },
        buildDescription(state, ids) {
            return `跨家族冲突升级为家族世仇的苗头……`;
        },
    },

    // ============================
    // From romance (rules 5-7)
    // ============================

    // 5. romance → jealousy_spiral (50% if either NPC has a crush who isn't the romance partner)
    {
        trigger: 'romance',
        probability: 0.5,
        spawn: 'jealousy_spiral',
        delayTurns: [1, 3],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            for (const id of ids) {
                const npc = getNPC(state, id);
                if (!npc?.crushes) continue;
                const otherIds = ids.filter(x => x !== id);
                if (npc.crushes.some(c => !otherIds.includes(c))) return true;
            }
            return false;
        },
        buildDescription(state, ids) {
            return `有人暗自嫉妒 ${npcName(state, ids[0])} 和 ${npcName(state, ids[1])} 的暧昧关系……`;
        },
    },

    // 6. romance → love_triangle (35% if third NPC has crush on either romantic partner)
    {
        trigger: 'romance',
        probability: 0.35,
        spawn: 'love_triangle',
        delayTurns: [2, 4],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            return state.npcs.some(npc =>
                !ids.includes(npc.id) &&
                npc.crushes?.some(c => ids.includes(c))
            );
        },
        buildDescription(state, ids) {
            const third = state.npcs.find(npc =>
                !ids.includes(npc.id) &&
                npc.crushes?.some(c => ids.includes(c))
            );
            return `${third?.name ?? '某人'} 对这段暧昧心生不满，三角关系形成！`;
        },
        selectInvolved(state, ids) {
            const third = state.npcs.find(npc =>
                !ids.includes(npc.id) &&
                npc.crushes?.some(c => ids.includes(c))
            );
            return third ? [...ids, third.id] : ids;
        },
    },

    // 7. romance → romantic_confession (40% if relationship > 50 after romance, delay 3-5)
    {
        trigger: 'romance',
        probability: 0.4,
        spawn: 'romantic_confession',
        delayTurns: [3, 5],
        severityDelta: 0,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            const fam = sharedFamily(state, ids[0], ids[1]);
            if (fam) return getRelationship(fam, ids[0], ids[1]) > 50;
            // Check across all families
            for (const id of ids) {
                const npc = getNPC(state, id);
                if (!npc?.familyId) continue;
                const f = getFamily(state, npc.familyId);
                if (!f) continue;
                for (const otherId of ids) {
                    if (otherId === id) continue;
                    if (getRelationship(f, id, otherId) > 50) return true;
                }
            }
            return false;
        },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 鼓起勇气准备向 ${npcName(state, ids[1])} 告白……`;
        },
    },

    // ============================
    // From gossip (rules 8-10)
    // ============================

    // 8. gossip → gossip_wildfire (70%, gossip spreads)
    {
        trigger: 'gossip',
        probability: 0.7,
        spawn: 'gossip_wildfire',
        delayTurns: [1, 2],
        severityDelta: 0,
        conditions() { return true; },
        buildDescription(_state, _ids) {
            return `八卦像野火一样蔓延开来……`;
        },
    },

    // 9. gossip → fight_break (30% if target NPC is 暴躁 or 直率)
    {
        trigger: 'gossip',
        probability: 0.3,
        spawn: 'fight_break',
        delayTurns: [1, 3],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 1) return false;
            // Treat last NPC as the gossip target
            const target = getNPC(state, ids[ids.length - 1]);
            return hasPersonality(target, '暴躁', '直率');
        },
        buildDescription(state, ids) {
            const target = npcName(state, ids[ids.length - 1]);
            return `${target} 听到八卦后暴怒，矛盾即将爆发！`;
        },
    },

    // 10. gossip → mood_breakdown (25% if target NPC mood < -20)
    {
        trigger: 'gossip',
        probability: 0.25,
        spawn: 'mood_breakdown',
        delayTurns: [1, 2],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 1) return false;
            const target = getNPC(state, ids[ids.length - 1]);
            return (target?.mood ?? 0) < -20;
        },
        buildDescription(state, ids) {
            const target = npcName(state, ids[ids.length - 1]);
            return `${target} 因为流言蜚语情绪崩溃了……`;
        },
    },

    // ============================
    // From alliance (rules 11-12)
    // ============================

    // 11. alliance → power_shift (40% if from different families, delay 3-4)
    {
        trigger: 'alliance',
        probability: 0.4,
        spawn: 'power_shift',
        delayTurns: [3, 4],
        severityDelta: 1,
        conditions(state, ids) {
            return areDifferentFamilies(state, ids);
        },
        buildDescription(state, ids) {
            return `跨家族联盟正在酝酿一场权力格局的变化……`;
        },
    },

    // 12. alliance → secret_alliance (30% if both are 腹黑 or 聪明)
    {
        trigger: 'alliance',
        probability: 0.3,
        spawn: 'secret_alliance',
        delayTurns: [2, 3],
        severityDelta: 0,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            const a = getNPC(state, ids[0]);
            const b = getNPC(state, ids[1]);
            return hasPersonality(a, '腹黑', '聪明') && hasPersonality(b, '腹黑', '聪明');
        },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 和 ${npcName(state, ids[1])} 悄然结成秘密同盟……`;
        },
    },

    // ============================
    // From rivalry (rules 13-14)
    // ============================

    // 13. rivalry → fight_break (50%, delay 2-3)
    {
        trigger: 'rivalry',
        probability: 0.5,
        spawn: 'fight_break',
        delayTurns: [2, 3],
        severityDelta: 1,
        conditions() { return true; },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 和 ${npcName(state, ids[1])} 的竞争逐渐白热化，冲突一触即发！`;
        },
    },

    // 14. rivalry → betrayal (25% if one rival has a friend (rel > 40) of the other rival)
    {
        trigger: 'rivalry',
        probability: 0.25,
        spawn: 'betrayal',
        delayTurns: [2, 4],
        severityDelta: 2,
        conditions(state, ids) {
            if (ids.length < 2) return false;
            // Check if any NPC is friends (rel > 40) with both rivals
            for (const fam of state.families) {
                for (const memberId of fam.memberIds) {
                    if (ids.includes(memberId)) continue;
                    const relA = getRelationship(fam, memberId, ids[0]);
                    const relB = getRelationship(fam, memberId, ids[1]);
                    // Friend of one rival (> 40) while also knowing the other
                    if ((relA > 40 && fam.memberIds.includes(ids[1])) ||
                        (relB > 40 && fam.memberIds.includes(ids[0]))) {
                        return true;
                    }
                }
            }
            return false;
        },
        buildDescription(state, ids) {
            return `竞争中有人意图背叛，局势变得更加复杂……`;
        },
    },

    // ============================
    // From party (rules 15-16)
    // ============================

    // 15. party → romance (30% if any two attendees have rel > 30, delay 1-2)
    {
        trigger: 'party',
        probability: 0.3,
        spawn: 'romantic_confession',
        delayTurns: [1, 2],
        severityDelta: 0,
        conditions(state, ids) {
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const fam = sharedFamily(state, ids[i], ids[j]);
                    if (fam && getRelationship(fam, ids[i], ids[j]) > 30) return true;
                }
            }
            return false;
        },
        buildDescription(state, ids) {
            // Find the pair
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const fam = sharedFamily(state, ids[i], ids[j]);
                    if (fam && getRelationship(fam, ids[i], ids[j]) > 30) {
                        return `聚会上 ${npcName(state, ids[i])} 和 ${npcName(state, ids[j])} 擦出了火花……`;
                    }
                }
            }
            return `聚会上有人暗生情愫……`;
        },
        selectInvolved(state, ids) {
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const fam = sharedFamily(state, ids[i], ids[j]);
                    if (fam && getRelationship(fam, ids[i], ids[j]) > 30) {
                        return [ids[i], ids[j]];
                    }
                }
            }
            return ids.slice(0, 2);
        },
    },

    // 16. party → reconciliation (40% if any two attendees have negative rel, chaos < 40)
    {
        trigger: 'party',
        probability: 0.4,
        spawn: 'reconciliation',
        delayTurns: [1, 3],
        severityDelta: -1,
        conditions(state, ids) {
            if (state.chaosLevel >= 40) return false;
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const fam = sharedFamily(state, ids[i], ids[j]);
                    if (fam && getRelationship(fam, ids[i], ids[j]) < 0) return true;
                }
            }
            return false;
        },
        buildDescription(state, ids) {
            return `聚会的温馨气氛让某些冤家有了和解的可能……`;
        },
        selectInvolved(state, ids) {
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const fam = sharedFamily(state, ids[i], ids[j]);
                    if (fam && getRelationship(fam, ids[i], ids[j]) < 0) {
                        return [ids[i], ids[j]];
                    }
                }
            }
            return ids.slice(0, 2);
        },
    },

    // ============================
    // Chain effects (rules 17-25)
    // ============================

    // 17. revenge_plot → family_feud (40% if revenge crosses family lines)
    {
        trigger: 'revenge_plot',
        probability: 0.4,
        spawn: 'family_feud',
        delayTurns: [2, 4],
        severityDelta: 1,
        conditions(state, ids) {
            return areDifferentFamilies(state, ids);
        },
        buildDescription(_state, _ids) {
            return `复仇计划牵连到不同家族，世仇即将形成……`;
        },
    },

    // 18. revenge_plot → fight_break (60%, direct confrontation)
    {
        trigger: 'revenge_plot',
        probability: 0.6,
        spawn: 'fight_break',
        delayTurns: [1, 3],
        severityDelta: 1,
        conditions() { return true; },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 的复仇行动正式爆发！`;
        },
    },

    // 19. love_triangle → betrayal (40%, delay 2-3)
    {
        trigger: 'love_triangle',
        probability: 0.4,
        spawn: 'betrayal',
        delayTurns: [2, 3],
        severityDelta: 1,
        conditions() { return true; },
        buildDescription(_state, _ids) {
            return `三角恋中有人选择了背叛……`;
        },
    },

    // 20. love_triangle → romantic_confession (30%, one suitor confesses)
    {
        trigger: 'love_triangle',
        probability: 0.3,
        spawn: 'romantic_confession',
        delayTurns: [2, 4],
        severityDelta: 0,
        conditions() { return true; },
        buildDescription(state, ids) {
            if (ids.length >= 2) {
                return `${npcName(state, ids[0])} 决定不再犹豫，准备正式告白！`;
            }
            return `三角恋中有人决定正式告白！`;
        },
        selectInvolved(_state, ids) {
            // Pick the first two as confessor and target
            return ids.slice(0, 2);
        },
    },

    // 21. jealousy_spiral → gossip_wildfire (50%)
    {
        trigger: 'jealousy_spiral',
        probability: 0.5,
        spawn: 'gossip_wildfire',
        delayTurns: [1, 2],
        severityDelta: 0,
        conditions() { return true; },
        buildDescription(_state, _ids) {
            return `嫉妒化为八卦，流言开始四处传播……`;
        },
    },

    // 22. jealousy_spiral → fight_break (35% if jealous NPC is 暴躁 or 冲动)
    {
        trigger: 'jealousy_spiral',
        probability: 0.35,
        spawn: 'fight_break',
        delayTurns: [1, 3],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 1) return false;
            const npc = getNPC(state, ids[0]);
            return hasPersonality(npc, '暴躁', '冲动');
        },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 因嫉妒失控，冲突爆发！`;
        },
    },

    // 23. family_feud → npc_runaway (30%, weakest-mood NPC flees)
    {
        trigger: 'family_feud',
        probability: 0.3,
        spawn: 'npc_runaway',
        delayTurns: [2, 4],
        severityDelta: 1,
        conditions() { return true; },
        buildDescription(state, ids) {
            const weakest = findWeakestMoodNPC(state, ids);
            const name = weakest ? weakest.name : '某人';
            return `家族纷争让 ${name} 不堪重负，萌生出走念头……`;
        },
        selectInvolved(state, ids) {
            const weakest = findWeakestMoodNPC(state, ids);
            return weakest ? [weakest.id] : ids.slice(0, 1);
        },
    },

    // 24. betrayal → revenge_plot (55%, the betrayed plots revenge)
    {
        trigger: 'betrayal',
        probability: 0.55,
        spawn: 'revenge_plot',
        delayTurns: [2, 4],
        severityDelta: 1,
        conditions() { return true; },
        buildDescription(state, ids) {
            if (ids.length >= 1) {
                return `被背叛的 ${npcName(state, ids[0])} 开始谋划复仇……`;
            }
            return `被背叛者开始谋划复仇……`;
        },
    },

    // 25. mood_breakdown → npc_runaway (40% if mood < -60)
    {
        trigger: 'mood_breakdown',
        probability: 0.4,
        spawn: 'npc_runaway',
        delayTurns: [1, 2],
        severityDelta: 1,
        conditions(state, ids) {
            if (ids.length < 1) return false;
            const npc = getNPC(state, ids[0]);
            return (npc?.mood ?? 0) < -60;
        },
        buildDescription(state, ids) {
            return `${npcName(state, ids[0])} 情绪彻底崩溃，决定离家出走！`;
        },
        selectInvolved(_state, ids) {
            return ids.slice(0, 1);
        },
    },
];

// ── internal helpers ───────────────────────────────────────────

function findWeakestMoodNPC(state: LifeSimState, ids: string[]): SimNPC | undefined {
    let weakest: SimNPC | undefined;
    let lowestMood = Infinity;
    for (const id of ids) {
        const npc = getNPC(state, id);
        if (npc && npc.mood < lowestMood) {
            lowestMood = npc.mood;
            weakest = npc;
        }
    }
    return weakest;
}

// ── main exported evaluator ────────────────────────────────────

/**
 * Evaluate all chain rules against a just-fired event / effect.
 *
 * @param state          Current simulation state
 * @param triggerType    The event or effect code that just happened
 * @param involvedNpcIds NPC IDs involved in the triggering event
 * @param triggerEffect  The pending effect that triggered this (if any)
 * @returns Array of new SimPendingEffect to push into state.pendingEffects
 */
export function evaluateEventChains(
    state: LifeSimState,
    triggerType: SimEventType | SimEffectCode,
    involvedNpcIds: string[],
    triggerEffect?: SimPendingEffect
): SimPendingEffect[] {
    const results: SimPendingEffect[] = [];

    for (const rule of CHAIN_RULES) {
        // 1. Match trigger
        if (rule.trigger !== triggerType) continue;

        // 2. Check conditions
        if (!rule.conditions(state, involvedNpcIds, triggerEffect)) continue;

        // 3. Adjust probability by chaos
        let adjustedProb = rule.probability;
        if (POSITIVE_EFFECTS.includes(rule.spawn)) {
            // Positive events become less likely as chaos rises
            adjustedProb *= (1 - state.chaosLevel / 200);
        } else {
            // Negative / neutral events become more likely as chaos rises
            adjustedProb *= getChaosMultiplier(state.chaosLevel);
        }
        // Clamp to [0, 1]
        adjustedProb = Math.min(1, Math.max(0, adjustedProb));

        // 4. Roll dice
        if (Math.random() >= adjustedProb) continue;

        // 5. Build effect
        const delay = randInt(rule.delayTurns[0], rule.delayTurns[1]);
        const baseSeverity = triggerEffect?.severity ?? 1;
        const severity = clamp(baseSeverity + rule.severityDelta, 1, 5);
        const involved = rule.selectInvolved
            ? rule.selectInvolved(state, involvedNpcIds)
            : [...involvedNpcIds];

        const effect: SimPendingEffect = {
            id: genId(),
            triggerTurn: state.turnNumber + delay,
            description: rule.buildDescription(state, involvedNpcIds),
            effectCode: rule.spawn,
            severity,
            involvedNpcIds: involved,
            chainFrom: triggerEffect?.id,
        };

        // Assign npcId / familyId for convenience if we can
        if (involved.length === 1) {
            effect.npcId = involved[0];
        }
        if (involved.length >= 1) {
            const firstNpc = getNPC(state, involved[0]);
            if (firstNpc?.familyId) {
                effect.familyId = firstNpc.familyId;
            }
        }

        results.push(effect);
    }

    return results;
}
