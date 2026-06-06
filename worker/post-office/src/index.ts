/**
 * SullyOS · 彼方虚拟邮局 —— 跨用户漂流信后端（Cloudflare Worker + D1）
 *
 * 这是一个共享后端：所有用户共用一个实例（如 https://noir2.cc.cd），
 * 别的用户无需任何配置。信件被丢进一个公共 D1 池，随机分发给别的设备回信，
 * 回信再路由回原作者，原作者收下并留档后通知后端释放。
 *
 * 匿名：客户端只带一个随机 deviceId（owner_id，无登录、无 PII）。信件只含 笔名 + 正文。
 *
 * ── 互动 / 防护（本版新增）──────────────────────────────────────────
 *  - 点赞 / 点踩：一台设备一票（可改可撤）。**点踩即举报**，不另设举报。
 *  - 自动删除：一封信点踩数达阈值（PO_DISLIKE_LIMIT，默认 5）即被删除。
 *  - 管理员：纯 API（无前端）。GET /admin/list 看信、POST /admin/delete 删信，
 *           凭 ADMIN_TOKEN（Authorization: Bearer，或 ?token=）。
 *  - 限流：按客户端 IP 的加盐哈希做固定窗口限流（不存原始 IP）。
 *  - 不主动按时间删：移除了旧的 TTL 清理；信只在 ①踩满 ②管理员删 ③作者删 时消失。
 *
 * ── 空间优化 ────────────────────────────────────────────────────
 *  po_devices 把长 owner_id(UUID) 映射成短整数 uid；多行的投票表 po_votes 只存 uid，
 *  避免反复存 36 字节 UUID。对外 API 仍只认 owner_id，客户端无感。
 *
 * 路由（兼容挂在根路径或 /po 前缀下；按 path 结尾匹配）：
 *   POST  …/letters       { device, letters:[{pen,content,lang?}] }       上传待寄出的信
 *   GET   …/inbox?device=X&limit=N                                         随机抽 N 封"别人的、还能回"的信
 *   POST  …/vote          { device, letterId, vote: 1|-1|0 }              点赞/点踩(=举报)/撤销
 *   POST  …/replies       { device, replies:[{letterId,pen,content}] }     上传回信
 *   GET   …/replies?device=X                                               取回我寄出的信上的回复 + 各信的赞踩浏览量
 *   POST  …/release       { device, letterIds:[...] }                      作者删自己的信
 *   GET   …/admin/list?token=&limit=                                       [管理] 列信
 *   POST  …/admin/delete  { letterId }  (+ token)                          [管理] 删信
 *   GET   …/health                                                         健康检查
 *
 * 表结构由 Worker 自动建（加性、不破坏老数据）。也可手动跑 schema.sql。
 */

export interface Env {
    DB: D1Database;
    /** 可选：一封信最多被几个设备回信（默认 3） */
    PO_MAX_REPLIES?: string;
    /** 可选：一封信点踩数达此值即自动删除（默认 5） */
    PO_DISLIKE_LIMIT?: string;
    /** 管理员令牌（secret）。未配置时管理接口一律 503 关闭。 */
    ADMIN_TOKEN?: string;
    /** 限流用的哈希盐（secret）。仅用于不可逆化 IP，建议配置。 */
    PO_IP_SALT?: string;
    /** 可选：每分钟限流次数。投信/回信/投票。 */
    PO_RATE_LETTERS?: string;
    PO_RATE_REPLIES?: string;
    PO_RATE_VOTES?: string;
}

// 最小 D1 类型（避免依赖 @cloudflare/workers-types）
interface D1Database {
    prepare(q: string): D1PreparedStatement;
    batch(s: D1PreparedStatement[]): Promise<unknown[]>;
    exec(q: string): Promise<unknown>;
}
interface D1PreparedStatement {
    bind(...a: unknown[]): D1PreparedStatement;
    run(): Promise<unknown>;
    first<T = unknown>(c?: string): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[] }>;
}

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Max-Age': '86400',
};
const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const MAX_CONTENT = 400;          // 单封正文字数上限（按字符：1 汉字/标点 = 1 字）
const MAX_BATCH = 20;             // 单次上传封数上限
const WINDOW_MS = 60_000;         // 默认限流窗口：1 分钟
const LETTERS_WINDOW_MS = 5 * 3600_000; // 投信限流窗口：5 小时
const uuid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
// 按字符（code point）截断，中文标点都算 1 字
const clip = (s: unknown) => [...String(s ?? '')].slice(0, MAX_CONTENT).join('');
const num = (v: string | undefined, dflt: number) => { const n = parseInt(v || '', 10); return Number.isFinite(n) ? n : dflt; };

