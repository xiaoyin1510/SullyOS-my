/**
 * 一张"纸"的画布
 *
 * - 容器自适应父宽 + 父高,默认填满,但用 maxWidth 限制宽屏不要无限拉
 * - 内部坐标系: 整张纸 = 100% x 100%, 每个 placement 用 % 落位
 * - 装饰: 左侧装订环 + 顶部 lace + 散落贴纸(由父级传入)
 *
 * 不负责日期头/翻页/编辑 — 只画一张纸的内容。
 */

import React from 'react';
import {
    HandbookPage, CharacterProfile, HandbookLayout, HandbookFragment,
} from '../../types';
import {
    PAPER_TONES, BinderRings, HANDWRITTEN_STACK,
    dayNum, dayOfWeekZh, seedFloat,
} from './paper';
import { SparkleDot } from './stickers';
import SlotRenderer from './SlotRenderer';

interface Props {
    date: string;
    layout: HandbookLayout;
    pages: HandbookPage[];
    characters: CharacterProfile[];
    userName: string;
    /** 点击某个 placement → 父级决定怎么处理(打开编辑/操作菜单) */
    onPickPlacement?: (pageId: string, fragmentId?: string) => void;
    /** 是否显示日期页眉(只有第一张纸显示) */
    showHeader?: boolean;
    pageNumberLabel?: string;     // "1 / 3" 之类,显示在右下角
}

