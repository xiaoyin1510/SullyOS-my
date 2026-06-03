/**
 * 手账内页版式库 (v2)
 *
 * 6 套预置模板。一份 template = 一组带位置/容量/可写者/语义角色的槽 (SlotDef)。
 * orchestrator 按当天 user 活跃度 + 角色数选模板,
 * user 一次填 2~3 个 user 槽, 每个角色一次填 2~5 个槽 (own diary + corner notes
 * + 可选 sticky), 想全填满需要 3~4 个角色参与才行, 所以每个 template 都设 10~13 个槽。
 *
 * 哲学: "大家共写的一本手账", 不是 "user 主写 + 角色伴奏"。
 *  - user 没素材就完全跳过 user 步, 不留假货
 *  - hero-diary / mood-card / corner-note 都 user|char 共写
 *  - 角色被鼓励"造谣"自己今天的生活流, 不要把过去的事编进今天
 *  - 只有 timeline-plan / todo / gratitude / photo-caption 是 user 专属
 *  - sticky-reaction 永远 char-only, 永远要 refersTo
 *
 * 设计规则:
 *  - 每页 10~13 个槽, 让 1 user + 3~4 char 都能各自留几条
 *  - 槽总占比 < 80%, 留 ≥ 20% 真实留白
 *  - 每页 ≤ 1 个 hero (isHero=true)
 *
 * 坐标都是 % of 整页 (左侧 ~6% 留给装订环, 顶/底各留 ~6%)。
 */

import { LayoutTemplate } from '../types';