let schemaReady = false;
async function ensureSchema(db: D1Database) {
    if (schemaReady) return;
    // 信件池（新库直接带 likes/dislikes/views；老库靠下面的 ADD COLUMN 补）
    await db.exec(
        `CREATE TABLE IF NOT EXISTS po_letters (id TEXT PRIMARY KEY, device TEXT NOT NULL, pen TEXT NOT NULL, content TEXT NOT NULL, lang TEXT, created_at INTEGER NOT NULL, reply_count INTEGER NOT NULL DEFAULT 0, likes INTEGER NOT NULL DEFAULT 0, dislikes INTEGER NOT NULL DEFAULT 0, views INTEGER NOT NULL DEFAULT 0);`
    );
    // 老库补列（列已存在会抛 "duplicate column"，吞掉即可）
    for (const col of ['likes INTEGER NOT NULL DEFAULT 0', 'dislikes INTEGER NOT NULL DEFAULT 0', 'views INTEGER NOT NULL DEFAULT 0']) {
        try { await db.exec(`ALTER TABLE po_letters ADD COLUMN ${col};`); } catch { /* 已存在 */ }
    }
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_letters_dev ON po_letters(device);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_letters_open ON po_letters(reply_count, created_at);`);
    // 抽信去重、回信（沿用旧结构，不迁移）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_picks (device TEXT NOT NULL, letter_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (device, letter_id));`);
    await db.exec(`CREATE TABLE IF NOT EXISTS po_replies (id TEXT PRIMARY KEY, letter_id TEXT NOT NULL, device TEXT NOT NULL, pen TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_replies_letter ON po_replies(letter_id);`);
    // owner_id ↔ 短整数 uid 映射（省 votes 空间）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_devices (uid INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);`);
    // 投票（点赞/点踩），一设备一票；ip_hash 用于「按 IP 去重」判定自动删除（防伪造 device 刷删）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_votes (letter_id TEXT NOT NULL, uid INTEGER NOT NULL, vote INTEGER NOT NULL, at INTEGER NOT NULL, ip_hash TEXT, PRIMARY KEY (letter_id, uid));`);
    try { await db.exec(`ALTER TABLE po_votes ADD COLUMN ip_hash TEXT;`); } catch { /* 已存在 */ }
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_po_votes_letter ON po_votes(letter_id);`);
    // 限流计数（固定窗口）
    await db.exec(`CREATE TABLE IF NOT EXISTS po_ratelimit (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    schemaReady = true;
}

/** owner_id → 短整数 uid（不存在则创建）。 */
async function getUid(db: D1Database, ownerId: string): Promise<number> {
    const hit = await db.prepare(`SELECT uid FROM po_devices WHERE owner_id = ?`).bind(ownerId).first<{ uid: number }>();
    if (hit) return hit.uid;
    await db.prepare(`INSERT OR IGNORE INTO po_devices (owner_id, created_at) VALUES (?, ?)`).bind(ownerId, Date.now()).run();
    const row = await db.prepare(`SELECT uid FROM po_devices WHERE owner_id = ?`).bind(ownerId).first<{ uid: number }>();
    return row?.uid ?? 0;
}

/** 删信 + 级联清掉回复/抽取记录/投票。 */
async function deleteLetters(db: D1Database, ids: string[]) {
    for (const id of ids) {
        await db.prepare(`DELETE FROM po_replies WHERE letter_id = ?`).bind(id).run();
        await db.prepare(`DELETE FROM po_picks  WHERE letter_id = ?`).bind(id).run();
        await db.prepare(`DELETE FROM po_votes  WHERE letter_id = ?`).bind(id).run();
        await db.prepare(`DELETE FROM po_letters WHERE id = ?`).bind(id).run();
    }
}

