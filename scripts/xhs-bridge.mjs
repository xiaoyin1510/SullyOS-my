#!/usr/bin/env node
/**
 * XHS Bridge Server — Node HTTP 桥接 xiaohongshu-skills Python CLI
 *
 * 适配 xiaohongshu-skills 新架构（2026-05 之后）：
 * - cli.py 不再通过 Chrome 远程调试端口（--remote-debugging-port=9222）
 * - 改为通过 "XHS Bridge" 浏览器扩展 + bridge_server.py（WebSocket :9333）
 * - cli.py 每次调用会自动拉起 bridge_server.py、自动打开 Chrome
 *
 * 前端 (SullyOS) 仍然通过 REST API 调用本服务，本服务 spawn Python CLI 并返回 JSON。
 * REST API 的 endpoint / 入参 / 出参与旧版完全兼容，前端无需改动。
 *
 * 依赖:
 *   - xiaohongshu-skills 新版（含 extension/ 目录）
 *   - "XHS Bridge" Chrome 扩展（在 chrome://extensions/ 加载已解压扩展 → extension/）
 *   - uv (Python 包管理器)
 *
 * 用法:
 *   node scripts/xhs-bridge.mjs                                    # 默认端口 18061
 *   node scripts/xhs-bridge.mjs --port 19000                       # 自定义端口
 *   node scripts/xhs-bridge.mjs --skills-dir /path/to/skills       # 自定义 skills 目录
 *   node scripts/xhs-bridge.mjs --bridge-url ws://localhost:9333   # 自定义扩展 bridge 地址
 *
 * 前端 Server URL 设为: http://localhost:18061/api
 *
 * 兼容性: --chrome-host / --chrome-port / --account 仍可传入，但会被忽略。
 */

import { createServer } from 'http';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PORT = parseInt(getArg('--port', '18061'), 10);
const BRIDGE_URL = getArg('--bridge-url', ''); // 空字符串 = 用 cli.py 默认 (ws://localhost:9333)

// Auto-detect skills directory
function findSkillsDir() {
    const explicit = getArg('--skills-dir', '');
    if (explicit) return explicit;
    const candidates = [
        join(__dirname, '..', 'xiaohongshu-skills'),
        join(__dirname, '..', 'xiaohongshu-skills-main'),
        join(process.cwd(), 'xiaohongshu-skills'),
        join(process.cwd(), 'xiaohongshu-skills-main'),
    ];
    for (const dir of candidates) {
        if (existsSync(join(dir, 'scripts', 'cli.py'))) {
            console.log(`[bridge] Auto-detected skills dir: ${dir}`);
            return dir;
        }
    }
    return join(__dirname, '..', 'xiaohongshu-skills');
}
const SKILLS_DIR = findSkillsDir();
const CLI_PATH = join(SKILLS_DIR, 'scripts', 'cli.py');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==================== CLI Runner ====================

/**
 * 执行 xiaohongshu-skills CLI 命令，返回 JSON 结果。
 * 注意：新版 cli.py 不接受 --host/--port/--account，只接受 --bridge-url + command。
 */
function runCli(command, cliArgs = []) {
    return new Promise((resolve, reject) => {
        const fullArgs = [
            CLI_PATH,
            ...(BRIDGE_URL ? ['--bridge-url', BRIDGE_URL] : []),
            command,
            ...cliArgs,
        ];

        console.log(`[bridge] $ uv run python ${fullArgs.join(' ')}`);

        const proc = spawn('uv', ['run', 'python', ...fullArgs], {
            cwd: SKILLS_DIR,
            env: { ...process.env },
            // 首次调用会拉起 bridge_server.py + 等待扩展连接，时间会略久
            timeout: 180_000,
        });

        const stdout = [];
        const stderr = [];

        proc.stdout.on('data', (d) => stdout.push(d));
        proc.stderr.on('data', (d) => stderr.push(d));

        proc.on('close', (code) => {
            const out = Buffer.concat(stdout).toString().trim();
            const err = Buffer.concat(stderr).toString().trim();

            if (err) console.log(`[bridge] stderr: ${err.slice(0, 800)}`);
            console.log(`[bridge] stdout (${out.length} chars): ${out.slice(0, 300)}`);
            console.log(`[bridge] exit code: ${code}`);

            if (out) {
                try {
                    resolve({ code, data: JSON.parse(out) });
                    return;
                } catch {
                    resolve({ code, data: out });
                    return;
                }
            }

            if (code === 0) {
                console.warn(`[bridge] WARNING: CLI exited 0 but produced no output for: ${command}`);
                resolve({ code, data: { success: true, empty: true, warning: 'CLI returned no data' } });
            } else if (code === 1) {
                reject(new Error('未登录，请先登录小红书'));
            } else {
                reject(new Error(err || `CLI 退出码: ${code}`));
            }
        });

        proc.on('error', (e) => {
            reject(new Error(`无法启动 CLI: ${e.message}. 请确保已安装 uv 和 xiaohongshu-skills`));
        });
    });
}

