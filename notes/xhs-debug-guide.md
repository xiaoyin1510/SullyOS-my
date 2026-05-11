# 小红书集成 - 技术调试文档

## 一、项目概览

NOI2test 是一个虚拟手机 OS 模拟器（React + Vite），其中集成了小红书自动化功能。
前端通过 `utils/xhsMcpClient.ts` 与后端通信，**支持两种后端模式**。

---

## 二、两种后端模式

### 模式 A: MCP 模式（JSON-RPC 2.0）

- **后端**: `xiaohongshu-mcp`（Go 语言，独立项目）
- **GitHub**: https://github.com/xpzouying/xiaohongshu-mcp
- **协议**: MCP (Model Context Protocol)，基于 JSON-RPC 2.0 + SSE
- **启动**: 独立启动 Go 二进制，监听 18060 端口
- **前端 URL**: 需配置为 `http://localhost:18061/mcp`（通过 CORS 代理）
- **CORS 代理**: `scripts/mcp-proxy.mjs`（代理 18061 → 18060，修复 CORS 头 + SPA 预热）
- **Chrome 管理**: Go 服务自己管理 Chrome（用户无需关心）

**MCP 模式的特殊处理**:
- 需要 `initialize` → `notifications/initialized` → `tools/list` 握手
- 需要 `Mcp-Session-Id` 头（Go 服务返回，浏览器 CORS 限制需要代理暴露该头）
- 工具名称不一致问题：Go 服务的工具名可能是 `search`、`get_recommend` 等，前端通过 `TOOL_NAME_ALIASES` 和 `mcpResolveToolName` 做映射
- SSE 响应需要特殊解析（`mcpParseSseResponse`）

### 模式 B: Skills/Bridge 模式（REST API）

- **后端**: `xiaohongshu-skills`（Python，独立项目）
- **GitHub**: https://github.com/autoclaw-cc/xiaohongshu-skills
- **桥接层**: `scripts/xhs-bridge.mjs`（Node.js HTTP 服务器，spawn Python CLI）
- **启动**: `start-xhs.bat` 一键启动（Chrome + Bridge + Cloudflared）
- **前端 URL**: 配置为 `http://localhost:18061/api`
- **Chrome 管理**: ⚠️ 这是当前的核心问题（见下文）

**Skills 模式的工作原理**:
```
前端 → HTTP POST /api/search → xhs-bridge.mjs → spawn `uv run python cli.py search-feeds --keyword xxx` → 返回 JSON
```

### 前端自动检测模式

`xhsMcpClient.ts` 第 23-26 行：
```typescript
const detectMode = (serverUrl: string): BackendMode => {
    if (serverUrl.includes('/api')) return 'bridge';
    return 'mcp'; // default
};
```

- URL 包含 `/api` → Bridge 模式
- 其他 → MCP 模式

---

## 三、当前状态和问题

### 正常工作的功能
- ✅ 发帖 (publish)
- ✅ 首页 (list-feeds) — Python CLI 有额外 `time.sleep(1)`
- ✅ 分享功能
- ✅ check-login（能正确检测登录状态）
- ✅ 搜索→详情→评论→回复（有 xsecToken 的正常流程）
- ✅ 搜索→点赞/收藏（有 xsecToken 的正常流程）

### 不工作的功能（已修复）
- ~~❌~~ ✅ 搜索 (search-feeds) — Bridge CDP fallback 已修复
- ~~❌~~ ✅ 用户主页 (user-profile) — Bridge CDP fallback 已修复

### 已修复的问题

#### ~~⚠️~~ ✅ 通过主页查看笔记详情时看不到评论区、无法评论/点赞（已修复）

**原现象**：AI 角色通过 `[[XHS_MY_PROFILE]]` 查看自己主页 → 选一条笔记 `[[XHS_DETAIL: noteId]]` → 能看到笔记正文 → 但评论区为空 → 后续的 `[[XHS_COMMENT]]`、`[[XHS_LIKE]]` 等操作因缺少 xsecToken 而失败。另外笔记列表也不显示。

**根本原因链（已定位并修复）**：

1. **笔记列表不显示（Bug 1）**：Bridge 模式返回 `{ code: 0, data: { notes: [...] } }`，但前端 `extractNotesFromMcpData()` 只查第一层 key，无法穿透 `data.data.notes` 嵌套结构，导致笔记列表始终为空。
   - **修复**：`extractNotesFromMcpData` 增加了 `data.data.*` 嵌套解包逻辑
   - **修复**：`useChatAI.ts` 在调用 `extractNotesFromMcpData` 前手动解包 `d.data || d`
   - **修复**：`profileStr` 改为只保留 `basic_info`（用户简介），避免整个 JSON 被 3000 字符截断

