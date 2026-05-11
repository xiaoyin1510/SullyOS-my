# 主动消息 Push 加速器 · 部署剧本（全按按钮版）

**作用**：给主动消息 1.0 提供"到点喊醒浏览器"的能力。cron 每分钟扫 D1，
对心跳活着的订阅发 wake push。AI 生成全在浏览器本地跑，Worker 看不到
任何聊天内容。

**费用**：Cloudflare 全程免费档，30 分钟主动消息随便用。

**文件说明**：
- `worker.bundle.js` — **要复制粘贴到 CF 面板的 Worker 代码**（单文件，零依赖）
- `vapid-gen.html` — 本地打开就能生成 VAPID 密钥对（**你要打开**）
- `src/` — Worker TypeScript 源码（开发用，你用不到）
- `schema.sql` — D1 建表 SQL（你要复制到 CF 面板执行）
- `wrangler.toml` — 旧 CLI 方式的配置文件（你不用管，备着以后开发参考）

---

## 阶段 1 · 拿到 VAPID 密钥对

1. 双击打开 `worker/proactive-push/vapid-gen.html`（任何浏览器都行）
2. 点 **"生成一对新密钥"** 按钮
3. 看到 **Public Key** 和 **Private Key**，两个都点 **复制** 存到记事本

> 全程在浏览器本地跑，不上传任何服务器。生成一次长期复用。

---

## 阶段 2 · CF 面板 · 建一个空 Worker

1. 打开 https://dash.cloudflare.com → 左边栏 **Workers & Pages** →
   **Create**（或 **Create application**）
2. 顶上切到 **Create Worker** 标签
3. Worker name 填 `proactive-push`（也可以改别的），点 **Deploy**
4. 部署完跳出来一个"你的 Worker 已启动"页面，点 **Edit code**
5. 进到编辑器，把左边默认的 `worker.js` 里所有代码**全选删掉**
6. 打开 `worker/proactive-push/dist/worker.js`，**全选复制粘贴**到编辑器
7. 右上角点 **Deploy**（蓝色按钮）
8. 回到 Worker 详情页，记下它的 URL，形如
   `https://proactive-push.你的子域.workers.dev`。抄到记事本。

---

## 阶段 3 · CF 面板 · 建 D1 数据库

1. 左边栏 **Workers & Pages** → **D1**（在下拉或 Storage & Databases 里）
2. 点 **Create database**
3. Name 填 `proactive-db`，点 **Create**
4. 进到数据库详情页，左边切到 **Console** 标签
5. 打开 `worker/proactive-push/schema.sql`，**全选复制粘贴**到 Console
6. 点 **Execute**，应看到 "Successful" 之类的 OK 提示

---

## 阶段 4 · CF 面板 · 把 D1 绑定到 Worker

1. 回到 **Workers & Pages** → 点你刚建的 `proactive-push`
2. 顶上切到 **Settings** 标签
3. 找到 **Variables and Secrets** 或 **Bindings**（CF 界面名字偶尔变）
4. 滚动到 **D1 database bindings**，点 **Add binding**
5. **Variable name** 填 **`DB`**（就是两个字母大写，和代码里一致）
6. **D1 database** 下拉选刚建的 `proactive-db`
7. 点 **Save** 或 **Deploy**

---

## 阶段 5 · CF 面板 · 填密钥和配置

回到 Worker 的 **Settings → Variables and Secrets**。

需要加 **5 个变量**，每个都点 **Add variable** 或 **+**：

| 名字 | 类型 | 值 |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Secret | 阶段 1 的 Public Key |
| `VAPID_PRIVATE_KEY` | Secret | 阶段 1 的 Private Key |
| `VAPID_SUBJECT` | Text | `mailto:你的邮箱@xxx.com` |
| `CLIENT_TOKEN` | Secret | 随便一串长字符串（建议 32 字符以上随机） |
| `HEARTBEAT_WINDOW_MS` | Text | `300000`（5 分钟，可选；不填默认也是 5 分钟） |

**Text 和 Secret 的区别**：
- Secret 之后就看不到原值了（安全）
- Text 之后可以看到可以改
- 私钥类的必须用 Secret

填完每一项记得点 **Save**。全部填完后点页面底部的 **Deploy** 重新发布。

---

## 阶段 6 · CF 面板 · 加 cron 定时

1. Worker 详情页 → **Triggers** 标签（或 **Settings → Triggers**）
2. 找到 **Cron Triggers**，点 **Add Cron Trigger**
3. 在 **Cron expression** 里填 `* * * * *`（每分钟一次）
4. 点 **Add trigger** 或 **Save**

---

## 阶段 7 · 测一下

在你的手机或电脑浏览器打开：

```
https://proactive-push.你的子域.workers.dev/health
```

应该看到：

```json
{"ok":true}
```

看到就对了 ✓

---

## 阶段 8 · 告诉我这两个值

把下面两个发我：

1. **Worker URL**（阶段 2 第 8 步记下的那个）
2. **阶段 1 的 Public Key**（不是 Private！）
3. **阶段 5 填的 `CLIENT_TOKEN`**

我会把它们填到前端源码 `utils/proactivePushConfig.ts` 的常量里并提交。
你重新 build 前端后，设置里会出现"主动消息 Push 加速"section，打开
开关即可。

---

## 验证（可选）

部署完之后，想看到底工作不工作：

1. app 里给任意角色开主动消息（任意 30 分钟倍数的间隔）
2. 回到 CF 面板的 Worker 详情页，点 **Logs** 标签 → **Begin log stream**
3. 到点时应看到类似：
   ```
   [cron] fired=1 dropped=0
   ```

---

## 常见问题

**Q：Worker 代码改了怎么重新部署？**

A：进 Worker 详情页 → **Edit code** → 贴新代码 → **Deploy**。
D1 绑定、secret、cron 都保留。

**Q：免费额度够吗？**

A：30 分钟主动消息每人每天约 768 次请求（48 次 wake + 720 次心跳），
免费档 10 万/天够 130+ 人。D1 读 500 万/天更宽松。

**Q：iOS 用户收不到？**

A：iOS Safari 16.4+ 必须先"添加到主屏"把网站装成 PWA 才能收 push。
普通 Safari 标签页收不到。这是 Apple 的限制不是我们能改的。

**Q：想停掉 push 加速？**

A：前端 app 设置里关掉开关就行——不需要动 Worker。或者在 CF 面板
把 Cron Trigger 删掉，所有人的 push 都停发。

**Q：怎么彻底删掉？**

A：CF 面板 → Worker 详情 → Manage → Delete。D1 同样在 D1 列表里
右键删除。