/**
 * 带重试的 CLI 执行：专用于 comment/reply 等操作
 * XHS 反爬机制：如果刚打开过笔记详情（get-feed-detail），再用同一 xsec_token
 * 打开同一笔记会被临时封锁（"笔记不可访问"/"当前笔记暂时无法浏览"）。
 * 等几秒后重试通常可以成功。
 */
async function runCliWithRetry(command, cliArgs, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await runCli(command, cliArgs);
            const errMsg = result.data?.error || '';
            if (errMsg.includes('不可访问') || errMsg.includes('无法浏览') || errMsg.includes('暂时无法')) {
                if (attempt < maxRetries) {
                    const waitSec = 5 + attempt * 3;
                    console.log(`[bridge] ${command}: 笔记暂时不可访问，等 ${waitSec}s 后重试 (${attempt + 1}/${maxRetries})...`);
                    await sleep(waitSec * 1000);
                    continue;
                }
            }
            return result;
        } catch (e) {
            if (attempt < maxRetries && (e.message.includes('不可访问') || e.message.includes('无法浏览'))) {
                const waitSec = 5 + attempt * 3;
                console.log(`[bridge] ${command}: 异常 - 笔记不可访问，等 ${waitSec}s 后重试 (${attempt + 1}/${maxRetries})...`);
                await sleep(waitSec * 1000);
                continue;
            }
            throw e;
        }
    }
}

function writeTempFile(content, prefix = 'xhs-') {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const path = join(dir, 'content.txt');
    writeFileSync(path, content, 'utf-8');
    return path;
}

function cleanupTempFile(path) {
    try { unlinkSync(path); } catch { /* ignore */ }
}

// ==================== xsec_token 缓存 ====================
// 新版 cli.py 强制要求 get-feed-detail / post-comment / like-feed 等带 --xsec-token。
// 从 search/list-feeds 的响应里把 token 缓存下来，调用方没传时回退到缓存。

const xsecTokenCache = new Map();

function cacheTokensFromFeeds(feeds) {
    if (!Array.isArray(feeds)) return;
    for (const f of feeds) {
        if (!f || typeof f !== 'object') continue;
        const card = f.noteCard || f.note_card;
        const id = f.id || f.noteId || f.note_id || card?.noteId || card?.note_id;
        const token = f.xsecToken || f.xsec_token || card?.xsecToken || card?.xsec_token;
        if (id && token) xsecTokenCache.set(id, token);
    }
}

function resolveXsecToken(feedId, providedToken) {
    if (providedToken) return providedToken;
    const cached = xsecTokenCache.get(feedId);
    if (cached) console.log(`[bridge] xsec_token 命中缓存: ${feedId}`);
    return cached || '';
}

// ==================== Route Handlers ====================

