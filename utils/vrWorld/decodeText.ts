/**
 * 小说 txt 解码 —— 不能写死 UTF-8，也不能 UTF-8 失败就一律当中文 GB18030。
 * 日文小说常见 Shift_JIS / EUC-JP，被 GB18030 解码器"将就"解出来就是一堆乱码。
 *
 * 策略：
 *   1. 先看 BOM（UTF-8 / UTF-16 LE / UTF-16 BE）—— 无歧义，直接定
 *   2. 用 fatal 模式试 UTF-8；能过就是 UTF-8
 *   3. 否则在候选编码（GB18030 / Shift_JIS / EUC-JP / Big5）里按"文本质量"打分挑最优
 *   4. 兜底 UTF-8 宽松模式
 *
 * 也支持手动指定编码（forced）：自动识别判错时，UI 可以让用户强制换一个。
 */

export interface DecodeResult {
    text: string;
    encoding: string;
}

/** 自动识别时参与评分的候选编码。GB18030 放最前 —— 同分时优先（中文是主场景）。 */
const CANDIDATES = ['gb18030', 'shift_jis', 'euc-jp', 'big5'] as const;

/** 识别只取前若干字节做样本，避免大文件（数 MB）反复全量解码拖慢上传。 */
const SAMPLE_BYTES = 256 * 1024;

function tryDecode(buf: ArrayBuffer, enc: string): string | null {
    try {
        return new TextDecoder(enc).decode(buf);
    } catch {
        // 引擎不认识这个编码 label
        return null;
    }
}

/**
 * 给一段解码结果打分：越像"正常人类文本"分越高。
 * 核心：用错编码会大量产生替换符 U+FFFD、私用区字符、半角片假名乱码；
 * 用对编码则是连片的汉字 / 假名 / ASCII。
 */
function scoreText(s: string): number {
    let score = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 0xFFFD) { score -= 100; continue; }              // 解码失败的替换符：强惩罚
        if (c >= 0x3040 && c <= 0x30FF) { score += 4; continue; }  // 平/片假名：强日文信号
        if (c >= 0x4E00 && c <= 0x9FFF) { score += 1; continue; }  // CJK 汉字
        if (c >= 0x3000 && c <= 0x303F) { score += 1; continue; }  // CJK 标点（含全角空格）
        if (c >= 0xFF01 && c <= 0xFF5E) { score += 1; continue; }  // 全角 ASCII
        if (c >= 0xFF61 && c <= 0xFF9F) { score -= 1; continue; }  // 半角片假名：乱码高发区，压一压
        if (c === 0x09 || c === 0x0A || c === 0x0D) { score += 1; continue; } // 制表/换行
        if (c >= 0x20 && c <= 0x7E) { score += 1; continue; }      // ASCII 可见字符
        if (c >= 0xE000 && c <= 0xF8FF) { score -= 20; continue; } // 私用区：几乎一定是乱码
        if (c < 0x20) { score -= 5; continue; }                    // 其它控制符
        score -= 0.3;                                               // 其余生僻符号：轻微减分
    }
    return score;
}

/** 在候选编码里按文本质量挑一个。GB18030 同分优先（数组顺序 + 严格大于）。 */
function detectEncoding(buf: ArrayBuffer): string {
    const sample = buf.byteLength > SAMPLE_BYTES ? buf.slice(0, SAMPLE_BYTES) : buf;
    let best = 'gb18030';
    let bestScore = -Infinity;
    for (const enc of CANDIDATES) {
        const t = tryDecode(sample, enc);
        if (t == null) continue;
        const sc = scoreText(t);
        if (sc > bestScore) {
            bestScore = sc;
            best = enc;
        }
    }
    return best;
}

/**
 * 解码字节流为文本。
 * @param buf    原始字节
 * @param forced 手动指定编码（如 'utf-8' / 'shift_jis'）。传了就直接用，识别失败再回退自动。
 */
export function decodeBytes(buf: ArrayBuffer, forced?: string): DecodeResult {
    const bytes = new Uint8Array(buf);

    // 手动指定：优先按用户选的来
    if (forced) {
        const t = tryDecode(buf, forced);
        if (t != null) return { text: t, encoding: forced };
        // 本引擎不认识这个 label → 落到下面的自动识别
    }

    // BOM（无歧义）
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'utf-16le' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'utf-16be' };
    }

    // 严格 UTF-8：非法字节序列会抛错 → 说明不是 UTF-8
    try {
        const t = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        return { text: t, encoding: 'utf-8' };
    } catch {
        /* not utf-8 */
    }

    // 非 UTF-8：在候选编码里挑文本质量最高的（区分中文 GB18030 / 日文 Shift_JIS·EUC-JP / 繁体 Big5）
    const enc = detectEncoding(buf);
    const t = tryDecode(buf, enc);
    if (t != null) return { text: t, encoding: enc };

    // 兜底：宽松 UTF-8
    return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8?' };
}

/** 直接解码一个 File（读 ArrayBuffer + 识别编码）。 */
export async function decodeTextFile(file: File, forced?: string): Promise<DecodeResult> {
    const buf = await file.arrayBuffer();
    return decodeBytes(buf, forced);
}
