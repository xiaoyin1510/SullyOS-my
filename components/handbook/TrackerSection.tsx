/**
 * 单个 Tracker 的 Section 视图
 *
 * = 月历 + 点格子开 entry sheet,把数据源 / 单元格渲染交给 caller 控制
 *
 * 特别处理 cellRenderField 字段:
 *   - rating  → 显示对应 emoji
 *   - options → 显示对应 emoji
 *   - boolean → ✓ 或留空
 *   - number  → 显示数字
 *   - 否则    → 显示一个 tracker.color 圆点
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Tracker, TrackerEntry } from '../../types';
import { DB } from '../../utils/db';
import CalendarView from './CalendarView';
import TrackerEntrySheet from './TrackerEntrySheet';
import { PAPER_TONES, SERIF_STACK, CUTE_STACK, WashiTape } from './paper';
import { ScatteredStickers } from './stickers';

interface Props {
    tracker: Tracker;
    onAddToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const TrackerSection: React.FC<Props> = ({ tracker, onAddToast }) => {
    const [entries, setEntries] = useState<TrackerEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [openDate, setOpenDate] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        const list = await DB.getTrackerEntriesByTracker(tracker.id);
        setEntries(list);
        setLoading(false);
    }, [tracker.id]);

    useEffect(() => { refresh(); }, [refresh]);

    const entryByDate: Record<string, TrackerEntry> = {};
    for (const e of entries) entryByDate[e.date] = e;

    const today = (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();

    // 单元格内容:根据 cellRenderField 渲染一个紧凑标记
    const renderCell = (date: string): React.ReactNode => {
        const entry = entryByDate[date];
        if (!entry) return null;
        const fieldKey = tracker.cellRenderField || tracker.schema[0]?.key;
        const field = tracker.schema.find(f => f.key === fieldKey);
        if (!field) {
            return <span style={{ color: tracker.color, fontSize: 18, lineHeight: 1 }}>•</span>;
        }
        const v = entry.values[fieldKey];
        if (v === undefined || v === null || v === '') {
            return <span style={{ color: tracker.color, fontSize: 14, lineHeight: 1 }}>·</span>;
        }
        if (field.kind === 'rating' || field.kind === 'options') {
            const choice = field.choices?.find(c => String(c.value) === String(v));
            if (choice?.emoji) return <span style={{ fontSize: 16, lineHeight: 1 }}>{choice.emoji}</span>;
            return <span style={{ ...CUTE_STACK, fontSize: 11, color: tracker.color, fontWeight: 700 }}>{String(v)}</span>;
        }
        if (field.kind === 'boolean') {
            return v
                ? <span style={{ color: tracker.color, fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✓</span>
                : <span style={{ color: PAPER_TONES.inkFaint, fontSize: 14 }}>·</span>;
        }
        if (field.kind === 'number') {
            return <span style={{ ...CUTE_STACK, fontSize: 10, color: tracker.color, fontWeight: 700 }}>{v}</span>;
        }
        // text / photo: 一个色点表示有记录
        return <span style={{ color: tracker.color, fontSize: 18, lineHeight: 1 }}>•</span>;
    };

    const handleSave = async (values: Record<string, any>) => {
        if (!openDate) return;
        const existing = entryByDate[openDate];
        const now = Date.now();
        const entry: TrackerEntry = existing
            ? { ...existing, values, updatedAt: now }
            : { id: `te-${tracker.id}-${openDate}-${now}`, trackerId: tracker.id, date: openDate, values, createdAt: now, updatedAt: now };
        await DB.saveTrackerEntry(entry);
        await refresh();
        setOpenDate(null);
        onAddToast?.(existing ? '更新好啦 ♡' : '记下啦 ♡', 'success');
    };

    const handleDelete = async () => {
        if (!openDate) return;
        const existing = entryByDate[openDate];
        if (!existing) return;
        await DB.deleteTrackerEntry(existing.id);
        await refresh();
        setOpenDate(null);
        onAddToast?.('已撕掉这天 ♡', 'info');
    };

    return (
        <div
            className="flex-1 overflow-y-auto pb-12 relative"
            style={{
                background: `${PAPER_TONES.paperWarm} radial-gradient(circle at 20% 10%, ${tracker.color}25 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(185,211,224,0.15) 0%, transparent 40%)`,
            }}
        >
            {/* Section 标题区 */}
            <div className="mx-4 mt-3 mb-4 relative">
                <div
                    className="rounded-2xl px-5 py-5 relative overflow-hidden"
                    style={{
                        background: '#fff',
                        boxShadow: '0 3px 10px -2px rgba(122,90,114,0.18), 0 0 0 1.5px rgba(220,199,213,0.5)',
                    }}
                >
                    {/* 散贴纸 */}
                    <ScatteredStickers seed={`tracker-${tracker.id}`} count={3} zone="corners" />

                    <div className="relative z-10 flex items-center gap-3">
                        <div
                            className="w-12 h-12 rounded-full flex items-center justify-center text-2xl shrink-0"
                            style={{
                                background: `${tracker.color}40`,
                                border: `2px solid ${tracker.color}`,
                            }}
                        >
                            {tracker.icon || '★'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div
                                className="text-[10px] tracking-[0.4em] mb-0.5"
                                style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                            >
                                · TRACKER ·
                            </div>
                            <div
                                className="text-xl font-bold"
                                style={{ ...SERIF_STACK, color: PAPER_TONES.ink }}
                            >
                                {tracker.name}
                            </div>
                        </div>
                        <WashiTape color="cream" pattern="dot" rotate={6}>
                            {entries.length} 次
                        </WashiTape>
                    </div>
                </div>
            </div>

            {/* 月历 */}
            {loading ? (
                <div
                    className="text-center py-10 text-sm"
                    style={{ ...CUTE_STACK, color: PAPER_TONES.inkSoft }}
                >
                    翻开中…
                </div>
            ) : (
                <div
                    className="mx-3 rounded-2xl"
                    style={{
                        background: PAPER_TONES.paper,
                        boxShadow: '0 4px 14px -4px rgba(122,90,114,0.18)',
                    }}
                >
                    <CalendarView
                        highlightDate={today}
                        renderCell={renderCell}
                        onCellTap={(d) => setOpenDate(d)}
                        accentColor={tracker.color}
                        title="点格子打卡 · 留白也可以 ♡"
                    />
                </div>
            )}

            {/* 输入 sheet */}
            {openDate && (
                <TrackerEntrySheet
                    visible={!!openDate}
                    tracker={tracker}
                    date={openDate}
                    existingEntry={entryByDate[openDate] || null}
                    onCancel={() => setOpenDate(null)}
                    onSave={handleSave}
                    onDelete={entryByDate[openDate] ? handleDelete : undefined}
                />
            )}
        </div>
    );
};

export default TrackerSection;
