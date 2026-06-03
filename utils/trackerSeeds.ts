/**
 * Tracker 内置模板 + 首次启动种子
 *
 * 设计:
 * - 系统提供 6 个常用模板,user 可以"启用"它们(创建一份属于自己的副本)
 * - 第一次进 Tracker 区会自动种"心情"作为示范,其他模板待 user 主动启用
 * - 启用 = 把模板复制成 Tracker 写进 DB,从此跟系统模板解耦(user 可随意改字段)
 */

import { Tracker, TrackerField } from '../types';
import { DB } from './db';

// ─── 字段模板辅助 ────────────────────────────────
const f = (
    key: string,
    label: string,
    kind: TrackerField['kind'],
    extra: Partial<TrackerField> = {},
): TrackerField => ({ key, label, kind, ...extra });

// ─── 6 个内置 Tracker 模板 ─────────────────────────
export interface TrackerTemplate {
    /** 用作种子 id 的前缀 */
    templateId: string;
    name: string;
    icon: string;
    color: string;
    schema: TrackerField[];
    cellRenderField: string;
    blurb: string;          // 一句话介绍,创建面板里展示
}

export const TRACKER_TEMPLATES: TrackerTemplate[] = [
    {
        templateId: 'mood',
        name: '心情',
        icon: '🌸',
        color: '#fbb8c8',
        cellRenderField: 'rating',
        blurb: '今天的心情打几分,顺手记一句',
        schema: [
            f('rating', '心情', 'rating', {
                required: true, min: 1, max: 5,
                choices: [
                    { value: '1', label: '很糟', emoji: '😣' },
                    { value: '2', label: '低落', emoji: '😔' },
                    { value: '3', label: '一般', emoji: '😐' },
                    { value: '4', label: '不错', emoji: '🙂' },
                    { value: '5', label: '很好', emoji: '😊' },
                ],
            }),
            f('note', '一句话', 'text', { placeholder: '今天的关键词……' }),
        ],
    },
    {
        templateId: 'cycle',
        name: '经期',
        icon: '🌷',
        color: '#f29db0',
        cellRenderField: 'flow',
        blurb: '记录开始/结束 + 流量,自动算周期',
        schema: [
            f('flow', '流量', 'options', {
                required: true,
                choices: [
                    { value: 'start',  label: '开始',  emoji: '🌷' },
                    { value: 'heavy',  label: '量多',  emoji: '🌹' },
                    { value: 'medium', label: '中等',  emoji: '🌸' },
                    { value: 'light',  label: '量少',  emoji: '🌼' },
                    { value: 'end',    label: '结束',  emoji: '🍃' },
                ],
            }),
            f('cramp', '不舒服?', 'boolean'),
            f('note', '备注', 'text'),
        ],
    },
    {
        templateId: 'food',
        name: '今日饮食',
        icon: '🍰',
        color: '#f5e295',
        cellRenderField: 'meal',
        blurb: '随手拍 + 一句话,不计算热量',
        schema: [
            f('photo', '照片', 'photo'),
            f('meal', '吃了啥', 'text', { required: true, placeholder: '一句话就好' }),
        ],
    },
    {
        templateId: 'water',
        name: '喝水',
        icon: '💧',
        color: '#b9d3e0',
        cellRenderField: 'cups',
        blurb: '今天喝了几杯水',
        schema: [
            f('cups', '杯数', 'number', { required: true, unit: '杯', min: 0, max: 20 }),
        ],
    },
    {
        templateId: 'weight',
        name: '体重',
        icon: '🪶',
        color: '#bfe1cf',
        cellRenderField: 'kg',
        blurb: '记一下今天的数字,后续画折线',
        schema: [
            f('kg', '体重', 'number', { required: true, unit: 'kg', min: 0, max: 999 }),
            f('note', '备注', 'text', { placeholder: '一句话说说?' }),
        ],
    },
    {
        templateId: 'symptom',
        name: '今天有没有不舒服',
        icon: '🤒',
        color: '#d6c8e8',
        cellRenderField: 'has',
        blurb: '通用症状打卡,可改名换字段',
        schema: [
            f('has', '有不舒服?', 'boolean', { required: true }),
            f('what', '哪里', 'text', { placeholder: '头痛 / 肚子痛 / ……' }),
            f('severity', '严重程度', 'rating', {
                min: 1, max: 5,
                choices: [
                    { value: '1', label: '轻', emoji: '·' },
                    { value: '2', label: '小', emoji: '◦' },
                    { value: '3', label: '中', emoji: '◐' },
                    { value: '4', label: '重', emoji: '●' },
                    { value: '5', label: '剧烈', emoji: '⚡' },
                ],
            }),
        ],
    },
];

// 把模板实例化成一个具体 Tracker(写进 DB 的形态)
export function instantiateTemplate(tpl: TrackerTemplate, sortOrder: number = 0): Tracker {
    const now = Date.now();
    return {
        id: `tracker-${tpl.templateId}-${now}`,
        name: tpl.name,
        icon: tpl.icon,
        color: tpl.color,
        schema: tpl.schema,
        cellRenderField: tpl.cellRenderField,
        isBuiltin: true,
        sortOrder,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * 首次进 Tracker 区时调用:
 * - 如果 DB 里完全没有 tracker → 种一个"心情"作为示范
 * - 已经有任何 tracker → 不动(尊重用户已有数据,即便 ta 已经把心情删了)
 */
export async function ensureSeedTrackers(): Promise<void> {
    const all = await DB.getAllTrackers();
    if (all.length > 0) return;
    const moodTpl = TRACKER_TEMPLATES.find(t => t.templateId === 'mood')!;
    await DB.saveTracker(instantiateTemplate(moodTpl, 0));
}
