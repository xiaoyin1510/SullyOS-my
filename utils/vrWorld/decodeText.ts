/**
 * 小说 txt 解码 —— 中文小说常见 GB18030/GBK 编码，不能写死 UTF-8。
 *
 * 策略：
 *   1. 先看 BOM（UTF-8 / UTF-16 LE / UTF-16 BE）
 *   2. 用 fatal 模式试 UTF-8；能过就是 UTF-8
 *   3. 过不了 → 按 GB18030 解码（覆盖 GBK / GB2312）
 *   4. 兜底 UTF-8 宽松模式
 */

export interface DecodeResult {
    text: string;
    encoding: string;
}

export function decodeBytes(buf: ArrayBuffer): DecodeResult {
    const bytes = new Uint8Array(buf);

    // BOM
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

    // 中文小说最常见：GB18030（含 GBK/GB2312）
    try {
        const t = new TextDecoder('gb18030').decode(buf);
        return { text: t, encoding: 'gb18030' };
    } catch {
        /* gb18030 不被支持时兜底 */
    }

    return { text: new TextDecoder('utf-8').decode(buf), encoding: 'utf-8?' };
}

/** 直接解码一个 File（读 ArrayBuffer + 识别编码）。 */
export async function decodeTextFile(file: File): Promise<DecodeResult> {
    const buf = await file.arrayBuffer();
    return decodeBytes(buf);
}