2. **评论区为空（Bug 2）**：CDP fallback 只从 `__INITIAL_STATE__.note.noteDetailMap` 提取笔记元数据，但评论是异步 XHR 加载的，不在 SSR 初始状态里。
   - **修复**：`cdpFallbackFeedDetail` 重构为手动管理 tab 生命周期：提取笔记数据后保持 tab 打开 → 执行 JS 滚动页面触发评论 XHR → 等待评论 DOM 渲染 → 从 DOM 提取评论 → 合并到笔记数据 → 关闭 tab

3. **xsecToken 缺失**：主页返回的笔记列表里没有 xsecToken，但 CDP 打开笔记详情页后能从 `noteDetailMap` 提取到 xsecToken 并缓存

**已实施的缓解措施（xhs-bridge.mjs）**：

- **xsecToken 内存缓存**：`cdpFallbackFeedDetail` 提取详情时自动缓存 xsecToken，后续 `ensureXsecToken()` 先查缓存
- **CDP→CLI 重试**：`get-feed-detail` 在 CDP 拿到 xsecToken 后，自动用 CLI 重试（CLI 能通过 Playwright 滚动页面加载评论）
- **CDP 直接提取评论**：`cdpFallbackFeedDetail` 滚动页面后从 DOM 提取评论，即使 CLI 重试失败也能拿到评论
- **前端也缓存 xsecToken**：`useChatAI.ts` 从 detail 响应中提取并缓存 token

**仍需注意**：
- CDP DOM 评论提取依赖小红书前端的 CSS 选择器，如果小红书改版可能需要更新选择器
- 整体流程较慢（CDP 提取 ~5s + 评论等待 ~5-10s），但比之前完全没评论要好

### 已定位的根本原因：`_wait_for_initial_state` 竞态条件

Python CLI（`xiaohongshu-skills`）的 `search.py` 中 `_wait_for_initial_state()` 只检查：
```python
ready = page.evaluate("window.__INITIAL_STATE__ !== undefined")
```

但小红书的 SSR 页面**一加载就有** `__INITIAL_STATE__`（空壳），搜索/用户主页数据是**异步填充**的。
所以 CLI 一导航完就立刻读到空数据返回了。

对比 `list_feeds`（能用）有额外的 `time.sleep(1)`，而 `search_feeds` 没有。

**修复方式**: `xhs-bridge.mjs` 增加了 CDP 直连 fallback。
当 CLI 返回空结果时，bridge 通过 CDP WebSocket 直连 Chrome，轮询等待 `__INITIAL_STATE__` 中的
数据实际填充后再提取（最多等 15 秒，每秒检查一次）。

### 历史问题：Chrome 浏览器管理冲突（已解决）

Python CLI（xiaohongshu-skills）内部有一个 `chrome_launcher` 模块：
- 它会检查指定端口（默认 9222）是否已有 Chrome 运行
- 如果没有，它会**自动启动一个新的 Chrome**
- 它使用自己的 profile 目录（通常是 `~/.xhs/chrome-profile`）

---

## 四、文件清单

### 核心文件

| 文件 | 作用 |
|------|------|
| `scripts/start-xhs.bat` | Windows 一键启动脚本（Chrome + Bridge + Cloudflared） |
| `scripts/xhs-bridge.mjs` | Node.js HTTP Bridge 服务器，封装 Python CLI |
| `scripts/mcp-proxy.mjs` | MCP 模式的 CORS 代理（+SPA 预热） |
| `utils/xhsMcpClient.ts` | 前端客户端，双模式（MCP/Bridge）自动切换 |

### 外部依赖（需用户本地安装）

| 项目 | 位置 | 用途 |
|------|------|------|
| `xiaohongshu-skills` | `scripts/xiaohongshu-skills/` | Python CLI，Bridge 模式后端 |
| `xiaohongshu-mcp` | 独立运行 | Go MCP 服务器，MCP 模式后端 |
| `cloudflared.exe` | `scripts/cloudflared.exe` | 可选，用于公网隧道 |
| Chrome | 系统安装 | 小红书自动化（CDP 连接） |
| `uv` | 系统安装 | Python 包管理器 |
| Node.js | 系统安装 | 运行 Bridge/Proxy |

