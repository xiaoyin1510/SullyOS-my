# 彼方邮局 · 互动功能接入交接（给 UI）

后端（`worker/post-office/`）和客户端 API（`utils/vrWorld/postOffice.ts`）已补齐**点赞 / 点踩(=举报) /
浏览量 / 身份导出导入**。后端已离线 e2e 跑通（23/23）。UI 这层在 `apps/VRWorldApp.tsx` 的邮局房间接入即可，
**不用读 worker 源码**，照着下面调 `PostOffice` 的方法就行。

## 一、抽到的信现在带热度字段

`PostOffice.fetchInbox()` 返回的 `RemoteLetter` 多了几个字段：

```ts
interface RemoteLetter {
  id: string; pen: string; content: string; created_at: number;
  likes?: number;        // 点赞数
  dislikes?: number;     // 点踩(=举报)数
  views?: number;        // 被抽到/浏览次数（抽到这封信时后端已 +1）
  reply_count?: number;  // 已被回信数
}
```

> 约定：**赞、踩都公开显示**（👍 数 + 👎 数），👁 浏览量也显示。👎 同时就是举报——
> 一封信被 **5 个不同设备**点踩会被后端**自动删除**（不可恢复）。UI 上 👎 按钮建议给个二次确认或说明文案，
> 让用户知道「踩 = 举报，会推动删除」。

本地 `VRLetter` 也加了缓存字段 `likes / dislikes / views / myVote`（`types.ts`），
存「我对这封 inbox 信的投票」用，方便高亮按钮状态。

## 二、投票

```ts
// vote: 1 点赞 / -1 点踩(=举报) / 0 撤销
const r = await PostOffice.vote(letterId, 1);
// r = { likes, dislikes, deleted? }
if (r.deleted) {
  // 这封信已被删（要么刚被你这一踩凑满阈值，要么早已被删）→ 从列表移除
} else {
  // 用 r.likes / r.dislikes 更新该卡片的计数；本地 myVote 记成刚投的值
}
```

一台设备对一封信**只能一票**，可改可撤（再投相同值不叠加，投 0 撤销）。后端按 `owner_id` 去重。

## 三、作者看自己信的热度

`fetchReplies()` 现在除了回复，还顺带返回我寄出的每封信的统计，可用新方法单独取：

```ts
const stats = await PostOffice.fetchMyStats();
// RemoteLetterStat[] = [{ id, likes, dislikes, views, reply_count, created_at }]
```

可以在「我寄出的信」列表上展示赞/踩/浏览量/回信数。

## 四、身份导出 / 导入（邮局 ⚙ 设置里加两个按钮）

owner_id 是本地随机 UUID，清浏览器数据就没了。给用户一个「带走身份」的口子：

```ts
import { exportIdentity, importIdentity } from '@/utils/vrWorld/postOffice';

const code = exportIdentity();         // 形如 "sullypo.<uuid>.<校验位>"，给用户复制保存
const ok = importIdentity(userInput);  // 校验通过→替换本地 owner_id，返回 true/false
```

导入成功后，换设备/清数据也能找回「我寄出的信」和它们的责任归属。导入失败（格式/校验位不对）返回 `false`，给个错误提示即可。

## 五、不需要 UI、但要知道的后端行为

- **不按时间删信**：信只在 ①点踩满 5 ②管理员删 ③作者删（`release`）时消失。
- **正文上限 400 字**（按字符，1 汉字/标点=1 字）：客户端导出常量 `MAX_LETTER_CHARS`，输入框直接用它做限制+计数提示；超长后端会截断。
- **限流**：**投信每 IP 每 5 小时最多 5 条**；回信/投票每分钟限流。超了返回 429（`call` 会抛 `HTTP 429`）。UI 给「今天写得有点多，歇会儿再寄」之类提示即可。
- **管理员删信**是纯后端 API（`/admin/*` + token），不做前端，跟 UI 无关。

部署：后端是加性升级，对已部署实例 `wrangler deploy` 即可，老数据不丢；需先
`wrangler secret put ADMIN_TOKEN` 和 `wrangler secret put PO_IP_SALT`（详见 `worker/post-office/README.md`）。

## 六、⚠️ 已知待决定：批量寄信 vs 投信限流

**冲突**：
- 后端投信限流是「同 IP 每 5 小时 5 封」，**按实际条数计**（一次寄 N 封扣 N 封额度），超额**整批 429**。
- UI 的 `sendOutbox`（`apps/VRWorldApp.tsx`）把「待寄出」队列里所有 `queued` 信**一次性**上传。
- 所以队列攒到 6 封时点「一键寄出」→ `cost=6 > 5` → 整批失败，提示「寄出失败：rate limited」，6 封全留在队列，得手动删 1 封再寄。**体验糙。**

**当前状态**：保持「整批拒」行为，未做特殊处理（先记录，待决定）。

**候选方案**（择一再实现）：
1. **部分接受**（体验最好）：服务端按剩余额度寄，超出的留在队列并提示「达上限，还剩 N 封下次寄」。需改 worker 的 `/letters`（不整批拒，返回 accepted ids + skipped）+ 客户端 `sendOutbox`（按返回的 ids 只标记成功的那几封为 sent，其余留 queued）。
2. **整批拒 + 友好提示**（最简单）：仅把 `sendOutbox` 的 429 错误文案改成「每 5 小时最多寄 5 封，请先删减待寄信件」。
3. **调高额度匹配 UI**：把 `PO_RATE_LETTERS` 调高（如 20），放宽你定的「5 封」硬限。

> 决定后告诉我，我来实现对应改动。
