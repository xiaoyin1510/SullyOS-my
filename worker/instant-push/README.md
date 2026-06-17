# instant-push Worker

基于 `@rei-standard/amsg-instant` 的自部署 Cloudflare Worker。
收到前端的 POST 请求后，调用你自己的 OpenAI 兼容 LLM，把回复分句后逐条发成 Web Push 通知。
默认零数据库、零 cron；大包默认走 `_multipart` 分片传输。想要更稳的大对象传输时，可以额外启用 D1 BlobStore，Worker 会自动建表并顺手清理过期数据。

> **改这里的 `sse: { backupPush: 'on' }` 配置或前端 catch 逻辑前**，先读 [`docs/instant-push-dual-channel.md`](../../docs/instant-push-dual-channel.md)。SSE 跟 Web Push 是并发双通道、SW 端按 messageId 去重 —— 这是个**结构性契约**，破了就会重现 iOS PWA「报错但收到消息」的 bug。`backupPush='on'` 在 amsg-instant 0.9+ 是强制的，库会直接拒绝其他值。

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/index.ts` | Worker 源码入口（极薄封装，平台无关） |
| `src/deno.ts` | Deno Deploy 入口：`Deno.serve` 包装 + env 读取 + 平台边界注释 |
| `wrangler.toml` | CF Worker 部署配置 |
| `package.json` | 子目录依赖声明 —— CF Workers Builds 用它跑 `npm install + wrangler deploy` |
| `worker.bundle.js` | 已打包好的 CF Worker：复制到 CF 控制台直接部署 |
| `worker.deno.bundle.js` | 已打包好的 Deno 版。一般不直接贴它——App 内「复制 Deno Loader」给的 8 行 loader 会在冷启动时自动拉它的最新版 |

---

## 阶段 1：生成 VAPID 密钥对

打开 **SullyOS → 设置 → Instant Push → 配置**，点"生成新密钥对"按钮。

- 页面上会显示公钥（自动填入表单）和**一次性显示的私钥**
- **立即复制私钥**，关闭弹窗后私钥消失，不可恢复
- 公钥会自动填进表单，等下第 3 步一起贴进 CF 后台

---

## 阶段 2：部署 Worker

### 方式 A：Deno Deploy Playground（推荐，自动追新）

全程手机浏览器可完成，且部署一次后**永久自动追新**——loader 在每次冷启动时
自动拉取站点发布的最新 worker 代码，上游更新后只需进 Playground 重新部署一次
（保存即可），不用再搬代码。

1. 打开 **SullyOS → 设置 → Instant 消息设置**，点「复制 Deno Loader」（仅 8 行）
2. 访问 [app.deno.com](https://app.deno.com)（注意是新版控制台；旧版 dash.deno.com 将于 2026-07 停服），New Playground，粘贴 loader，部署
3. 在 Playground 的环境变量里填入阶段 1 的 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
   （可选项见阶段 3 的表格，含义与 CF 一致）
4. 记录 Worker 地址：`https://<项目名>.<你的账号>.deno.net`

> Deno 路线不支持 D1 BlobStore（`/capabilities` 会如实报告），大包自动走默认的
> multipart 分片，无需任何额外配置。
>
> 平台边界一句话版：客户端断开（杀 App）后实例还能存活约 20-30 秒，与 CF 的
> 30 秒宽限同量级——「发完消息立刻杀 App + LLM 超过半分钟才回完」的极端组合
> 在两个平台上都可能丢当条回复，重发即可。

### 方式 B：Cloudflare · 用 Git URL 克隆

