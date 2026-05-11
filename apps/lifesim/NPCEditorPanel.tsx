import React, { useState } from 'react';
import { SimGender, SimNPC } from '../../types';
import { CheckCircle, X } from '@phosphor-icons/react';
import { NPCAvatar } from '../../utils/styledIcons';

const PERSONALITY_OPTIONS = [
    '社牛', '社恐', '卷王', '摸鱼', '文青', '话题女王', '职场精英', '暖男/暖女',
    '叛逆', '精致', '独立', '自恋', '佛系', '焦虑', '八卦', '高冷', '上进',
    '有品味', '消息灵通', '目标明确', '热心', '老好人', '不按常理出牌', '外貌协会',
];

const GENDER_OPTIONS: { value: SimGender; label: string }[] = [
    { value: 'male', label: '男' },
    { value: 'female', label: '女' },
    { value: 'nonbinary', label: '非二元' },
];

const NPCEditorPanel: React.FC<{
    npc: SimNPC;
    onSave: (updates: Partial<SimNPC>) => void;
    onClose: () => void;
}> = ({ npc, onSave, onClose }) => {
    const [name, setName] = useState(npc.name);
    const [gender, setGender] = useState<SimGender>(npc.gender || 'nonbinary');
    const [personality, setPersonality] = useState<string[]>(npc.personality || []);
    const [bio, setBio] = useState(npc.bio || '');
    const [backstory, setBackstory] = useState(npc.backstory || '');

    const togglePersonality = (value: string) => {
        setPersonality(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
    };

    const handleSave = () => {
        onSave({
            name: name.trim() || npc.name,
            gender,
            personality: personality.length > 0 ? personality : npc.personality,
            bio: bio.trim(),
            backstory: backstory.trim(),
        });
    };

    return (
        <div
            className="absolute inset-0 z-50 flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.34)' }}
            onClick={event => { if (event.target === event.currentTarget) onClose(); }}
        >
            <div
                className="retro-window w-full mx-2 mb-2"
                style={{
                    maxHeight: '78vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '4px 4px 0 rgba(0,0,0,0.2), inset 0 0 0 1px rgba(255,255,255,0.5)',
                }}
            >
                <div className="retro-titlebar">
                    <span>npc-editor.cfg</span>
                    <button
                        onClick={onClose}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 18,
                            height: 18,
                            borderRadius: 3,
                            background: 'rgba(255,255,255,0.15)',
                            border: '1px solid rgba(255,255,255,0.25)',
                            color: 'white',
                        }}
                    >
                        <X size={10} weight="bold" />
                    </button>
                </div>

                <div className="overflow-y-auto flex-1" style={{ padding: 10 }}>
                    <div className="flex items-center gap-3 retro-inset" style={{ padding: '8px 10px', marginBottom: 8 }}>
                        <NPCAvatar name={name || npc.name} size={42} className="rounded-lg" />
                        <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#544f63' }}>{name || npc.name}</div>
                            <div style={{ fontSize: 9, color: '#8d859d', marginTop: 2 }}>
                                长按居民卡可改设定
                            </div>
                        </div>
                    </div>

                    <div style={{ fontSize: 10, fontWeight: 700, color: '#666', marginBottom: 4 }}>名字</div>
                    <input
                        value={name}
                        onChange={event => setName(event.target.value)}
                        style={{
                            width: '100%',
                            padding: '6px 8px',
                            fontSize: 10,
                            background: 'white',
                            border: '2px solid rgba(0,0,0,0.15)',
                            borderRadius: 4,
                            outline: 'none',
                            color: '#333',
                            boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.08)',
                        }}
                    />

                    <div style={{ fontSize: 10, fontWeight: 700, color: '#666', margin: '10px 0 4px' }}>性别</div>
                    <div className="flex gap-1.5 flex-wrap">
                        {GENDER_OPTIONS.map(option => (
                            <button
                                key={option.value}
                                onClick={() => setGender(option.value)}
                                className="retro-btn"
                                style={{
                                    padding: '3px 10px',
                                    fontSize: 10,
                                    ...(gender === option.value ? {
                                        background: 'linear-gradient(180deg, #a594d0, #8b7bb8)',
                                        color: 'white',
                                        borderColor: '#8b7bb8',
                                    } : {}),
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div style={{ fontSize: 10, fontWeight: 700, color: '#666', margin: '10px 0 4px' }}>性格</div>
                    <div className="flex flex-wrap gap-1">
                        {PERSONALITY_OPTIONS.map(item => {
                            const active = personality.includes(item);
                            return (
                                <button
                                    key={item}
                                    onClick={() => togglePersonality(item)}
                                    className="retro-btn"
                                    style={{
                                        padding: '2px 8px',
                                        fontSize: 9,
                                        ...(active ? {
                                            background: 'linear-gradient(180deg, #a594d0, #8b7bb8)',
                                            color: 'white',
                                            borderColor: '#8b7bb8',
                                        } : {}),
                                    }}
                                >
                                    {item}
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ fontSize: 10, fontWeight: 700, color: '#666', margin: '10px 0 4px' }}>简介</div>
                    <textarea
                        value={bio}
                        onChange={event => setBio(event.target.value)}
                        rows={3}
                        style={{
                            width: '100%',
                            padding: '6px 8px',
                            fontSize: 10,
                            background: 'white',
                            border: '2px solid rgba(0,0,0,0.15)',
                            borderRadius: 4,
                            outline: 'none',
                            color: '#333',
                            resize: 'vertical',
                            boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.08)',
                        }}
                    />

                    <div style={{ fontSize: 10, fontWeight: 700, color: '#666', margin: '10px 0 4px' }}>背景</div>
                    <textarea
                        value={backstory}
                        onChange={event => setBackstory(event.target.value)}
                        rows={4}
                        style={{
                            width: '100%',
                            padding: '6px 8px',
                            fontSize: 10,
                            background: 'white',
                            border: '2px solid rgba(0,0,0,0.15)',
                            borderRadius: 4,
                            outline: 'none',
                            color: '#333',
                            resize: 'vertical',
                            boxShadow: 'inset 1px 1px 3px rgba(0,0,0,0.08)',
                        }}
                    />
                </div>

                <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                    <button
                        onClick={handleSave}
                        className="retro-btn retro-btn-primary w-full flex items-center justify-center gap-1"
                        style={{ padding: '7px 12px' }}
                    >
                        <CheckCircle size={12} weight="bold" /> 保存设定
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NPCEditorPanel;