/** 按 po_votes 重算某封信的赞/踩并回写（展示用，按设备计数）。 */
async function recountVotes(db: D1Database, letterId: string): Promise<{ likes: number; dislikes: number }> {
    const r = await db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0)  AS likes,
                COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS dislikes
         FROM po_votes WHERE letter_id = ?`
    ).bind(letterId).first<{ likes: number; dislikes: number }>();
    const likes = r?.likes ?? 0, dislikes = r?.dislikes ?? 0;
    await db.prepare(`UPDATE po_letters SET likes = ?, dislikes = ? WHERE id = ?`).bind(likes, dislikes, letterId).run();
    return { likes, dislikes };
}

/**
 * 按「不同 IP」去重统计点踩数，用于自动删除判定。
 * 防止一个人伪造多个 device（同一 IP）刷满阈值删信；无 IP 时退化为按设备计。
 */
async function countDislikeIps(db: D1Database, letterId: string): Promise<number> {
    const r = await db.prepare(
        `SELECT COUNT(DISTINCT COALESCE(NULLIF(ip_hash, ''), 'u' || uid)) AS n
         FROM po_votes WHERE letter_id = ? AND vote = -1`
    ).bind(letterId).first<{ n: number }>();
    return r?.n ?? 0;
}

/** 把 IP 加盐哈希成桶 key（不可逆，不存原始 IP）。 */
async function hashIp(ip: string, salt: string): Promise<string> {
    const data = new TextEncoder().encode(`${salt}:${ip}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * 固定窗口限流：单条 upsert 原子累加，超阈值返回 true。
 * windowMs 指定窗口长度；cost 指定本次消耗的额度（批量端点按条数计，防止单请求塞满 MAX_BATCH 绕过）。
 */
async function rateLimited(db: D1Database, ipHash: string, action: string, limit: number, windowMs = WINDOW_MS, cost = 1): Promise<boolean> {
    if (!ipHash || limit <= 0) return false;
    const now = Date.now();
    const bucket = `${ipHash}:${action}`;
    const row = await db.prepare(
        `INSERT INTO po_ratelimit (bucket, count, reset_at) VALUES (?, ?, ?)
         ON CONFLICT(bucket) DO UPDATE SET
           count    = CASE WHEN reset_at <= ? THEN ? ELSE count + ? END,
           reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
         RETURNING count`
    ).bind(bucket, cost, now + windowMs, now, cost, cost, now, now + windowMs).first<{ count: number }>();
    return (row?.count ?? cost) > limit;
}

