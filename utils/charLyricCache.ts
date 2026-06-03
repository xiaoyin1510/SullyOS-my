/**
 * Char 背景音 · 歌词片段缓存
 *
 * 给 schedule 层那个"此刻 char 在听 X"注入一段稳定的歌词窗口，影响 char 的心境 / 情绪。
 * 不做"当前播放到哪一行"这种进度模拟 —— char 没有物理播放，拿一段代表性歌词即可。
 *
 * - 同一首歌的全量歌词按 songId 长久缓存（歌词不会变；命中率爆高）
 * - 窗口按 (charId + today + slot.startTime + songId) 种子哈希挑起点，
 *   保证同一个 slot 内每次聊天看到的歌词片段是一样的，slot 一过就换或消失
 * - 拉失败就返回空 string[]，prompt 层会无损降级成"只有歌名 + 艺人"
 */

import { MusicCfg, musicApi, parseLyric } from '../context/MusicContext';

const MEM_CACHE = new Map<number, string[] | null>();  // null = 已知没有歌词
const INFLIGHT = new Map<number, Promise<string[] | null>>();

const LS_KEY = (id: number) => `sully_char_lyric_v1_${id}`;
const LS_META_KEY = 'sully_char_lyric_meta_v1';
const LS_CAP = 200;  // 本地存的歌最多 200 首，超了按 LRU 淘汰

type LyricEntry = { text: string[] | null; at: number };

const loadFromLS = (id: number): LyricEntry | null => {
    try {
        const raw = localStorage.getItem(LS_KEY(id));
        if (!raw) return null;
        const j = JSON.parse(raw);
        if (!j || !Array.isArray(j.text) && j.text !== null) return null;
        return j as LyricEntry;
    } catch { return null; }
};

const saveToLS = (id: number, text: string[] | null) => {
    try {
        localStorage.setItem(LS_KEY(id), JSON.stringify({ text, at: Date.now() }));
        // 维护 meta 索引做 LRU 淘汰
        const metaRaw = localStorage.getItem(LS_META_KEY);
        const meta: number[] = metaRaw ? JSON.parse(metaRaw) : [];
        const next = [id, ...meta.filter(x => x !== id)].slice(0, LS_CAP);
        localStorage.setItem(LS_META_KEY, JSON.stringify(next));
        // 淘汰多出来的
        if (meta.length >= LS_CAP) {
            for (const gone of meta.slice(LS_CAP - 1)) {
                if (gone !== id) localStorage.removeItem(LS_KEY(gone));
            }
        }
    } catch {}
};

/** 拉一首歌的全量歌词行文本，带双层缓存（mem + localStorage） */
const getFullLyric = async (cfg: MusicCfg, songId: number): Promise<string[] | null> => {
    if (MEM_CACHE.has(songId)) return MEM_CACHE.get(songId)!;

    const fromLS = loadFromLS(songId);
    if (fromLS) {
        MEM_CACHE.set(songId, fromLS.text);
        return fromLS.text;
    }

    // 去重 in-flight（同一首歌并发多次调用只打一次网）
    const existing = INFLIGHT.get(songId);
    if (existing) return existing;

    const p = (async () => {
        try {
            const r = await musicApi.lyric(cfg, songId);
            const raw = r?.lrc?.lyric || '';
            const lines = parseLyric(raw).map(l => l.text).filter(Boolean);
            const result = lines.length > 0 ? lines : null;
            MEM_CACHE.set(songId, result);
            saveToLS(songId, result);
            return result;
        } catch {
            // 拉失败不 poisons 缓存（下一个 slot 有机会重试）
            return null;
        } finally {
            INFLIGHT.delete(songId);
        }
    })();
    INFLIGHT.set(songId, p);
    return p;
};

/** 用给定种子串稳定地取一段 lineCount 行的窗口 */
const pickWindow = (lines: string[], seed: string, lineCount: number): string[] => {
    if (lines.length === 0) return [];
    if (lines.length <= lineCount) return lines.slice();
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const maxStart = lines.length - lineCount;
    const start = h % (maxStart + 1);
    return lines.slice(start, start + lineCount);
};

/**
 * 拿 char 此刻应该"听到"的那段歌词（稳定、有限行、纯只读）。
 * @param cfg MusicContext 里那份 MusicCfg（workerUrl + cookie + quality）
 * @param songId 歌的 id
 * @param seed 一般传 `${charId}-${today}-${slot.startTime}-${songId}`
 * @param lineCount 默认 6 行，足够让 LLM 品味到情绪但不会撑爆 prompt
 * @returns 一段连续的歌词行（可能为 []，如歌词拉不到或是纯音乐）
 */
export const getCharLyricSnippet = async (
    cfg: MusicCfg,
    songId: number,
    seed: string,
    lineCount: number = 6,
): Promise<string[]> => {
    if (!songId || !cfg?.workerUrl) return [];
    const full = await getFullLyric(cfg, songId);
    if (!full || full.length === 0) return [];
    return pickWindow(full, seed, lineCount);
};
