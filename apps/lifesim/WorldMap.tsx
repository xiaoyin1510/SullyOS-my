/**
 * WorldMap — 城市天际线地图 (retro pixel art style)
 * Fits inside retro-window frame, cleaner layout
 */

import React, { useState, useEffect, useRef } from 'react';
import { LifeSimState } from '../../types';
import {
    getFamilyMembers, getIndependentNPCs, getMoodLabel,
    getProfessionInfo, getFamilyAtmosphere,
    SEASON_INFO, WEATHER_INFO,
} from '../../utils/lifeSimEngine';
import { getTileSet, houseForFamily, TileSet } from '../../utils/tinyTownTiles';
import { NPCAvatar, IconRaindrop, IconSnowflake, IconLightning, IconFlame, IconExplosion, IconCrush } from '../../utils/styledIcons';

const WorldMap: React.FC<{ gameState: LifeSimState }> = ({ gameState }) => {
    const [tiles, setTiles] = useState<TileSet | null>(null);
    const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
    const [zoomedFamilyId, setZoomedFamilyId] = useState<string | null>(null);
    const mapRef = useRef<HTMLDivElement>(null);
    const season = gameState.season ?? 'spring';
    const { chaosLevel } = gameState;

    useEffect(() => {
        setTiles(getTileSet(season));
    }, [season]);

    const selectedFamily = selectedFamilyId ? gameState.families.find(f => f.id === selectedFamilyId) : null;
    const independentNPCs = getIndependentNPCs(gameState);
    const zoomedFamily = zoomedFamilyId ? gameState.families.find(f => f.id === zoomedFamilyId) : null;
    const zoomedMembers = zoomedFamily ? getFamilyMembers(gameState, zoomedFamily.id) : [];

    const weather = gameState.weather ?? 'sunny';
    const weatherOverlay =
        weather === 'stormy' ? 'rgba(20,0,40,0.4)' :
        weather === 'rainy'  ? 'rgba(0,20,60,0.25)' :
        weather === 'snowy'  ? 'rgba(100,120,160,0.2)' :
        chaosLevel > 80 ? 'rgba(120,0,0,0.2)' :
        chaosLevel > 60 ? 'rgba(80,40,0,0.12)' : 'transparent';

    const handleFamilyClick = (familyId: string) => {
        if (zoomedFamilyId === familyId) {
            setZoomedFamilyId(null);
            setSelectedFamilyId(null);
        } else {
            setZoomedFamilyId(familyId);
            setSelectedFamilyId(familyId);
        }
    };

    return (
        <div style={{ position: 'relative' }}>
            {/* Main map area */}
            <div ref={mapRef} style={{
                position: 'relative',
                height: zoomedFamilyId ? '280px' : '160px',
                overflow: 'hidden',
                transition: 'height 0.4s cubic-bezier(0.4,0,0.2,1)',
            }}>
                {/* City map background */}
                {tiles ? (
                    <img src={tiles.mapBackground} className="absolute inset-0 w-full h-full"
                        style={{ imageRendering: 'pixelated', objectFit: 'cover', opacity: 0.8 }} alt="" draggable={false} />
                ) : (
                    <div className="absolute inset-0" style={{ background: '#c4c0d4' }} />
                )}

                {/* Bottom gradient */}
                <div className="absolute inset-0 pointer-events-none" style={{
                    background: 'linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.25) 100%)',
                    zIndex: 1,
                }} />

                {/* Road lines (subtle) */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 2 }}>
                    {gameState.families.flatMap((famA, i) =>
                        gameState.families.slice(i + 1).map(famB => (
                            <line key={`${famA.id}-${famB.id}`}
                                x1={`${famA.homeX}%`} y1={`${famA.homeY}%`}
                                x2={`${famB.homeX}%`} y2={`${famB.homeY}%`}
                                stroke="rgba(100,80,140,0.15)" strokeWidth="1" strokeDasharray="4,3"
                                strokeLinecap="round" />
                        ))
                    )}
                </svg>

                {/* Buildings */}
                {tiles && gameState.families.map(family => {
                    const members = getFamilyMembers(gameState, family.id);
                    const isZoomed = zoomedFamilyId === family.id;
                    const isOtherZoomed = zoomedFamilyId && !isZoomed;
                    const isEmpty = members.length === 0;
                    const houseSrc = tiles[houseForFamily(family.emoji)];
                    const dotColors = ['#ffe066', '#7dd3fc', '#f9a8d4', '#86efac', '#fca5a5', '#c4b5fd'];

                    return (
                        <div key={family.id} className="absolute cursor-pointer"
                            style={{
                                left: isZoomed ? '50%' : `${family.homeX}%`,
                                top: isZoomed ? '46%' : `${family.homeY}%`,
                                transform: isZoomed
                                    ? 'translate(-50%,-50%) scale(2.35)'
                                    : isOtherZoomed
                                    ? 'translate(-50%,-50%) scale(0.7)'
                                    : 'translate(-50%,-50%) scale(1)',
                                zIndex: isZoomed ? 20 : 10,
                                opacity: isOtherZoomed ? 0.3 : 1,
                                transition: 'all 0.4s cubic-bezier(0.4,0,0.2,1)',
                                filter: isZoomed ? 'drop-shadow(0 0 12px rgba(139,92,246,0.5))' : 'none',
                            }}
                            onClick={() => handleFamilyClick(family.id)}>
                            {isZoomed && (
                                <div className="absolute rounded-full animate-pulse"
                                    style={{
                                        inset: '-12px',
                                        background: 'radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)',
                                        zIndex: -1,
                                    }} />
                            )}
                            {isZoomed && members.length > 0 && (
                                <div className="absolute flex gap-0.5"
                                    style={{
                                        left: '50%',
                                        top: '68%',
                                        transform: 'translate(-50%,-50%)',
                                        zIndex: 2,
                                        background: 'rgba(0,0,0,0.2)',
                                        border: '1px solid rgba(255,255,255,0.25)',
                                        borderRadius: 2,
                                        padding: '1px 2px',
                                    }}>
                                    {members.slice(0, 4).map((npc, idx) => (
                                        <span key={npc.id} title={npc.name}
                                            style={{
                                                width: 4,
                                                height: 4,
                                                display: 'inline-block',
                                                background: dotColors[idx % dotColors.length],
                                                boxShadow: '0 0 0 1px rgba(0,0,0,0.55), 0 0 3px rgba(255,255,255,0.3)',
                                                imageRendering: 'pixelated',
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                            {houseSrc ? (
                                <div className="flex justify-center">
                                    <img src={houseSrc} width={36} height={36}
                                        style={{
                                            imageRendering: 'pixelated',
                                            filter: isEmpty ? 'grayscale(1) opacity(0.3)'
                                                : 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))',
                                            transition: 'all 0.3s',
                                        }}
                                        alt="" draggable={false} />
                                </div>
                            ) : (
                                <div style={{
                                    textAlign: 'center',
                                    filter: isEmpty ? 'grayscale(1) opacity(0.3)' : '',
                                }}>
                                    <NPCAvatar name={family.name} size={28} className="rounded" />
                                </div>
                            )}
                            {/* Resident avatars */}
                            {members.length > 0 && !isZoomed && (
                                <div className="flex flex-wrap justify-center mt-0.5"
                                    style={{ maxWidth: '52px', fontSize: '10px', lineHeight: 1.1 }}>
                                    {members.slice(0, 4).map(npc => (
                                        <span key={npc.id} title={npc.name}
                                            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
                                            <NPCAvatar name={npc.name} size={10} className="rounded-sm" />
                                        </span>
                                    ))}
                                    {members.length > 4 && (
                                        <span style={{ color: '#aaa', fontSize: '7px', textShadow: '0 1px 2px #000' }}>
                                            +{members.length - 4}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="text-center whitespace-nowrap" style={{
                                fontSize: '7px', fontWeight: 700, color: '#d4d8e8',
                                textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(100,80,140,0.3)',
                                letterSpacing: '0.02em',
                            }}>{family.name}</div>
                        </div>
                    );
                })}

                {/* Independent NPCs */}
                {independentNPCs.length > 0 && (
                    <div className="absolute flex flex-wrap gap-0.5 items-center justify-center"
                        style={{ left: '50%', top: '80%', transform: 'translate(-50%,-50%)', maxWidth: '80px', zIndex: 8 }}>
                        {independentNPCs.map(npc => (
                            <span key={npc.id} title={`${npc.name}（独居）`}
                                style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>
                                <NPCAvatar name={npc.name} size={12} className="rounded-sm" />
                            </span>
                        ))}
                    </div>
                )}

                {/* Weather overlay */}
                <div className="absolute inset-0 pointer-events-none transition-all duration-1000"
                    style={{ background: weatherOverlay, zIndex: 25 }} />

                {/* Rain particles */}
                {(weather === 'rainy' || weather === 'stormy') && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 26 }}>
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="absolute opacity-40"
                                style={{ left: `${i * 12}%`, top: '-5px',
                                    animation: `fall ${0.6 + i * 0.08}s linear infinite`, animationDelay: `${i * 0.12}s` }}>
                                <IconRaindrop size={7} />
                            </div>
                        ))}
                    </div>
                )}

                {/* Snow particles */}
                {weather === 'snowy' && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 26 }}>
                        {Array.from({ length: 10 }).map((_, i) => (
                            <div key={i} className="absolute opacity-50"
                                style={{ left: `${i * 9 + 2}%`, top: '-5px',
                                    animation: `fall ${1.0 + i * 0.12}s linear infinite`, animationDelay: `${i * 0.18}s` }}>
                                <IconSnowflake size={7} />
                            </div>
                        ))}
                    </div>
                )}

                {/* High chaos effects */}
                {chaosLevel > 65 && (
                    <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 26 }}>
                        {[IconLightning, IconFlame, IconExplosion].map((Icon, i) => (
                            <div key={i} className="absolute animate-bounce opacity-40"
                                style={{ left: `${18+i*32}%`, top: `${8+i*12}%`,
                                    animationDelay: `${i*0.25}s`, animationDuration: '1.2s' }}>
                                <Icon size={14} />
                            </div>
                        ))}
                    </div>
                )}

                {/* Click map blank to close zoom */}
                {zoomedFamilyId && (
                    <div className="absolute inset-0" style={{ zIndex: 5 }}
                        onClick={(e) => {
                            if (e.target === e.currentTarget) {
                                setZoomedFamilyId(null);
                                setSelectedFamilyId(null);
                            }
                        }} />
                )}
            </div>

            {/* Zoomed detail panel */}
            {zoomedFamily && (
                <div style={{
                    borderTop: '2px solid rgba(0,0,0,0.1)',
                    background: 'rgba(255,255,255,0.7)',
                    animation: 'slideDown 0.3s ease-out',
                    overflow: 'hidden',
                }}>
                    <div style={{ padding: '8px 10px' }}>
                        {/* Family title */}
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <div style={{
                                    width: 24, height: 24, borderRadius: 4,
                                    overflow: 'hidden', border: '1px solid rgba(139,92,246,0.3)',
                                    background: 'rgba(139,92,246,0.1)',
                                }}>
                                    <NPCAvatar name={zoomedFamily.name} size={24} className="rounded" />
                                </div>
                                <div>
                                    <p style={{ fontSize: 11, fontWeight: 700, color: '#444' }}>{zoomedFamily.name}</p>
                                    <p style={{ fontSize: 9, color: '#999' }}>
                                        {getFamilyAtmosphere(gameState, zoomedFamily.id)} · {zoomedMembers.length}位住户
                                    </p>
                                </div>
                            </div>
                            <button onClick={() => { setZoomedFamilyId(null); setSelectedFamilyId(null); }}
                                className="retro-btn" style={{ padding: '2px 6px', fontSize: 9 }}>
                                ✕
                            </button>
                        </div>

                        {/* Member cards (horizontal scroll) */}
                        {zoomedMembers.length > 0 ? (
                            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                                {zoomedMembers.map(npc => {
                                    const profInfo = getProfessionInfo(npc.profession ?? 'freelancer');
                                    const { label: moodLabel } = getMoodLabel(npc.mood);
                                    const hasGrudge = (npc.grudges?.length ?? 0) > 0;
                                    const hasCrush = (npc.crushes?.length ?? 0) > 0;
                                    const moodNorm = (npc.mood + 100) / 2;
                                    const moodColor = moodNorm > 60 ? '#5b9b6b' : moodNorm > 30 ? '#b89840' : '#b85050';
                                    return (
                                        <div key={npc.id} className="flex-shrink-0 retro-inset" style={{
                                            padding: '5px 8px', minWidth: 110, borderRadius: 4,
                                        }}>
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <div style={{
                                                    width: 20, height: 20, borderRadius: 3,
                                                    overflow: 'hidden', border: `1px solid ${profInfo.color}30`,
                                                }}>
                                                    <NPCAvatar name={npc.name} size={20} className="rounded" />
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <p style={{ fontSize: 10, fontWeight: 700, color: '#444' }} className="truncate">{npc.name}</p>
                                                    <p style={{ color: profInfo.color, fontSize: 8, fontWeight: 600 }}>{profInfo.zh}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <div className="flex-1" style={{
                                                    height: 3, background: 'rgba(0,0,0,0.06)', borderRadius: 1, overflow: 'hidden',
                                                }}>
                                                    <div style={{ height: '100%', width: `${moodNorm}%`, background: moodColor, borderRadius: 1, transition: 'all 0.3s' }} />
                                                </div>
                                                <span style={{ fontSize: 7, color: moodColor, fontWeight: 600 }}>{moodLabel}</span>
                                            </div>
                                            {(hasGrudge || hasCrush) && (
                                                <div className="flex gap-1 mt-0.5">
                                                    {hasGrudge && <span title="记仇中"><IconFlame size={8} /></span>}
                                                    {hasCrush && <span title="暗恋中"><IconCrush size={8} /></span>}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p style={{ color: '#aaa', fontSize: 10, textAlign: 'center', padding: '6px 0' }}>暂无住户</p>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes fall {
                    from { transform: translateY(-10px); opacity: 0.5; }
                    to { transform: translateY(220px); opacity: 0.05; }
                }
                @keyframes slideDown {
                    from { max-height: 0; opacity: 0; }
                    to { max-height: 300px; opacity: 1; }
                }
                .no-scrollbar::-webkit-scrollbar { display: none; }
                .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
            `}</style>
        </div>
    );
};

export default WorldMap;
