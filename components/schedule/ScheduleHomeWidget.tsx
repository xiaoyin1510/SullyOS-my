import React, { useEffect, useMemo, useState } from 'react';
import { CharacterProfile, DailySchedule, ScheduleSlot } from '../../types';
import ScheduleCard from './ScheduleCard';

const getCurrentSlotIndex = (slots: ScheduleSlot[]): number => {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    for (let i = slots.length - 1; i >= 0; i--) {
        const [h, m] = slots[i].startTime.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) return i;
    }
    return -1;
};

interface ScheduleSquareWidgetProps {
    schedule: DailySchedule | null;
    character: CharacterProfile | null;
    contentColor?: string;
    onOpen: () => void;
}

export const ScheduleSquareWidget: React.FC<ScheduleSquareWidgetProps> = ({
    schedule,
    character,
    contentColor = '#ffffff',
    onOpen,
}) => {
    const currentIdx = schedule ? getCurrentSlotIndex(schedule.slots) : -1;
    const currentSlot = currentIdx >= 0 ? schedule!.slots[currentIdx] : null;
    const nextSlot = schedule && currentIdx < schedule.slots.length - 1
        ? schedule.slots[currentIdx + 1]
        : null;

    const accentHsl = `hsl(${character?.themeColor ?? 260}, 70%, 65%)`;
    const accentSoft = `hsla(${character?.themeColor ?? 260}, 70%, 55%, 0.32)`;
    const cardBg = `hsl(${character?.themeColor ?? 260}, 38%, 12%)`;

    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    return (
        <button
            onClick={onOpen}
            className="relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer transition-transform duration-200 active:scale-[0.98] animate-fade-in text-left"
            style={{
                background: `linear-gradient(155deg, ${cardBg}, hsl(${character?.themeColor ?? 260}, 32%, 7%))`,
                border: '1px solid rgba(255,255,255,0.14)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.07)',
                color: contentColor,
            }}
        >
            {/* Background avatar */}
            {character?.avatar && (
                <img
                    src={character.avatar}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 w-full h-full object-cover opacity-55"
                    style={{ objectPosition: 'center 28%' }}
                />
            )}
            {/* Bottom gradient for text legibility */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: `linear-gradient(to bottom, transparent 30%, ${cardBg} 95%)`,
                }}
            />
            {/* Accent corner glow */}
            <div
                className="absolute -top-10 -right-10 w-24 h-24 rounded-full pointer-events-none opacity-50"
                style={{ background: `radial-gradient(circle, ${accentHsl}, transparent 70%)` }}
            />

            {/* Top row: NOW badge + time */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 pt-3 z-10">
                <span
                    className="text-[8.5px] font-bold tracking-[0.22em] uppercase px-1.5 py-0.5 rounded-full"
                    style={{
                        background: currentSlot ? accentSoft : 'rgba(255,255,255,0.14)',
                        color: currentSlot ? accentHsl : contentColor,
                        border: '1px solid rgba(255,255,255,0.16)',
                    }}
                >
                    {currentSlot ? 'Now' : 'Idle'}
                </span>
                <span className="text-[10px] font-mono opacity-65 tracking-wider drop-shadow">
                    {currentSlot ? currentSlot.startTime : timeLabel}
                </span>
            </div>

            {/* Decorative label */}
            <div className="absolute top-9 left-3 z-10 flex items-center gap-1.5">
                <span className="text-[9px] font-bold tracking-[0.2em] uppercase opacity-55">Daily</span>
                <div className="h-px w-5 opacity-30" style={{ background: contentColor }}></div>
            </div>

            {/* Bottom content */}
            <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                <div className="flex items-center gap-1.5 mb-1">
                    {currentSlot?.emoji && (
                        <span className="text-xl shrink-0 drop-shadow-md">{currentSlot.emoji}</span>
                    )}
                    <span className="text-[13px] font-bold truncate drop-shadow-md leading-tight">
                        {currentSlot?.activity || (schedule ? '休息中' : '未生成')}
                    </span>
                </div>
                {nextSlot ? (
                    <div className="text-[9.5px] opacity-55 truncate leading-tight">
                        <span className="opacity-70 mr-1">→ {nextSlot.startTime}</span>
                        {nextSlot.activity}
                    </div>
                ) : (
                    <div className="text-[9.5px] opacity-40 truncate tracking-widest uppercase">
                        {character?.name || '—'}
                    </div>
                )}
            </div>

            {/* Tap hint */}
            <div
                className="absolute bottom-3 right-3 w-6 h-6 rounded-full flex items-center justify-center z-10 opacity-70"
                style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.2)' }}
            >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" className="w-3 h-3">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5V5a2 2 0 0 1 2-2h2.5M21 7.5V5a2 2 0 0 0-2-2h-2.5M3 16.5V19a2 2 0 0 0 2 2h2.5M21 16.5V19a2 2 0 0 1-2 2h-2.5" />
                </svg>
            </div>
        </button>
    );
};