const handlers = {
    'check-login': async (_body) => runCli('check-login'),

    'search': async (body) => {
        const cliArgs = ['--keyword', body.keyword || ''];
        if (body.sort_by) cliArgs.push('--sort-by', body.sort_by);
        if (body.note_type) cliArgs.push('--note-type', body.note_type);
        if (body.publish_time) cliArgs.push('--publish-time', body.publish_time);
        if (body.search_scope) cliArgs.push('--search-scope', body.search_scope);
        if (body.location) cliArgs.push('--location', body.location);
        const result = await runCli('search-feeds', cliArgs);
        cacheTokensFromFeeds(result.data?.feeds);
        return result;
    },

    'list-feeds': async (_body) => {
        const result = await runCli('list-feeds');
        cacheTokensFromFeeds(result.data?.feeds);
        return result;
    },

    'get-feed-detail': async (body) => {
        const feedId = body.feed_id;
        const xsecToken = resolveXsecToken(feedId, body.xsec_token);
        if (!xsecToken) {
            return { code: 0, data: { error: '缺少 xsec_token。请先调用 search 或 list-feeds 获取 token，或在调用时显式传入 xsec_token。' } };
        }
        const cliArgs = ['--feed-id', feedId, '--xsec-token', xsecToken];
        if (body.load_all_comments) cliArgs.push('--load-all-comments');
        if (body.click_more_replies) cliArgs.push('--click-more-replies');
        return runCli('get-feed-detail', cliArgs);
    },

    'post-comment': async (body) => {
        const xsecToken = resolveXsecToken(body.feed_id, body.xsec_token);
        if (!xsecToken) {
            return { code: 1, data: { error: '缺少 xsec_token，评论失败' } };
        }
        return runCliWithRetry('post-comment', [
            '--feed-id', body.feed_id,
            '--xsec-token', xsecToken,
            '--content', body.content,
        ]);
    },

    'reply-comment': async (body) => {
        const xsecToken = resolveXsecToken(body.feed_id, body.xsec_token);
        if (!xsecToken) {
            return { code: 1, data: { error: '缺少 xsec_token，回复失败' } };
        }
        const cliArgs = ['--feed-id', body.feed_id, '--xsec-token', xsecToken, '--content', body.content];
        if (body.comment_id) cliArgs.push('--comment-id', body.comment_id);
        if (body.user_id) cliArgs.push('--user-id', body.user_id);
        return runCliWithRetry('reply-comment', cliArgs);
    },

    'like-feed': async (body) => {
        const xsecToken = resolveXsecToken(body.feed_id, body.xsec_token);
        if (!xsecToken) {
            return { code: 1, data: { error: '缺少 xsec_token，点赞失败' } };
        }
        const cliArgs = ['--feed-id', body.feed_id, '--xsec-token', xsecToken];
        if (body.unlike) cliArgs.push('--unlike');
        return runCli('like-feed', cliArgs);
    },

    'favorite-feed': async (body) => {
        const xsecToken = resolveXsecToken(body.feed_id, body.xsec_token);
        if (!xsecToken) {
            return { code: 1, data: { error: '缺少 xsec_token，收藏失败' } };
        }
        const cliArgs = ['--feed-id', body.feed_id, '--xsec-token', xsecToken];
        if (body.unfavorite) cliArgs.push('--unfavorite');
        return runCli('favorite-feed', cliArgs);
    },

    'user-profile': async (body) => {
        const userId = body.user_id;
        const xsecToken = body.xsec_token || '';
        if (!xsecToken) {
            return {
                code: 0,
                data: {
                    error: '缺少 xsec_token。新版 xiaohongshu-skills 强制要求 user-profile 带 token，请从 search/list-feeds 结果或他人主页链接中提取后传入。',
                },
            };
        }
        return runCli('user-profile', ['--user-id', userId, '--xsec-token', xsecToken]);
    },

    'publish': async (body) => {
        const titleFile = writeTempFile(body.title || '');
        const contentFile = writeTempFile(body.content || '');
        const cliArgs = ['--title-file', titleFile, '--content-file', contentFile];

        if (body.images?.length) {
            for (const img of body.images) cliArgs.push('--images', img);
        }
        if (body.tags?.length) {
            for (const tag of body.tags) cliArgs.push('--tags', tag);
        }
        if (body.visibility) cliArgs.push('--visibility', body.visibility);

        try {
            return await runCli('publish', cliArgs);
        } finally {
            cleanupTempFile(titleFile);
            cleanupTempFile(contentFile);
        }
    },

    'publish-video': async (body) => {
        const titleFile = writeTempFile(body.title || '');
        const contentFile = writeTempFile(body.content || '');
        const cliArgs = [
            '--title-file', titleFile,
            '--content-file', contentFile,
            '--video', body.video,
        ];

        if (body.tags?.length) {
            for (const tag of body.tags) cliArgs.push('--tags', tag);
        }
        if (body.visibility) cliArgs.push('--visibility', body.visibility);

        try {
            return await runCli('publish-video', cliArgs);
        } finally {
            cleanupTempFile(titleFile);
            cleanupTempFile(contentFile);
        }
    },

    'long-article': async (body) => {
        const titleFile = writeTempFile(body.title || '');
        const contentFile = writeTempFile(body.content || '');
        const cliArgs = ['--title-file', titleFile, '--content-file', contentFile];

        if (body.images?.length) {
            for (const img of body.images) cliArgs.push('--images', img);
        }

        try {
            return await runCli('long-article', cliArgs);
        } finally {
            cleanupTempFile(titleFile);
            cleanupTempFile(contentFile);
        }
    },

    'login': async (_body) => runCli('login'),
    'get-qrcode': async (_body) => runCli('get-qrcode'),
    'delete-cookies': async (_body) => runCli('delete-cookies'),
};

