/**
 * Char 音乐 · Schedule 运行时 (纯同步版)
 *
 * 设计目标：给 char 一个"此刻背景音"元数据，让它能在聊天 / 拜访页里感知。
 * 故意 **不** 拉歌词、不做进度映射 —— char 作为叙事主体天然知道"自己在听什么"，
 * 不需要 app 模拟物理播放进度给它看。
 *
 * 因此这个模块是纯同步的：给定 char + schedule + now，直接返回一份 CharCurrentListening 或 null。
 * 可以在任意位置（chat 送信前、拜访页渲染时）自由调用，零网络成本。
 */

import { CharacterProfile, CharCurrentListening, CharPlaylistSong, DailySchedule, ScheduleSlot } from '../types';

const LISTENING_KEYWORDS = [
    '听歌', '听音乐', '戴耳机', '戴上耳机', '戴着耳机', '耳机',
    '循环', '单曲循环', '播放', '耳畔', '耳旁',
    '播放列表', '歌单', '副歌', '前奏',
    'listening', 'music', 'song', 'playlist', 'vinyl', 'headphone', '🎵', '🎶', '🎧',
];

const MAX_SAMPLED_SONGS = 20;

/** 返回当前时间属于哪一个 slot */
export const getCurrentSlot = (schedule: DailySchedule | null, at: Date = new Date()): ScheduleSlot | null => {
    if (!schedule?.slots?.length) return null;
    const nowMin = at.getHours() * 60 + at.getMinutes();
    for (let i = schedule.slots.length - 1; i >= 0; i--) {
        const [h, m] = schedule.slots[i].startTime.split(':').map(Number);
        if (!isFinite(h) || !isFinite(m)) continue;
        if (nowMin >= h * 60 + m) return schedule.slots[i];
    }
    return null;
};

/** 判断 slot 是否暗示"在听歌" */
export const slotIsListening = (slot: ScheduleSlot | null): boolean => {
    if (!slot) return false;
    const blob = `${slot.activity || ''} ${slot.description || ''} ${slot.innerThought || ''} ${slot.emoji || ''}`.toLowerCase();
    return LISTENING_KEYWORDS.some(kw => blob.includes(kw.toLowerCase()));
};

/** slot.startTime "08:00" → 今日 Date */
const slotStartToDate = (slot: ScheduleSlot, baseDate: Date): Date => {
    const [h, m] = slot.startTime.split(':').map(Number);
    const d = new Date(baseDate);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
};

/**
 * 基于 (today + slot.startTime + charId) 种子从 char 歌单里稳定抽一首。
 * 同一 slot 期间永远是同一首歌，不会跳。
 */
const pickSongForSlot = (
    char: CharacterProfile,
    slot: ScheduleSlot,
    today: string,
): CharPlaylistSong | null => {
    const p = char.musicProfile;
    if (!p) return null;

    const pool: CharPlaylistSong[] = [];
    const seen = new Set<number>();
    for (const pl of p.playlists) {
        for (const s of pl.songs) {
            if (seen.has(s.id)) continue;
            seen.add(s.id);
            pool.push(s);
            if (pool.length >= MAX_SAMPLED_SONGS) break;
        }
        if (pool.length >= MAX_SAMPLED_SONGS) break;
    }
    if (pool.length === 0) return null;

    const seedStr = `${today}-${slot.startTime}-${char.id}`;
    let h = 0;
    for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return pool[h % pool.length];
};

/**
 * 计算 char 此刻该"在听"的歌（纯同步，无网络）。
 * - slot 不含听歌关键词 → 返回 null
 * - char 没有歌单或歌单全为空 → 返回 null
 *
 * 调用方可以直接把结果挂到 char.musicProfile.currentListening (UI 展示)，
 * 或只临时用于 prompt 注入，不必持久化。
 */
export function computeCurrentListening(
    char: CharacterProfile,
    schedule: DailySchedule | null,
    now: Date = new Date(),
): CharCurrentListening | null {
    if (!char.musicProfile) return null;

    const slot = getCurrentSlot(schedule, now);
    if (!slot || !slotIsListening(slot)) return null;

    const today = now.toISOString().slice(0, 10);
    const song = pickSongForSlot(char, slot, today);
    if (!song) return null;

    return {
        songId: song.id,
        songName: song.name,
        artists: song.artists,
        albumPic: song.albumPic,
        vibe: slot.innerThought || slot.description || undefined,
        startedAt: slotStartToDate(slot, now).getTime(),
    };
}