interface ScheduleHomeWidgetProps {
    schedule: DailySchedule | null;
    character: CharacterProfile | null;
    contentColor?: string;
    onOpen: () => void;
}

export const ScheduleHomeWidget: React.FC<ScheduleHomeWidgetProps> = ({
    schedule,
    character,
    contentColor = '#ffffff',
    onOpen,
}) => {
    const currentIdx = schedule ? getCurrentSlotIndex(schedule.slots) : -1;
    const currentSlot = currentIdx >= 0 ? schedule!.slots[currentIdx] : null;
    const nextSlot = schedule && currentIdx < schedule.slots.length - 1
        ? schedule.slots[currentIdx + 1]
        : null;

    const accentHsl = `hsl(${character?.themeColor ?? 260}, 70%, 65%)`;
    const accentSoft = `hsla(${character?.themeColor ?? 260}, 70%, 55%, 0.28)`;

    const now = new Date();
    const timeLabel = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    const timelineSlots = schedule?.slots ?? [];

    return (
        <button
            onClick={onOpen}
            className="w-full group text-left rounded-3xl overflow-hidden transition-transform duration-200 active:scale-[0.98] relative"
            style={{
                background: 'rgba(255,255,255,0.08)',
                backdropFilter: 'blur(24px) saturate(1.4)',
                WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                border: '1px solid rgba(255,255,255,0.12)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.08)',
                color: contentColor,
            }}
        >
            {/* Blurred avatar glow */}
            {character?.avatar && (
                <div
                    className="absolute inset-0 opacity-25 pointer-events-none"
                    style={{
                        backgroundImage: `url(${character.avatar})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center 28%',
                        filter: 'blur(36px) saturate(1.6)',
                        transform: 'scale(1.35)',
                    }}
                />
            )}
            {/* Accent corner glow */}
            <div
                className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none opacity-40"
                style={{ background: `radial-gradient(circle, ${accentHsl}, transparent 70%)` }}
            />
            {/* Accent vertical stripe */}
            <div
                className="absolute left-0 top-0 bottom-0 w-[3px]"
                style={{ background: `linear-gradient(to bottom, ${accentHsl}, transparent)` }}
            />

            <div className="relative flex flex-col p-4 gap-3">
                {/* Header row: label + character name + time */}
                <div className="flex items-center gap-2 text-[9px] tracking-[0.22em] uppercase opacity-60">
                    <span className="font-bold">Daily Schedule</span>
                    <div className="h-px flex-1" style={{ background: contentColor, opacity: 0.25 }}></div>
                    <span className="font-mono tracking-wider opacity-80">{timeLabel}</span>
                </div>

                {/* Main row: avatar | activity */}
                <div className="flex items-center gap-4">
                    <div
                        className="w-[72px] h-[72px] shrink-0 rounded-2xl overflow-hidden bg-slate-800/60 relative"
                        style={{
                            border: '1.5px solid rgba(255,255,255,0.24)',
                            boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
                        }}
                    >
                        {character?.avatar ? (
                            <img
                                src={character.avatar}
                                alt=""
                                loading="lazy"
                                className="w-full h-full object-cover"
                                style={{ objectPosition: 'center 28%' }}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg font-bold opacity-70">
                                {character?.name?.[0] || '·'}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                            <span
                                className="text-[9px] font-bold tracking-[0.22em] uppercase px-1.5 py-0.5 rounded-full"
                                style={{
                                    background: currentSlot ? accentSoft : 'rgba(255,255,255,0.14)',
                                    color: currentSlot ? accentHsl : undefined,
                                    border: '1px solid rgba(255,255,255,0.16)',
                                }}
                            >
                                {currentSlot ? 'Now' : 'Idle'}
                            </span>
                            <span className="text-[10px] font-mono opacity-60 tracking-wider">
                                {currentSlot ? currentSlot.startTime : timeLabel}
                            </span>
                            <span className="text-[9px] opacity-40 tracking-widest uppercase ml-auto shrink-0 truncate max-w-[40%]">
                                {character?.name || '—'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                            {currentSlot?.emoji && (
                                <span className="text-lg shrink-0 drop-shadow-md">{currentSlot.emoji}</span>
                            )}
                            <span className="text-[15px] font-bold truncate drop-shadow-md leading-tight">
                                {currentSlot?.activity || (schedule ? '休息中 · 暂无安排' : '尚未生成日程')}
                            </span>
                        </div>
                        {(currentSlot?.description || nextSlot) && (
                            <div className="text-[10.5px] opacity-55 truncate mt-0.5 leading-snug">
                                {currentSlot?.description ? (
                                    currentSlot.description
                                ) : nextSlot ? (
                                    <>
                                        <span className="opacity-70 mr-1">→ {nextSlot.startTime}</span>
                                        {nextSlot.emoji ? `${nextSlot.emoji} ` : ''}{nextSlot.activity}
                                    </>
                                ) : null}
                            </div>
                        )}
                    </div>

                    {/* Open indicator */}
                    <div
                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center opacity-70 group-hover:opacity-100 transition-opacity self-start"
                        style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.2)' }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5V5a2 2 0 0 1 2-2h2.5M21 7.5V5a2 2 0 0 0-2-2h-2.5M3 16.5V19a2 2 0 0 0 2 2h2.5M21 16.5V19a2 2 0 0 1-2 2h-2.5" />
                        </svg>
                    </div>
                </div>

                {/* Timeline footer */}
                {timelineSlots.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1">
                        {timelineSlots.slice(0, 10).map((slot, i) => {
                            const isCurrent = i === currentIdx;
                            const isPast = currentIdx >= 0 && i < currentIdx;
                            return (
                                <div
                                    key={i}
                                    className="flex-1 min-w-0 flex flex-col items-center gap-1"
                                >
                                    <div
                                        className="w-full h-[3px] rounded-full transition-all"
                                        style={{
                                            background: isCurrent ? accentHsl : isPast ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.14)',
                                            boxShadow: isCurrent ? `0 0 8px ${accentHsl}` : 'none',
                                        }}
                                    ></div>
                                    <span
                                        className="text-[8px] font-mono tracking-wider"
                                        style={{
                                            opacity: isCurrent ? 0.9 : isPast ? 0.35 : 0.5,
                                            color: isCurrent ? accentHsl : contentColor,
                                        }}
                                    >
                                        {slot.startTime.slice(0, 5)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </button>
    );
};

interface ScheduleFullscreenViewerProps {
    open: boolean;
    onClose: () => void;
    characters: CharacterProfile[];
    activeCharId: string | null;
    onSwitchCharacter: (id: string) => void;
    schedule: DailySchedule | null;
    activeCharacter: CharacterProfile | null;
    contentColor?: string;
}

export const ScheduleFullscreenViewer: React.FC<ScheduleFullscreenViewerProps> = ({
    open,
    onClose,
    characters,
    activeCharId,
    onSwitchCharacter,
    schedule,
    activeCharacter,
    contentColor = '#ffffff',
}) => {
    // Lock scroll of background
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Close on ESC
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    const accentHsl = useMemo(
        () => `hsl(${activeCharacter?.themeColor ?? 260}, 70%, 65%)`,
        [activeCharacter?.themeColor]
    );

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[200] flex flex-col animate-fade-in"
            style={{
                background: 'rgba(6, 8, 16, 0.72)',
                backdropFilter: 'blur(22px) saturate(1.2)',
                WebkitBackdropFilter: 'blur(22px) saturate(1.2)',
                color: contentColor,
            }}
            onClick={onClose}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-3 shrink-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div>
                    <div className="text-[10px] font-bold tracking-[0.25em] uppercase opacity-50">Today</div>
                    <div className="text-lg font-black tracking-tight" style={{ color: accentHsl }}>
                        Daily Schedule
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-90"
                    style={{
                        background: 'rgba(255,255,255,0.12)',
                        border: '1px solid rgba(255,255,255,0.18)',
                    }}
                    aria-label="Close"
                >
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                </button>
            </div>

            {/* Character switcher */}
            {characters.length > 0 && (
                <div
                    className="shrink-0 px-5 pb-3"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex gap-2 overflow-x-auto no-scrollbar py-1 -mx-1 px-1">
                        {characters.map(c => {
                            const isActive = c.id === activeCharId;
                            return (
                                <button
                                    key={c.id}
                                    onClick={() => onSwitchCharacter(c.id)}
                                    className="shrink-0 flex flex-col items-center gap-1 transition-transform active:scale-95"
                                    style={{ width: 56 }}
                                >
                                    <div
                                        className={`w-12 h-12 rounded-2xl overflow-hidden transition-all ${isActive ? 'scale-105' : 'opacity-55'}`}
                                        style={{
                                            border: isActive
                                                ? `2px solid ${accentHsl}`
                                                : '2px solid rgba(255,255,255,0.12)',
                                            boxShadow: isActive
                                                ? `0 6px 18px hsla(${c.themeColor ?? 260}, 70%, 55%, 0.45)`
                                                : 'none',
                                        }}
                                    >
                                        {c.avatar ? (
                                            <img src={c.avatar} alt="" className="w-full h-full object-cover" loading="lazy" />
                                        ) : (
                                            <div className="w-full h-full bg-white/10 flex items-center justify-center text-sm font-bold">
                                                {c.name[0]}
                                            </div>
                                        )}
                                    </div>
                                    <span
                                        className={`text-[10px] truncate max-w-full font-semibold tracking-wide ${isActive ? 'opacity-100' : 'opacity-45'}`}
                                    >
                                        {c.name}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Schedule card */}
            <div
                className="flex-1 min-h-0 overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] no-scrollbar"
                onClick={(e) => e.stopPropagation()}
            >
                <ScheduleCard
                    schedule={schedule}
                    character={activeCharacter}
                    contentColor={contentColor}
                    compact={true}
                />
                <div className="text-[10px] text-center opacity-40 mt-4 tracking-widest">
                    TAP OUTSIDE TO CLOSE · 点空白处关闭
                </div>
            </div>
        </div>
    );
};