const JournalCanvas: React.FC<Props> = ({
    date, layout, pages, characters, userName, onPickPlacement, showHeader = true, pageNumberLabel,
}) => {
    // 把 pageId → page,fragmentId → fragment 建索引
    const pageMap = new Map<string, HandbookPage>();
    pages.forEach(p => pageMap.set(p.id, p));
    const fragMap = new Map<string, HandbookFragment>();
    pages.forEach(p => p.fragments?.forEach(f => fragMap.set(f.id, f)));

    // v2: 强调预算 lint 退役 — slot charBudget 已经卡住字数, prompt 也限制 emphasis 上限
    // 老数据 (无 slotRole) 渲染时 SlotRenderer 自动 fallback 到 JournalFragmentCard,
    // 那一路也不再依赖外部 lint (老 entry 重新打开就是了)

    // 用 date 当种子, 决定纸张底纹: 网格 / 横线 / 净色
    // 像真实日记本 — 纸先于贴纸存在
    const paperKind = (() => {
        const r = seedFloat(date, 4242);
        if (r < 0.45) return 'grid';
        if (r < 0.85) return 'lined';
        return 'plain';
    })();
    const paperBg: React.CSSProperties = paperKind === 'grid'
        ? { backgroundImage: 'linear-gradient(rgba(185,211,224,0.20) 1px, transparent 1px), linear-gradient(90deg, rgba(185,211,224,0.20) 1px, transparent 1px)', backgroundSize: '22px 22px' }
        : paperKind === 'lined'
        ? { backgroundImage: 'repeating-linear-gradient(transparent, transparent 25px, rgba(242,157,176,0.18) 25px, rgba(242,157,176,0.18) 26px)' }
        : {};

    // ─── 装饰预算 (硬编码) ──────────────────────────────────
    // 上限: ≤ 2 件 (sparkle + bow), 每件 ≤ 12% 面积, 避开所有 placement bbox.
    // 候选位置 = 4 个角的小区域, 用 seed 选, 与 placements 不重叠才放。
    const decorations = (() => {
        type Box = { x1: number; y1: number; x2: number; y2: number };
        const placedBoxes: Box[] = layout.placements.map(pl => {
            const text = pl.fragmentId ? fragMap.get(pl.fragmentId)?.text ?? '' : pageMap.get(pl.pageId)?.content ?? '';
            const charsPerLine = Math.max(8, Math.floor(pl.widthPct * 0.16));
            const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
            const base = pl.role === 'margin' ? 4 : pl.role === 'corner' ? 6 : 9;
            const h = lines * 3.4 + base;
            return { x1: pl.xPct - 1, y1: pl.yPct - 1, x2: pl.xPct + pl.widthPct + 1, y2: pl.yPct + h + 1 };
        });
        const intersect = (a: Box, b: Box) => !(a.x2 < b.x1 || b.x2 < a.x1 || a.y2 < b.y1 || b.y2 < a.y1);

        // 候选锚点 (x%, y%) — 仅放在文字不太可能落到的区域
        const anchors: Array<{ x: number; y: number; w: number; h: number; rot: number }> = [
            { x: 88, y: 4,  w: 8, h: 6, rot: 12 },   // 右上
            { x: 88, y: 92, w: 8, h: 6, rot: -8 },   // 右下
            { x: 2,  y: 92, w: 8, h: 6, rot: 6 },    // 左下 (装订线右侧)
        ];
        const out: Array<{ x: number; y: number; rot: number; kind: 'sparkle' | 'bow' }> = [];
        for (let i = 0; i < anchors.length && out.length < 2; i++) {
            const a = anchors[i];
            const box: Box = { x1: a.x, y1: a.y, x2: a.x + a.w, y2: a.y + a.h };
            if (placedBoxes.some(pb => intersect(pb, box))) continue;
            const kindRoll = seedFloat(date, 5000 + i);
            out.push({ x: a.x, y: a.y, rot: a.rot, kind: kindRoll < 0.6 ? 'sparkle' : 'bow' });
        }
        return out;
    })();

    return (
        <div
            className="relative mx-auto"
            style={{
                width: '100%',
                height: '100%',
                maxWidth: 480,
                background: PAPER_TONES.paper,
                boxShadow: '0 6px 22px -6px rgba(122,90,114,0.25), inset 0 0 0 1.5px rgba(220,199,213,0.5)',
                borderRadius: 6,
                paddingLeft: 30,             // 给装订环让位
                overflow: 'hidden',
                ...paperBg,
            }}
        >
            <BinderRings count={11} tone="silver" />

            {/* 左侧装订线 */}
            <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                    left: 13, width: 1.5,
                    background: `repeating-linear-gradient(to bottom, ${PAPER_TONES.accentRose} 0 4px, transparent 4px 8px)`,
                    opacity: 0.4,
                }}
                aria-hidden
            />

            {/* 装饰 — 预算 ≤ 2 件, 已与 placement bbox 做过碰撞检测 */}
            {decorations.map((d, i) => (
                <div
                    key={i}
                    className="absolute pointer-events-none"
                    style={{ top: `${d.y}%`, left: `${d.x}%`, transform: `rotate(${d.rot}deg)`, zIndex: 1 }}
                    aria-hidden
                >
                    {d.kind === 'sparkle'
                        ? <SparkleDot size={10} color={PAPER_TONES.accentRose} />
                        : <SparkleDot size={8} color={PAPER_TONES.accentLemon} />
                    }
                </div>
            ))}

            {/* 日期页眉 — 像真实日记顶部那一行手写日期, 极简 ───────── */}
            {/* "5/10 Sat." 体例: 大手写月日 + 星期英文缩写, 不再杂志大标题 */}
            {showHeader && (
                <div className="absolute pointer-events-none" style={{ top: 10, left: 38, right: 14, zIndex: 1 }}>
                    <div className="flex items-baseline gap-2">
                        <span
                            style={{
                                ...HANDWRITTEN_STACK,
                                fontSize: 24,
                                lineHeight: 1,
                                color: PAPER_TONES.ink,
                                fontWeight: 600,
                            }}
                        >
                            {parseInt(dayNum(date), 10)}/{date.split('-')[1].replace(/^0/, '')}
                        </span>
                        <span
                            style={{
                                ...HANDWRITTEN_STACK,
                                fontSize: 18,
                                lineHeight: 1,
                                color: PAPER_TONES.inkSoft,
                                fontStyle: 'italic',
                            }}
                        >
                            {dayOfWeekZh(date) === '日' ? 'Sun.'
                                : dayOfWeekZh(date) === '一' ? 'Mon.'
                                : dayOfWeekZh(date) === '二' ? 'Tue.'
                                : dayOfWeekZh(date) === '三' ? 'Wed.'
                                : dayOfWeekZh(date) === '四' ? 'Thu.'
                                : dayOfWeekZh(date) === '五' ? 'Fri.' : 'Sat.'}
                        </span>
                        {/* 一句心情小词, 极小 */}
                        <span
                            className="ml-auto"
                            style={{
                                ...HANDWRITTEN_STACK,
                                fontSize: 13,
                                color: PAPER_TONES.accentBlush,
                                opacity: 0.85,
                            }}
                        >
                            {(() => {
                                const moods = ['いい天気!', '心地よい ♡', 'soft day', 'just right', 'gentle ✿'];
                                return moods[Math.floor(seedFloat(date, 1) * moods.length)];
                            })()}
                        </span>
                    </div>
                    {/* 一根细线压住, 像日记的日期下划线 */}
                    <div style={{
                        marginTop: 4, height: 1,
                        background: PAPER_TONES.accentRose, opacity: 0.4,
                    }} />
                </div>
            )}

            {/* 第二张及以后,顶部用一个简洁 jolt */}
            {!showHeader && (
                <div className="absolute pointer-events-none" style={{ top: 10, left: 38, right: 14, zIndex: 1 }}>
                    <span
                        style={{
                            ...HANDWRITTEN_STACK,
                            fontSize: 14,
                            color: PAPER_TONES.inkSoft,
                            fontStyle: 'italic',
                        }}
                    >
                        cont. · {parseInt(dayNum(date), 10)}/{date.split('-')[1].replace(/^0/, '')}
                    </span>
                </div>
            )}

            {/* 画布 — 可摆 fragment 的整页 */}
            <div
                className="absolute"
                style={{
                    left: 32,
                    right: 4,
                    top: showHeader ? 50 : 30,
                    bottom: 28,
                }}
            >
                {layout.placements.map((pl, i) => {
                    const page = pageMap.get(pl.pageId);
                    if (!page) return null;
                    const fragment = pl.fragmentId ? fragMap.get(pl.fragmentId) : undefined;
                    const char = page.charId ? characters.find(c => c.id === page.charId) : undefined;

                    return (
                        <div
                            key={`${pl.pageId}-${pl.fragmentId ?? 'page'}-${i}`}
                            style={{
                                position: 'absolute',
                                left: `${pl.xPct}%`,
                                top: `${pl.yPct}%`,
                                width: `${pl.widthPct}%`,
                                transform: `rotate(${pl.rotate}deg)`,
                                transformOrigin: 'top left',
                                zIndex: pl.zIndex,
                            }}
                        >
                            <div onClick={onPickPlacement ? () => onPickPlacement(pl.pageId, pl.fragmentId) : undefined}
                                style={{ cursor: onPickPlacement ? 'pointer' : 'default' }}>
                                <SlotRenderer
                                    placement={pl}
                                    fragment={fragment}
                                    page={page}
                                    char={char}
                                    userName={userName}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 页脚 — 仅一行小手写 tagline + (多页时)页码 ─────────── */}
            <div
                className="absolute pointer-events-none flex items-end justify-between"
                style={{ bottom: 6, left: 38, right: 14, zIndex: 1 }}
            >
                <span
                    style={{
                        ...HANDWRITTEN_STACK,
                        fontSize: 11,
                        color: PAPER_TONES.inkFaint,
                        fontStyle: 'italic',
                        opacity: 0.7,
                    }}
                >
                    {(() => {
                        const taglines = [
                            'soft day ♡', 'small things kept gently', 'to remember softly',
                            'just a usual day', 'let the day stay',
                        ];
                        return taglines[Math.floor(seedFloat(date, 99) * taglines.length)];
                    })()}
                </span>
                {pageNumberLabel && (
                    <span
                        style={{
                            ...HANDWRITTEN_STACK,
                            fontSize: 11,
                            color: PAPER_TONES.inkSoft,
                            opacity: 0.7,
                        }}
                    >
                        {pageNumberLabel}
                    </span>
                )}
            </div>
        </div>
    );
};

export default JournalCanvas;
