import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { ArrowLeft, UploadSimple, Trash, Wrench, Warning } from '@phosphor-icons/react';
import { DB } from '../utils/db';
import type { CustomCreatorPart } from '../types';

// 与捏人器 character_creator.html 里 PARTS 的 key 一一对应
const CC_CATEGORIES: { key: string; label: string; multi?: boolean }[] = [
    { key: 'skin', label: '肤色' },
    { key: 'eyes', label: '眼睛' },
    { key: 'mouth', label: '嘴' },
    { key: 'fronthair', label: '前发' },
    { key: 'earhair', label: '耳发' },
    { key: 'back1', label: '后发1' },
    { key: 'back2', label: '后发2' },
    { key: 'outfit', label: '衣服' },
    { key: 'outer', label: '外套' },
    { key: 'facemark', label: '面纹', multi: true },
    { key: 'decor', label: '配饰', multi: true },
];
const labelOf = (key: string) => CC_CATEGORIES.find(c => c.key === key)?.label || key;

const CharCreatorDevApp: React.FC = () => {
    const { closeApp, addToast } = useOS();
    const [parts, setParts] = useState<CustomCreatorPart[]>([]);
    const [categoryKey, setCategoryKey] = useState('fronthair');
    const [name, setName] = useState('');
    const [tintable, setTintable] = useState(false);
    const [src, setSrc] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => setParts(await DB.getCustomCreatorParts()), []);
    useEffect(() => { void load(); }, [load]);

    const onFile = (f: File | undefined) => {
        if (!f) return;
        if (!/png|webp|image/.test(f.type)) { addToast?.('建议用透明 PNG', 'info'); }
        const reader = new FileReader();
        reader.onload = () => setSrc(String(reader.result || ''));
        reader.readAsDataURL(f);
    };

    const save = async () => {
        if (!src) { addToast?.('先选一张图', 'error'); return; }
        const part: CustomCreatorPart = {
            id: `${categoryKey}_cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            categoryKey,
            name: name.trim() || `自定义${labelOf(categoryKey)}`,
            src,
            tintable,
            createdAt: Date.now(),
        };
        await DB.saveCustomCreatorPart(part);
        setName(''); setSrc(''); setTintable(false);
        if (fileRef.current) fileRef.current.value = '';
        await load();
        addToast?.(`已加入「${labelOf(categoryKey)}」`, 'success');
    };

    const remove = async (id: string) => {
        await DB.deleteCustomCreatorPart(id);
        await load();
        addToast?.('已删除', 'success');
    };

    const grouped = useMemo(() => {
        const m: Record<string, CustomCreatorPart[]> = {};
        for (const p of parts) (m[p.categoryKey] ||= []).push(p);
        return m;
    }, [parts]);

    return (
        <div className="h-full w-full flex flex-col text-white" style={{ background: 'linear-gradient(180deg,#1a1f2e 0%,#10131c 100%)' }}>
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
                <button onClick={closeApp} className="p-1.5 -ml-1.5 rounded-full active:bg-white/10"><ArrowLeft size={22} weight="bold" /></button>
                <Wrench size={18} weight="fill" className="text-amber-300" />
                <span className="text-lg font-bold">捏脸部件 · 开发</span>
                <span className="ml-auto text-[10px] text-white/40">{parts.length} 个自定义</span>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {/* 提示 */}
                <div className="rounded-xl p-3 border border-amber-400/30 bg-amber-400/10 flex gap-2">
                    <Warning size={16} weight="fill" className="text-amber-300 mt-0.5 shrink-0" />
                    <div className="text-[10.5px] text-amber-100/90 leading-relaxed">
                        部件须是<b>透明背景 PNG</b>，且与捏人器画布<b>同尺寸、同锚点</b>（整幅图按位置叠层），否则会错位。
                        新部件会注入到「特别时光」和「彼方」的捏人器里——<b>下次打开捏人器</b>时生效。
                    </div>
                </div>

                {/* 新增表单 */}
                <div className="rounded-xl p-3 border border-white/10 space-y-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="text-[12px] font-bold text-white/90">追加部件</div>
                    {/* 类目 */}
                    <div>
                        <div className="text-[10px] text-white/50 mb-1">类目</div>
                        <div className="flex flex-wrap gap-1.5">
                            {CC_CATEGORIES.map(c => (
                                <button key={c.key} onClick={() => setCategoryKey(c.key)}
                                    className={`text-[11px] rounded-full px-2.5 py-1 font-semibold ${categoryKey === c.key ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70'}`}>
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* 图片 */}
                    <input ref={fileRef} type="file" accept="image/png,image/webp,image/*" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                    <button onClick={() => fileRef.current?.click()}
                        className="w-full rounded-lg border border-dashed border-white/30 py-6 flex flex-col items-center justify-center gap-1 active:bg-white/5">
                        {src ? (
                            <img src={src} alt="" className="max-h-28 object-contain" style={{ background: 'repeating-conic-gradient(#0003 0% 25%, transparent 0% 50%) 50% / 16px 16px' }} />
                        ) : (
                            <><UploadSimple size={20} weight="bold" className="text-white/60" /><span className="text-[11px] text-white/50">选择部件图（透明 PNG）</span></>
                        )}
                    </button>
                    {/* 名称 + tintable */}
                    <input value={name} onChange={e => setName(e.target.value)} placeholder={`名称（默认「自定义${labelOf(categoryKey)}」）`}
                        className="w-full rounded-lg bg-white/8 px-3 py-2 text-[13px] text-white placeholder-white/40 outline-none" />
                    <label className="flex items-center gap-2 text-[12px] text-white/80">
                        <input type="checkbox" checked={tintable} onChange={e => setTintable(e.target.checked)} className="accent-amber-400 w-4 h-4" />
                        可换色（tintable）—— 仅当这张图是单色线稿/可着色层时勾选
                    </label>
                    <button onClick={save} disabled={!src}
                        className="w-full rounded-xl py-2.5 text-[13px] font-bold text-black disabled:opacity-40" style={{ background: 'linear-gradient(135deg,#fbbf24,#f59e0b)' }}>
                        加入捏人器
                    </button>
                </div>

                {/* 已有列表 */}
                {parts.length === 0 ? (
                    <p className="text-[11px] text-white/40 py-4 text-center">还没有自定义部件。</p>
                ) : (
                    <div className="space-y-3">
                        {Object.keys(grouped).map(key => (
                            <div key={key}>
                                <div className="text-[11px] font-bold text-white/60 mb-1.5">{labelOf(key)} · {grouped[key].length}</div>
                                <div className="grid grid-cols-3 gap-2">
                                    {grouped[key].map(p => (
                                        <div key={p.id} className="relative rounded-lg overflow-hidden border border-white/10 aspect-square flex items-center justify-center"
                                            style={{ background: 'repeating-conic-gradient(#ffffff10 0% 25%, transparent 0% 50%) 50% / 14px 14px' }}>
                                            <img src={p.src} alt={p.name} className="max-h-full max-w-full object-contain" />
                                            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8.5px] text-white/90 px-1 py-0.5 truncate">{p.name}{p.tintable ? ' ·色' : ''}</span>
                                            <button onClick={() => remove(p.id)} className="absolute top-1 right-1 bg-red-500/90 rounded-full p-1 active:scale-90"><Trash size={11} weight="bold" /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CharCreatorDevApp;
