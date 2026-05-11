/**
 * RelationsTab — NPC关系列表 (retro style)
 */

import React from 'react';
import { LifeSimState } from '../../types';
import { getRelLabel } from '../../utils/lifeSimEngine';
import { NPCAvatar, IconFlame, IconCrush } from '../../utils/styledIcons';

const RelationsTab: React.FC<{ gameState: LifeSimState }> = ({ gameState }) => {
    const { npcs, families } = gameState;
    if (npcs.length < 2) return (
        <div className="flex items-center justify-center p-8" style={{ color: '#999', fontSize: 12 }}>
            至少需要2个居民才能看关系
        </div>
    );

    const getRelVal = (aId: string, bId: string): number => {
        for (const fam of families) {
            if (fam.memberIds.includes(aId) && fam.memberIds.includes(bId)) {
                return fam.relationships?.[aId]?.[bId] ?? 0;
            }
        }
        return 0;
    };

    const pairs: { a: typeof npcs[0]; b: typeof npcs[0]; val: number }[] = [];
    for (let i = 0; i < npcs.length; i++) {
        for (let j = i + 1; j < npcs.length; j++) {
            const val = getRelVal(npcs[i].id, npcs[j].id);
            pairs.push({ a: npcs[i], b: npcs[j], val });
        }
    }
    pairs.sort((x, y) => Math.abs(y.val) - Math.abs(x.val));

    return (
        <div style={{ padding: 6 }} className="space-y-1">
            {pairs.map(({ a, b, val }) => {
                const { label, color } = getRelLabel(val);
                const isGrudge = (a.grudges ?? []).includes(b.id) || (b.grudges ?? []).includes(a.id);
                const isCrush = (a.crushes ?? []).includes(b.id) || (b.crushes ?? []).includes(a.id);
                const barWidth = Math.abs(val);
                const barColor = val > 0 ? '#5b9b6b' : '#b85050';

                return (
                    <div key={`${a.id}-${b.id}`} className="flex items-center gap-1.5" style={{
                        background: 'rgba(255,255,255,0.5)',
                        border: '1px solid rgba(0,0,0,0.06)',
                        borderRadius: 4,
                        padding: '4px 8px',
                    }}>
                        {/* NPC A */}
                        <div className="flex items-center gap-1 flex-shrink-0" style={{ minWidth: 0 }}>
                            <NPCAvatar name={a.name} size={14} className="rounded" />
                            <span style={{ fontSize: 9, color: '#555', fontWeight: 600, maxWidth: 44 }} className="truncate">{a.name}</span>
                        </div>

                        {/* Relation bar */}
                        <div className="flex-1 flex items-center gap-1">
                            <div className="flex-1 relative" style={{
                                height: 5, background: 'rgba(0,0,0,0.06)',
                                borderRadius: 2, border: '1px solid rgba(0,0,0,0.06)',
                                overflow: 'hidden',
                            }}>
                                <div className="absolute top-0 h-full transition-all duration-300" style={{
                                    width: `${barWidth}%`,
                                    background: barColor,
                                    left: val >= 0 ? '50%' : `${50 - barWidth}%`,
                                    ...(val >= 0 ? {} : { right: '50%', left: 'auto' }),
                                    borderRadius: 1,
                                }} />
                                <div className="absolute top-0 left-1/2 w-px h-full" style={{ background: 'rgba(0,0,0,0.15)' }} />
                            </div>
                        </div>

                        {/* Label + icons */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <span className="retro-tag" style={{
                                color: val > 0 ? '#5b9b6b' : val < 0 ? '#b85050' : '#888',
                                borderColor: val > 0 ? 'rgba(91,155,107,0.3)' : val < 0 ? 'rgba(184,80,80,0.3)' : 'rgba(0,0,0,0.1)',
                            }}>{label}</span>
                            {isGrudge && <span title="仇恨"><IconFlame size={9} /></span>}
                            {isCrush && <span title="暗恋"><IconCrush size={9} /></span>}
                        </div>

                        {/* NPC B */}
                        <div className="flex items-center gap-1 flex-shrink-0" style={{ minWidth: 0 }}>
                            <span style={{ fontSize: 9, color: '#555', fontWeight: 600, maxWidth: 44 }} className="truncate">{b.name}</span>
                            <NPCAvatar name={b.name} size={14} className="rounded" />
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default RelationsTab;
