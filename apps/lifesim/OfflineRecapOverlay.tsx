/**
 * OfflineRecapOverlay — 离线回顾"报纸"
 * 展示用户不在时发生的重大事件
 */

import React from 'react';
import { OfflineRecapEvent } from '../../types';
import { getElapsedDescription } from '../../utils/lifeSimOfflineSim';
import { WarningCircle } from '@phosphor-icons/react';
import { EventIcon, NPCAvatar } from '../../utils/styledIcons';

const OfflineRecapOverlay: React.FC<{
    recap: OfflineRecapEvent[];
    elapsedMs: number;
    currentChaos: number;
    onDismiss: () => void;
}> = ({ recap, elapsedMs, currentChaos, onDismiss }) => {
    const elapsedDesc = getElapsedDescription(elapsedMs);

    // 统计
    const fightCount = recap.filter(e => ['fight', 'fight_break', 'revenge_plot', 'family_feud'].includes(e.eventType as string)).length;
    const romanceCount = recap.filter(e => ['romance', 'romantic_confession', 'love_triangle'].includes(e.eventType as string)).length;
    const totalChaosChange = recap.reduce((sum, e) => sum + (e.chaosChange ?? 0), 0);

    return (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
            <div className="bg-gray-900 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl border border-white/10 max-h-[85vh] flex flex-col">
                {/* 报头 */}
                <div className="bg-gradient-to-b from-indigo-900 to-purple-950 px-5 pt-6 pb-4 text-center flex-shrink-0">
                    <p className="text-purple-300/60 text-[10px] tracking-widest mb-1">都市快报 · 号外</p>
                    <p className="text-purple-100 text-xl font-bold">你不在的时候...</p>
                    <p className="text-purple-300/70 text-xs mt-1">{elapsedDesc}过去了</p>
                </div>

                {/* 事件列表 */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                    {recap.length === 0 ? (
                        <p className="text-white/40 text-center text-sm py-6">风平浪静，什么都没发生。</p>
                    ) : recap.slice(0, 20).map((ev, i) => {
                        return (
                            <div key={i} className="bg-white/5 rounded-xl p-3 border border-white/10">
                                <div className="flex items-start gap-2">
                                    <span className="flex-shrink-0"><EventIcon eventType={ev.eventType as string} size={20} /></span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white text-xs font-bold leading-snug">{ev.headline}</p>
                                        <p className="text-white/50 text-[10px] mt-0.5">{ev.description}</p>
                                        <div className="flex items-center gap-1 mt-1">
                                            {ev.involvedNpcs.slice(0, 4).map((npc, j) => (
                                                <span key={j} className="text-[10px] bg-white/10 rounded px-1 py-0.5 text-white/70 flex items-center gap-0.5">
                                                    <NPCAvatar name={npc.name} size={10} className="rounded-sm" />{npc.name}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {recap.length > 20 && (
                        <p className="text-white/30 text-center text-[10px]">...还有{recap.length - 20}件事没来得及报道</p>
                    )}
                </div>

                {/* 底部统计 */}
                <div className="flex-shrink-0 bg-black/30 px-4 py-3 border-t border-white/10">
                    <div className="flex justify-around text-center mb-3">
                        {fightCount > 0 && (
                            <div>
                                <p className="text-red-400 text-lg font-bold">{fightCount}</p>
                                <p className="text-white/40 text-[9px]">场冲突</p>
                            </div>
                        )}
                        {romanceCount > 0 && (
                            <div>
                                <p className="text-pink-400 text-lg font-bold">{romanceCount}</p>
                                <p className="text-white/40 text-[9px]">段恋情</p>
                            </div>
                        )}
                        <div>
                            <p className={`text-lg font-bold ${totalChaosChange > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                {totalChaosChange > 0 ? '+' : ''}{totalChaosChange}
                            </p>
                            <p className="text-white/40 text-[9px]">混乱度变化</p>
                        </div>
                        <div>
                            <p className="text-amber-400 text-lg font-bold">{currentChaos}</p>
                            <p className="text-white/40 text-[9px]">当前混乱</p>
                        </div>
                    </div>
                    <button onClick={onDismiss}
                        className="w-full py-3 rounded-2xl bg-purple-600 text-white font-bold text-sm active:bg-purple-700">
                        <WarningCircle size={16} weight="bold" className="inline-block mr-1" /> 进入Drama现场
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OfflineRecapOverlay;