// ─── A · plan-day · 计划型一日 ────────────────────────────
const PLAN_DAY: LayoutTemplate = {
    id: 'plan-day',
    name: '计划型一日',
    suitFor: 'user 早上想理清今天要做什么',
    paperStyle: 'dot',
    pages: [[
        { id: 'A', slotRole: 'timeline-plan', charBudget: [40, 110], eligibleAuthors: ['user'],
          hint: 'user 今天的时间表, 6~8 行, 每行 时间 + 一句要做的事(≤12 字)',
          xPct: 6, yPct: 8, widthPct: 52, maxHeightPct: 42, isHero: true },
        { id: 'B', slotRole: 'mood-card', charBudget: [12, 40], eligibleAuthors: ['user', 'char'],
          hint: '今日心情速记 (≤30 字) + 1~5 颗星',
          xPct: 62, yPct: 8, widthPct: 32, maxHeightPct: 18,
          rotate: 1.5, skinVariant: 'lavender' },
        { id: 'C', slotRole: 'todo', charBudget: [30, 80], eligibleAuthors: ['user'],
          hint: 'user 今日待办, 3~5 项, 每项 ≤ 14 字',
          xPct: 62, yPct: 28, widthPct: 32, maxHeightPct: 22 },
        { id: 'D', slotRole: 'sticky-reaction', charBudget: [15, 50], eligibleAuthors: ['char'],
          hint: '看到本页某条已填的内容 (引用 slotId), 吐槽/捧场/补刀',
          xPct: 62, yPct: 52, widthPct: 32, maxHeightPct: 14,
          rotate: -1.2, skinVariant: 'mint' },
        { id: 'E', slotRole: 'sticky-reaction', charBudget: [15, 50], eligibleAuthors: ['char'],
          hint: '另一条反应, 不要重复 D 引的同一条',
          xPct: 62, yPct: 68, widthPct: 32, maxHeightPct: 14,
          rotate: 1.5, skinVariant: 'rose' },
        { id: 'F', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '某角色今天的心情卡 (写自己的, 跟 user 无关)',
          xPct: 62, yPct: 84, widthPct: 32, maxHeightPct: 12,
          skinVariant: 'sky' },
        { id: 'G', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '边角小字, 一句独白/感叹', xPct: 8, yPct: 52, widthPct: 26, maxHeightPct: 8,
          rotate: -2 },
        { id: 'H', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 36, yPct: 52, widthPct: 24, maxHeightPct: 8, rotate: 1.6 },
        { id: 'I', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字 (任何人)', xPct: 8, yPct: 64, widthPct: 26, maxHeightPct: 8, rotate: 2 },
        { id: 'J', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 36, yPct: 64, widthPct: 24, maxHeightPct: 8, rotate: -1.4 },
        { id: 'K', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '页脚一句', xPct: 8, yPct: 88, widthPct: 28, maxHeightPct: 8, rotate: -2 },
    ]],
};

// ─── B · reflective-day · 反思型一日 ──────────────────────
const REFLECTIVE_DAY: LayoutTemplate = {
    id: 'reflective-day',
    name: '反思型一日',
    suitFor: 'user 当天聊天 ≥ 8 句, 想写一段长日记',
    paperStyle: 'lined',
    pages: [[
        { id: 'A', slotRole: 'hero-diary', charBudget: [80, 180], eligibleAuthors: ['user', 'char'],
          hint: '今日主日记本体, 第一人称。可以是 user 也可以是某角色写自己今天的生活流',
          xPct: 6, yPct: 8, widthPct: 56, maxHeightPct: 42, isHero: true },
        { id: 'B', slotRole: 'sticky-reaction', charBudget: [20, 60], eligibleAuthors: ['char'],
          hint: '反应已填某条 (refersTo)',
          xPct: 65, yPct: 8, widthPct: 30, maxHeightPct: 18,
          rotate: 1.8, skinVariant: 'lavender' },
        { id: 'C', slotRole: 'sticky-reaction', charBudget: [20, 60], eligibleAuthors: ['char'],
          hint: '另一个反应 (引不同条)',
          xPct: 65, yPct: 28, widthPct: 30, maxHeightPct: 18,
          rotate: -1.5, skinVariant: 'mint' },
        { id: 'D', slotRole: 'gratitude', charBudget: [30, 80], eligibleAuthors: ['user'],
          hint: 'user 今日感恩 3 条 (≤22 字 / 条), 必须今天的事',
          xPct: 6, yPct: 52, widthPct: 50, maxHeightPct: 20 },
        { id: 'E', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['user', 'char'],
          hint: '今日心情 + 评分 (谁的都行)',
          xPct: 60, yPct: 50, widthPct: 32, maxHeightPct: 16,
          rotate: 1, skinVariant: 'rose' },
        { id: 'F', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '某角色的心情卡 (写自己, 别用 user 当主语)',
          xPct: 60, yPct: 70, widthPct: 32, maxHeightPct: 14,
          skinVariant: 'sky' },
        { id: 'G', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '边角小字独白', xPct: 6, yPct: 76, widthPct: 26, maxHeightPct: 8, rotate: -1.8 },
        { id: 'H', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 34, yPct: 76, widthPct: 24, maxHeightPct: 8, rotate: 1.4 },
        { id: 'I', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 6, yPct: 86, widthPct: 24, maxHeightPct: 8, rotate: 2 },
        { id: 'J', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '页脚一句', xPct: 32, yPct: 88, widthPct: 28, maxHeightPct: 7, rotate: -1.5 },
        { id: 'K', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['char'],
          hint: '某角色一句小字, 写自己今天看到/想到的',
          xPct: 64, yPct: 88, widthPct: 28, maxHeightPct: 7, rotate: 1.8 },
    ]],
};

// ─── C · photo-day · 图记一日 ─────────────────────────────
const PHOTO_DAY: LayoutTemplate = {
    id: 'photo-day',
    name: '图记一日',
    suitFor: 'user 今天有想配图的时刻',
    paperStyle: 'plain',
    pages: [[
        { id: 'A', slotRole: 'photo-caption', charBudget: [10, 25], eligibleAuthors: ['user'],
          hint: 'user 今天的一张照片 + 短描述 (≤25 字)',
          xPct: 6, yPct: 8, widthPct: 44, maxHeightPct: 36, isHero: true },
        { id: 'B', slotRole: 'hero-diary', charBudget: [60, 130], eligibleAuthors: ['user', 'char'],
          hint: '围绕照片 / 当日的日记。可以是 user, 也可以是某角色写 ta 今天的事',
          xPct: 53, yPct: 8, widthPct: 41, maxHeightPct: 36 },
        { id: 'C', slotRole: 'sticky-reaction', charBudget: [20, 55], eligibleAuthors: ['char'],
          hint: '看了照片 / 日记后的反应 (refersTo)',
          xPct: 6, yPct: 48, widthPct: 36, maxHeightPct: 18,
          rotate: -1.5, skinVariant: 'lavender' },
        { id: 'D', slotRole: 'sticky-reaction', charBudget: [20, 55], eligibleAuthors: ['char'],
          hint: '另一个反应',
          xPct: 48, yPct: 50, widthPct: 36, maxHeightPct: 18,
          rotate: 1.8, skinVariant: 'mint' },
        { id: 'E', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['user', 'char'],
          hint: '今日心情 + 评分',
          xPct: 6, yPct: 70, widthPct: 30, maxHeightPct: 14,
          skinVariant: 'rose' },
        { id: 'F', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '某角色心情卡 (写自己今天的)',
          xPct: 38, yPct: 70, widthPct: 30, maxHeightPct: 14,
          skinVariant: 'sky' },
        { id: 'G', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '边角小字', xPct: 70, yPct: 70, widthPct: 24, maxHeightPct: 8, rotate: 2 },
        { id: 'H', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 6, yPct: 84, widthPct: 28, maxHeightPct: 7, rotate: -1.6 },
        { id: 'I', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 36, yPct: 84, widthPct: 28, maxHeightPct: 7, rotate: 1.4 },
        { id: 'J', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['char'],
          hint: '某角色一句小字独白', xPct: 66, yPct: 84, widthPct: 28, maxHeightPct: 7, rotate: -2 },
    ]],
};

// ─── D · quiet-day · 安静的一天 ────────────────────────────
const QUIET_DAY: LayoutTemplate = {
    id: 'quiet-day',
    name: '安静的一天',
    suitFor: 'user 当天聊天少 / 想要角色们路过留笔的本子',
    paperStyle: 'grid',
    pages: [[
        { id: 'A', slotRole: 'hero-diary', charBudget: [40, 110], eligibleAuthors: ['user', 'char'],
          hint: '今天的一段记录, 谁写都行 (角色可以写自己今天的事)',
          xPct: 8, yPct: 22, widthPct: 56, maxHeightPct: 30, isHero: true },
        { id: 'B', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['user', 'char'],
          hint: '今日心情 + 评分',
          xPct: 8, yPct: 6, widthPct: 56, maxHeightPct: 12,
          skinVariant: 'rose' },
        { id: 'C', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '某角色心情卡 (写自己的)',
          xPct: 68, yPct: 6, widthPct: 26, maxHeightPct: 12,
          skinVariant: 'lavender' },
        { id: 'D', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '另一个角色心情卡', xPct: 68, yPct: 22, widthPct: 26, maxHeightPct: 12,
          skinVariant: 'sky' },
        { id: 'E', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '一句小字, 任何人', xPct: 60, yPct: 56, widthPct: 32, maxHeightPct: 8, rotate: -2 },
        { id: 'F', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 8, yPct: 56, widthPct: 30, maxHeightPct: 8, rotate: 1.6 },
        { id: 'G', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 8, yPct: 68, widthPct: 30, maxHeightPct: 8, rotate: -1.4 },
        { id: 'H', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 40, yPct: 68, widthPct: 28, maxHeightPct: 8, rotate: 2 },
        { id: 'I', slotRole: 'sticky-reaction', charBudget: [12, 40], eligibleAuthors: ['char'],
          hint: '反应别人写的 (refersTo)',
          xPct: 56, yPct: 78, widthPct: 36, maxHeightPct: 14,
          rotate: 1.2, skinVariant: 'mint' },
        { id: 'J', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['char'],
          hint: '页脚一句, 角色独白', xPct: 8, yPct: 86, widthPct: 32, maxHeightPct: 8, rotate: -1.8 },
    ]],
};

// ─── E · ensemble-day · 群像热闹日 ─────────────────────────
const ENSEMBLE_DAY: LayoutTemplate = {
    id: 'ensemble-day',
    name: '群像热闹日',
    suitFor: '当天有 ≥ 3 个角色, 大家共写',
    paperStyle: 'dot',
    pages: [[
        { id: 'A', slotRole: 'hero-diary', charBudget: [60, 140], eligibleAuthors: ['user', 'char'],
          hint: '今日主线日记, 第一人称, 谁写都行',
          xPct: 6, yPct: 8, widthPct: 54, maxHeightPct: 36, isHero: true },
        { id: 'B', slotRole: 'sticky-reaction', charBudget: [18, 50], eligibleAuthors: ['char'],
          hint: '反应已填某条 (refersTo)',
          xPct: 63, yPct: 8, widthPct: 32, maxHeightPct: 14,
          rotate: 1.8, skinVariant: 'lavender' },
        { id: 'C', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['user', 'char'],
          hint: '心情卡, 谁写都行',
          xPct: 63, yPct: 24, widthPct: 32, maxHeightPct: 14,
          skinVariant: 'mint' },
        { id: 'D', slotRole: 'sticky-reaction', charBudget: [18, 50], eligibleAuthors: ['char'],
          hint: '另一条反应',
          xPct: 63, yPct: 40, widthPct: 32, maxHeightPct: 14,
          rotate: -1.4, skinVariant: 'rose' },
        { id: 'E', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '某角色心情 (写自己)', xPct: 63, yPct: 56, widthPct: 32, maxHeightPct: 12,
          skinVariant: 'sky' },
        { id: 'F', slotRole: 'gratitude', charBudget: [25, 70], eligibleAuthors: ['user'],
          hint: 'user 今日感恩 3 条 (≤22 字 / 条)',
          xPct: 6, yPct: 46, widthPct: 54, maxHeightPct: 18 },
        { id: 'G', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '边角小字', xPct: 6, yPct: 66, widthPct: 26, maxHeightPct: 8, rotate: -1.5 },
        { id: 'H', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句', xPct: 32, yPct: 66, widthPct: 26, maxHeightPct: 8, rotate: 1.6 },
        { id: 'I', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句', xPct: 6, yPct: 76, widthPct: 26, maxHeightPct: 8, rotate: 2 },
        { id: 'J', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '另一句', xPct: 32, yPct: 76, widthPct: 26, maxHeightPct: 8, rotate: -1.8 },
        { id: 'K', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['user', 'char'],
          hint: '页脚一句', xPct: 6, yPct: 86, widthPct: 28, maxHeightPct: 7, rotate: -2 },
        { id: 'L', slotRole: 'corner-note', charBudget: [6, 22], eligibleAuthors: ['char'],
          hint: '某角色页脚一句独白', xPct: 36, yPct: 86, widthPct: 28, maxHeightPct: 7, rotate: 1.6 },
    ]],
};

// ─── F · todo-focus · 待办主导 ─────────────────────────────
const TODO_FOCUS: LayoutTemplate = {
    id: 'todo-focus',
    name: '待办主导',
    suitFor: 'user 偏功能型记录, 今天就是来打勾的',
    paperStyle: 'grid',
    pages: [[
        { id: 'A', slotRole: 'todo', charBudget: [50, 130], eligibleAuthors: ['user'],
          hint: 'user 今日待办, 5~8 项, 每项 ≤ 16 字',
          xPct: 6, yPct: 8, widthPct: 56, maxHeightPct: 50, isHero: true },
        { id: 'B', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['user', 'char'],
          hint: '今日心情 + 评分',
          xPct: 65, yPct: 8, widthPct: 30, maxHeightPct: 14,
          skinVariant: 'lavender' },
        { id: 'C', slotRole: 'sticky-reaction', charBudget: [15, 45], eligibleAuthors: ['char'],
          hint: '看到 user 的 todo, 吐槽某一项 (refersTo)',
          xPct: 65, yPct: 24, widthPct: 30, maxHeightPct: 14,
          rotate: 1.6, skinVariant: 'mint' },
        { id: 'D', slotRole: 'sticky-reaction', charBudget: [15, 45], eligibleAuthors: ['char'],
          hint: '另一个角色 / 另一项 todo',
          xPct: 65, yPct: 40, widthPct: 30, maxHeightPct: 14,
          rotate: -1.2, skinVariant: 'rose' },
        { id: 'E', slotRole: 'mood-card', charBudget: [10, 30], eligibleAuthors: ['char'],
          hint: '某角色心情卡 (写自己今天)',
          xPct: 65, yPct: 56, widthPct: 30, maxHeightPct: 12,
          skinVariant: 'sky' },
        { id: 'F', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '边角一句独白', xPct: 6, yPct: 60, widthPct: 28, maxHeightPct: 7, rotate: -2 },
        { id: 'G', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 34, yPct: 60, widthPct: 28, maxHeightPct: 7, rotate: 1.4 },
        { id: 'H', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 6, yPct: 70, widthPct: 28, maxHeightPct: 7, rotate: 2 },
        { id: 'I', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['user', 'char'],
          hint: '另一句小字', xPct: 34, yPct: 70, widthPct: 28, maxHeightPct: 7, rotate: -1.6 },
        { id: 'J', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['char'],
          hint: '某角色页脚独白 (写自己)', xPct: 6, yPct: 86, widthPct: 32, maxHeightPct: 7, rotate: -1.8 },
        { id: 'K', slotRole: 'corner-note', charBudget: [6, 20], eligibleAuthors: ['char'],
          hint: '另一个角色一句独白', xPct: 40, yPct: 86, widthPct: 28, maxHeightPct: 7, rotate: 1.6 },
    ]],
};

// ─── 模板表 ──────────────────────────────────────────────
export const LAYOUT_TEMPLATES: Record<string, LayoutTemplate> = {
    'plan-day': PLAN_DAY,
    'reflective-day': REFLECTIVE_DAY,
    'photo-day': PHOTO_DAY,
    'quiet-day': QUIET_DAY,
    'ensemble-day': ENSEMBLE_DAY,
    'todo-focus': TODO_FOCUS,
};

export const TEMPLATE_IDS = Object.keys(LAYOUT_TEMPLATES);

/**
 * 按当日条件选模板。
 *
 * 规则:
 *  - userMsgCount < 4               → quiet-day
 *  - userHasPhotoIntent === true    → photo-day
 *  - charCount >= 3                 → ensemble-day
 *  - userMsgCount >= 8              → reflective-day
 *  - 其它                            → plan-day
 *
 * todo-focus 不会被自动选 (user 主动挑)。
 */
export function pickTemplate(opts: {
    userMsgCount: number;
    charCount: number;
    userHasPhotoIntent?: boolean;
}): LayoutTemplate {
    if (opts.userHasPhotoIntent) return PHOTO_DAY;
    if (opts.userMsgCount < 4) return QUIET_DAY;
    if (opts.charCount >= 3) return ENSEMBLE_DAY;
    if (opts.userMsgCount >= 8) return REFLECTIVE_DAY;
    return PLAN_DAY;
}

export function getTemplate(id: string): LayoutTemplate | null {
    return LAYOUT_TEMPLATES[id] || null;
}
