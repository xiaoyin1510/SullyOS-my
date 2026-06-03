/**
 * 新建 Tracker 面板(底部 sheet)
 *
 * 两屏:
 *  Tab "模板"   — 6 个内置模板列表,已启用的标"已添加",未添加点一下立即启用
 *  Tab "自由"   — 简易自定义构建:name + icon + color + 1 个主字段(kind+label)
 *               复杂多字段编辑等以后再做,暂时让 user 先有"造一个属于自己的"通道
 */

import React, { useState } from 'react';
import { Tracker, TrackerField, TrackerFieldKind } from '../../types';
import { TRACKER_TEMPLATES, instantiateTemplate, TrackerTemplate } from '../../utils/trackerSeeds';
import { DB } from '../../utils/db';
import { PAPER_TONES, SERIF_STACK, CUTE_STACK, WashiTape } from './paper';
import { HeartSticker, StarSticker, SparkleDot } from './stickers';
import { X, Sparkle, Plus, Check } from '@phosphor-icons/react';

interface Props {
    visible: boolean;
    existingTrackers: Tracker[];
    onCancel: () => void;
    onCreated: (tracker: Tracker) => void;
}

const COLOR_SWATCHES = [
    { name: 'rose',     value: PAPER_TONES.accentRose },
    { name: 'blush',    value: PAPER_TONES.accentBlush },
    { name: 'lavender', value: PAPER_TONES.accentLavender },
    { name: 'blue',     value: PAPER_TONES.accentBlue },
    { name: 'sky',      value: PAPER_TONES.accentSky },
    { name: 'mint',     value: PAPER_TONES.accentMint },
    { name: 'lemon',    value: PAPER_TONES.accentLemon },
    { name: 'silver',   value: PAPER_TONES.accentSilver },
];

const ICON_SUGGEST = ['🌸','🌷','🌼','🌻','🌹','🍰','🍵','💧','🪶','📖','✨','🤒','💖','🐱','☕','🌙','🍓','🌿','📷','🏃'];

const FIELD_KINDS: { kind: TrackerFieldKind; label: string; hint: string }[] = [
    { kind: 'rating',  label: '评分',     hint: '1~5 星 / 5 个 emoji' },
    { kind: 'text',    label: '一句话',   hint: '随手写一句' },
    { kind: 'number',  label: '数字',     hint: '比如杯数 / 体重' },
    { kind: 'boolean', label: '是 / 否',  hint: '简单打个钩' },
];

