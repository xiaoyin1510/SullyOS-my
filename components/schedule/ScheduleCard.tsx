
import React, { useState, useRef } from 'react';
import { DailySchedule, ScheduleSlot, CharacterProfile } from '../../types';

interface ScheduleCardProps {
    schedule: DailySchedule | null;
    character: CharacterProfile | null;
    contentColor?: string;
    compact?: boolean; // widget mode (no editing)
    onEdit?: (index: number, slot: ScheduleSlot) => void;
    onDelete?: (index: number) => void;
    onReroll?: () => void;
    onCoverImageChange?: (dataUrl: string) => void;
    isGenerating?: boolean;
}

const getCurrentSlotIndex = (slots: ScheduleSlot[]): number => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (let i = slots.length - 1; i >= 0; i--) {
        const [h, m] = slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) return i;
    }
    return -1;
};

const formatDate = (): string => {
    const now = new Date();
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[now.getMonth()]} ${now.getDate()} · ${days[now.getDay()]}`;
};

const ScheduleCard: React.FC<ScheduleCardProps> = ({
    schedule,
    character,
    contentColor = '#ffffff',
    compact = false,
    onEdit,
    onDelete,
    onReroll,
    onCoverImageChange,
    isGenerating = false,
}) => {
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [editTime, setEditTime] = useState('');
    const [editActivity, setEditActivity] = useState('');
    const [editDesc, setEditDesc] = useState('');
    const [editEmoji, setEditEmoji] = useState('');
    const coverInputRef = useRef<HTMLInputElement>(null);

    // 长按菜单状态：记录哪一条日程被长按触发 action sheet（修改 / 删除）
    const [actionIdx, setActionIdx] = useState<number | null>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const LONG_PRESS_MS = 500;

    const startLongPress = (idx: number) => {
        longPressTriggeredRef.current = false;
        if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = true;
            setActionIdx(idx);
        }, LONG_PRESS_MS);
    };

    const cancelLongPress = () => {
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const currentIdx = schedule ? getCurrentSlotIndex(schedule.slots) : -1;
    const charAvatar = character?.avatar;
    const charName = character?.name || '角色';
    const coverImage = schedule?.coverImage;

    const startEdit = (idx: number, slot: ScheduleSlot) => {
        setEditingIdx(idx);
        setEditTime(slot.startTime);
        setEditActivity(slot.activity);
        setEditDesc(slot.description || '');
        setEditEmoji(slot.emoji || '');
    };

    const saveEdit = () => {
        if (editingIdx !== null && onEdit) {
            onEdit(editingIdx, {
                startTime: editTime,
                activity: editActivity,
                description: editDesc || undefined,
                emoji: editEmoji || undefined,
            });
        }
        setEditingIdx(null);
    };

    const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onCoverImageChange) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new window.Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const maxW = 400;
                const scale = Math.min(1, maxW / img.width);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
                onCoverImageChange(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    // Accent color derived from theme
    const accentHsl = `hsl(${character?.themeColor || 260}, 70%, 65%)`;
    const accentBg = `hsl(${character?.themeColor || 260}, 50%, 20%)`;
    const cardBg = `hsl(${character?.themeColor || 260}, 40%, 12%)`;

    return (
        <div
            className="relative rounded-3xl overflow-hidden shadow-2xl border border-white/10"
            style={{
                background: `linear-gradient(145deg, ${cardBg}, hsl(${character?.themeColor || 260}, 35%, 8%))`,
                color: contentColor,
            }}
        >
            {/* Header */}
            <div className="relative px-5 pt-5 pb-3 flex items-start justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold tracking-[0.2em] uppercase opacity-50">Daily</span>
                        <div className="h-px flex-1 opacity-20" style={{ background: contentColor }}></div>
                    </div>
                    <h2 className="text-2xl font-black tracking-tight" style={{ color: accentHsl }}>Schedule</h2>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/20" style={{ background: accentBg }}>
                        {formatDate()}
                    </span>
                    {!compact && onReroll && (
                        <button
                            onClick={onReroll}
                            disabled={isGenerating}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-white/20 hover:border-white/40 transition-all active:scale-95 disabled:opacity-30"
                            style={{ background: accentBg }}
                        >
                            {isGenerating ? '生成中...' : '↻ 重新生成'}
                        </button>
                    )}
                </div>
            </div>

            {/* Content: Character Image Banner on top, Schedule List below */}
            <div className="flex flex-col">
                {/* Character Image Banner */}
                <div className="relative w-full h-32 overflow-hidden flex-shrink-0">
                    {(coverImage || charAvatar) ? (
                        <img
                            src={coverImage || charAvatar}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover opacity-70"
                            style={{ objectPosition: 'center 30%' }}
                        />
                    ) : (
                        <div className="absolute inset-0 opacity-10" style={{ background: `linear-gradient(135deg, ${accentHsl}, transparent)` }}></div>
                    )}

                    {/* Bottom gradient for blending into schedule */}
                    <div className="absolute inset-0 z-10" style={{ background: `linear-gradient(to bottom, transparent 30%, ${cardBg})` }}></div>

                    {/* Character name label */}
                    <div className="absolute bottom-2 right-3 z-20">
                        <span className="text-[10px] font-bold opacity-50 tracking-widest uppercase">
                            {charName}
                        </span>
                    </div>

                    {/* Cover image upload (non-compact) */}
                    {!compact && onCoverImageChange && (
                        <button
                            onClick={() => coverInputRef.current?.click()}
                            className="absolute top-2 right-2 z-20 w-6 h-6 rounded-full bg-black/40 flex items-center justify-center text-white/60 hover:text-white/90 transition-colors text-[10px]"
                            title="更换看板图"
                        >
                            ✎
                        </button>
                    )}
                    <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
                </div>

                {/* Schedule List */}
                <div className="px-5 pb-5 pt-1 space-y-1 min-w-0">
                    {isGenerating && !schedule ? (
                        <div className="py-12 text-center">
                            <div className="inline-block w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mb-3"></div>
                            <p className="text-xs opacity-40">正在生成日程...</p>
                        </div>
                    ) : schedule && schedule.slots.length > 0 ? (
                        schedule.slots.map((slot, idx) => {
                            const isCurrent = idx === currentIdx;
                            const isPast = currentIdx >= 0 && idx < currentIdx;
                            const isEditing = editingIdx === idx;

                            if (isEditing && !compact) {
                                return (
                                    <div key={idx} className="p-3 rounded-xl border border-white/20" style={{ background: accentBg }}>
                                        <div className="flex gap-2 mb-2">
                                            <input
                                                type="time"
                                                value={editTime}
                                                onChange={e => setEditTime(e.target.value)}
                                                className="bg-white/10 rounded-lg px-2 py-1 text-xs font-mono w-24 border border-white/10 focus:outline-none"
                                            />
                                            <input
                                                value={editEmoji}
                                                onChange={e => setEditEmoji(e.target.value)}
                                                placeholder="emoji"
                                                className="bg-white/10 rounded-lg px-2 py-1 text-xs w-14 border border-white/10 focus:outline-none text-center"
                                            />
                                        </div>
                                        <input
                                            value={editActivity}
                                            onChange={e => setEditActivity(e.target.value)}
                                            placeholder="活动"
                                            className="w-full bg-white/10 rounded-lg px-2 py-1 text-sm font-bold mb-1 border border-white/10 focus:outline-none"
                                        />
                                        <input
                                            value={editDesc}
                                            onChange={e => setEditDesc(e.target.value)}
                                            placeholder="描述 (可选)"
                                            className="w-full bg-white/10 rounded-lg px-2 py-1 text-xs border border-white/10 focus:outline-none opacity-70"
                                        />
                                        <div className="flex gap-2 mt-2">
                                            <button onClick={saveEdit} className="text-[10px] font-bold px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 transition-colors">保存</button>
                                            <button onClick={() => setEditingIdx(null)} className="text-[10px] font-bold px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 transition-colors opacity-60">取消</button>
                                        </div>
                                    </div>
                                );
                            }

                            const editable = !compact && !!onEdit;
                            const pressHandlers = editable ? {
                                onPointerDown: (e: React.PointerEvent) => {
                                    // 只对主指针（鼠标左键 / 触屏首指）起反应，忽略右键
                                    if (e.button !== undefined && e.button !== 0) return;
                                    startLongPress(idx);
                                },
                                onPointerUp: () => cancelLongPress(),
                                onPointerLeave: () => cancelLongPress(),
                                onPointerCancel: () => cancelLongPress(),
                                onClick: () => {
                                    // 长按已触发时不再执行 tap-to-edit，避免抬手时误进入编辑
                                    if (longPressTriggeredRef.current) {
                                        longPressTriggeredRef.current = false;
                                        return;
                                    }
                                    startEdit(idx, slot);
                                },
                                // 屏蔽原生长按右键菜单，避免与自定义长按冲突
                                onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
                            } : {};
                            return (
                                <div
                                    key={idx}
                                    className={`relative flex items-start gap-3 py-2 px-3 rounded-xl transition-all ${
                                        isCurrent ? 'border border-white/20' : 'border border-transparent'
                                    } ${editable ? 'cursor-pointer hover:bg-white/5 select-none' : ''}`}
                                    style={isCurrent ? { background: accentBg } : {}}
                                    {...pressHandlers}
                                >
                                    {/* Time */}
                                    <div className="flex flex-col items-center w-12 flex-shrink-0">
                                        <span className={`text-xs font-mono font-bold ${isPast ? 'opacity-30' : isCurrent ? 'opacity-100' : 'opacity-60'}`}>
                                            {slot.startTime}
                                        </span>
                                        {isCurrent && (
                                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 animate-pulse" style={{ background: accentHsl, color: cardBg }}>
                                                NOW
                                            </span>
                                        )}
                                    </div>

                                    {/* Timeline dot + line */}
                                    <div className="flex flex-col items-center pt-1.5 flex-shrink-0">
                                        <div
                                            className={`w-2.5 h-2.5 rounded-full border-2 ${isPast ? 'opacity-30' : ''}`}
                                            style={{
                                                borderColor: isCurrent ? accentHsl : 'rgba(255,255,255,0.3)',
                                                background: isCurrent ? accentHsl : (isPast ? 'rgba(255,255,255,0.15)' : 'transparent'),
                                            }}
                                        />
                                        {idx < schedule.slots.length - 1 && (
                                            <div className={`w-px flex-1 min-h-[16px] ${isPast ? 'opacity-15' : 'opacity-20'}`} style={{ background: contentColor }}></div>
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className={`flex-1 min-w-0 ${isPast ? 'opacity-30' : ''}`}>
                                        <div className="flex items-center gap-1.5">
                                            {slot.emoji && <span className="text-sm flex-shrink-0">{slot.emoji}</span>}
                                            <span className={`text-sm font-bold ${isCurrent ? '' : ''}`}>{slot.activity}</span>
                                        </div>
                                        {slot.description && (
                                            <p className="text-[11px] opacity-50 mt-0.5 leading-tight">{slot.description}</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="py-12 text-center">
                            <p className="text-xs opacity-30">暂无日程</p>
                            {onReroll && (
                                <button onClick={onReroll} className="mt-2 text-xs font-bold opacity-50 hover:opacity-80 transition-opacity" style={{ color: accentHsl }}>
                                    生成今日日程
                                </button>
                            )}
                        </div>
                    )}

                    {/* OFFLINE footer */}
                    {schedule && schedule.slots.length > 0 && (
                        <div className="pt-2 pl-3">
                            <span className="text-[10px] font-bold tracking-widest opacity-20">OFFLINE</span>
                            <p className="text-[10px] opacity-15">就寝</p>
                        </div>
                    )}
                </div>

            </div>

            {/* 长按菜单：修改 / 删除 */}
            {actionIdx !== null && schedule && schedule.slots[actionIdx] && (
                <div
                    className="absolute inset-0 z-30 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
                    onClick={() => setActionIdx(null)}
                >
                    <div
                        className="w-full sm:w-64 bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-slate-100">
                            <p className="text-xs text-slate-400">日程项</p>
                            <p className="text-sm font-bold text-slate-700 truncate">
                                {schedule.slots[actionIdx].startTime} · {schedule.slots[actionIdx].activity}
                            </p>
                        </div>
                        <button
                            className="w-full py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                            onClick={() => {
                                const i = actionIdx;
                                setActionIdx(null);
                                if (i !== null && schedule) startEdit(i, schedule.slots[i]);
                            }}
                        >
                            修改
                        </button>
                        <button
                            className="w-full py-3 text-sm font-bold text-red-500 border-t border-slate-100 hover:bg-red-50 transition-colors"
                            onClick={() => {
                                const i = actionIdx;
                                setActionIdx(null);
                                if (i !== null && onDelete) onDelete(i);
                            }}
                        >
                            删除
                        </button>
                        <button
                            className="w-full py-3 text-sm text-slate-400 border-t border-slate-100 hover:bg-slate-50 transition-colors"
                            onClick={() => setActionIdx(null)}
                        >
                            取消
                        </button>
                    </div>
                </div>
            )}

            {/* Decorative elements */}
            <div className="absolute top-3 left-3 opacity-10 pointer-events-none">
                <svg width="20" height="20" viewBox="0 0 20 20" fill={contentColor}>
                    <path d="M10 0l2.5 7.5H20l-6 4.5 2.5 7.5L10 15l-6.5 4.5L6 12 0 7.5h7.5z"/>
                </svg>
            </div>
            <div className="absolute bottom-2 left-5 opacity-5 pointer-events-none text-[8px] font-mono tracking-widest">
                DESIGN: NOI
            </div>
        </div>
    );
};

export default ScheduleCard;
