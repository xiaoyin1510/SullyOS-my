/**
 * NPCGrid - city residents
 */

import React, { useRef, useState } from 'react';
import { LifeSimState, SimNPC } from '../../types';
import { getMoodLabel, getProfessionInfo, getGenderLabel } from '../../utils/lifeSimEngine';
import { NPCAvatar, IconFlame, IconCrush } from '../../utils/styledIcons';

const MOOD_COLORS = (norm: number) =>
    norm > 60 ? '#5b9b6b' : norm > 30 ? '#b89840' : '#b85050';

const LONG_PRESS_MS = 420;

const NPCCard: React.FC<{
    npc: SimNPC;
    gameState: LifeSimState;
    onLongPressNpc?: (npc: SimNPC) => void;
}> = ({ npc, gameState, onLongPressNpc }) => {
    const [expanded, setExpanded] = useState(false);
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const didLongPress = useRef(false);
    const profInfo = getProfessionInfo(npc.profession ?? 'freelancer');
    const mood = npc.mood;
    const { label: moodLabel } = getMoodLabel(mood);
    const family = gameState.families.find(f => f.id === npc.familyId);
    const moodNorm = (mood + 100) / 2;
    const grudges = npc.grudges ?? [];
    const crushes = npc.crushes ?? [];
    const genderSymbol = getGenderLabel(npc.gender);

    const clearPress = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current);
            pressTimer.current = null;
        }
    };

    const handlePressStart = () => {
        clearPress();
        didLongPress.current = false;
        if (!onLongPressNpc) return;
        pressTimer.current = setTimeout(() => {
            didLongPress.current = true;
            onLongPressNpc(npc);
        }, LONG_PRESS_MS);
    };

    const handleClick = () => {
        if (didLongPress.current) {
            didLongPress.current = false;
            return;
        }
        setExpanded(value => !value);
    };

    return (
        <div
            className="retro-window cursor-pointer"
            style={{ marginBottom: 0 }}
            onClick={handleClick}
            onContextMenu={event => {
                event.preventDefault();
                onLongPressNpc?.(npc);
            }}
            onTouchStart={handlePressStart}
            onTouchEnd={clearPress}
            onTouchCancel={clearPress}
            onMouseDown={handlePressStart}
            onMouseUp={clearPress}
            onMouseLeave={clearPress}
        >
            <div className="retro-titlebar" style={{ padding: '2px 6px', fontSize: 9 }}>
                <span className="truncate">{npc.name}{genderSymbol ? ` ${genderSymbol}` : ''}</span>
                <span style={{ fontSize: 8, opacity: 0.7 }}>{expanded ? '▲' : '▼'}</span>
            </div>

            <div style={{ padding: '6px 8px' }}>
                <div className="flex items-center gap-2">
                    <div
                        className="flex-shrink-0"
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 4,
                            border: `1px solid ${profInfo.color}40`,
                            overflow: 'hidden',
                        }}
                    >
                        <NPCAvatar name={npc.name} size={28} className="rounded" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                            <span
                                style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    color: profInfo.color,
                                    background: `${profInfo.color}15`,
                                    padding: '0 4px',
                                    borderRadius: 2,
                                    border: `1px solid ${profInfo.color}25`,
                                }}
                            >
                                {profInfo.zh}
                            </span>
                            {family && (
                                <span style={{ fontSize: 8, color: '#888', fontWeight: 500 }}>
                                    {family.name}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1 mt-1">
                            <div
                                className="flex-1 h-1.5 rounded-sm overflow-hidden"
                                style={{
                                    background: 'rgba(0,0,0,0.06)',
                                    border: '1px solid rgba(0,0,0,0.08)',
                                }}
                            >
                                <div
                                    className="h-full rounded-sm transition-all duration-500"
                                    style={{
                                        width: `${moodNorm}%`,
                                        background: MOOD_COLORS(moodNorm),
                                    }}
                                />
                            </div>
                            <span style={{ fontSize: 8, color: MOOD_COLORS(moodNorm), fontWeight: 600 }}>{moodLabel}</span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-0.5 mt-1.5">
                    {npc.personality.slice(0, 3).map(item => (
                        <span key={item} className="retro-tag">{item}</span>
                    ))}
                </div>

                {(grudges.length > 0 || crushes.length > 0) && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                        {grudges.map(gid => {
                            const target = gameState.npcs.find(n => n.id === gid);
                            return target ? (
                                <span
                                    key={`g-${gid}`}
                                    style={{
                                        fontSize: 8,
                                        fontWeight: 600,
                                        background: 'rgba(200,60,60,0.1)',
                                        color: '#b85050',
                                        border: '1px solid rgba(200,60,60,0.2)',
                                        borderRadius: 3,
                                        padding: '0 4px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 2,
                                    }}
                                >
                                    <IconFlame size={7} />{target.name}
                                </span>
                            ) : null;
                        })}
                        {crushes.map(cid => {
                            const target = gameState.npcs.find(n => n.id === cid);
                            return target ? (
                                <span
                                    key={`c-${cid}`}
                                    style={{
                                        fontSize: 8,
                                        fontWeight: 600,
                                        background: 'rgba(200,100,150,0.1)',
                                        color: '#c06090',
                                        border: '1px solid rgba(200,100,150,0.2)',
                                        borderRadius: 3,
                                        padding: '0 4px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 2,
                                    }}
                                >
                                    <IconCrush size={7} />{target.name}
                                </span>
                            ) : null;
                        })}
                    </div>
                )}

                {expanded && (
                    <div
                        style={{
                            marginTop: 6,
                            paddingTop: 6,
                            borderTop: '1px dashed rgba(0,0,0,0.1)',
                        }}
                    >
                        {npc.bio && (
                            <p style={{ fontSize: 9, color: '#666', lineHeight: 1.5, marginBottom: 4 }}>{npc.bio}</p>
                        )}
                        {npc.backstory && (
                            <div className="retro-inset" style={{ padding: '4px 6px', marginTop: 4 }}>
                                <p style={{ fontSize: 8, color: '#888', fontWeight: 600, marginBottom: 2 }}>背景故事</p>
                                <p style={{ fontSize: 9, color: '#555', lineHeight: 1.5 }}>{npc.backstory}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const NPCGrid: React.FC<{
    gameState: LifeSimState;
    onLongPressNpc?: (npc: SimNPC) => void;
}> = ({ gameState, onLongPressNpc }) => {
    const allNpcs = gameState.npcs;

    if (allNpcs.length === 0) {
        return (
            <div className="flex items-center justify-center p-8" style={{ color: '#999', fontSize: 12 }}>
                还没有居民入住
            </div>
        );
    }

    return (
        <div style={{ padding: 6 }}>
            <div className="retro-inset" style={{ padding: '4px 6px', marginBottom: 6 }}>
                <p style={{ fontSize: 9, color: '#7a7488' }}>提示：点一下展开居民故事，长按可以改这局的角色设定。</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                {allNpcs.map(npc => (
                    <NPCCard key={npc.id} npc={npc} gameState={gameState} onLongPressNpc={onLongPressNpc} />
                ))}
            </div>
        </div>
    );
};

export default NPCGrid;
