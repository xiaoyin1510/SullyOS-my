/**
 * 右侧伸出的活页本 tab 条
 *
 * 视觉:像活页本侧边露出的彩色标签纸,每个 tab:
 *   - 占据右侧 ~22px 宽
 *   - 垂直堆叠,每个 tab 用对应 tracker.color 染色
 *   - 文字竖排(writing-mode: vertical-rl),tracker name 第一个字 + icon
 *   - 当前激活的 tab 向左凸出一些(像被翻到的那一页)
 *
 * 顶部固定的 "今" tab 永远是 today 主视图,底部 "+" 是新建 tracker 入口
 */

import React from 'react';
import { Tracker } from '../../types';
import { PAPER_TONES, SERIF_STACK, CUTE_STACK } from './paper';

export type HandbookSection =
    | { kind: 'today' }
    | { kind: 'tracker'; trackerId: string };

interface Props {
    activeSection: HandbookSection;
    trackers: Tracker[];
    onSwitch: (section: HandbookSection) => void;
    onAddTracker: () => void;
}

interface TabSpec {
    key: string;
    label: string;
    icon?: string;
    color: string;
    onClick: () => void;
    isActive: boolean;
}

const TabStrip: React.FC<{ tab: TabSpec }> = ({ tab }) => {
    return (
        <button
            onClick={tab.onClick}
            className="relative flex flex-col items-center justify-center transition active:scale-95"
            style={{
                width: tab.isActive ? 30 : 22,
                minHeight: 64,
                marginRight: tab.isActive ? -10 : 0,
                background: tab.color,
                color: PAPER_TONES.ink,
                clipPath: 'polygon(40% 0, 100% 0, 100% 100%, 40% 100%, 0 50%)',
                paddingLeft: 12,
                paddingRight: 4,
                paddingTop: 8,
                paddingBottom: 8,
                boxShadow: tab.isActive
                    ? '0 2px 8px -2px rgba(122,90,114,0.3)'
                    : '0 1px 3px rgba(122,90,114,0.15)',
                transition: 'all 0.2s ease',
            }}
            aria-label={tab.label}
            title={tab.label}
        >
            {tab.icon && (
                <span style={{ fontSize: 14, lineHeight: 1, marginBottom: 2 }}>{tab.icon}</span>
            )}
            <span
                style={{
                    ...CUTE_STACK,
                    writingMode: 'vertical-rl' as any,
                    textOrientation: 'upright' as any,
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    fontWeight: 700,
                    color: PAPER_TONES.ink,
                }}
            >
                {tab.label}
            </span>
        </button>
    );
};

const HandbookSideTabs: React.FC<Props> = ({
    activeSection, trackers, onSwitch, onAddTracker,
}) => {
    const sortedTrackers = [...trackers].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const tabs: TabSpec[] = [
        {
            key: 'today',
            label: '今日',
            icon: '✦',
            color: '#fff8fb',
            isActive: activeSection.kind === 'today',
            onClick: () => onSwitch({ kind: 'today' }),
        },
        ...sortedTrackers.map<TabSpec>(t => ({
            key: t.id,
            label: t.name.length > 2 ? t.name.slice(0, 2) : t.name,
            icon: t.icon,
            color: t.color + 'cc', // 半透明
            isActive: activeSection.kind === 'tracker' && activeSection.trackerId === t.id,
            onClick: () => onSwitch({ kind: 'tracker', trackerId: t.id }),
        })),
    ];

    return (
        <div
            className="absolute top-20 right-0 z-30 flex flex-col gap-2 pointer-events-none"
            aria-label="手账分区标签"
        >
            <div className="pointer-events-auto flex flex-col gap-2">
                {tabs.map(t => (
                    <TabStrip key={t.key} tab={t} />
                ))}
                {/* 新建按钮 */}
                <button
                    onClick={onAddTracker}
                    className="flex items-center justify-center transition active:scale-95"
                    style={{
                        width: 22,
                        minHeight: 36,
                        background: 'rgba(255,255,255,0.85)',
                        border: `1.5px dashed ${PAPER_TONES.spine}`,
                        clipPath: 'polygon(40% 0, 100% 0, 100% 100%, 40% 100%, 0 50%)',
                        paddingLeft: 10,
                    }}
                    title="新建 tracker"
                    aria-label="新建 tracker"
                >
                    <span style={{ ...SERIF_STACK, color: PAPER_TONES.inkSoft, fontSize: 14, fontWeight: 700 }}>
                        +
                    </span>
                </button>
            </div>
        </div>
    );
};

export default HandbookSideTabs;