---

## 五、Bridge 模式 API 端点

`xhs-bridge.mjs` 提供以下 REST 端点（POST）：

| 端点 | CLI 命令 | 功能 |
|------|---------|------|
| `/api/check-login` | `check-login` | 检查登录状态 |
| `/api/search` | `search-feeds --keyword xxx` | 搜索笔记 |
| `/api/list-feeds` | `list-feeds` | 首页推荐 |
| `/api/get-feed-detail` | `get-feed-detail --feed-id xxx` | 笔记详情+评论 |
| `/api/post-comment` | `post-comment --feed-id xxx --content xxx` | 发表评论 |
| `/api/reply-comment` | `reply-comment --feed-id xxx --content xxx` | 回复评论 |
| `/api/like-feed` | `like-feed --feed-id xxx` | 点赞/取消 |
| `/api/favorite-feed` | `favorite-feed --feed-id xxx` | 收藏/取消 |
| `/api/user-profile` | `user-profile --user-id xxx --xsec-token xxx` | 用户主页 |
| `/api/publish` | `publish --title-file xxx --content-file xxx` | 发布图文 |
| `/api/publish-video` | `publish-video ...` | 发布视频 |
| `/api/long-article` | `long-article ...` | 发布长文 |
| `/api/login` | `login` | 登录（获取二维码） |
| `/api/get-qrcode` | `get-qrcode` | 获取二维码 |
| `/api/delete-cookies` | `delete-cookies` | 登出 |

所有端点都通过 `runCli()` 函数执行：
```
uv run python scripts/cli.py --host 127.0.0.1 --port 9222 <command> <args>
```

---

## 六、调试建议

### 1. 先搞清楚 Python CLI 的 Chrome 管理逻辑

```bash
# 查看 chrome_launcher 源码
cat xiaohongshu-skills/scripts/chrome_launcher.py
# 或
cat xiaohongshu-skills/xhs/cdp.py
```

关键要确认：
- 连接端口 9222 时是否先检测已有 Chrome？
- 如果已有 Chrome，是直接连接还是另起一个？
- `--user-data-dir` 路径是什么？

### 2. 测试 Chrome 连接

```bash
# 手动启动 Chrome
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.xhs\chrome-profile" --no-first-run https://www.xiaohongshu.com

# 然后手动测试 CLI 命令
cd xiaohongshu-skills
uv run python scripts/cli.py --host 127.0.0.1 --port 9222 check-login
uv run python scripts/cli.py --host 127.0.0.1 --port 9222 search-feeds --keyword "测试"
```

观察 search-feeds 是否启动了新的 Chrome 窗口。

### 3. 可能的解决方案

**方案 A**: 修改 bat，**不用 `--app` 模式**，改用普通窗口打开小红书：
```batch
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --user-data-dir="%CHROME_PROFILE%" --no-first-run https://www.xiaohongshu.com
```
（当前已经是这样，如果还是空白页，可能是 `--user-data-dir` 路径有问题）

**方案 B**: 去掉 `--app=` 前缀试试（`--app` 会用 app 模式打开，可能不加载完整页面）：
```batch
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --user-data-dir="%CHROME_PROFILE%" --no-first-run "https://www.xiaohongshu.com"
```

**方案 C**: 不在 bat 里启动 Chrome，而是让 bridge 在启动后自动调用一次 `check-login` 或 `login`，让 CLI 自己启动 Chrome 并导航到小红书。

**方案 D**: 在 bridge 启动后，等 CLI 的 chrome_launcher 启动 Chrome 后，在 Node.js 里通过 CDP 协议发送导航命令到小红书。

### 4. MCP 和 Skills 兼容性

两种模式必须共存，因为：
- MCP 模式用 Go 服务（`xiaohongshu-mcp`），有自己的 Chrome 管理
- Skills/Bridge 模式用 Python CLI（`xiaohongshu-skills`），也有自己的 Chrome 管理
- 前端 `xhsMcpClient.ts` 通过 URL 自动判断使用哪种模式
- 两种模式**不会同时运行**，但代码需要都支持

**不能破坏的东西**：
- MCP 模式的 `mcp-proxy.mjs`（CORS 代理 + SPA 预热）
- Bridge 模式的 `xhs-bridge.mjs`（REST API → CLI spawn）
- 前端 `xhsMcpClient.ts` 的双模式检测和调用逻辑

---

## 七、关键日志

启动 bridge 后，观察控制台输出：

