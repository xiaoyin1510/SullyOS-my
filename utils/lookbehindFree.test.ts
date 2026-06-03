/**
 * lookbehind-free 改写对照测试
 *
 * 背景: 正则后行断言 (?<=) / (?<!) 在 iOS Safari < 16.4 (WebKit/JSC) 不支持,
 *   旧设备上 `new RegExp('(?<=…)')` 直接抛 "Invalid regular expression:
 *   invalid group specifier name", 被聊天兜底 catch 包成 "[连接中断: …]" 弹给用户。
 *   见 utils/chatParser.ts / sanitize.ts / GroupChat.tsx 等 8 处。
 *
 * 策略: 这里把每处「旧 lookbehind 写法」当 oracle, 「新 lookahead 写法」当 candidate,
 *   在支持 lookbehind 的 Node/V8 里跑一批覆盖性输入, 断言两者逐字节一致。
 *   旧写法只存在于本测试文件 (oracle), 源码里已全部清除 (见 no-lookbehind 守卫)。
 *
 * 注意: oracle 用的 lookbehind 正则本身会让 <16.4 的 JSC 解析失败, 但本测试只在
 *   CI / 开发机的 Node 上跑, 不进 bundle, 所以无所谓。
 */
import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// 1) CJK 分气泡: chatParser.chunkText / sanitize.chunkText
//    旧: split(/(?<=[CJK])\s+(?=[CJK])/)  ——「夹在两个 CJK 之间的空格」处断开
//    新: 把左侧 CJK 捕获进来, 用换行哨兵标记切点, 再 split
// ─────────────────────────────────────────────────────────────────────────────
const CJK =
  '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef\\u2000-\\u206f\\u2e80-\\u2eff\\u3001-\\u3003\\u2018-\\u201f\\u300a-\\u300f\\uff01-\\uff0f\\uff1a-\\uff20';

const oracleCjkSplit = (chunk: string): string[] => {
  const re = new RegExp(`(?<=[${CJK}])\\s+(?=[${CJK}])`);
  return chunk.split(re);
};

// candidate: lookahead-only。左侧 CJK 用捕获组吃进来再用 $1 补回, 右侧保持零宽 lookahead。
// 哨兵用 U+241F (␟, Unit Separator 的可见符号), 正文里不会出现, 且肉眼可见 —— 别用裸 \0,
// 那东西不可见、会污染 shell、Read 还会把它显示成普通空格 (本测试就被这坑过一次)。
const SPLIT_SENTINEL = '␟';
const candidateCjkSplit = (chunk: string): string[] => {
  const re = new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, 'g');
  return chunk.replace(re, `$1${SPLIT_SENTINEL}`).split(SPLIT_SENTINEL);
};

