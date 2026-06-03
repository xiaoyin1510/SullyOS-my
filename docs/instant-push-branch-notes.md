# Instant Push 分支调整说明

本分支主要围绕 ChatApp 的 Instant Push 链路做稳定性补齐。目标是让 instant 模式和本地模式在上下文构建、输出质量、副作用执行上保持一致，同时解决后台推送、情绪 buff、Notion 写入和工具调用状态提示的问题。

## 1. 情绪 buff 走 Instant Push 链路

之前的问题：

- 情绪评估没有完整接入 instant 链路。
- 主消息已经走 worker / push，但情绪评估仍可能在前端或后台反复触发。
- 结果是后台会重复调用情绪 API，出现额外消耗，并且前端可能一直停在“情绪分析中”。

现在的处理：

- 情绪评估跟主消息一样走 Instant Push worker。
- 前端在 instant 请求体里带上 `emotionEval` 配置和 prompt。
- worker 收到主消息请求后，用 `ctx.waitUntil` 运行副 API 情绪评估。
- 情绪评估完成后，worker 通过 `emotion_update` push 把 raw 结果推回客户端。
- 客户端收到后统一调用 `applyEmotionEvalRaw` 落库、更新 buff、广播 UI 刷新事件。

这样情绪 buff 不再依赖前端持续活着，也不会和本地模式重复跑。

## 2. Notion 写入丢失问题

之前的问题：

- Instant 工具链路里，角色调用 Notion 或相关工具后，可能因为前端切后台、推送内容太大、或续跑状态缺失，导致 Notion 写入信息丢失。
- 信息一丢，后续 `/continue` 没法带着正确 tool result 继续跑，表现为 Notion 写入失败或角色回复断掉。

现在的处理：

- Instant tool request 会写入 `pending_tool_calls`。
- 前端可见时立即跑 tool runner。
- 不可见时由通知唤回，回到前台后继续消费 pending tool。
- tool result 会拼回 OpenAI tool-call 标准消息格式，再 POST `/continue` 给 worker 续跑。
- 续跑阶段保留同一轮 outbound session，避免工具结果和主消息上下文断链。

## 3. 大包传输: 默认 multipart, 可选 D1 BlobStore

部分问题的根因是 Web Push 单包大小很小。情绪 buff raw、长工具结果、reasoning 或长文本 push 都可能超过安全线。超过后如果还直接推，会出现 worker 已完成、前端却收不到结果的情况。

现在的处理：

- worker 发送大 payload 时走 `sendPushWithMaybeBlob`。
- 小 payload 仍然直接 Web Push。
- 默认不启用 D1，超限 payload 会走 `amsg-instant` generic `_multipart` 分片。
- `amsg-sw` 负责收齐分片、还原原始 payload，再交给 SullyOS 的 inbox / tool / emotion 流程。
- 如果前台 D1 开关打开且 Worker 绑定了可用 D1，则大 payload 会先写入 BlobStore，再只推一个很小的 blob envelope。
- D1 表结构由 Worker 自动初始化，过期 blob row 会在请求经过 Worker 时定期清理。
- 前台通过 Worker `/capabilities` 自动检测 D1 能力；没检测到 D1 时，不允许打开 D1 envelope 开关。
- 客户端 Service Worker 收到 envelope 后再 fetch 真正内容，继续原本的 inbox / flush 流程。

### 传输策略

| 前台选择 | 行为 |
|----------|------|
| 默认分片 | 无数据库，大包走 `_multipart` 分片 |
| D1 envelope | 只有 `/capabilities` 检测到 D1 后才可打开，大包走 BlobStore envelope |

`AMSG_OVERSIZE_TRANSPORT` 仍保留为高级兜底项；通常不需要设置。

### Cloudflare D1 配置流程

如果想启用 D1 BlobStore，Instant Push Worker 需要配置 D1 数据库，binding 名必须是 `DB`。前台会自动检测，不需要手动设置 `AMSG_OVERSIZE_TRANSPORT`。

#### Cloudflare 后台方式（不用命令行）

