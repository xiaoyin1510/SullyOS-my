/**
 * Memory Palace — 日期引用解析
 *
 * 聊天里出现"去年12月""3月4号""上周""昨天"这类日期引用时，
 * 向量相似度/BM25 都不可靠（记忆内容里是"12月15日"，query 里是"十二月"
 * 或"去年12月"，两者 embedding 向量不对齐；BM25 分词也对不上）。
 *
 * 本模块把 query 文本里的日期引用解析成绝对 [start, end) 时间戳区间，
 * 供 pipeline 另起一路按 createdAt 查记忆，融入召回池。
 *
 * 设计原则：
 * - 宽松优先：哪怕只命中"去年"或"3月"这种粗范围也给出结果，宁可多不要错过
 * - 歧义时选最近：孤立的"3月"→ 最近一次出现过的 3 月（跨年时往前找）
 * - 只处理常见中文/数字表达，不套 NLU 模型
 */

export interface DateRange {
    /** 区间起点（毫秒时间戳，含） */
    start: number;
    /** 区间终点（毫秒时间戳，不含） */
    end: number;
    /** 人类可读标签，用于日志 */
    label: string;
    /** exact = 日级精确；fuzzy = 月/周/年级粗粒度 */
    confidence: 'exact' | 'fuzzy';
}

const MS_DAY = 24 * 60 * 60 * 1000;