1. 访问 [dash.cloudflare.com](https://dash.cloudflare.com/) → Workers & Pages → Create → Worker
2. 选择 **Clone a public repository via Git URL**
3. Git repository URL 填：
   ```
   https://github.com/qegj567-cloud/SullyOS/tree/master/worker/instant-push
   ```
   （URL 末尾的 `worker/instant-push` 子目录路径必须保留，CF 才知道用哪一份 wrangler.toml）
4. CF 会自动 `npm install` + `wrangler deploy`，部署成功后记录 Worker 地址：
   `https://instant-push.<你的账号>.workers.dev`
5. ~~之后只要上游仓库 push 新版，CF Workers Builds 会自动重新部署，**不用再手动同步**~~

> 🚧 **【存疑 · 待核实，2026-05-26】** 上面第 5 条原先承诺「上游更新会自动同步」，
> 目前看来**很可能不成立**，先标注出来、不急着拍板：
> CF 的「Clone a public repository via Git URL」实测更像是**把公开仓库一次性导入到你自己的
> GitHub 账号下、生成一份独立副本**，之后 Workers Builds 监听的是**你那份副本**，而不是上游
> `qegj567-cloud/SullyOS`。果真如此的话，我们这边更新了 worker，你那份副本不会自动跟上，
> 需要你手动同步（或重新克隆）才能拿到最新代码。
>
> 我们正在确认 CF 的确切行为，并准备一份**图文部署教程**替代旧视频。在结论出来前，
> 想吃到最新 worker 代码，最稳的是用下面的「备用方案」重贴一次 `worker.bundle.js`。
> 另外，后端更新时我们会在 App 内**弹窗提醒**已启用 Instant Push 的用户来更新。

### 方式 C：Cloudflare · 复制 `worker.bundle.js`

CF 后台连不上 GitHub、或者你 fork 了私有副本不想接 OAuth 时用这条路：

1. 同样在 CF 后台 Create → Worker，给 Worker 起名（如 `instant-push`），点 Deploy 先建一个空 Worker
2. 进入 Worker 详情页 → **Edit code**（在线编辑器）
3. 把 `worker/instant-push/worker.bundle.js` 的全部内容粘贴进去，覆盖原有代码
4. 点 **Deploy** 完成部署
5. 同样记录 Worker 地址

> ⚠️ 备用方案部署的是 commit 时的 bundle 快照，要拿最新代码就得重新粘贴一次。
> （主方案是否真能「自动跟最新」见上面阶段 2 第 5 条的存疑说明，结论未定前别太当真。）

---

## 阶段 3：配置环境变量

Deno：Playground 设置里的环境变量面板；CF：Worker 详情页 → **Settings → Variables and Secrets**。依次添加：

### 必填（2 个）

| 变量名 | 来源 |
|--------|------|
| `VAPID_PUBLIC_KEY` | 阶段 1 生成的公钥 |
| `VAPID_PRIVATE_KEY` | 阶段 1 生成的私钥（类型选 **Secret**） |

### 可选

| 变量名 | 说明 |
|--------|------|
| `VAPID_EMAIL` | 留空则默认 `mailto:noreply@example.com`，填什么都行 |
| `AMSG_CLIENT_TOKEN` | 防止别人扫到你的 Worker URL 滥用 CF 配额；前端填相同的值 |
| `AMSG_OVERSIZE_TRANSPORT` | 高级兜底项。通常留空，由前台连接测试后的开关决定；填 `d1` 可让旧前端默认用 D1 |

配置完重新 Deploy 一次让 secrets 生效。

### 可选：启用 D1 BlobStore

默认不需要 D1。超出 Web Push 单包安全线的内容会被 `amsg-instant` 拆成 `_multipart` 分片，由 `amsg-sw` 在浏览器 Service Worker 里收齐后还原。

如果你愿意多部署一个 D1，想让大对象走更稳的“短 push + HTTP 拉完整包”路径：

1. 创建 D1 数据库：
   ```bash
   wrangler d1 create instant-blob-db
   ```
2. 在 `wrangler.toml` 里取消注释 `[[d1_databases]]`，填入 `database_id`。
3. 重新部署。
4. 回到 SullyOS → Instant Push 配置，点“检测连接”。检测到 D1 后，前台才会允许打开 D1 envelope。

表结构会由 Worker 首次请求自动初始化，过期 blob row 也会由 Worker 定期顺手清理。

取舍很简单：`multipart` 少部署、无服务端暂存；D1 更稳，但多一个数据库。低流量场景下自动清理只会在有请求经过时触发；想更准时清理的话，可以额外打开 `wrangler.toml` 里注释掉的 cron。

---

## 阶段 4：测试

回到 **SullyOS → 设置 → Instant Push → 配置**：

1. 填入 Worker URL（阶段 2 末尾记录的地址）
2. 确认公钥已自动填入
3. 如果配了 `AMSG_CLIENT_TOKEN`，在"Client Token"字段填入相同的值
4. 点**发送测试推送** —— 浏览器会先申请通知权限，然后调用你的 LLM 生成一句话推送过来
5. 系统通知里收到消息 = 链路全通

---

## 常见问题

**Q：手机上收不到推送？**
iOS 要求把 SullyOS 以 PWA 方式安装到主屏幕才能收 Web Push；Safari 浏览器内的标签页不支持。
安卓国行手机若无 Google 服务（GMS），Web Push 通道不通，换 Chrome 桌面版测试确认链路，App 内通知走 Capacitor 本地通知不受影响。

**Q：想暂停推送怎么办？**
最简单的是前端关掉 Instant Push 开关（两个平台通用）。
CF 还可以在后台把 Worker 暂停（Pause），前端数据不丢，重新启用后恢复正常。

**Q：怎么彻底删除？**
Deno：app.deno.com 里删除该 Playground 应用；
CF：后台 → Workers & Pages → 找到该 Worker → Settings → Delete。
前端在 SullyOS → 设置 → Instant Push 关掉开关即可停止发起请求。

**Q：LLM 调用费用谁出？**
你自己在前端配置的 Chat API（apiKey）—— Worker 用你传进来的 key 和 apiUrl 调 LLM，Worker 本身不持有任何 key。

**Q：CF 的 Git 克隆构建失败、提示找不到依赖？**
检查 Git URL 末尾是否带上了 `tree/master/worker/instant-push` 子目录路径。CF 必须看到子目录里的 `package.json` 和 `wrangler.toml` 才能构建。