/** 校验管理员令牌（Authorization: Bearer 或 ?token=）。 */
function isAdmin(req: Request, url: URL, env: Env): boolean {
    if (!env.ADMIN_TOKEN) return false;
    const auth = req.headers.get('Authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const token = bearer || url.searchParams.get('token') || '';
    return token === env.ADMIN_TOKEN;
}

export default {
    async fetch(req: Request, env: Env): Promise<Response> {
        if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
        if (!env.DB) return json({ ok: false, error: 'D1 binding "DB" 未配置' }, 500);

        const url = new URL(req.url);
        const path = url.pathname.replace(/\/+$/, '');
        const ends = (p: string) => path === p || path.endsWith(p);
        const maxReplies = num(env.PO_MAX_REPLIES, 3) || 3;
        const dislikeLimit = num(env.PO_DISLIKE_LIMIT, 5) || 5;

        // 限流准备：拿 IP 哈希（盐缺省也能用，只是可被猜测）
        const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || '';
        const ipHash = ip ? await hashIp(ip, env.PO_IP_SALT || 'po') : '';
        const tooMany = (action: string, limit: number, windowMs?: number, cost?: number) => rateLimited(env.DB, ipHash, action, limit, windowMs, cost);

        try {
            await ensureSchema(env.DB);

            if (req.method === 'GET' && ends('/health')) {
                return json({ ok: true, service: 'sullyos-post-office', maxReplies, dislikeLimit, admin: !!env.ADMIN_TOKEN });
            }

            // ── 管理（纯 API，无前端）─────────────────────────────
            if (ends('/admin/list') && req.method === 'GET') {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const limit = Math.min(Math.max(num(url.searchParams.get('limit') || '', 50), 1), 200);
                const rows = await env.DB.prepare(
                    `SELECT id, pen, content, lang, created_at, reply_count, likes, dislikes, views
                     FROM po_letters ORDER BY dislikes DESC, created_at DESC LIMIT ?`
                ).bind(limit).all<any>();
                return json({ ok: true, letters: rows.results || [] });
            }
            if (ends('/admin/delete') && req.method === 'POST') {
                if (!isAdmin(req, url, env)) return json({ ok: false, error: 'unauthorized' }, 401);
                const body: any = await req.json().catch(() => ({}));
                const rawIds: string[] = Array.isArray(body.letterIds)
                    ? body.letterIds : (body.letterId ? [body.letterId] : []);
                const ids = rawIds.slice(0, 100).map(String);
                if (ids.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                await deleteLetters(env.DB, ids);
                // 只报实际删除的数量；超 100 的部分未删，提示客户端分批
                return json({ ok: true, deleted: ids.length, truncated: rawIds.length > ids.length });
            }

            // ── 投票：点赞 / 点踩(=举报) / 撤销 ──────────────────
            if (req.method === 'POST' && ends('/vote')) {
                if (await tooMany('vote', num(env.PO_RATE_VOTES, 120))) return json({ ok: false, error: 'rate limited' }, 429);
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const letterId = String(body.letterId || '');
                const vote = body.vote === 1 ? 1 : body.vote === -1 ? -1 : 0;
                if (!device || !letterId) return json({ ok: false, error: 'bad request' }, 400);
                const exists = await env.DB.prepare(`SELECT id FROM po_letters WHERE id = ?`).bind(letterId).first();
                if (!exists) return json({ ok: true, deleted: true, likes: 0, dislikes: 0 });
                const uid = await getUid(env.DB, device);
                if (vote === 0) {
                    await env.DB.prepare(`DELETE FROM po_votes WHERE letter_id = ? AND uid = ?`).bind(letterId, uid).run();
                } else {
                    await env.DB.prepare(
                        `INSERT INTO po_votes (letter_id, uid, vote, at, ip_hash) VALUES (?,?,?,?,?)
                         ON CONFLICT(letter_id, uid) DO UPDATE SET vote = ?, at = ?, ip_hash = ?`
                    ).bind(letterId, uid, vote, Date.now(), ipHash, vote, Date.now(), ipHash).run();
                }
                const { likes, dislikes } = await recountVotes(env.DB, letterId);
                // 点踩(=举报)满阈值 → 删信。阈值按「不同 IP」算，防伪造 device 刷删
                if (vote === -1 && await countDislikeIps(env.DB, letterId) >= dislikeLimit) {
                    await deleteLetters(env.DB, [letterId]);
                    return json({ ok: true, deleted: true, likes, dislikes });
                }
                return json({ ok: true, likes, dislikes });
            }

            // ── 上传待寄出的信 ──────────────────────────────────
            if (req.method === 'POST' && ends('/letters')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const letters: any[] = Array.isArray(body.letters) ? body.letters.slice(0, MAX_BATCH) : [];
                if (!device || letters.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                // 投信：同一 IP 5 小时内最多 PO_RATE_LETTERS 条（默认 5），按实际条数计
                if (await tooMany('letters', num(env.PO_RATE_LETTERS, 5), LETTERS_WINDOW_MS, letters.length)) return json({ ok: false, error: 'rate limited' }, 429);
                const ids: string[] = [];
                const now = Date.now();
                for (const l of letters) {
                    const content = clip(l.content);
                    if (!content.trim()) continue;
                    const id = uuid();
                    ids.push(id);
                    await env.DB.prepare(`INSERT INTO po_letters (id, device, pen, content, lang, created_at) VALUES (?,?,?,?,?,?)`)
                        .bind(id, device, String(l.pen || '匿名').slice(0, 60), content, String(l.lang || '').slice(0, 16), now).run();
                }
                return json({ ok: true, ids });
            }

            // ── 随机抽别人的、还能回的信（抽到即 +1 浏览量）────────
            if (req.method === 'GET' && ends('/inbox')) {
                const device = String(url.searchParams.get('device') || '').slice(0, 80);
                const limit = Math.min(Math.max(num(url.searchParams.get('limit') || '', 5), 1), 10);
                if (!device) return json({ ok: false, error: 'bad request' }, 400);
                const rows = await env.DB.prepare(
                    `SELECT id, pen, content, created_at, likes, dislikes, views, reply_count FROM po_letters
                     WHERE device != ? AND reply_count < ?
                       AND id NOT IN (SELECT letter_id FROM po_picks WHERE device = ?)
                     ORDER BY RANDOM() LIMIT ?`
                ).bind(device, maxReplies, device, limit).all<any>();
                const letters = rows.results || [];
                const now = Date.now();
                // 查询已排除"抽过的"，故返回的每封都是新抽到 → 直接 views++（天然去重）
                for (const r of letters) {
                    await env.DB.prepare(`INSERT OR IGNORE INTO po_picks (device, letter_id, at) VALUES (?,?,?)`).bind(device, r.id, now).run();
                    await env.DB.prepare(`UPDATE po_letters SET views = views + 1 WHERE id = ?`).bind(r.id).run();
                    r.views = (r.views || 0) + 1;
                }
                return json({ ok: true, letters });
            }

            // ── 上传回信 ────────────────────────────────────────
            if (req.method === 'POST' && ends('/replies')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const replies: any[] = Array.isArray(body.replies) ? body.replies.slice(0, MAX_BATCH) : [];
                if (!device || replies.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                // 回信：每分钟上限按实际条数计
                if (await tooMany('replies', num(env.PO_RATE_REPLIES, 60), undefined, replies.length)) return json({ ok: false, error: 'rate limited' }, 429);
                const now = Date.now();
                let accepted = 0;
                for (const rp of replies) {
                    const letterId = String(rp.letterId || '');
                    const content = clip(rp.content);
                    if (!letterId || !content.trim()) continue;
                    const lt = await env.DB.prepare(`SELECT reply_count FROM po_letters WHERE id = ?`).bind(letterId).first<any>();
                    if (!lt || lt.reply_count >= maxReplies) continue;
                    await env.DB.prepare(`INSERT INTO po_replies (id, letter_id, device, pen, content, created_at) VALUES (?,?,?,?,?,?)`)
                        .bind(uuid(), letterId, device, String(rp.pen || '匿名').slice(0, 60), content, now).run();
                    await env.DB.prepare(`UPDATE po_letters SET reply_count = reply_count + 1 WHERE id = ?`).bind(letterId).run();
                    accepted++;
                }
                return json({ ok: true, accepted });
            }

            // ── 取回我寄出的信上的回复 + 各信的赞/踩/浏览量 ────────
            if (req.method === 'GET' && ends('/replies')) {
                const device = String(url.searchParams.get('device') || '').slice(0, 80);
                if (!device) return json({ ok: false, error: 'bad request' }, 400);
                const replies = await env.DB.prepare(
                    `SELECT r.id, r.letter_id, r.pen, r.content, r.created_at
                     FROM po_replies r JOIN po_letters l ON l.id = r.letter_id
                     WHERE l.device = ? ORDER BY r.created_at ASC LIMIT 200`
                ).bind(device).all<any>();
                const stats = await env.DB.prepare(
                    `SELECT id, likes, dislikes, views, reply_count, created_at FROM po_letters WHERE device = ?`
                ).bind(device).all<any>();
                return json({ ok: true, replies: replies.results || [], letters: stats.results || [] });
            }

            // ── 作者删自己的信（原 release）────────────────────────
            if (req.method === 'POST' && ends('/release')) {
                const body: any = await req.json().catch(() => ({}));
                const device = String(body.device || '').slice(0, 80);
                const letterIds: string[] = Array.isArray(body.letterIds) ? body.letterIds.slice(0, 100) : [];
                if (!device || letterIds.length === 0) return json({ ok: false, error: 'bad request' }, 400);
                const mine: string[] = [];
                for (const id of letterIds) {
                    const lt = await env.DB.prepare(`SELECT device FROM po_letters WHERE id = ?`).bind(String(id)).first<any>();
                    if (lt && lt.device === device) mine.push(String(id)); // 只能删自己的
                }
                await deleteLetters(env.DB, mine);
                return json({ ok: true });
            }

            return json({ ok: false, error: 'not found' }, 404);
        } catch (e: any) {
            return json({ ok: false, error: e?.message || 'server error' }, 500);
        }
    },
};