```
[bridge] $ uv run python scripts/cli.py --host 127.0.0.1 --port 9222 search-feeds --keyword xxx
[bridge] stderr: chrome_launcher: 启动 Chrome (port=9222, headless=False)   ← ⚠️ 说明启动了新 Chrome
[bridge] stderr: xhs.cdp: 导航到搜索页...
[bridge] stdout (34 chars): { "feeds": [], "count": 0 }                     ← ❌ 空结果（新 Chrome 没登录）
[bridge] exit code: 0
```

正确的输出应该是：
```
[bridge] stderr: xhs.cdp: 连接到已有 Chrome (port=9222)                    ← ✅ 连接已有
[bridge] stderr: xhs.cdp: 导航到搜索页...
[bridge] stdout: { "feeds": [...], "count": 20 }                            ← ✅ 有结果
```

---

## 八、当前 start-xhs.bat 的 Chrome 启动参数

```batch
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --user-data-dir="%CHROME_PROFILE%" --no-first-run --app=https://www.xiaohongshu.com
```

其中 `CHROME_PROFILE` = `%USERPROFILE%\.xhs\chrome-profile`

**注意**：`--app=URL` 会以应用模式打开（无地址栏），如果出现空白页，可能需要去掉 `--app=` 改为把 URL 作为普通参数传入。

---

## 九、xsecToken 机制详解

### 什么是 xsecToken

小红书的反爬机制之一。几乎所有写操作（评论、点赞、收藏）和笔记详情 API 都需要 xsecToken。每条笔记有独立的 xsecToken，且会过期。

### xsecToken 的获取路径

| 来源 | 何时可用 | 可靠性 |
|------|---------|--------|
| 搜索结果 `feeds[].xsecToken` | 搜索返回的笔记列表 | ✅ 最可靠 |
| 首页推荐 `feeds[].xsecToken` | 首页返回的笔记列表 | ✅ 可靠 |
| CDP `noteDetailMap[id].note.xsecToken` | 打开笔记详情页后 | ⚠️ 需等页面加载 |
| URL 参数 `?xsec_token=xxx` | 从 URL 提取 | ⚠️ 不一定有 |
| 用户主页笔记列表 | 查看主页时 | ❌ 通常没有 |

### 缓存层次

```
前端 xsecTokenCacheRef (Map<noteId, token>)
  ↑ 搜索结果、首页推荐、detail 响应
  ↑ findXsecToken() 查找

Bridge xsecTokenCache (Map<feedId, token>)
  ↑ cdpFallbackFeedDetail 提取时缓存
  ↑ cdpGetXsecToken 提取时缓存
  ↑ ensureXsecToken() 查找（用于 comment/like/fav）
```

### get-feed-detail 的完整流程

```
1. 前端调用 getNoteDetail(noteId, xsecToken?)
2. Bridge 收到请求
   ├─ 有 xsecToken（来自前端缓存或请求参数）
   │   └─ CLI get-feed-detail --feed-id xxx --xsec-token xxx
   │       ├─ 成功 → 返回（含评论）✅
   │       └─ 失败 → 走下面的 CDP 路径
   └─ 无 xsecToken
       └─ CDP 直连打开笔记页
           ├─ 从 noteDetailMap 提取笔记数据
           ├─ 缓存 xsecToken（如果有）
           ├─ 有缓存 token → CLI 重试（能加载评论）✅
           └─ 无缓存 token → 返回 CDP 结果（无评论）⚠️
3. 前端收到响应
   ├─ 缓存 xsecToken（如果有）
   ├─ 缓存评论 userId/authorName
   └─ 发送给 AI 模型
```

### 为什么主页→详情流程经常失败

```
MY_PROFILE → cdpFallbackUserProfile → 返回 5 条笔记（无 xsecToken）
     ↓
AI 选择一条笔记 → XHS_DETAIL: noteId
     ↓
findXsecToken(noteId) → undefined（主页数据里没有）
     ↓
Bridge: 无 xsecToken → CDP 直连
     ↓
CDP 打开笔记页 → 提取 noteDetailMap
     ├─ 有 xsecToken → 缓存 → CLI 重试（有评论）✅
     └─ 无 xsecToken → 返回 CDP 数据（无评论）⚠️
         ↓
     后续 LIKE/COMMENT → ensureXsecToken → 无缓存 → CDP 重新提取
         ├─ 成功 → 操作成功 ✅
         └─ 超时 → 操作失败 ❌
```