1. 建数据库：

Cloudflare Dashboard → 左侧 `Storage & Databases` → `D1` → `Create database`，名字填 `instant-blob-db` → 创建。

2. 绑定到 worker：

进入你的 `instant-push` Worker → `Settings` → `Bindings`（有的版本叫 `Variables/Bindings`）→ `Add binding` → 选 `D1 database`。

填写：

- Variable name: `DB`（必须一字不差）
- Database: 选择刚才的 `instant-blob-db`

保存。

3. 重新部署 worker，让它拿到这个绑定。大包传输变量通常留空即可。

4. 回到 SullyOS → Instant Push 配置，点“检测连接”。检测到 D1 后，再打开 D1 envelope 开关。

表不用手动建，Worker 首次用到 D1 时会自动 `CREATE TABLE IF NOT EXISTS`。过期数据也不用强制配 cron，Worker 会在有请求经过时每隔一段时间顺手清掉已过期的数据。

低流量部署如果想更准时清理，可以额外加 cron：

Worker → `Triggers` → `Cron Triggers` → `Add`，填：

```text
*/15 * * * *
```

#### 命令行方式（如果装了 wrangler）

```bash
wrangler d1 create instant-blob-db
```

然后把输出的 `database_id` 填进 `worker/instant-push/wrangler.toml` 里那段被注释的 `[[d1_databases]]`，并取消注释 `[[d1_databases]]`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "instant-blob-db"
database_id = "REPLACE_WITH_YOUR_D1_ID"
```

`[triggers]` cron 可选；不配也能跑，自动清理会在请求经过时触发。

最后重新部署：

```bash
wrangler deploy
```

## 4. 小红书 / Notion 工具调用状态提示

之前的问题：

- 角色调用小红书、Notion 等工具时，工具本身可能已经正常返回。
- 但用户回到 ChatApp 后，看不到任何提示，不知道角色是在查资料、写 Notion、继续回复，还是已经卡住。
- 用户也不知道此时能不能离开前端。

现在的处理：

- Instant tool runner 会广播 `instant-tool-status`。
- ChatApp 会在聊天流底部显示状态气泡。
- 状态会区分：
  - 正在读取小红书 / Notion / 飞书 / 网页 / 记忆
  - 工具完成，正在让角色继续回复
  - 正在等待角色回复推回
  - 失败，需要重新触发
- 状态会写入短期 localStorage，用户回到界面时还能看到最近的工具状态。

## 5. 发送后自动触发与手动 ⚡ 提示

本分支新增了可选的“发送后自动触发回复”开关。

- 默认关闭。
- 开启后，发送文本后会自动触发 Instant Push 回复。
- 关闭时，用户仍然可以手动点击 ⚡ 触发回复。

之前的问题：

- 默认关闭自动触发时，点击 ⚡ 虽然会发送 instant 请求，但没有“发送准备中”的圆点提示。
- 用户很难判断是否已经触发成功、什么时候可以离开前端。

现在的处理：

- 手动点击 ⚡ 也会点亮发送准备中的三点。
- 这个三点只表示“前端正在拼接并 POST instant 请求”。
- POST 发出后会熄灭，表示请求已经交给 worker，可以安全离开。
- 目前为了不改太多 UI，只做了一个临时位置调整，让三点更靠近输入框。位置还不算完美，但不会再完全没反馈。

## 输出质量与上下文一致性

ChatApp 的 instant prompt 构建已经和本地本体对齐：

- 顺序一致。
- system prompt 内容一致。
- history messages 内容一致。
- 情绪评估看到的材料也与主消息材料一致。

因此，输出质量不应该因为走本地模式或 instant 模式而出现系统性差异。

## 验证状态

- ChatApp instant 主回复链路已验证。
- 情绪 buff instant 回传已验证。
- 小红书 / Notion 工具调用与续跑状态提示已验证。
- 大包场景默认走 multipart；启用 D1 BlobStore 后可用 envelope 路径承接更稳的大 payload。
- 本地构建已通过：`npm run build`。