// 中文数字（只处理 1-31，够用于月份和日期）
const CN_DIGIT: Record<string, number> = {
    '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
    '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};
function cnNumToInt(s: string): number | null {
    // "十二" → 12, "二十" → 20, "二十三" → 23, "十" → 10, "九" → 9
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (CN_DIGIT[s] !== undefined) return CN_DIGIT[s];
    // 十X
    const m1 = /^十([一二三四五六七八九])$/.exec(s);
    if (m1) return 10 + CN_DIGIT[m1[1]];
    // X十 / X十Y
    const m2 = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(s);
    if (m2) return CN_DIGIT[m2[1]] * 10 + (m2[2] ? CN_DIGIT[m2[2]] : 0);
    return null;
}

function startOfDay(y: number, m0: number, d: number): number {
    return new Date(y, m0, d, 0, 0, 0, 0).getTime();
}

function daysInMonth(y: number, m0: number): number {
    return new Date(y, m0 + 1, 0).getDate();
}

/** 把日级定位成 [当天 00:00, 次日 00:00) */
function dayRange(y: number, m0: number, d: number, label: string): DateRange {
    const start = startOfDay(y, m0, d);
    return { start, end: start + MS_DAY, label, confidence: 'exact' };
}

/** 把月级定位成 [1 号 00:00, 次月 1 号 00:00) */
function monthRange(y: number, m0: number, label: string): DateRange {
    const start = startOfDay(y, m0, 1);
    const end = startOfDay(y, m0 + 1, 1);
    return { start, end, label, confidence: 'fuzzy' };
}

/** 把年级定位成 [1 月 1 日 00:00, 次年 1 月 1 日 00:00) */
function yearRange(y: number, label: string): DateRange {
    const start = startOfDay(y, 0, 1);
    const end = startOfDay(y + 1, 0, 1);
    return { start, end, label, confidence: 'fuzzy' };
}

/**
 * 给定月份（1-12），结合当前日期，选定"最近一次出现该月份"的年份。
 * 例：now=2026-04，query="12月" → 2025-12（过去的 12 月）
 *     now=2026-04，query="3月"  → 2026-03（当年刚过）
 *     now=2026-04，query="5月"  → 2025-05（今年还没到，指向去年）
 */
function resolveNearestPastMonth(targetMonth1: number, now: Date): number {
    const y = now.getFullYear();
    const m1 = now.getMonth() + 1;
    return targetMonth1 <= m1 ? y : y - 1;
}

// ─── 主解析 ────────────────────────────────────────────

export function resolveDateReferences(query: string, now: Date = new Date()): DateRange[] {
    const ranges: DateRange[] = [];
    const seenLabels = new Set<string>();
    const push = (r: DateRange | null) => {
        if (!r) return;
        if (seenLabels.has(r.label)) return;
        seenLabels.add(r.label);
        ranges.push(r);
    };

    const curY = now.getFullYear();
    const curM0 = now.getMonth();
    const curD = now.getDate();

    // 相对年（前年/去年/今年/明年）可单独出现，也可"去年12月"这种组合
    //   先捕获组合，再处理单独

    // 1) 相对年 + 月 + 日：去年12月15日 / 去年12月15号
    for (const m of query.matchAll(/(前年|去年|今年|明年)\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/gu)) {
        const yOff = { '前年': -2, '去年': -1, '今年': 0, '明年': 1 }[m[1]]!;
        const mm = cnNumToInt(m[2]);
        const dd = cnNumToInt(m[3]);
        if (mm && dd && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
            const y = curY + yOff;
            if (dd <= daysInMonth(y, mm - 1)) {
                push(dayRange(y, mm - 1, dd, m[0]));
            }
        }
    }

    // 2) 相对年 + 月：去年12月
    for (const m of query.matchAll(/(前年|去年|今年|明年)\s*(\d{1,2}|[一二三四五六七八九十]+)\s*月(?![\d一二三四五六七八九十份])/gu)) {
        const yOff = { '前年': -2, '去年': -1, '今年': 0, '明年': 1 }[m[1]]!;
        const mm = cnNumToInt(m[2]);
        if (mm && mm >= 1 && mm <= 12) {
            push(monthRange(curY + yOff, mm - 1, m[0]));
        }
    }

    // 3) 相对年：去年（无紧跟月份）
    for (const m of query.matchAll(/(前年|去年|今年|明年)(?![\d一二三四五六七八九十])/gu)) {
        const yOff = { '前年': -2, '去年': -1, '今年': 0, '明年': 1 }[m[1]]!;
        push(yearRange(curY + yOff, m[0]));
    }

    // 4) 绝对年月日：2024年12月15日 / 24年12月15号 / 2024-12-15 / 2024/12/15
    for (const m of query.matchAll(/(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g)) {
        let y = parseInt(m[1], 10);
        if (y < 100) y += 2000;
        const mm = parseInt(m[2], 10);
        const dd = parseInt(m[3], 10);
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= daysInMonth(y, mm - 1)) {
            push(dayRange(y, mm - 1, dd, m[0]));
        }
    }
    for (const m of query.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)) {
        const y = parseInt(m[1], 10);
        const mm = parseInt(m[2], 10);
        const dd = parseInt(m[3], 10);
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= daysInMonth(y, mm - 1)) {
            push(dayRange(y, mm - 1, dd, m[0]));
        }
    }

    // 5) 绝对年月：2024年12月 / 24年12月
    for (const m of query.matchAll(/(\d{2,4})\s*年\s*(\d{1,2})\s*月(?![\d日号])/g)) {
        let y = parseInt(m[1], 10);
        if (y < 100) y += 2000;
        const mm = parseInt(m[2], 10);
        if (mm >= 1 && mm <= 12) {
            push(monthRange(y, mm - 1, m[0]));
        }
    }

    // 6) 仅年：2024年（无紧跟月份）
    for (const m of query.matchAll(/(\d{4})\s*年(?![\d一二三四五六七八九十])/g)) {
        const y = parseInt(m[1], 10);
        push(yearRange(y, m[0]));
    }

    // 7) 孤立月日：3月4号 / 12月15日 / 3/4 / 12-15（无年份）→ 最近一次出现
    for (const m of query.matchAll(/(?<![\d年])(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/gu)) {
        const mm = cnNumToInt(m[1]);
        const dd = cnNumToInt(m[2]);
        if (mm && dd && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
            const y = resolveNearestPastMonth(mm, now);
            if (dd <= daysInMonth(y, mm - 1)) {
                push(dayRange(y, mm - 1, dd, m[0]));
            }
        }
    }

    // 8) 孤立月：3月 / 十二月（无年份、无后续日/号）
    for (const m of query.matchAll(/(?<![\d年])(\d{1,2}|[一二三四五六七八九十]+)\s*月(?![\d日号份一二三四五六七八九十])/gu)) {
        const mm = cnNumToInt(m[1]);
        if (mm && mm >= 1 && mm <= 12) {
            const y = resolveNearestPastMonth(mm, now);
            push(monthRange(y, mm - 1, m[0]));
        }
    }

    // 9) 相对日：昨天/前天/今天/明天/后天/大前天/大后天
    const dayOffsets: Record<string, number> = {
        '大前天': -3, '前天': -2, '昨天': -1, '今天': 0,
        '明天': 1, '后天': 2, '大后天': 3,
    };
    for (const [kw, off] of Object.entries(dayOffsets)) {
        if (query.includes(kw)) {
            const target = new Date(curY, curM0, curD + off);
            push(dayRange(target.getFullYear(), target.getMonth(), target.getDate(), kw));
        }
    }

    // 10) 相对周：上周/上礼拜/本周/这周/下周/下礼拜
    //    本周 = 周一 00:00 到周日 23:59
    const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 周一=1..周日=7
    const thisMondayD = curD - (dayOfWeek - 1);
    const thisMonday0 = startOfDay(curY, curM0, thisMondayD);
    if (/上\s*(个)?\s*(周|礼拜|星期)/.test(query)) {
        push({
            start: thisMonday0 - 7 * MS_DAY,
            end: thisMonday0,
            label: '上周',
            confidence: 'fuzzy',
        });
    }
    if (/(本|这)\s*(周|礼拜|星期)/.test(query)) {
        push({
            start: thisMonday0,
            end: thisMonday0 + 7 * MS_DAY,
            label: '本周',
            confidence: 'fuzzy',
        });
    }
    if (/下\s*(个)?\s*(周|礼拜|星期)/.test(query)) {
        push({
            start: thisMonday0 + 7 * MS_DAY,
            end: thisMonday0 + 14 * MS_DAY,
            label: '下周',
            confidence: 'fuzzy',
        });
    }

    // 11) 相对月：上个月/上月/本月/这个月/下个月
    if (/上\s*(个)?\s*月(?![\d一二三四五六七八九十份])/.test(query)) {
        push(monthRange(curY, curM0 - 1, '上个月'));
    }
    if (/(本|这\s*个?)\s*月(?![\d一二三四五六七八九十份])/.test(query)) {
        push(monthRange(curY, curM0, '本月'));
    }
    if (/下\s*(个)?\s*月(?![\d一二三四五六七八九十份])/.test(query)) {
        push(monthRange(curY, curM0 + 1, '下个月'));
    }

    // 12) 最近 / 最近一周 / 最近几天（粗粒度，取 7 天）
    if (/最近(一周|几天|这(一|几)?天)?/.test(query)) {
        const end = startOfDay(curY, curM0, curD) + MS_DAY; // 含今天
        push({ start: end - 7 * MS_DAY, end, label: '最近', confidence: 'fuzzy' });
    }

    return ranges;
}
