/**
 * ActionPanel — 行动面板 (retro dialog box style)
 */

import React, { useState } from 'react';
import { LifeSimState, SimEventType } from '../../types';
import {
    MaskHappy, UserPlus, Lightning, CheckCircle,
} from '@phosphor-icons/react';
import { NPCAvatar, IconFight, IconParty, IconRomance, IconGossip, IconRivalry, IconAlliance } from '../../utils/styledIcons';

const EVENT_TYPES: { type: SimEventType; label: string; Icon: React.FC<{ size?: number }> }[] = [
    { type: 'fight', label: '吵架', Icon: IconFight },
    { type: 'party', label: '联谊', Icon: IconParty },
    { type: 'romance', label: '暧昧', Icon: IconRomance },
    { type: 'gossip', label: '说闲话', Icon: IconGossip },
    { type: 'rivalry', label: '竞争', Icon: IconRivalry },
    { type: 'alliance', label: '结盟', Icon: IconAlliance },
];

const NPC_PERSONALITY_OPTIONS = [
    '社牛','社恐','卷王','摸鱼','文青','话题女王','职场精英','暖男/暖女',
    '叛逆','精致','独立','自恋','佛系','焦虑','八卦','高冷','上进',
    '有品味','消息灵通','目标明确','热心','老好人','不按常理出牌','外貌协会',
];

const NPC_STYLE_OPTIONS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y'];

export interface StirAction {
    eventType: SimEventType;
    involvedNpcIds: string[];
    eventDesc: string;
    worldStory?: boolean;
}

export interface AddNpcAction {
    name: string;
    emoji: string;
    personalities: string[];
    familyId: string;
}

