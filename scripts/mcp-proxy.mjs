#!/usr/bin/env node
/**
 * MCP CORS Proxy (with SPA Pre-warm for reply_comment)
 *
 * xiaohongshu-mcp 服务器缺少 Access-Control-Expose-Headers: Mcp-Session-Id，
 * 导致浏览器读不到 session ID，MCP 协议无法正常工作。
 *
 * 这个代理转发所有请求到 MCP 服务器，并添加正确的 CORS 头。
 *
 * 额外功能: reply_comment SPA 预热
 * 小红书是 SPA，直接打开帖子 URL 时路由初始化不完整，评论区 DOM 不渲染。
 * 代理检测到 reply_comment 调用时，先发一个 check_login 让 MCP 浏览器访问
 * 小红书（预热 SPA），然后再转发原始请求。这样 reply_comment 导航到帖子时
 * SPA JS 已缓存，评论区更可能正常渲染。
 *
 * 用法:
 *   node scripts/mcp-proxy.mjs                           # 默认: 代理 18061 → MCP 18060
 *   node scripts/mcp-proxy.mjs --port 19000              # 自定义代理端口
 *   node scripts/mcp-proxy.mjs --target http://localhost:9090  # 自定义 MCP 地址
 *   node scripts/mcp-proxy.mjs --no-prewarm              # 禁用 SPA 预热
 *
 * 然后在应用设置里把 MCP URL 改为: http://localhost:18061/mcp
 */

import { createServer, request as httpRequest } from 'http';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
    const idx = args.indexOf(name);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const PROXY_PORT = parseInt(getArg('--port', '18061'), 10);
const TARGET = getArg('--target', 'http://localhost:18060');
const PREWARM_ENABLED = !args.includes('--no-prewarm');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
};

// ==================== SPA Pre-warm 逻辑 ====================

let requestIdCounter = 100000; // 给预热请求用的高位 id，避免和前端冲突
let lastPrewarmTime = 0;
const PREWARM_COOLDOWN = 30_000; // 30 秒冷却期，避免频繁预热

/**
 * 向 MCP 服务器发送一个 JSON-RPC 请求，返回完整响应文本
 */
function mcpCall(sessionId, jsonRpcBody) {
    return new Promise((resolve, reject) => {
        const targetUrl = new URL('/mcp', TARGET);
        const bodyStr = JSON.stringify(jsonRpcBody);
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        };
        if (sessionId) headers['Mcp-Session-Id'] = sessionId;

        const req = httpRequest(
            {
                hostname: targetUrl.hostname,
                port: targetUrl.port,
                path: targetUrl.pathname,
                method: 'POST',
                headers,
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks).toString()));
                res.on('error', reject);
            },
        );
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

/**
 * 预热: 调用 check_login 让 MCP 浏览器访问小红书站点
 * check_login 会导航到小红书检查登录状态，从而初始化 SPA
 */
async function prewarmSPA(sessionId) {
    const now = Date.now();
    if (now - lastPrewarmTime < PREWARM_COOLDOWN) {
        console.log(`[proxy] SPA 预热跳过（${Math.round((PREWARM_COOLDOWN - (now - lastPrewarmTime)) / 1000)}秒冷却中）`);
        return;
    }

    console.log('[proxy] 🔥 SPA 预热: 发送 check_login 让浏览器访问小红书...');
    try {
        const resp = await mcpCall(sessionId, {
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
                name: 'check_login',
                arguments: {},
            },
            id: ++requestIdCounter,
        });
        lastPrewarmTime = Date.now();
        console.log(`[proxy] 🔥 SPA 预热完成（${Date.now() - now}ms），响应: ${resp.slice(0, 100)}`);
    } catch (e) {
        console.warn(`[proxy] SPA 预热失败（不影响后续请求）: ${e.message}`);
    }
}

/**
 * 检测是否是 reply_comment 相关的 tools/call 请求
 */
function isReplyCommentCall(parsed) {
    if (parsed?.method !== 'tools/call') return false;
    const toolName = (parsed.params?.name || '').toLowerCase().replace(/[_-]/g, '');
    return toolName.includes('replycomment');
}

// ==================== Proxy Server ====================

createServer((req, res) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
    }

    // Collect body
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const targetUrl = new URL(req.url, TARGET);

        // Forward headers (keep Mcp-Session-Id, Content-Type, Accept)
        const fwdHeaders = {};
        if (req.headers['content-type']) fwdHeaders['Content-Type'] = req.headers['content-type'];
        if (req.headers['accept']) fwdHeaders['Accept'] = req.headers['accept'];
        if (req.headers['mcp-session-id']) fwdHeaders['Mcp-Session-Id'] = req.headers['mcp-session-id'];

        // 检测是否需要 SPA 预热
        if (PREWARM_ENABLED && body.length > 0) {
            try {
                const parsed = JSON.parse(body.toString());
                if (isReplyCommentCall(parsed)) {
                    console.log('[proxy] 🔍 检测到 reply_comment 调用，触发 SPA 预热...');
                    await prewarmSPA(req.headers['mcp-session-id']);
                }
            } catch {
                // JSON 解析失败，正常转发
            }
        }

        // Forward to MCP server
        const proxyReq = httpRequest(
            {
                hostname: targetUrl.hostname,
                port: targetUrl.port,
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: fwdHeaders,
            },
            (proxyRes) => {
                // Build response headers: CORS + forwarded
                const respHeaders = { ...CORS_HEADERS };
                const ct = proxyRes.headers['content-type'];
                if (ct) respHeaders['Content-Type'] = ct;
                const sid = proxyRes.headers['mcp-session-id'];
                if (sid) respHeaders['Mcp-Session-Id'] = sid;

                res.writeHead(proxyRes.statusCode || 200, respHeaders);
                proxyRes.pipe(res);
            },
        );

        proxyReq.on('error', (e) => {
            console.error(`[proxy] Error forwarding to ${TARGET}: ${e.message}`);
            res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
            res.end(`Proxy error: ${e.message}`);
        });

        if (body.length > 0) proxyReq.write(body);
        proxyReq.end();
    });
}).listen(PROXY_PORT, () => {
    console.log(`MCP CORS Proxy started`);
    console.log(`  Proxy:  http://localhost:${PROXY_PORT}/mcp`);
    console.log(`  Target: ${TARGET}/mcp`);
    console.log(`  SPA Pre-warm: ${PREWARM_ENABLED ? 'ENABLED' : 'disabled'}`);
    console.log(`\nSet your MCP URL to: http://localhost:${PROXY_PORT}/mcp`);
});
