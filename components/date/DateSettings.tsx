
import React, { useState, useRef, useEffect } from 'react';
import { useOS } from '../../context/OSContext';
import { CharacterProfile, SpriteConfig, SkinSet } from '../../types';
import { processImage } from '../../utils/file';

// 标准情绪列表
const REQUIRED_EMOTIONS = ['normal', 'happy', 'angry', 'sad', 'shy'];
const DEFAULT_SPRITE_CONFIG: SpriteConfig = { scale: 1, x: 0, y: 0 };

interface DateSettingsProps {
    char: CharacterProfile;
    onBack: () => void;
}

const DateSettings: React.FC<DateSettingsProps> = ({ char, onBack }) => {
    const { updateCharacter, addToast } = useOS();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [uploadTarget, setUploadTarget] = useState<'bg' | 'sprite' | 'skin-sprite'>('bg');
    const [targetEmotionKey, setTargetEmotionKey] = useState<string>('');
    const [tempSpriteConfig, setTempSpriteConfig] = useState<SpriteConfig>(DEFAULT_SPRITE_CONFIG);
    const [newEmotionName, setNewEmotionName] = useState<string>('');

    // Skin system state
    const [newSkinName, setNewSkinName] = useState('');
    const [editingSkinId, setEditingSkinId] = useState<string | null>(null);
    const [skinUrlInput, setSkinUrlInput] = useState('');
    const [skinUrlEmotionKey, setSkinUrlEmotionKey] = useState('');
    const [showUrlModal, setShowUrlModal] = useState(false);
    const [urlTargetSkinId, setUrlTargetSkinId] = useState<string | null>(null); // null = default sprites
    const skinSets = char.dateSkinSets || [];
    const activeSkinId = char.activeSkinSetId || null;

    // Sync config on mount
    useEffect(() => {
        if (char.spriteConfig) {
            setTempSpriteConfig(char.spriteConfig);
        }
    }, [char.id]);

    const sprites = char.sprites || {};
    // Preview shows active skin set's sprites if one is selected
    const previewSprites = React.useMemo(() => {
        if (activeSkinId) {
            const skin = skinSets.find(s => s.id === activeSkinId);
            if (skin && Object.keys(skin.sprites).length > 0) return skin.sprites;
        }
        return sprites;
    }, [activeSkinId, skinSets, sprites]);
    const currentSpriteImg = previewSprites['normal'] || previewSprites['default'] || Object.values(previewSprites)[0] || char.avatar;

    const triggerUpload = (target: 'bg' | 'sprite', emotionKey?: string) => {
        setUploadTarget(target);
        if (emotionKey) setTargetEmotionKey(emotionKey);
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const base64 = await processImage(file);
            if (uploadTarget === 'bg') {
                updateCharacter(char.id, { dateBackground: base64 });
                addToast('背景已更新', 'success');
            } else if (uploadTarget === 'skin-sprite') {
                // Upload to a specific skin set
                const key = targetEmotionKey.trim().toLowerCase();
                const skinId = editingSkinId;
                if (!key || !skinId) { addToast('参数丢失', 'error'); return; }
                const updatedSets = (char.dateSkinSets || []).map(s =>
                    s.id === skinId ? { ...s, sprites: { ...s.sprites, [key]: base64 } } : s
                );
                updateCharacter(char.id, { dateSkinSets: updatedSets });
                addToast(`皮肤立绘 [${key}] 已保存`, 'success');
                setTargetEmotionKey('');
            } else {
                const key = targetEmotionKey.trim().toLowerCase();
                if (!key) { addToast('情绪Key丢失', 'error'); return; }
                const newSprites = { ...(char.sprites || {}), [key]: base64 };
                updateCharacter(char.id, { sprites: newSprites });
                addToast(`立绘 [${key}] 已保存`, 'success');
                setTargetEmotionKey('');
            }
        } catch (e: any) {
            addToast(e.message, 'error');
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // --- Skin Set Management ---
    const handleCreateSkinSet = () => {
        const name = newSkinName.trim();
        if (!name) { addToast('请输入皮肤名称', 'error'); return; }
        if (skinSets.some(s => s.name === name)) { addToast('该名称已存在', 'error'); return; }
        const newSkin: SkinSet = { id: `skin_${Date.now()}`, name, sprites: {} };
        updateCharacter(char.id, { dateSkinSets: [...skinSets, newSkin] });
        setNewSkinName('');
        addToast(`皮肤 [${name}] 已创建`, 'success');
    };

    const handleDeleteSkinSet = (skinId: string) => {
        const updated = skinSets.filter(s => s.id !== skinId);
        const patch: Partial<CharacterProfile> = { dateSkinSets: updated };
        if (activeSkinId === skinId) patch.activeSkinSetId = undefined;
        updateCharacter(char.id, patch);
        if (editingSkinId === skinId) setEditingSkinId(null);
        addToast('已删除皮肤', 'success');
    };

    const handleActivateSkin = (skinId: string | null) => {
        updateCharacter(char.id, { activeSkinSetId: skinId || undefined });
        addToast(skinId ? '已切换皮肤' : '已切换为默认立绘', 'success');
    };

    const triggerSkinSpriteUpload = (skinId: string, emotionKey: string) => {
        setUploadTarget('skin-sprite');
        setEditingSkinId(skinId);
        setTargetEmotionKey(emotionKey);
        fileInputRef.current?.click();
    };

    const handleUrlSubmit = () => {
        const url = skinUrlInput.trim();
        const key = skinUrlEmotionKey.trim().toLowerCase();
        if (!url || !key) { addToast('请填写完整', 'error'); return; }
        // Basic URL validation
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            addToast('请输入有效的 URL (http/https)', 'error'); return;
        }

        if (urlTargetSkinId) {
            // Save to skin set
            const updatedSets = (char.dateSkinSets || []).map(s =>
                s.id === urlTargetSkinId ? { ...s, sprites: { ...s.sprites, [key]: url } } : s
            );
            updateCharacter(char.id, { dateSkinSets: updatedSets });
        } else {
            // Save to default sprites
            const newSprites = { ...(char.sprites || {}), [key]: url };
            updateCharacter(char.id, { sprites: newSprites });
        }
        addToast(`立绘 [${key}] URL 已保存`, 'success');
        setSkinUrlInput('');
        setSkinUrlEmotionKey('');
        setShowUrlModal(false);
    };

    const handleSaveSettings = () => {
        updateCharacter(char.id, { spriteConfig: tempSpriteConfig });
        addToast('配置已保存', 'success');
        onBack();
    };

    const customEmotions = char.customDateSprites || [];

    const handleAddCustomEmotion = () => {
        const key = newEmotionName.trim().toLowerCase().replace(/\s+/g, '_');
        if (!key) { addToast('请输入情绪名称', 'error'); return; }
        if (REQUIRED_EMOTIONS.includes(key)) { addToast('该名称与默认情绪重复', 'error'); return; }
        if (customEmotions.includes(key)) { addToast('该自定义情绪已存在', 'error'); return; }
        if (key === 'chibi') { addToast('不能使用 chibi 作为情绪名', 'error'); return; }
        const updated = [...customEmotions, key];
        updateCharacter(char.id, { customDateSprites: updated });
        setNewEmotionName('');
        addToast(`已添加自定义情绪 [${key}]`, 'success');
    };

    const handleDeleteCustomEmotion = (key: string) => {
        const updated = customEmotions.filter(e => e !== key);
        updateCharacter(char.id, { customDateSprites: updated });
        // Also remove the sprite image for this emotion
        const newSprites = { ...(char.sprites || {}) };
        delete newSprites[key];
        updateCharacter(char.id, { sprites: newSprites, customDateSprites: updated });
        addToast(`已删除自定义情绪 [${key}]`, 'success');
    };

    return (
        <div className="h-full w-full bg-slate-50 flex flex-col">
            <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 bg-white shrink-0 z-20">
                <button onClick={onBack} className="p-2 -ml-2 text-slate-600 active:scale-95 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>
                <span className="font-bold text-slate-700">场景布置</span>
                <div className="w-8"></div>
            </div>
            
            {/* Live Preview Area */}
            <div className="h-64 bg-black relative overflow-hidden shrink-0 border-b border-slate-200">
                    <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: char.dateBackground ? `url(${char.dateBackground})` : 'none' }}></div>
                    <div className="absolute inset-0 flex items-end justify-center pointer-events-none">
                        <img 
                        src={currentSpriteImg}
                        className="max-h-[90%] object-contain transition-transform"
                        style={{ 
                            transform: `translate(${tempSpriteConfig.x}%, ${tempSpriteConfig.y}%) scale(${tempSpriteConfig.scale})`
                        }}
                        />
                    </div>
                    <div className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-2 py-1 rounded backdrop-blur-sm">预览 (Preview)</div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-8 pb-20">
                <section className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-4">立绘位置调整</h3>
                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-2"><span>大小缩放 (Scale)</span><span>{tempSpriteConfig.scale.toFixed(1)}x</span></div>
                            <input type="range" min="0.5" max="2.0" step="0.1" value={tempSpriteConfig.scale} onChange={e => setTempSpriteConfig({...tempSpriteConfig, scale: parseFloat(e.target.value)})} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary" />
                        </div>
                        <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-2"><span>左右偏移 (X)</span><span>{tempSpriteConfig.x}%</span></div>
                            <input type="range" min="-100" max="100" step="5" value={tempSpriteConfig.x} onChange={e => setTempSpriteConfig({...tempSpriteConfig, x: parseInt(e.target.value)})} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary" />
                        </div>
                            <div>
                            <div className="flex justify-between text-[10px] text-slate-500 mb-2"><span>上下偏移 (Y)</span><span>{tempSpriteConfig.y}%</span></div>
                            <input type="range" min="-50" max="50" step="5" value={tempSpriteConfig.y} onChange={e => setTempSpriteConfig({...tempSpriteConfig, y: parseInt(e.target.value)})} className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary" />
                        </div>
                    </div>
                </section>

                <section className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-xs font-bold text-slate-400 uppercase">浅色阅读模式</h3>
                            <p className="text-[11px] text-slate-400 mt-1">小说视图使用浅色背景，减少眼睛疲劳</p>
                        </div>
                        <button
                            onClick={() => updateCharacter(char.id, { dateLightReading: !char.dateLightReading })}
                            className={`w-12 h-7 rounded-full transition-colors relative ${char.dateLightReading ? 'bg-primary' : 'bg-slate-200'}`}
                        >
                            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform ${char.dateLightReading ? 'translate-x-5' : 'translate-x-0.5'}`}></div>
                        </button>
                    </div>
                </section>

                <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">背景 (Background)</h3>
                    <div 
                        onClick={() => triggerUpload('bg')}
                        className="aspect-video bg-slate-200 rounded-xl overflow-hidden relative border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:border-primary group"
                    >
                        {char.dateBackground ? (
                            <>
                                <img src={char.dateBackground} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><span className="text-white text-xs font-bold">更换背景</span></div>
                            </>
                        ) : <span className="text-slate-400 text-xs">+ 上传背景图</span>}
                    </div>
                </section>
                
                <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">基础情绪立绘</h3>
                    <div className="grid grid-cols-3 gap-3">
                        {REQUIRED_EMOTIONS.map(key => (
                            <div key={key} onClick={() => triggerUpload('sprite', key)} className="flex flex-col gap-2 group cursor-pointer">
                                <div className={`aspect-[3/4] rounded-xl overflow-hidden relative border ${sprites[key] ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-100'} shadow-sm flex items-center justify-center transition-all group-hover:border-primary`}>
                                    {sprites[key] ? (
                                        <>
                                            <img src={sprites[key]} className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><span className="text-white text-[10px]">更换</span></div>
                                        </>
                                    ) : <span className="text-slate-300 text-2xl">+</span>}
                                </div>
                                <div className="text-center">
                                    <div className="text-xs font-bold text-slate-600 capitalize">{key}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">自定义情绪 (Custom Emotions)</h3>
                    <p className="text-[11px] text-slate-400 mb-4">为该角色添加专属情绪，AI 会在见面时使用。每个角色的自定义情绪互相独立。</p>

                    {/* Existing custom emotions grid */}
                    {customEmotions.length > 0 && (
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            {customEmotions.map(key => (
                                <div key={key} className="flex flex-col gap-2 group relative">
                                    <div
                                        onClick={() => triggerUpload('sprite', key)}
                                        className={`aspect-[3/4] rounded-xl overflow-hidden relative border ${sprites[key] ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-100'} shadow-sm flex items-center justify-center transition-all group-hover:border-primary cursor-pointer`}
                                    >
                                        {sprites[key] ? (
                                            <>
                                                <img src={sprites[key]} className="w-full h-full object-cover" />
                                                <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><span className="text-white text-[10px]">更换</span></div>
                                            </>
                                        ) : <span className="text-slate-300 text-2xl">+</span>}
                                    </div>
                                    <div className="text-center flex items-center justify-center gap-1">
                                        <div className="text-xs font-bold text-slate-600 capitalize truncate">{key}</div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteCustomEmotion(key); }}
                                            className="text-slate-300 hover:text-red-400 transition-colors shrink-0"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Add new custom emotion */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newEmotionName}
                            onChange={e => setNewEmotionName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddCustomEmotion(); }}
                            placeholder="输入情绪名 (如 scared, excited...)"
                            className="flex-1 px-4 py-3 bg-slate-100 rounded-xl text-sm focus:ring-1 focus:ring-primary/30 outline-none transition-all"
                        />
                        <button
                            onClick={handleAddCustomEmotion}
                            disabled={!newEmotionName.trim()}
                            className="px-5 py-3 bg-primary text-white text-sm font-bold rounded-xl disabled:opacity-40 active:scale-95 transition-all"
                        >
                            添加
                        </button>
                    </div>
                </section>

                {/* URL Upload for Default Sprites */}
                <section className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-slate-400 uppercase">图床 URL 上传</h3>
                    </div>
                    <p className="text-[11px] text-slate-400 mb-3">直接粘贴图片 URL 作为默认立绘</p>
                    <button
                        onClick={() => { setUrlTargetSkinId(null); setShowUrlModal(true); }}
                        className="w-full py-2.5 bg-slate-100 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-200 transition-colors active:scale-95"
                    >
                        + 通过 URL 添加立绘
                    </button>
                </section>

                {/* Skin Sets System */}
                <section>
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">皮肤系统 (Skin Sets)</h3>
                    <p className="text-[11px] text-slate-400 mb-4">为角色创建多套立绘皮肤。切换皮肤后，AI 将使用对应皮肤的表情立绘。</p>

                    {/* Active skin indicator */}
                    <div className="mb-4 flex items-center gap-2 text-xs">
                        <span className="text-slate-400">当前激活:</span>
                        <span className="font-bold text-slate-700">{activeSkinId ? (skinSets.find(s => s.id === activeSkinId)?.name || '未知') : '默认立绘'}</span>
                        {activeSkinId && (
                            <button onClick={() => handleActivateSkin(null)} className="text-[10px] text-primary underline">切回默认</button>
                        )}
                    </div>

                    {/* Existing skin sets */}
                    <div className="space-y-3 mb-4">
                        {skinSets.map(skin => (
                            <div key={skin.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${activeSkinId === skin.id ? 'border-primary ring-1 ring-primary/20' : 'border-slate-100'}`}>
                                <div className="p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-sm text-slate-700">{skin.name}</span>
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{Object.keys(skin.sprites).length} 个表情</span>
                                        {activeSkinId === skin.id && <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold">使用中</span>}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {activeSkinId !== skin.id && (
                                            <button onClick={() => handleActivateSkin(skin.id)} className="text-[10px] text-primary font-bold px-2 py-1 rounded-lg hover:bg-primary/5 transition-colors">激活</button>
                                        )}
                                        <button onClick={() => setEditingSkinId(editingSkinId === skin.id ? null : skin.id)} className="text-[10px] text-slate-500 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors">
                                            {editingSkinId === skin.id ? '收起' : '编辑'}
                                        </button>
                                        <button onClick={() => handleDeleteSkinSet(skin.id)} className="text-slate-300 hover:text-red-400 transition-colors p-1">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                                        </button>
                                    </div>
                                </div>

                                {/* Expanded edit view */}
                                {editingSkinId === skin.id && (
                                    <div className="border-t border-slate-100 p-3">
                                        <div className="grid grid-cols-3 gap-2 mb-3">
                                            {[...REQUIRED_EMOTIONS, ...(char.customDateSprites || [])].map(emoKey => (
                                                <div key={emoKey} onClick={() => triggerSkinSpriteUpload(skin.id, emoKey)} className="flex flex-col gap-1 group cursor-pointer">
                                                    <div className={`aspect-[3/4] rounded-lg overflow-hidden relative border ${skin.sprites[emoKey] ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50'} flex items-center justify-center transition-all group-hover:border-primary`}>
                                                        {skin.sprites[emoKey] ? (
                                                            <>
                                                                <img src={skin.sprites[emoKey]} className="w-full h-full object-cover" />
                                                                <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><span className="text-white text-[9px]">更换</span></div>
                                                            </>
                                                        ) : <span className="text-slate-300 text-lg">+</span>}
                                                    </div>
                                                    <div className="text-[10px] font-bold text-slate-500 capitalize text-center truncate">{emoKey}</div>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => { setUrlTargetSkinId(skin.id); setShowUrlModal(true); }}
                                            className="w-full py-2 bg-slate-50 text-slate-500 text-[11px] font-medium rounded-lg hover:bg-slate-100 transition-colors"
                                        >
                                            + 通过 URL 添加立绘到此皮肤
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Create new skin set */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newSkinName}
                            onChange={e => setNewSkinName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleCreateSkinSet(); }}
                            placeholder="皮肤名称 (如 冬装、泳装...)"
                            className="flex-1 px-4 py-3 bg-slate-100 rounded-xl text-sm focus:ring-1 focus:ring-primary/30 outline-none transition-all"
                        />
                        <button
                            onClick={handleCreateSkinSet}
                            disabled={!newSkinName.trim()}
                            className="px-5 py-3 bg-primary text-white text-sm font-bold rounded-xl disabled:opacity-40 active:scale-95 transition-all"
                        >
                            创建
                        </button>
                    </div>
                </section>

                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />
            </div>

            {/* URL Input Modal */}
            {showUrlModal && (
                <div className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowUrlModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-100">
                            <h3 className="font-bold text-slate-700 text-sm">通过 URL 添加立绘</h3>
                            <p className="text-[11px] text-slate-400 mt-1">{urlTargetSkinId ? `目标: ${skinSets.find(s => s.id === urlTargetSkinId)?.name}` : '目标: 默认立绘'}</p>
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <label className="text-[11px] text-slate-500 font-bold mb-1 block">情绪 Key</label>
                                <select
                                    value={skinUrlEmotionKey}
                                    onChange={e => setSkinUrlEmotionKey(e.target.value)}
                                    className="w-full px-3 py-2.5 bg-slate-100 rounded-xl text-sm outline-none"
                                >
                                    <option value="">选择情绪...</option>
                                    {[...REQUIRED_EMOTIONS, ...(char.customDateSprites || [])].map(k => (
                                        <option key={k} value={k}>{k}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-[11px] text-slate-500 font-bold mb-1 block">图片 URL</label>
                                <input
                                    type="text"
                                    value={skinUrlInput}
                                    onChange={e => setSkinUrlInput(e.target.value)}
                                    placeholder="https://example.com/sprite.png"
                                    className="w-full px-3 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-1 focus:ring-primary/30"
                                />
                            </div>
                            {skinUrlInput && skinUrlInput.startsWith('http') && (
                                <div className="bg-slate-50 rounded-xl p-2 flex items-center justify-center h-24">
                                    <img src={skinUrlInput} className="max-h-full max-w-full object-contain rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 flex gap-2">
                            <button onClick={() => setShowUrlModal(false)} className="flex-1 py-2.5 bg-slate-100 text-slate-600 font-bold text-sm rounded-xl">取消</button>
                            <button onClick={handleUrlSubmit} disabled={!skinUrlInput.trim() || !skinUrlEmotionKey} className="flex-1 py-2.5 bg-primary text-white font-bold text-sm rounded-xl disabled:opacity-40 active:scale-95 transition-all">确认添加</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="p-4 border-t border-slate-200 bg-white/90 backdrop-blur-sm sticky bottom-0 z-20">
                <button onClick={handleSaveSettings} className="w-full py-3 bg-primary text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-transform">
                    保存当前布置
                </button>
            </div>
        </div>
    );
};

export default DateSettings;
