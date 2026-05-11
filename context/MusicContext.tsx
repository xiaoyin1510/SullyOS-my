/**
 * 全局音乐播放上下文
 *
 * 让音乐在 App 间切换、锁屏、甚至后台退出时都能继续播放：
 *   1. <audio> 元素挂在 Provider 上，不随 MusicApp 卸载销毁。
 *   2. 播放队列、进度、用户 cookie/配置 全部在 Context 中。
 *   3. localStorage 持久化 cookie/工作台地址/队列，刷新后可恢复。
 *   4. Media Session API 暴露锁屏控件 (Android/iOS 原生通知栏也能控制)。
 */
import React, {
  createContext, useCallback, useContext, useEffect,
  useMemo, useRef, useState,
} from 'react';
import { cachedCall as _cachedCall, invalidate as _invalidateCache, clearAll as _clearAllCache } from '../utils/musicCache';
import { DB } from '../utils/db';

/* ───────────── 类型 ───────────── */
export type MusicQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires';

export interface MusicCfg {
  workerUrl: string;
  cookie: string;
  quality: MusicQuality;
}

export interface Song {
  id: number;
  name: string;
  artists: string;
  album: string;
  albumPic: string;
  duration: number;
  fee: number;
  // ── Local-source extensions (used for AI-generated songs from 写歌 App) ──
  /** True for songs not from netease — play them via blob from IndexedDB. */
  local?: boolean;
  /** IndexedDB key (under DB.assets) where the audio Blob lives. */
  localAssetKey?: string;
  /** Optional MIME type — used to set <audio> source correctly. */
  localMimeType?: string;
  /** Cover gradient/color for songs without album art. */
  localCoverStyle?: string;
  /** Char ID(s) credited as co-author. */
  customAuthorCharIds?: string[];
  /** Raw lyric text (with [Verse]/[Chorus] markers OK) — for synced display. */
  localLyrics?: string;
  /** Manual timestamps (seconds) per visible lyric line — overrides auto distribution. */
  lyricLineTimings?: number[];
}

export interface LyricLine { t: number; text: string; }

export interface NeteaseProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
  signature?: string;
  backgroundUrl?: string;
  vipType?: number;
  province?: number;
  gender?: number;
  followeds?: number;
  follows?: number;
  eventCount?: number;
  playlistCount?: number;
}

/* ───────────── 默认 / 常量 ───────────── */
const LS_CFG_KEY = 'sully_music_cfg_v1';
const LS_STATE_KEY = 'sully_music_state_v1';
const LS_LOCAL_ALBUM_KEY = 'sully_music_local_album_v1';