const ActionPanel: React.FC<{
    gameState: LifeSimState;
    mode: 'stir' | 'add';
    onStir: (action: StirAction) => void;
    onAdd: (action: AddNpcAction) => void;
    onClose: () => void;
}> = ({ gameState, mode, onStir, onAdd, onClose }) => {

    const [eventType, setEventType] = useState<SimEventType>('fight');
    const [eventDesc, setEventDesc] = useState('');
    const [npcName, setNpcName] = useState('');
    const [npcEmoji, setNpcEmoji] = useState(NPC_STYLE_OPTIONS[0]);
    const [personalities, setPersonalities] = useState<string[]>([]);
    const [familyId, setFamilyId] = useState('');

    const handleStir = () => {
        const shuffledNpcs = [...gameState.npcs].sort(() => Math.random() - 0.5);
        const autoCount = Math.min(shuffledNpcs.length, Math.floor(Math.random() * 2) + 2);
        const autoInvolved = shuffledNpcs.slice(0, autoCount).map(n => n.id);
        onStir({
            eventType,
            involvedNpcIds: autoInvolved,
            eventDesc: eventDesc || `${EVENT_TYPES.find(e => e.type === eventType)?.label}事件`,
            worldStory: true,
        });
    };

    const handleAdd = () => {
        if (!familyId || !npcName.trim() || personalities.length === 0) {
            alert('请填写名字、选择性格、并选择入住公寓！'); return;
        }
        onAdd({ name: npcName.trim(), emoji: npcEmoji, personalities, familyId });
    };

    return (
        <div className="absolute inset-0 z-40 flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.3)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="retro-window w-full mx-2 mb-2" style={{
                maxHeight: '70vh', display: 'flex', flexDirection: 'column',
                boxShadow: '4px 4px 0px rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.5)',
            }}>
                {/* Titlebar */}
                <div className="retro-titlebar">
                    <span className="flex items-center gap-1">
                        {mode === 'stir'
                            ? <><MaskHappy size={11} weight="bold" /> 搅局 — 制造Drama</>
                            : <><UserPlus size={11} weight="bold" /> 新邻居 — 搬入</>}
                    </span>
                    <span className="retro-dots">
                        <span className="retro-dot" style={{ background: '#f87171' }} onClick={onClose}>×</span>
                    </span>
                </div>

                {/* Content */}
                <div className="overflow-y-auto overflow-x-hidden no-scrollbar flex-1" style={{ padding: 10, minWidth: 0 }}>

                    {mode === 'stir' && (
                        <div className="space-y-2.5">
                            <div className="retro-inset" style={{ padding: '5px 8px' }}>
                                <p style={{ fontSize: 9, color: '#8b6bb8', lineHeight: 1.5 }}>
                                    选择搅局方式，系统将自动卷入相关NPC
                                </p>
                            </div>

                            <p style={{ fontSize: 10, fontWeight: 700, color: '#666' }}>搅局方式</p>
                            <div className="grid grid-cols-3 gap-1">
                                {EVENT_TYPES.map(et => (
                                    <button key={et.type} onClick={() => setEventType(et.type)}
                                        className="retro-btn flex items-center justify-center gap-1"
                                        style={{
                                            padding: '5px 4px', fontSize: 10,
                                            ...(eventType === et.type ? {
                                                background: 'linear-gradient(180deg, #a594d0, #8b7bb8)',
                                                color: 'white', borderColor: '#8b7bb8',
                                            } : {}),
                                        }}>
                                        <et.Icon size={12} /> {et.label}
                                    </button>
                                ))}
                            </div>

                            <input value={eventDesc} onChange={e => setEventDesc(e.target.value)}
                                placeholder="描述剧情（可选）"
                                style={{
                                    width: '100%', padding: '5px 8px', fontSize: 10,
                                    background: 'white', border: '2px solid rgba(0,0,0,0.15)',
                                    borderRadius: 4, outline: 'none', color: '#333',
                                    boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.08)',
                                }} />

                            <button onClick={handleStir}
                                className="retro-btn retro-btn-primary w-full flex items-center justify-center gap-1"
                                style={{ padding: '7px 12px' }}>
                                <Lightning size={12} weight="bold" /> 搅动世界！
                            </button>
                        </div>
                    )}

                    {mode === 'add' && (
                        <div className="space-y-2">
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#666' }}>名字</p>
                            <input value={npcName} onChange={e => setNpcName(e.target.value)}
                                placeholder="给TA取个名字"
                                style={{
                                    width: '100%', padding: '5px 8px', fontSize: 10,
                                    background: 'white', border: '2px solid rgba(0,0,0,0.15)',
                                    borderRadius: 4, outline: 'none', color: '#333',
                                    boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.08)',
                                }} />

                            <p style={{ fontSize: 10, fontWeight: 700, color: '#666' }}>头像风格</p>
                            <div className="flex flex-wrap gap-1">
                                {NPC_STYLE_OPTIONS.map(e => (
                                    <button key={e} onClick={() => setNpcEmoji(e)}
                                        style={{
                                            borderRadius: 4, overflow: 'hidden', padding: 2,
                                            border: npcEmoji === e ? '2px solid #8b7bb8' : '2px solid transparent',
                                            background: npcEmoji === e ? 'rgba(139,123,184,0.15)' : 'transparent',
                                        }}>
                                        <NPCAvatar name={e + (npcName || 'NPC')} size={22} className="rounded" />
                                    </button>
                                ))}
                            </div>

                            <p style={{ fontSize: 10, fontWeight: 700, color: '#666' }}>性格（至少选1个）</p>
                            <div className="flex flex-wrap gap-1">
                                {NPC_PERSONALITY_OPTIONS.map(p => {
                                    const sel = personalities.includes(p);
                                    return (
                                        <button key={p} onClick={() => setPersonalities(
                                            sel ? personalities.filter(x => x !== p) : [...personalities, p]
                                        )} className="retro-btn" style={{
                                            padding: '2px 8px', fontSize: 9,
                                            ...(sel ? {
                                                background: 'linear-gradient(180deg, #a594d0, #8b7bb8)',
                                                color: 'white', borderColor: '#8b7bb8',
                                            } : {}),
                                        }}>
                                            {p}
                                        </button>
                                    );
                                })}
                            </div>

                            <p style={{ fontSize: 10, fontWeight: 700, color: '#666' }}>入住公寓</p>
                            <div className="grid grid-cols-2 gap-1">
                                {gameState.families.map(f => (
                                    <button key={f.id} onClick={() => setFamilyId(f.id)}
                                        className="retro-btn flex items-center justify-center gap-1"
                                        style={{
                                            padding: '4px 6px', fontSize: 10,
                                            ...(familyId === f.id ? {
                                                background: 'linear-gradient(180deg, #a594d0, #8b7bb8)',
                                                color: 'white', borderColor: '#8b7bb8',
                                            } : {}),
                                        }}>
                                        <NPCAvatar name={f.name} size={12} className="rounded-sm" /> {f.name}
                                    </button>
                                ))}
                            </div>

                            <button onClick={handleAdd}
                                className="retro-btn retro-btn-primary w-full flex items-center justify-center gap-1"
                                style={{ padding: '7px 12px', marginTop: 4, background: 'linear-gradient(180deg, #7badc4, #5b8fa8)', borderColor: '#5b8fa8' }}>
                                <CheckCircle size={12} weight="bold" /> 入住
                            </button>
                        </div>
                    )}
                </div>

                {/* Close button */}
                <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                    <button onClick={onClose} className="retro-btn w-full" style={{ padding: '5px 12px' }}>
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ActionPanel;