describe('CJK 分气泡: lookahead 改写与 lookbehind 等价', () => {
  const cases = [
    '你好 世界',           // 基本: 一个空格夹在两汉字间
    '中 文 字',            // 连续单字: 必须切成三段, 不能漏 (codex 提的坑)
    '中  文',              // 多个空格
    'hello world',         // 纯英文: 不该切
    '你好 world 再见',      // 中英混: 中-英 不切, 英-中 不切, 只切 中-中? (空格右边是 w 非 CJK)
    '句号。 下一句',        // 标点也在 CJK 集合里
    '   ',                 // 全空格
    '',                    // 空串
    '单',                  // 单字符
    'a 中',                // 英-中 (左非 CJK, 不切)
    '中 a',                // 中-英 (右非 CJK, 不切)
    '你好	世界',          // tab 分隔
    '我 是 谁 啊 喂',       // 多个连续单字
  ];
  for (const input of cases) {
    it(`等价: ${JSON.stringify(input)}`, () => {
      expect(candidateCjkSplit(input)).toEqual(oracleCjkSplit(input));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) GroupChat 分气泡: 左右字符集不同 (左含标点全集, 右只含汉字两段)
//    旧: split(/(?<=[左CJK])\s+(?=[右CJK])/)
// ─────────────────────────────────────────────────────────────────────────────
const GC_LEFT =
  '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3000-\\u303f\\uff00-\\uffef\\u2000-\\u206f\\u2e80-\\u2eff\\u3001-\\u3003\\u2018-\\u201f\\u300a-\\u300f\\uff01-\\uff0f\\uff1a-\\uff20';
const GC_RIGHT = '\\u4e00-\\u9fff\\u3400-\\u4dbf';

const oracleGroupSplit = (text: string): string[] => {
  const re = new RegExp(`(?<=[${GC_LEFT}])\\s+(?=[${GC_RIGHT}])`);
  return text.split(re);
};
const candidateGroupSplit = (text: string): string[] => {
  const re = new RegExp(`([${GC_LEFT}])\\s+(?=[${GC_RIGHT}])`, 'g');
  return text.replace(re, `$1${SPLIT_SENTINEL}`).split(SPLIT_SENTINEL);
};

describe('GroupChat 分气泡: 左右范围不同也等价', () => {
  const cases = [
    '你好 世界',
    '中 文 字',
    '句号。 中文',        // 左标点 + 右汉字: 切
    '句号。 ！',          // 右是全角标点 (在左集但不在右集): 不切
    '中 文',
    '我 是 谁 啊 喂',
    '中 a 文',            // 中-英不切, 英-中不切
    '',
    '中',
  ];
  for (const input of cases) {
    it(`等价: ${JSON.stringify(input)}`, () => {
      expect(candidateGroupSplit(input)).toEqual(oracleGroupSplit(input));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) memoryPalace/migration 句末切句
//    旧: split(/(?<=[。！？!?])\s*|\n+/)  —— 句末标点后切 (标点留给前句), 或换行切
//    新: 先用占位把 \n 段统一, 标点切点同样靠"捕获标点 + 哨兵"
// ─────────────────────────────────────────────────────────────────────────────
const oracleSentenceSplit = (summary: string): string[] =>
  summary
    .split(/(?<=[。！？!?])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

// candidate: 两个 alternation 分支分别处理。
//   分支 A「(?<=[标点])\s*」: 在标点后(含可选空白)切, 标点留前句 → 捕获标点 + 哨兵 + 吃掉随后的 \s*
//   分支 B「\n+」: 直接切
const candidateSentenceSplit = (summary: string): string[] => {
  const marked = summary
    .replace(/([。！？!?])\s*/g, `$1${SPLIT_SENTINEL}`)
    .replace(/\n+/g, SPLIT_SENTINEL);
  return marked
    .split(SPLIT_SENTINEL)
    .map((s) => s.trim())
    .filter(Boolean);
};

describe('句末切句: 等价', () => {
  const cases = [
    '今天去爬山了。天气很好！你呢?',
    '第一句。\n第二句。\n\n第三句',
    '没有标点的一长句话',
    '混合。 带空格 ！ 带换行\n结尾',
    'Hello. World! How are you?',
    '',
    '。。。',
    '结尾标点。',
    '中间\n\n\n多换行',
  ];
  for (const input of cases) {
    it(`等价: ${JSON.stringify(input)}`, () => {
      expect(candidateSentenceSplit(input)).toEqual(oracleSentenceSplit(input));
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4) dateResolver: (?<![\d年]) 前向否定 —— 候选月/月日前面不能紧跟数字或"年"
//    旧: matchAll(/(?<![\d年])(\d{1,2}|[一二三四五六七八九十]+)\s*月.../gu)
//    新: 去掉 lookbehind, 改成匹配后用 m.index 检查前一字符, 不满足则跳过 (codex 提的法子)
//    这里验证「保留集合」逐字节一致: 对同一 query, 两种方法筛出的 (值, index) 列表相同。
// ─────────────────────────────────────────────────────────────────────────────
type Hit = { v1: string; v2?: string; index: number };

const oracleMonthDay = (query: string): Hit[] => {
  const out: Hit[] = [];
  for (const m of query.matchAll(
    /(?<![\d年])(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/gu,
  )) {
    out.push({ v1: m[1], v2: m[2], index: m.index ?? 0 });
  }
  return out;
};
const candidateMonthDay = (query: string): Hit[] => {
  const out: Hit[] = [];
  for (const m of query.matchAll(
    /(\d{1,2}|[一二三四五六七八九十]+)\s*月\s*(\d{1,2}|[一二三四五六七八九十]+)\s*[日号]/gu,
  )) {
    const index = m.index ?? 0;
    if (index > 0 && /[\d年]/u.test(query[index - 1])) continue; // 模拟 (?<![\d年])
    out.push({ v1: m[1], v2: m[2], index });
  }
  return out;
};

const oracleMonth = (query: string): Hit[] => {
  const out: Hit[] = [];
  for (const m of query.matchAll(
    /(?<![\d年])(\d{1,2}|[一二三四五六七八九十]+)\s*月(?![\d日号份一二三四五六七八九十])/gu,
  )) {
    out.push({ v1: m[1], index: m.index ?? 0 });
  }
  return out;
};
const candidateMonth = (query: string): Hit[] => {
  const out: Hit[] = [];
  for (const m of query.matchAll(
    /(\d{1,2}|[一二三四五六七八九十]+)\s*月(?![\d日号份一二三四五六七八九十])/gu,
  )) {
    const index = m.index ?? 0;
    if (index > 0 && /[\d年]/u.test(query[index - 1])) continue;
    out.push({ v1: m[1], index });
  }
  return out;
};

describe('dateResolver: m.index 检查与 lookbehind 等价', () => {
  const cases = [
    '3月4号',
    '12月15日',
    '去年3月4号',         // "年"在前 → 旧的被 (?<!年) 拒, 新的也得拒
    '2024年3月',          // 年前缀
    '13月4号',            // 月份非法但正则仍匹配 (筛选在业务层)
    '我想查3月的事',
    '3月 和 5月6号',
    '第3月',              // 前面是"第"(非数字非年) → 应保留
    '20240304',           // 纯数字无月
    '十二月三十一号',
    '前面有2然后3月',      // "2"非紧邻? "然后3月" → 3 前是"后", 保留
    '23月',               // 2 紧邻 3 → 旧 lookbehind 在 "3月" 处前一字符是 "2"(数字) 应拒
    // 以下专门压「matchAll 消费跳过」: 候选 A 被前缀拒绝后, 紧挨的候选 B 不能被 A 的匹配吞掉
    '1月2月',             // "1月"前是行首应留; "2月"前是"月"(非数字非年)应留 → 两个都中
    '5月3月4号',          // "5月"留; 紧跟"3月4号"前是"月"应留
    '12月34号56号',       // 连续日号
    '年3月',              // "年"紧贴 → 拒; 但行首"年"本身不参与
    '3月4月5月',          // 三连月, 全应保留
    '99月88号77月',       // 全非法值但匹配, 测纯切分一致性
  ];
  for (const input of cases) {
    it(`月日等价: ${JSON.stringify(input)}`, () => {
      expect(candidateMonthDay(input)).toEqual(oracleMonthDay(input));
    });
    it(`孤立月等价: ${JSON.stringify(input)}`, () => {
      expect(candidateMonth(input)).toEqual(oracleMonth(input));
    });
  }
});

// dateResolver: 有意偏离旧 lookbehind 的 case (顺手修了旧 bug, 不强行等价)
//
// 旧 lookbehind 写法有个隐藏 bug: 当中文数字是多字符贪婪串 (如"十二月") 且前面紧跟 年/数字时,
// (?<![\d年]) 在首字"十"处拒绝后, 正则引擎会从"二"重试, 贪婪量词 [一二三…]+ 只够匹配"二",
// 于是把"十二月"错误肢解成"二月"去检索记忆 —— 这是 bug。
// 新写法 (matchAll 一次性贪婪吃掉"十二月" + idx-1 检查) 会整条跳过, 不再抠出假的"二月"。
// 这类输入本就该由前面的 case 5「绝对年月」(\d{2,4}年\d{1,2}月) 处理, case 8 这个 fallback 不该插手。
// 所以这里断言新行为 (整条跳过), 不和旧 oracle 比。
describe('dateResolver: 顺手修正旧 lookbehind 的"短匹配回退"bug', () => {
  const cases: Array<[string, Hit[]]> = [
    ['2024年十二月', []],   // 旧: 抠出"二月"(idx6); 新: 跳过 (该走绝对年月 case)
    ['今年三四月', []],      // 旧: 抠出"四月"(idx3); 新: 跳过
    ['x1十二月', []],        // 旧: 抠出"二月"(idx3); 新: 跳过 (数字前缀也触发)
    ['去年十二月', []],      // 旧: 抠出"二月"(idx3); 新: 跳过 (该走相对年月)
  ];
  for (const [input, expected] of cases) {
    it(`孤立月不再肢解: ${JSON.stringify(input)}`, () => {
      expect(candidateMonth(input)).toEqual(expected);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5) scheduleGenerator: 数未转义引号
//    旧: s.match(/(?<!\\)"/g)?.length —— 前面不是反斜杠的引号个数
//    注意: 旧写法对 \\" (偶数反斜杠, 即转义的反斜杠 + 真引号) 会误判成"已转义",
//         所以新写法不追求和旧写法字节一致, 而是追求"正确": 数引号前连续反斜杠, 偶数才算未转义。
//    这里测「新写法在旧写法正确的场景下与之一致」+「新写法修正了旧写法的 bug」。
// ─────────────────────────────────────────────────────────────────────────────
const oracleUnescapedQuoteCount = (s: string): number =>
  (s.match(/(?<!\\)"/g) || []).length;

// 新: 扫描器。数每个 " 前连续反斜杠数量, 偶数(含0) → 未转义。
const countUnescapedQuotes = (s: string): number => {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '"') continue;
    let backslashes = 0;
    let j = i - 1;
    while (j >= 0 && s[j] === '\\') {
      backslashes++;
      j--;
    }
    if (backslashes % 2 === 0) count++;
  }
  return count;
};

describe('未转义引号计数', () => {
  it('与旧写法在简单场景一致', () => {
    const simple = ['"abc"', 'no quotes', '\\"escaped\\"', 'a"b"c', '""'];
    for (const s of simple) {
      expect(countUnescapedQuotes(s)).toBe(oracleUnescapedQuoteCount(s));
    }
  });
  it('修正旧写法对偶数反斜杠的误判', () => {
    // 字符串字面量 '\\\\"' = 反斜杠 + 反斜杠 + 引号 = 转义的反斜杠后跟真引号 → 应算"未转义"(1)
    const tricky = '\\\\"';
    expect(countUnescapedQuotes(tricky)).toBe(1);   // 新: 正确
    expect(oracleUnescapedQuoteCount(tricky)).toBe(0); // 旧: 误判为已转义
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6) JournalRichText: 单星斜体 (区分 *斜体* 与 **粗体**)
//    旧: rest.match(/(?<!\*)\*([^*]+)\*(?!\*)/) —— 左右都不是星号的单星
//    新: (^|[^*])\* …, 命中后 idx/len 要减去前缀字符 it[1]
// ─────────────────────────────────────────────────────────────────────────────
type ItalicHit = { idx: number; len: number; inner: string } | null;

const oracleItalic = (rest: string): ItalicHit => {
  const it = rest.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
  if (it && it.index !== undefined) {
    return { idx: it.index, len: it[0].length, inner: it[1] };
  }
  return null;
};
const candidateItalic = (rest: string): ItalicHit => {
  const it = rest.match(/(^|[^*])\*([^*]+)\*(?!\*)/);
  if (it && it.index !== undefined) {
    const offset = it[1].length; // 前缀 (^ 时为 '' 长度0, [^*] 时为 1)
    return { idx: it.index + offset, len: it[0].length - offset, inner: it[2] };
  }
  return null;
};

describe('斜体单星: 前缀捕获改写与 lookbehind 等价', () => {
  const cases = [
    '*斜体*',
    '行首*斜体*尾',
    'a*斜体*b',
    '**粗体**',           // 不该被斜体命中
    '**粗**和*斜*',        // 混合: 单星应命中"斜"
    '没有星号',
    '*单边',              // 不闭合
    '* 空格星',
    '前缀*x*',
    '*a* *b*',            // 多个, match 取第一个
  ];
  for (const input of cases) {
    it(`等价: ${JSON.stringify(input)}`, () => {
      expect(candidateItalic(input)).toEqual(oracleItalic(input));
    });
  }
});