const loadLocalAlbum = (): Song[] => {
  try {
    const raw = localStorage.getItem(LS_LOCAL_ALBUM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
};
const saveLocalAlbum = (songs: Song[]) => {
  try { localStorage.setItem(LS_LOCAL_ALBUM_KEY, JSON.stringify(songs)); } catch {}
};
const DEFAULT_WORKER = 'https://sullymeow.ccwu.cc';

export const MUSIC_DEFAULT_CFG: MusicCfg = {
  workerUrl: DEFAULT_WORKER,
  cookie: '',
  quality: 'exhigh',
};

/* ───────────── 工具 ───────────── */
// 旧 worker 域名 → 新自定义域名的迁移表。老用户 localStorage 里存的还是
// sully-n.qegj567.workers.dev，国内访问超时；自定义域名走 CF 边缘到同一个
// worker，行为一致。第一次读到自动改写并落盘，下次刷新就稳定了。
const STALE_WORKER_HOSTS = [/sully-n\.qegj567\.workers\.dev/i];
const migrateWorkerUrl = (url: string | undefined): string => {
  if (!url) return DEFAULT_WORKER;
  for (const re of STALE_WORKER_HOSTS) {
    if (re.test(url)) return DEFAULT_WORKER;
  }
  return url;
};

const loadCfg = (): MusicCfg => {
  try {
    const raw = localStorage.getItem(LS_CFG_KEY);
    if (!raw) return MUSIC_DEFAULT_CFG;
    const parsed = JSON.parse(raw);
    const cfg = { ...MUSIC_DEFAULT_CFG, ...parsed };
    const migrated = migrateWorkerUrl(cfg.workerUrl);
    if (migrated !== cfg.workerUrl) {
      cfg.workerUrl = migrated;
      try { localStorage.setItem(LS_CFG_KEY, JSON.stringify(cfg)); } catch {}
    }
    return cfg;
  } catch { return MUSIC_DEFAULT_CFG; }
};

/**
 * 非 React 调用者（Proactive / activeMsgClient / prompt 构造层）读取当前 user 的
 * MusicCfg。走 localStorage 持久化层，不挂 Context。
 */
export const loadMusicCfgStandalone = (): MusicCfg => loadCfg();

/**
 * 实时播放快照 — 给 OSContext 主动消息流程读，避免 OSProvider 在 MusicProvider
 * 外层导致拿不到 useMusic()。MusicProvider mount 后会持续把当前播放状态写到这里。
 */
export interface MusicPlaybackSnapshot {
  current: Song | null;
  playing: boolean;
  lyric: LyricLine[];
  activeLyricIdx: number;
  listeningTogetherWith: string[];
  cfg: MusicCfg;
}
let __musicPlaybackSnapshot: MusicPlaybackSnapshot | null = null;
export const loadMusicPlaybackSnapshot = (): MusicPlaybackSnapshot | null => __musicPlaybackSnapshot;

const saveCfg = (cfg: MusicCfg) => {
  try { localStorage.setItem(LS_CFG_KEY, JSON.stringify(cfg)); } catch {}
};

const loadState = (): { queue: Song[]; idx: number } => {
  try {
    const raw = localStorage.getItem(LS_STATE_KEY);
    if (!raw) return { queue: [], idx: -1 };
    const s = JSON.parse(raw);
    return { queue: Array.isArray(s.queue) ? s.queue : [], idx: typeof s.idx === 'number' ? s.idx : -1 };
  } catch { return { queue: [], idx: -1 }; }
};

const saveState = (queue: Song[], idx: number) => {
  try { localStorage.setItem(LS_STATE_KEY, JSON.stringify({ queue, idx })); } catch {}
};

export const parseLyric = (txt: string): LyricLine[] => {
  if (!txt) return [];
  const out: LyricLine[] = [];
  const re = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;
  for (const line of txt.split(/\r?\n/)) {
    const m = re.exec(line); if (!m) continue;
    const mm = parseInt(m[1], 10), ss = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
    const text = m[4].trim(); if (!text) continue;
    out.push({ t: mm * 60 + ss + ms / 1000, text });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
};

export const normalizeCookie = (raw: string): string => {
  const s = (raw || '').trim(); if (!s) return '';
  if (s.toUpperCase().startsWith('MUSIC_U=')) return s;
  return `MUSIC_U=${s}`;
};

/**
 * 把网易云返回的 http:// 资源 URL 升级成 https://
 * 浏览器在 HTTPS 页面里加载 http:// 图片会抛 Mixed Content 警告、并强制升级请求，
 * 我们直接在映射层就升级，避免控制台噪音。
 * - 只处理明文 http:// 开头的；https / data / 相对路径保持原样
 * - 空/非字符串直接返回原值
 */
export const toHttps = (url: string): string => {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http://')) return 'https://' + url.slice('http://'.length);
  return url;
};

/* ───────────── API ───────────── */
export const musicApi = {
  // 内部：真正打网络（不走缓存）
  async _raw(cfg: MusicCfg, path: string, body: any = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const cookie = normalizeCookie(cfg.cookie);
    if (cookie) headers['X-Netease-Cookie'] = cookie;
    const url = `${cfg.workerUrl.replace(/\/+$/, '')}/netease${path.startsWith('/') ? path : '/' + path}`;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
    return j;
  },
  // 对外：默认走 TTL 缓存 + in-flight 去重；无匹配规则的 path 会透传
  async call(cfg: MusicCfg, path: string, body: any = {}) {
    return _cachedCall(path, body, cfg.cookie, () => musicApi._raw(cfg, path, body));
  },
  search(cfg: MusicCfg, keyword: string, offset = 0) {
    return musicApi.call(cfg, '/search', { keyword, limit: 30, offset, type: 1 });
  },
  songUrl(cfg: MusicCfg, id: number) {
    return musicApi.call(cfg, '/song/url', { ids: [id], level: cfg.quality });
  },
  lyric(cfg: MusicCfg, id: number) {
    return musicApi.call(cfg, '/lyric', { id });
  },
  loginStatus(cfg: MusicCfg) {
    return musicApi.call(cfg, '/login/status', {});
  },
  userDetail(cfg: MusicCfg, uid: number) {
    return musicApi.call(cfg, '/user/detail', { uid });
  },
  userPlaylist(cfg: MusicCfg, uid: number) {
    return musicApi.call(cfg, '/user/playlist', { uid, limit: 60 });
  },
  userRecord(cfg: MusicCfg, uid: number, type = 1) {
    return musicApi.call(cfg, '/user/record', { uid, type });
  },
  userCloud(cfg: MusicCfg) {
    return musicApi.call(cfg, '/user/cloud', {});
  },
  userSubcount(cfg: MusicCfg) {
    return musicApi.call(cfg, '/user/subcount', {});
  },
  playlistDetail(cfg: MusicCfg, id: number) {
    return musicApi.call(cfg, '/playlist/detail', { id });
  },
  playlistTrackAll(cfg: MusicCfg, id: number, limit = 50, offset = 0) {
    return musicApi.call(cfg, '/playlist/track/all', { id, limit, offset });
  },
  recommendSongs(cfg: MusicCfg) {
    return musicApi.call(cfg, '/recommend/songs', {});
  },
  personalFm(cfg: MusicCfg) {
    return musicApi.call(cfg, '/personal_fm', {});
  },
  dailySignin(cfg: MusicCfg, type = 1) {
    return musicApi.call(cfg, '/daily_signin', { type });
  },
  toplist(cfg: MusicCfg) {
    return musicApi.call(cfg, '/toplist', {});
  },
  loginQrKey(cfg: MusicCfg) {
    return musicApi.call(cfg, '/login/qr/key', {});
  },
  loginQrCreate(cfg: MusicCfg, key: string) {
    return musicApi.call(cfg, '/login/qr/create', { key, qrimg: true });
  },
  loginQrCheck(cfg: MusicCfg, key: string) {
    return musicApi.call(cfg, '/login/qr/check', { key });
  },
  loginCellphone(cfg: MusicCfg, phone: string, captcha: string) {
    return musicApi.call(cfg, '/login/cellphone', { phone, captcha });
  },
  captchaSent(cfg: MusicCfg, phone: string) {
    return musicApi.call(cfg, '/captcha/sent', { phone });
  },
  logout(cfg: MusicCfg) {
    return musicApi.call(cfg, '/logout', {});
  },
};

/* ───────────── Context 定义 ───────────── */
type PlayMode = 'loop' | 'shuffle' | 'single';

interface MusicContextType {
  cfg: MusicCfg;
  setCfg: (next: MusicCfg) => void;

  // 播放队列 / 当前曲
  queue: Song[];
  setQueue: (next: Song[]) => void;
  idx: number;
  current: Song | null;

  // 播放状态
  playing: boolean;
  progress: number;
  duration: number;
  loadingSong: boolean;

  // 歌词
  lyric: LyricLine[];
  tlyric: LyricLine[];
  activeLyricIdx: number;

  // 用户
  profile: NeteaseProfile | null;
  refreshProfile: () => Promise<void>;

  // 操作
  playSong: (song: Song, opts?: { alsoSetQueue?: boolean; replaceQueue?: Song[]; startIdx?: number }) => Promise<void>;
  togglePlay: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seek: (pct: number) => void;

  // 播放模式 & 喜欢
  playMode: PlayMode;
  setPlayMode: (m: PlayMode) => void;
  liked: boolean;
  toggleLike: () => Promise<void>;

  // 一起听 — 当前哪些 char 和 user 一起听（仅视觉状态，不影响播放）
  // 歌曲切换 / 结束时自动清空
  listeningTogetherWith: string[];
  addListeningPartner: (charId: string) => void;
  removeListeningPartner: (charId: string) => void;
  clearListeningPartners: () => void;

  // toast 转发 (解耦)
  toast: (msg: string, type?: 'info' | 'success' | 'error') => void;
  setToastHandler: (h: (msg: string, type?: 'info' | 'success' | 'error') => void) => void;

  // 「一起写的歌」专辑 — 从 写歌 App 同步过来的本地生成歌
  localAlbumSongs: Song[];
  addLocalSong: (song: Song) => void;
  removeLocalSong: (songId: number) => void;
  // 实时重录状态 — 让音乐 App 即使在切到其他界面也能看到"正在重录"提示
  regeneratingId: number | null;
  regeneratingStatus: string;
  markRegenerating: (id: number | null, status?: string) => void;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

/* ───────────── Provider ───────────── */
export const MusicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cfg, setCfgState] = useState<MusicCfg>(loadCfg);
  const setCfg = useCallback((next: MusicCfg) => {
    setCfgState(prev => {
      // cookie / workerUrl 变了 → 上一个账号的缓存全部失效，避免看到旧账号数据
      if (prev.cookie !== next.cookie || prev.workerUrl !== next.workerUrl) {
        _clearAllCache();
      }
      return next;
    });
    saveCfg(next);
  }, []);

  const initialState = useMemo(loadState, []);
  const [queue, setQueueState] = useState<Song[]>(initialState.queue);
  const [idx, setIdx] = useState<number>(initialState.idx);
  const current = idx >= 0 && idx < queue.length ? queue[idx] : null;

  // 「一起写的歌」本地专辑 — 由写歌 App 同步过来的 ACE-Step / MiniMax 出歌
  const [localAlbumSongs, setLocalAlbumSongs] = useState<Song[]>(loadLocalAlbum);
  const addLocalSong = useCallback((song: Song) => {
    setLocalAlbumSongs(prev => {
      // 同 id 去重，新版本覆盖
      const filtered = prev.filter(s => s.id !== song.id);
      const next = [song, ...filtered];
      saveLocalAlbum(next);
      return next;
    });
  }, []);
  const removeLocalSong = useCallback((songId: number) => {
    setLocalAlbumSongs(prev => {
      const next = prev.filter(s => s.id !== songId);
      saveLocalAlbum(next);
      return next;
    });
  }, []);

  // 重录状态 — 单个 id + 状态文案，跨 App 可见
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [regeneratingStatus, setRegeneratingStatus] = useState<string>('');
  const markRegenerating = useCallback((id: number | null, status: string = '') => {
    setRegeneratingId(id);
    setRegeneratingStatus(status);
  }, []);

  const setQueue = useCallback((next: Song[]) => {
    setQueueState(next);
  }, []);

  // 队列持久化
  useEffect(() => { saveState(queue, idx); }, [queue, idx]);

  // 播放
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadingSong, setLoadingSong] = useState(false);

  // 歌词
  const [lyric, setLyric] = useState<LyricLine[]>([]);
  const [tlyric, setTlyric] = useState<LyricLine[]>([]);
  const activeLyricIdx = useMemo(() => {
    if (!lyric.length) return -1;
    let i = 0;
    for (let k = 0; k < lyric.length; k++) if (lyric[k].t <= progress) i = k; else break;
    return i;
  }, [lyric, progress]);

  // toast 转发
  const toastHandlerRef = useRef<(msg: string, type?: 'info' | 'success' | 'error') => void>(() => {});
  const toast = useCallback((msg: string, type: 'info' | 'success' | 'error' = 'info') => {
    try { toastHandlerRef.current(msg, type); } catch {}
  }, []);
  const setToastHandler = useCallback((h: (msg: string, type?: 'info' | 'success' | 'error') => void) => {
    toastHandlerRef.current = h;
  }, []);

  // 用户信息
  const [profile, setProfile] = useState<NeteaseProfile | null>(null);
  const refreshProfile = useCallback(async () => {
    if (!cfg.cookie) { setProfile(null); return; }
    try {
      const r = await musicApi.loginStatus(cfg);
      const p = r?.data?.profile || r?.profile;
      if (!p) { setProfile(null); return; }
      setProfile({
        userId: p.userId,
        nickname: p.nickname || '',
        avatarUrl: toHttps(p.avatarUrl || ''),
        signature: p.signature || '',
        backgroundUrl: toHttps(p.backgroundUrl || ''),
        vipType: p.vipType ?? 0,
        province: p.province,
        gender: p.gender,
        followeds: p.followeds,
        follows: p.follows,
        eventCount: p.eventCount,
        playlistCount: p.playlistCount,
      });
    } catch { setProfile(null); }
  }, [cfg]);

  useEffect(() => { refreshProfile(); }, [refreshProfile]);

  // 喜欢列表
  const [likedSet, setLikedSet] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!cfg.cookie) { setLikedSet(new Set()); return; }
    musicApi.call(cfg, '/likelist', {}).then(r => {
      const ids: number[] = r?.ids || r?.data?.ids || [];
      setLikedSet(new Set(ids));
    }).catch(() => {});
  }, [cfg]);

  // 「喜欢」逻辑分两条路:
  //   - 网易云歌 → 走 likelist API
  //   - 本地歌 → 在 localAlbum 里就算喜欢，不在就不喜欢；toggle = add/remove
  const liked = !!current && (
    current.local
      ? localAlbumSongs.some(s => s.id === current.id)
      : likedSet.has(current.id)
  );
  const toggleLike = useCallback(async () => {
    if (!current) return;
    // ── 本地歌：toggle from album ──
    if (current.local) {
      const inAlbum = localAlbumSongs.some(s => s.id === current.id);
      if (inAlbum) {
        removeLocalSong(current.id);
        toast('已从「一起写的歌」移除', 'info');
      } else {
        addLocalSong(current);
        toast('已加入「一起写的歌」', 'success');
      }
      return;
    }
    // ── 网易云歌 ──
    if (!cfg.cookie) { toast('需要登录网易云账号', 'error'); return; }
    const willLike = !likedSet.has(current.id);
    try {
      await musicApi.call(cfg, '/like', { id: current.id, like: willLike });
      _invalidateCache('/likelist', cfg.cookie);
      setLikedSet(prev => {
        const next = new Set(prev);
        if (willLike) next.add(current.id); else next.delete(current.id);
        return next;
      });
      toast(willLike ? '已添加到喜欢' : '已取消喜欢', 'success');
    } catch (e: any) {
      toast(`喜欢失败: ${e.message}`, 'error');
    }
  }, [current, cfg, likedSet, localAlbumSongs, addLocalSong, removeLocalSong, toast]);

  // 播放模式
  const [playMode, setPlayMode] = useState<PlayMode>('loop');

  // 一起听 - char 加入后在 miniPlayer / 播放页显示徽标；切歌 / 结束自动清空
  const [listeningTogetherWith, setListeningTogetherWith] = useState<string[]>([]);
  const addListeningPartner = useCallback((charId: string) => {
    setListeningTogetherWith(prev => prev.includes(charId) ? prev : [...prev, charId]);
  }, []);
  const removeListeningPartner = useCallback((charId: string) => {
    setListeningTogetherWith(prev => prev.filter(id => id !== charId));
  }, []);
  const clearListeningPartners = useCallback(() => {
    setListeningTogetherWith(prev => prev.length ? [] : prev);
  }, []);

  // 当 current 歌曲变化（切歌 / 初次播放新歌）→ 清空"一起听"
  // 这样 char 选择 "join" 仅对当前这一首有效，切到下一首后回到 off
  const currentSongIdRef = useRef<number | null>(null);
  useEffect(() => {
    const newId = current?.id ?? null;
    if (currentSongIdRef.current !== null && currentSongIdRef.current !== newId) {
      setListeningTogetherWith([]);
    }
    currentSongIdRef.current = newId;
  }, [current]);

  // 前进/后退 refs (避免循环依赖 & audio 事件闭包陷阱)
  const queueRef = useRef(queue); queueRef.current = queue;
  const idxRef = useRef(idx); idxRef.current = idx;
  const modeRef = useRef(playMode); modeRef.current = playMode;
  const cfgRef = useRef(cfg); cfgRef.current = cfg;
  const endedHandlerRef = useRef<() => void>(() => {});

  // 初始化 audio（仅 Provider 生命周期创建一次）
  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    // 注意: 不要设置 crossOrigin — NetEase CDN 没有 CORS 头，会变成静默加载失败
    audioRef.current = a;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setProgress(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    // 播放出错 → 清掉 playing 状态 + 清掉"一起听"伙伴（防止 UI 卡在残留状态）
    const onErr = () => { setPlaying(false); setListeningTogetherWith([]); toast('播放失败', 'error'); };
    const onEnd = () => { endedHandlerRef.current(); };

    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('error', onErr);
    a.addEventListener('ended', onEnd);

    return () => {
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('error', onErr);
      a.removeEventListener('ended', onEnd);
      try { a.pause(); a.src = ''; } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 播放单曲
  const playSong = useCallback(async (song: Song, opts: { alsoSetQueue?: boolean; replaceQueue?: Song[]; startIdx?: number } = {}) => {
    const { alsoSetQueue = true, replaceQueue, startIdx } = opts;

    if (replaceQueue) {
      setQueueState(replaceQueue);
      setIdx(typeof startIdx === 'number' ? startIdx : replaceQueue.findIndex(s => s.id === song.id));
    } else if (alsoSetQueue) {
      const qnow = queueRef.current;
      const existing = qnow.findIndex(s => s.id === song.id);
      if (existing >= 0) {
        setIdx(existing);
      } else {
        setQueueState(q => [...q, song]);
        setIdx(qnow.length);
      }
    }

    setLoadingSong(true); setLyric([]); setTlyric([]); setProgress(0); setDuration(0);
    try {
      // ── Local-source branch ── 本地生成的歌（写歌 App 出歌）从 IndexedDB 取 blob
      if (song.local && song.localAssetKey) {
        const a = audioRef.current!;
        const entry = await DB.getAssetRaw(song.localAssetKey).catch(() => null) as
          | { blob?: Blob; mimeType?: string }
          | Blob
          | null;
        const blob: Blob | null = entry instanceof Blob ? entry : (entry?.blob instanceof Blob ? entry.blob : null);
        if (!blob) {
          toast('本地歌曲文件丢失', 'error');
          setLoadingSong(false);
          return;
        }
        const prevSrc = a.src;
        if (prevSrc.startsWith('blob:')) URL.revokeObjectURL(prevSrc);
        a.src = URL.createObjectURL(blob);
        a.play().catch(() => {});

        // ── 本地歌词时间分布 ──
        // MiniMax / ACE-Step 不返回带时间戳的歌词，但我们写歌时就有原文。
        // 等 metadata 加载完拿到 duration → 把每行歌词均匀铺到时长上，
        // 实现「跟着歌词滚动」的网易云播放器体验。
        if (song.localLyrics) {
          const distribute = () => {
            const dur = a.duration;
            if (!isFinite(dur) || dur <= 0) return;
            const lines = song.localLyrics!
              .split(/\r?\n/)
              .map(l => l.trim())
              // 跳过 [Verse]/[Chorus]/[Bridge] 等章节标记（纯时间标，不显示）
              // 也跳过空行
              .filter(l => l && !/^\[[^\]]+\]$/i.test(l));
            if (lines.length === 0) {
              setLyric([]);
              setTlyric([]);
              return;
            }
            // 用户手动对轴的优先用，没对过用平均分布兜底
            let synced: LyricLine[];
            if (song.lyricLineTimings && song.lyricLineTimings.length === lines.length) {
              synced = lines.map((text, i) => ({
                t: song.lyricLineTimings![i] ?? 0,
                text,
              }));
            } else {
              const intro = Math.min(2, dur * 0.05);
              const outro = Math.min(3, dur * 0.05);
              const usable = Math.max(dur - intro - outro, dur * 0.6);
              const step = usable / lines.length;
              synced = lines.map((text, i) => ({
                t: intro + i * step,
                text,
              }));
            }
            setLyric(synced);
            setTlyric([]);
          };
          if (a.readyState >= 1 && isFinite(a.duration) && a.duration > 0) {
            distribute();
          } else {
            const onMeta = () => { distribute(); a.removeEventListener('loadedmetadata', onMeta); };
            a.addEventListener('loadedmetadata', onMeta);
          }
        } else {
          setLyric([]);
          setTlyric([]);
        }

        if ('mediaSession' in navigator) {
          try {
            (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({
              title: song.name,
              artist: song.artists,
              album: song.album,
            });
          } catch {}
        }
        setLoadingSong(false);
        return;
      }

      const [urlRes, lyricRes] = await Promise.all([
        musicApi.songUrl(cfgRef.current, song.id),
        musicApi.lyric(cfgRef.current, song.id).catch(() => null),
      ]);
      const url: string | null = urlRes?.data?.[0]?.url || null;
      if (!url) {
        toast(urlRes?.data?.[0]?.fee && !cfgRef.current.cookie ? '需要会员 cookie' : '暂无播放地址', 'error');
        setLoadingSong(false);
        return;
      }
      const a = audioRef.current!;
      a.src = url.replace(/^http:\/\//i, 'https://');
      a.play().catch(() => {});
      if (lyricRes) {
        setLyric(parseLyric(lyricRes?.lrc?.lyric || ''));
        setTlyric(parseLyric(lyricRes?.tlyric?.lyric || ''));
      }
      // 媒体会话（锁屏 / 通知栏）
      if ('mediaSession' in navigator) {
        try {
          (navigator as any).mediaSession.metadata = new (window as any).MediaMetadata({
            title: song.name,
            artist: song.artists,
            album: song.album,
            artwork: song.albumPic ? [
              { src: song.albumPic, sizes: '300x300', type: 'image/jpeg' },
              { src: song.albumPic, sizes: '512x512', type: 'image/jpeg' },
            ] : [],
          });
        } catch {}
      }
    } catch (e: any) {
      toast(`播放失败：${e.message}`, 'error');
    } finally {
      setLoadingSong(false);
    }
  }, [toast]);

  // 下一首 / 上一首
  const nextSong = useCallback(() => {
    const q = queueRef.current; if (!q.length) return;
    const cur = idxRef.current; if (cur < 0) return;
    let n: number;
    if (modeRef.current === 'shuffle' && q.length > 1) {
      do { n = Math.floor(Math.random() * q.length); } while (n === cur);
    } else if (modeRef.current === 'single') {
      n = cur;
    } else {
      n = (cur + 1) % q.length;
    }
    setIdx(n); playSong(q[n], { alsoSetQueue: false });
  }, [playSong]);

  const prevSong = useCallback(() => {
    const q = queueRef.current; if (!q.length) return;
    const cur = idxRef.current; if (cur < 0) return;
    const n = (cur - 1 + q.length) % q.length;
    setIdx(n); playSong(q[n], { alsoSetQueue: false });
  }, [playSong]);

  // 自动下一首（end 事件）— 通过 ref 转发，以免 useEffect([], []) 闭包陷阱
  useEffect(() => {
    endedHandlerRef.current = () => {
      if (modeRef.current === 'single') {
        const a = audioRef.current; if (a) { a.currentTime = 0; a.play().catch(() => {}); }
        return;
      }
      nextSong();
    };
  }, [nextSong]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current; if (!a) return;
    // 刷新后 audio 元素是新创建的、尚未设置 src；此时按播放键应根据持久化的队列按需加载当前曲目
    if (!a.src) {
      const q = queueRef.current; const i = idxRef.current;
      const cur = i >= 0 && i < q.length ? q[i] : null;
      if (cur) playSong(cur, { alsoSetQueue: false });
      return;
    }
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, [playSong]);

  const seek = useCallback((pct: number) => {
    const a = audioRef.current; if (!a || !duration) return;
    a.currentTime = Math.max(0, Math.min(duration, duration * pct));
  }, [duration]);

  // Media Session handlers (锁屏播放/暂停/上下首)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = (navigator as any).mediaSession;
    try {
      ms.setActionHandler('play', () => {
        const a = audioRef.current; if (!a) return;
        if (!a.src) {
          const q = queueRef.current; const i = idxRef.current;
          const cur = i >= 0 && i < q.length ? q[i] : null;
          if (cur) playSong(cur, { alsoSetQueue: false });
          return;
        }
        if (a.paused) a.play().catch(() => {});
      });
      ms.setActionHandler('pause', () => {
        const a = audioRef.current; if (a && !a.paused) a.pause();
      });
      ms.setActionHandler('nexttrack', () => nextSong());
      ms.setActionHandler('previoustrack', () => prevSong());
      ms.setActionHandler('seekto', (details: any) => {
        const a = audioRef.current; if (!a) return;
        if (typeof details.seekTime === 'number') a.currentTime = details.seekTime;
      });
    } catch { /* ignore */ }
  }, [nextSong, prevSong, playSong]);

  // 播放状态同步到 mediaSession
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    try { (navigator as any).mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  }, [playing]);

  // 把当前播放状态写到模块级快照，供非 React 调用者（OSContext.runProactive
  // 等位于 MusicProvider 上层的代码）读取。useMusic() 在那一层用不了。
  useEffect(() => {
    __musicPlaybackSnapshot = {
      current,
      playing,
      lyric,
      activeLyricIdx,
      listeningTogetherWith,
      cfg,
    };
  }, [current, playing, lyric, activeLyricIdx, listeningTogetherWith, cfg]);

  const value: MusicContextType = {
    cfg, setCfg,
    queue, setQueue, idx, current,
    playing, progress, duration, loadingSong,
    lyric, tlyric, activeLyricIdx,
    profile, refreshProfile,
    playSong, togglePlay, nextSong, prevSong, seek,
    playMode, setPlayMode,
    liked, toggleLike,
    listeningTogetherWith, addListeningPartner, removeListeningPartner, clearListeningPartners,
    toast, setToastHandler,
    localAlbumSongs, addLocalSong, removeLocalSong,
    regeneratingId, regeneratingStatus, markRegenerating,
  };

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
};

export const useMusic = (): MusicContextType => {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusic must be used within MusicProvider');
  return ctx;
};