const TrackerCreateSheet: React.FC<Props> = ({ visible, existingTrackers, onCancel, onCreated }) => {
    const [tab, setTab] = useState<'template' | 'custom'>('template');

    // 自定义状态
    const [customName, setCustomName] = useState('');
    const [customIcon, setCustomIcon] = useState('✨');
    const [customColor, setCustomColor] = useState(PAPER_TONES.accentLavender);
    const [customFieldKind, setCustomFieldKind] = useState<TrackerFieldKind>('rating');
    const [customFieldLabel, setCustomFieldLabel] = useState('');

    if (!visible) return null;

    // 已启用的模板按 templateId 标记(用 name+icon 双匹配,因为系统模板首次创建后名称不会变)
    const isTemplateAdded = (tpl: TrackerTemplate) => {
        return existingTrackers.some(t => t.isBuiltin && t.name === tpl.name && t.icon === tpl.icon);
    };

    const handleAddTemplate = async (tpl: TrackerTemplate) => {
        if (isTemplateAdded(tpl)) return;
        const sortOrder = existingTrackers.length;
        const tracker = instantiateTemplate(tpl, sortOrder);
        await DB.saveTracker(tracker);
        onCreated(tracker);
    };

    const handleCreateCustom = async () => {
        if (!customName.trim()) return;
        const now = Date.now();
        const baseField: TrackerField = (() => {
            const label = customFieldLabel.trim() || customName;
            switch (customFieldKind) {
                case 'rating':
                    return {
                        key: 'rating', label, kind: 'rating', required: true, min: 1, max: 5,
                        choices: [
                            { value: '1', label: '差', emoji: '·' },
                            { value: '2', label: '一般', emoji: '◦' },
                            { value: '3', label: '中', emoji: '◐' },
                            { value: '4', label: '好', emoji: '●' },
                            { value: '5', label: '极好', emoji: '★' },
                        ],
                    };
                case 'number':
                    return { key: 'value', label, kind: 'number', required: true, min: 0, max: 999 };
                case 'boolean':
                    return { key: 'has', label, kind: 'boolean', required: true };
                case 'text':
                default:
                    return { key: 'note', label, kind: 'text', required: true, placeholder: '一句话就好…' };
            }
        })();
        const tracker: Tracker = {
            id: `tracker-custom-${now}`,
            name: customName.trim(),
            icon: customIcon,
            color: customColor,
            schema: [baseField],
            cellRenderField: baseField.key,
            isBuiltin: false,
            sortOrder: existingTrackers.length,
            createdAt: now,
            updatedAt: now,
        };
        await DB.saveTracker(tracker);
        onCreated(tracker);
        // 清空
        setCustomName(''); setCustomIcon('✨'); setCustomColor(PAPER_TONES.accentLavender);
        setCustomFieldKind('rating'); setCustomFieldLabel('');
    };

    return (
        <div
            className="absolute inset-0 z-[60] flex items-end justify-center"
            style={{ background: 'rgba(122,90,114,0.45)', backdropFilter: 'blur(6px)' }}
            onClick={onCancel}
        >
            <div
                className="w-full max-h-[88%] overflow-y-auto rounded-t-3xl relative"
                style={{
                    background: PAPER_TONES.paper,
                    boxShadow: '0 -8px 28px rgba(122,90,114,0.25)',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* 顶部把手 */}
                <div className="flex justify-center pt-3 pb-1">
                    <div style={{ width: 40, height: 4, borderRadius: 2, background: PAPER_TONES.accentLavender, opacity: 0.5 }} />
                </div>

                {/* 装饰 */}
                <div className="absolute top-4 left-5 pointer-events-none" style={{ transform: 'rotate(-15deg)' }}>
                    <HeartSticker size={18} color={PAPER_TONES.accentLavender} />
                </div>
                <div className="absolute top-5 right-7 pointer-events-none" style={{ transform: 'rotate(20deg)' }}>
                    <StarSticker size={16} color={PAPER_TONES.accentLemon} />
                </div>

                {/* 标题 */}
                <div className="px-5 pt-2 pb-2 text-center">
                    <WashiTape color="lavender" pattern="star" rotate={-1.5}>
                        新 建 Tracker ♡
                    </WashiTape>
                    <div
                        className="text-[11px] mt-3"
                        style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                    >
                        从模板挑一个 · 或者从零造一个属于你的
                    </div>
                </div>

                {/* Tab 切换 */}
                <div className="flex gap-2 px-5 mb-3">
                    <button
                        onClick={() => setTab('template')}
                        className="flex-1 py-2 rounded-full text-[12px] font-bold active:scale-95 transition"
                        style={{
                            ...CUTE_STACK,
                            background: tab === 'template' ? PAPER_TONES.accentLavender : 'transparent',
                            color: tab === 'template' ? '#fff' : PAPER_TONES.inkSoft,
                            border: `1.5px solid ${PAPER_TONES.accentLavender}`,
                        }}
                    >
                        ✦ 模 板
                    </button>
                    <button
                        onClick={() => setTab('custom')}
                        className="flex-1 py-2 rounded-full text-[12px] font-bold active:scale-95 transition"
                        style={{
                            ...CUTE_STACK,
                            background: tab === 'custom' ? PAPER_TONES.accentLavender : 'transparent',
                            color: tab === 'custom' ? '#fff' : PAPER_TONES.inkSoft,
                            border: `1.5px solid ${PAPER_TONES.accentLavender}`,
                        }}
                    >
                        ✦ 从 零 造
                    </button>
                </div>

                {/* 内容区 */}
                {tab === 'template' ? (
                    <TemplateGallery
                        templates={TRACKER_TEMPLATES}
                        isAdded={isTemplateAdded}
                        onAdd={handleAddTemplate}
                    />
                ) : (
                    <CustomBuilder
                        name={customName} setName={setCustomName}
                        icon={customIcon} setIcon={setCustomIcon}
                        color={customColor} setColor={setCustomColor}
                        fieldKind={customFieldKind} setFieldKind={setCustomFieldKind}
                        fieldLabel={customFieldLabel} setFieldLabel={setCustomFieldLabel}
                        onCreate={handleCreateCustom}
                    />
                )}

                {/* 底部 cancel */}
                <div
                    className="sticky bottom-0 px-5 py-3 flex justify-center"
                    style={{ background: PAPER_TONES.paper, borderTop: `1.5px solid ${PAPER_TONES.spine}` }}
                >
                    <button
                        onClick={onCancel}
                        className="px-6 py-2.5 rounded-full text-[12px] font-bold active:scale-95 transition flex items-center gap-1"
                        style={{
                            ...CUTE_STACK,
                            color: PAPER_TONES.inkSoft,
                            background: '#fff',
                            border: `1.5px solid ${PAPER_TONES.spine}`,
                        }}
                    >
                        <X className="w-3.5 h-3.5" /> 关上
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── 模板 Gallery ──────────────────────────────────
const TemplateGallery: React.FC<{
    templates: TrackerTemplate[];
    isAdded: (t: TrackerTemplate) => boolean;
    onAdd: (t: TrackerTemplate) => void;
}> = ({ templates, isAdded, onAdd }) => (
    <div className="px-5 pb-3 space-y-2">
        {templates.map(tpl => {
            const added = isAdded(tpl);
            return (
                <button
                    key={tpl.templateId}
                    onClick={() => !added && onAdd(tpl)}
                    disabled={added}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl transition active:scale-[0.99] text-left"
                    style={{
                        background: added ? 'rgba(220,199,213,0.18)' : '#fff',
                        border: `1.5px solid ${added ? PAPER_TONES.spine : tpl.color}`,
                        opacity: added ? 0.55 : 1,
                        boxShadow: added ? 'none' : '0 1px 3px rgba(122,90,114,0.08)',
                    }}
                >
                    <div
                        className="w-11 h-11 rounded-full flex items-center justify-center text-2xl shrink-0"
                        style={{
                            background: `${tpl.color}33`,
                            border: `2px solid ${tpl.color}`,
                        }}
                    >
                        {tpl.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div
                            className="text-[14px] font-bold"
                            style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}
                        >
                            {tpl.name}
                        </div>
                        <div
                            className="text-[11px] mt-0.5"
                            style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                        >
                            {tpl.blurb}
                        </div>
                    </div>
                    <div className="shrink-0">
                        {added ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>
                                <Check className="w-3 h-3" weight="bold" />
                                已添加
                            </span>
                        ) : (
                            <span
                                className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full"
                                style={{
                                    ...CUTE_STACK,
                                    background: tpl.color,
                                    color: '#fff',
                                }}
                            >
                                <Plus className="w-3 h-3" weight="bold" />
                                启用
                            </span>
                        )}
                    </div>
                </button>
            );
        })}
    </div>
);

// ─── 自定义 Builder ────────────────────────────────
const CustomBuilder: React.FC<{
    name: string; setName: (v: string) => void;
    icon: string; setIcon: (v: string) => void;
    color: string; setColor: (v: string) => void;
    fieldKind: TrackerFieldKind; setFieldKind: (v: TrackerFieldKind) => void;
    fieldLabel: string; setFieldLabel: (v: string) => void;
    onCreate: () => void;
}> = ({ name, setName, icon, setIcon, color, setColor, fieldKind, setFieldKind, fieldLabel, setFieldLabel, onCreate }) => (
    <div className="px-5 pb-3 space-y-4">
        {/* 名字 */}
        <div>
            <Label>这个 tracker 叫什么</Label>
            <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="今天有没有偏头痛 / 今天读了多久书 …"
                className="w-full outline-none rounded-lg px-3 py-2.5"
                style={{
                    ...SERIF_STACK,
                    fontSize: 15,
                    background: '#fff',
                    border: `1.5px solid ${PAPER_TONES.spine}`,
                    color: PAPER_TONES.ink,
                }}
            />
        </div>

        {/* 图标 */}
        <div>
            <Label>挑个图标</Label>
            <div className="flex flex-wrap gap-2">
                {ICON_SUGGEST.map(em => (
                    <button
                        key={em}
                        onClick={() => setIcon(em)}
                        className="w-9 h-9 rounded-full flex items-center justify-center text-lg active:scale-95 transition"
                        style={{
                            background: icon === em ? color + '33' : '#fff',
                            border: `1.5px solid ${icon === em ? color : PAPER_TONES.spine}`,
                        }}
                    >
                        {em}
                    </button>
                ))}
            </div>
        </div>

        {/* 颜色 */}
        <div>
            <Label>挑个颜色</Label>
            <div className="flex flex-wrap gap-2">
                {COLOR_SWATCHES.map(s => (
                    <button
                        key={s.name}
                        onClick={() => setColor(s.value)}
                        className="w-7 h-7 rounded-full active:scale-95 transition"
                        style={{
                            background: s.value,
                            border: color === s.value ? '2.5px solid #fff' : '2px solid transparent',
                            boxShadow: color === s.value ? `0 0 0 2px ${s.value}` : '0 1px 2px rgba(0,0,0,0.1)',
                        }}
                        aria-label={s.name}
                    />
                ))}
            </div>
        </div>

        {/* 主字段 */}
        <div>
            <Label>每天打卡时,需要填什么</Label>
            <div className="grid grid-cols-2 gap-2 mb-2">
                {FIELD_KINDS.map(fk => {
                    const active = fieldKind === fk.kind;
                    return (
                        <button
                            key={fk.kind}
                            onClick={() => setFieldKind(fk.kind)}
                            className="px-3 py-2 rounded-lg active:scale-95 transition text-left"
                            style={{
                                background: active ? color + '22' : '#fff',
                                border: `1.5px solid ${active ? color : PAPER_TONES.spine}`,
                            }}
                        >
                            <div className="text-[13px] font-bold" style={{ ...CUTE_STACK, color: PAPER_TONES.ink }}>
                                {fk.label}
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>
                                {fk.hint}
                            </div>
                        </button>
                    );
                })}
            </div>
            <input
                type="text"
                value={fieldLabel}
                onChange={e => setFieldLabel(e.target.value)}
                placeholder={`字段标签(留空就用"${name || '名字'}")`}
                className="w-full outline-none rounded-lg px-3 py-2"
                style={{
                    ...SERIF_STACK,
                    fontSize: 13,
                    background: '#fff',
                    border: `1px solid ${PAPER_TONES.spine}`,
                    color: PAPER_TONES.ink,
                }}
            />
        </div>

        {/* 预览 */}
        <div
            className="rounded-xl px-3 py-3 flex items-center gap-3"
            style={{
                background: '#fff',
                border: `1.5px dashed ${color}`,
            }}
        >
            <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                style={{ background: `${color}33`, border: `2px solid ${color}` }}
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-[10px] tracking-[0.3em]" style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}>
                    PREVIEW
                </div>
                <div className="text-[14px] font-bold" style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}>
                    {name || '(还没起名)'}
                </div>
            </div>
            <SparkleDot size={12} color={color} />
        </div>

        {/* 创建按钮 */}
        <button
            onClick={onCreate}
            disabled={!name.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-full text-[14px] font-bold active:scale-95 transition disabled:opacity-40"
            style={{
                ...CUTE_STACK,
                background: `linear-gradient(135deg, ${color} 0%, ${PAPER_TONES.accentBlush} 100%)`,
                color: '#fff',
                boxShadow: `0 2px 6px ${color}66`,
            }}
        >
            <Sparkle weight="fill" className="w-4 h-4" />
            创 建 ♡
        </button>
    </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div
        className="text-[11px] mb-2 tracking-widest"
        style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
    >
        ◆ {children}
    </div>
);

export default TrackerCreateSheet;