// ==================== HTTP Server ====================

createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname;

    if (path === '/api/health' || path === '/health') {
        res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', backend: 'xiaohongshu-skills', mode: 'extension-bridge' }));
        return;
    }

    const match = path.match(/^\/api\/(.+)$/);
    if (!match) {
        res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use /api/<command>' }));
        return;
    }

    const command = match[1];
    const handler = handlers[command];

    if (!handler) {
        res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unknown command: ${command}. Available: ${Object.keys(handlers).join(', ')}` }));
        return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
        let body = {};
        if (chunks.length > 0) {
            try {
                body = JSON.parse(Buffer.concat(chunks).toString());
            } catch {
                res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                return;
            }
        }

        try {
            const result = await handler(body);
            res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.data));
        } catch (e) {
            console.error(`[bridge] Error in ${command}:`, e.message);
            const status = e.message.includes('未登录') ? 401 : 500;
            res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    });
}).listen(PORT, () => {
    console.log(`XHS Bridge Server started`);
    console.log(`  Listen:     http://localhost:${PORT}/api`);
    console.log(`  Skills dir: ${SKILLS_DIR}`);
    console.log(`  CLI path:   ${CLI_PATH}`);
    console.log(`  Mode:       Extension Bridge`);
    if (BRIDGE_URL) console.log(`  Bridge URL: ${BRIDGE_URL}`);

    if (!existsSync(CLI_PATH)) {
        console.error(`\n[WARNING] cli.py not found at: ${CLI_PATH}`);
        console.error(`  The bridge will start but CLI commands will fail.`);
        console.error(`  Please check your --skills-dir path or place xiaohongshu-skills in the parent directory.`);
    } else if (!existsSync(join(SKILLS_DIR, 'scripts', 'bridge_server.py'))) {
        console.error(`\n[WARNING] 检测到 OLD VERSION xiaohongshu-skills！`);
        console.error(`  ${SKILLS_DIR}\\scripts\\ 里没有 bridge_server.py，说明这是旧版（CDP 架构）。`);
        console.error(`  本 bridge 是为新版（扩展架构）写的，调旧 cli.py 会出现：`);
        console.error(`    - 自动弹出空白 Chrome 让你扫码登录`);
        console.error(`    - 发布/评论等操作用旧 DOM 选择器，小红书改版后会失败`);
        console.error(`  请从 https://github.com/autoclaw-cc/xiaohongshu-skills 用 Code → Download ZIP 拿最新源码`);
        console.error(`  （Release 页的 zip 不包含 extension/，是坑）然后整个覆盖到 ${SKILLS_DIR}\\`);
    }

    console.log(`\nAvailable endpoints:`);
    for (const cmd of Object.keys(handlers)) {
        console.log(`  POST /api/${cmd}`);
    }
    console.log(`\nSet your server URL to: http://localhost:${PORT}/api`);
    console.log(`\nNotes:`);
    console.log(`  - cli.py 会在首次请求时自动启动 bridge_server.py 和打开 Chrome`);
    console.log(`  - 确保 "XHS Bridge" 浏览器扩展已在 Chrome 加载并启用`);
    console.log(`  - 扩展加载方式: chrome://extensions/ → 开发者模式 → 加载已解压扩展 → 选 extension/ 目录`);
});
