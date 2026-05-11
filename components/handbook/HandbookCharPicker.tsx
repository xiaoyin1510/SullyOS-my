/**
 * 角色筛选 bottom sheet（糖果版,带深度档位选择器)
 */

import React from 'react';
import { CharacterProfile } from '../../types';
import { LifestreamDepth } from '../../utils/handbookGenerator';
import { PAPER_TONES, CUTE_STACK, WashiTape } from './paper';
import { HeartSticker, StarSticker, SparkleDot } from './stickers';
import { Sparkle, X } from '@phosphor-icons/react';

interface PickerProps {
    visible: boolean;
    chatChars: CharacterProfile[];
    lifeChars: CharacterProfile[];
    excludedChat: Set<string>;
    excludedLife: Set<string>;
    onToggleChat: (charId: string) => void;
    onToggleLife: (charId: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
    generating: boolean;
    depth: LifestreamDepth;
    onDepthChange: (d: LifestreamDepth) => void;
}

const HandbookCharPicker: React.FC<PickerProps> = ({
    visible, chatChars, lifeChars, excludedChat, excludedLife,
    onToggleChat, onToggleLife, onCancel, onConfirm, generating,
    depth, onDepthChange,
}) => {
    if (!visible) return null;

    const renderRow = (
        c: CharacterProfile,
        excluded: boolean,
        onToggle: () => void,
        accent: string,
    ) => (
        <button
            key={c.id}
            onClick={onToggle}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition active:scale-[0.99]"
            style={{
                background: excluded ? 'rgba(220,199,213,0.12)' : '#fff',
                border: `1.5px solid ${excluded ? 'rgba(220,199,213,0.3)' : accent}`,
                opacity: excluded ? 0.5 : 1,
                boxShadow: excluded ? 'none' : '0 1px 3px rgba(122,90,114,0.08)',
            }}
        >
            <img
                src={c.avatar}
                className="w-10 h-10 rounded-full object-cover shrink-0"
                style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.15), 0 0 0 2.5px #fff' }}
                alt=""
            />
            <span
                className="flex-1 text-left text-[14px]"
                style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}
            >
                {c.name}
            </span>
            <span
                className="text-[10px] tracking-widest font-bold"
                style={{ ...CUTE_STACK, color: excluded ? PAPER_TONES.inkSoft : accent }}
            >
                {excluded ? '已 排 除' : '入 册 ♡'}
            </span>
        </button>
    );

    return (
        <div
            className="absolute inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(122,90,114,0.4)', backdropFilter: 'blur(6px)' }}
            onClick={onCancel}
        >
            <div
                className="w-full max-h-[85%] overflow-y-auto rounded-t-3xl relative"
                style={{
                    background: PAPER_TONES.paper,
                    boxShadow: '0 -8px 28px rgba(122,90,114,0.25)',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* 顶部把手 */}
                <div className="flex justify-center pt-3 pb-1">
                    <div style={{ width: 40, height: 4, borderRadius: 2, background: PAPER_TONES.accentRose, opacity: 0.5 }} />
                </div>

                {/* 角落贴纸 */}
                <div className="absolute top-6 left-5 pointer-events-none" style={{ transform: 'rotate(-15deg)' }}>
                    <HeartSticker size={20} />
                </div>
                <div className="absolute top-7 right-7 pointer-events-none" style={{ transform: 'rotate(20deg)' }}>
                    <StarSticker size={18} color={PAPER_TONES.accentLemon} />
                </div>

                {/* 标题 */}
                <div className="px-5 pt-2 pb-3 text-center">
                    <WashiTape color="rose" pattern="heart" rotate={-1.5}>生 成 今 日 ♡</WashiTape>
                    <div
                        className="text-[11px] mt-3"
                        style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                    >
                        默认全部入册 · 想跳过的勾掉就好
                    </div>
                </div>

                {/* 我的一天 · 取材自 */}
                <div className="px-5 mt-2">
                    <div className="flex items-center gap-2 mb-3">
                        <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentRose, opacity: 0.4 }} />
                        <span
                            className="text-[11px] tracking-[0.3em] font-bold"
                            style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                        >
                            我 的 一 天 · 取 材 自
                        </span>
                        <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentRose, opacity: 0.4 }} />
                    </div>
                    {chatChars.length === 0 ? (
                        <div
                            className="text-[12px] py-2 text-center"
                            style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                        >
                            今天还没和谁说过话 …
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {chatChars.map(c => renderRow(
                                c, excludedChat.has(c.id), () => onToggleChat(c.id), PAPER_TONES.accentBlush,
                            ))}
                        </div>
                    )}
                </div>

                {/* 让 ta 也在这页写一笔 (任何角色都行,不限生活系) */}
                <div className="px-5 mt-6 pb-3">
                    <div className="flex items-center gap-2 mb-3">
                        <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentBlue, opacity: 0.4 }} />
                        <span
                            className="text-[11px] tracking-[0.3em] font-bold"
                            style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                        >
                            让 ta 在 这 页 也 写 一 笔
                        </span>
                        <div style={{ flex: 1, height: 1, background: PAPER_TONES.accentBlue, opacity: 0.4 }} />
                    </div>

                    {/* 深度档位选择器(只影响陪伴页的生成深度) */}
                    <div
                        className="rounded-xl px-3 py-2.5 mb-3"
                        style={{
                            background: 'rgba(214,200,232,0.18)',
                            border: `1px dashed ${PAPER_TONES.accentLavender}`,
                        }}
                    >
                        <div
                            className="text-[10px] tracking-widest mb-2"
                            style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                        >
                            ◆ 深度档位 · 想看 ta 怎样的一天
                        </div>
                        <div className="flex gap-1.5">
                            {([
                                { v: 'light',  label: '日常',  hint: '纯小事' },
                                { v: 'medium', label: '反思',  hint: '日常 + 思考' },
                                { v: 'deep',   label: '反刍',  hint: '深度内省' },
                            ] as const).map(opt => {
                                const active = depth === opt.v;
                                return (
                                    <button
                                        key={opt.v}
                                        onClick={() => onDepthChange(opt.v)}
                                        className="flex-1 py-1.5 px-2 rounded-lg active:scale-95 transition"
                                        style={{
                                            background: active ? PAPER_TONES.accentLavender : '#fff',
                                            color: active ? '#fff' : PAPER_TONES.ink,
                                            border: `1.5px solid ${active ? PAPER_TONES.accentLavender : PAPER_TONES.spine}`,
                                        }}
                                    >
                                        <div className="text-[12px] font-bold" style={CUTE_STACK}>{opt.label}</div>
                                        <div
                                            className="text-[9px] mt-0.5"
                                            style={{
                                                ...CUTE_STACK,
                                                color: active ? 'rgba(255,255,255,0.85)' : PAPER_TONES.inkFaint,
                                            }}
                                        >
                                            {opt.hint}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {lifeChars.length === 0 ? (
                        <div
                            className="text-[12px] py-2 text-center"
                            style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                        >
                            还没有任何角色 …
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {lifeChars.map(c => renderRow(
                                c, excludedLife.has(c.id), () => onToggleLife(c.id), PAPER_TONES.accentSky,
                            ))}
                        </div>
                    )}
                </div>

                {/* 底部操作 */}
                <div
                    className="sticky bottom-0 px-5 py-3 flex gap-2"
                    style={{
                        background: PAPER_TONES.paper,
                        borderTop: `1.5px solid ${PAPER_TONES.accentRose}`,
                    }}
                >
                    <button
                        onClick={onCancel}
                        className="px-4 py-3 rounded-full text-[13px] font-bold active:scale-95 transition flex items-center gap-1"
                        style={{
                            ...CUTE_STACK,
                            color: PAPER_TONES.inkSoft,
                            background: '#fff',
                            border: `1.5px solid ${PAPER_TONES.accentRose}`,
                        }}
                    >
                        <X className="w-3.5 h-3.5" /> 算了
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={generating || (chatChars.length === 0 && lifeChars.length === 0)}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-[13px] font-bold active:scale-95 transition disabled:opacity-50"
                        style={{
                            ...CUTE_STACK,
                            background: `linear-gradient(135deg, ${PAPER_TONES.accentBlush} 0%, ${PAPER_TONES.accentRose} 100%)`,
                            color: '#fff',
                            boxShadow: '0 2px 6px rgba(242,157,176,0.4)',
                        }}
                    >
                        <Sparkle weight="fill" className="w-3.5 h-3.5" />
                        {generating ? '正在落笔…' : '开 始 落 笔 ♡'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HandbookCharPicker;
