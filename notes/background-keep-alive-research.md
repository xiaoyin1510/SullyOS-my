# 后台保活方案调研

> 问题：用户在等待 AI 聊天回复时，离开页面（切换标签页/最小化/切到其他 App）会导致请求中断或页面被回收，丢失回复。

## 当前项目现状

| 项目 | 情况 |
|---|---|
| 框架 | React 18 + Vite 5 |
| 平台 | Web + Android（Capacitor 6） |
| 聊天 API | `safeFetchJson` → OpenAI 兼容 `/chat/completions`，**非流式**（`stream: false`） |
| 现有 Worker | `worker/index.js`（Cloudflare Worker，做 API 代理/搜索/小红书桥接） |
| Service Worker | **无** |
| 后台处理 | **无** |

**关键特征**：每次聊天请求是一个普通的 `fetch` POST，等待完整 JSON 返回。耗时可能几秒到几十秒。非流式意味着我们只需要保证这个 fetch 能完成即可，不需要维持长连接。

---

## 方案一览

### 1. Service Worker + Background Fetch/Sync ⭐ 推荐 Web 端方案

**原理**：注册一个 Service Worker，将聊天请求委托给 SW 处理。SW 在独立线程运行，不受页面可见性影响。即使用户切走标签页，SW 仍可完成 fetch 并缓存结果到 IndexedDB/Cache API。用户回来时直接读取。

**实现思路**：
```
页面发送消息 → postMessage 给 SW → SW 发起 fetch →
→ 结果存入 IndexedDB → 页面回来时读取
```

**细分 API**：
- **Background Sync API**：页面注册 sync 事件，SW 在网络恢复时执行。适合离线场景，但我们的场景更适合直接在 SW 里 fetch。
- **Background Fetch API**：适合大文件下载，有进度条 UI。对聊天 JSON 来说杀鸡用牛刀。
- **直接在 SW 里 fetch**：最简单直接，SW 收到 message 后直接 fetch，完成后 postMessage 回页面或存 IndexedDB。

**优点**：
- Web 通用，不依赖原生
- 实现相对简单（项目目前没有 SW，需要新增）
- 完美适配非流式请求
- 可以复用 safeApi.ts 的重试逻辑

**缺点**：
- 浏览器可能在极端低内存时杀掉 SW（但通常 30 秒内的请求没问题）
- iOS Safari 对 SW 支持有限（后台 3 秒左右可能被杀）
- 需要 HTTPS（Capacitor 的 `androidScheme: "https"` 已满足）

**兼容性**：Chrome/Edge/Firefox 全支持，Safari 支持基本 SW 但后台行为受限。

---

### 2. Capacitor 原生后台插件 ⭐ 推荐 Android 端方案

**2a. Android Foreground Service（最可靠）**

使用 `@capawesome-team/capacitor-android-foreground-service`，启动一个前台服务+持久通知。Android 不会杀有前台服务的进程。

```
用户发消息 → 启动前台通知 "正在思考中..." → fetch 完成 → 关闭通知
```

**优点**：Android 上最可靠，系统不会杀进程，可以无限后台运行
**缺点**：需要显示通知栏通知，仅 Android

**2b. @capacitor/background-runner（官方插件）**

**优点**：官方维护
**缺点**：最小间隔 15 分钟，每次只有 30 秒执行时间，不适合即时聊天场景

**2c. capacitor-persistent-notification**

类似前台服务方案，JS 层写后台逻辑。仅 Android。

**推荐**：2a（前台服务）最适合本项目。

---

### 3. Page Visibility API + fetch keepalive

**原理**：监听 `visibilitychange`，当页面进入后台时，用 `fetch(url, { keepalive: true })` 或 `navigator.sendBeacon()` 发送请求。`keepalive: true` 告诉浏览器即使页面关闭也要完成请求。

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // 如果有进行中的请求，标记需要 keepalive
    // 新请求使用 keepalive: true
  }
});
```

**优点**：
- 零依赖，几行代码搞定
- 不需要 SW
- `keepalive: true` 确保 fetch 在页面卸载后仍能完成

**缺点**：
- `keepalive` 请求体上限 64KB（我们的聊天 payload 可能超过，因为带大量历史消息）
- 只能保证请求**发出**，但如果页面被回收了，response 也接收不到
- 不能处理"请求已发出，等待回复"的情况
- 结果接收是个问题——页面被杀后回来怎么拿到结果？

**评估**：作为辅助手段可以，但单独使用不够。

---

### 4. Web Lock API

**原理**：持有 Web Lock 的页面，浏览器会**尽量**不回收。

```js
navigator.locks.request('chat-in-progress', async () => {
  // 在这里做 fetch，持有锁期间浏览器不太会冻结页面
  const result = await fetch(...)
});
```

**优点**：一行代码
**缺点**：
- W3C 规范明确说浏览器**可以**释放后台页面的锁，这只是个"建议"不是保证
- 实际测试中 Chrome 确实会更晚冻结持锁页面，但不是 100% 可靠
- Safari 不支持
- 不解决"页面被回收后结果去哪"的问题

**评估**：锦上添花，不能作为主方案。

---

### 5. WebSocket 保持连接

**原理**：浏览器对有活跃 WebSocket 连接的标签页不做节流。可以用 WebSocket 替代 HTTP fetch 来发送聊天请求。

**优点**：
- Chrome 明确不节流有 WebSocket 的页面
- 可以顺便支持流式响应
- 实时性好

**缺点**：
- 需要后端支持 WebSocket（当前用的是 OpenAI 兼容 API，不走 WS）
- 架构改动大
- 中间代理（Cloudflare Worker）也要改
- 不解决 iOS 后台挂起的问题

**评估**：如果未来要做流式输出，可以考虑。当前改动太大。

---

### 6. 静音音频播放（Hack）

**原理**：播放一段无声音频，浏览器认为页面在播放媒体，不会节流。

```js
const audio = new Audio('data:audio/wav;base64,...'); // 极短无声音频
audio.loop = true;
audio.volume = 0.01;
audio.play();
```

**优点**：简单粗暴，大多数浏览器有效
**缺点**：
- Hack，不是正规做法
- 可能被未来浏览器更新封杀
- 移动端可能有电量影响
- 状态栏会显示音频播放图标

**评估**：紧急方案/兜底方案，不推荐长期使用。

---

### 7. SharedWorker

**原理**：SharedWorker 可被多个标签页共享，只要有一个标签页存活，Worker 就不会被杀。在 SW 里管理聊天请求。

**优点**：不依赖页面生命周期
**缺点**：Safari 不支持（2023 年开始支持了，但 iOS Safari 仍不支持），Android WebView 不支持

**评估**：对 Capacitor 应用不实用。

---

## 方案对比矩阵

| 方案 | 可靠性 | 改动量 | Web 兼容 | Android | iOS | 推荐度 |
|---|---|---|---|---|---|---|
| **Service Worker** | ★★★★ | 中 | ✅ | ✅ | ⚠️ 受限 | ⭐⭐⭐⭐⭐ |
| **Android 前台服务** | ★★★★★ | 中 | ❌ | ✅ | ❌ | ⭐⭐⭐⭐⭐ (Android) |
| **Visibility + keepalive** | ★★ | 小 | ✅ | ✅ | ✅ | ⭐⭐⭐ |
| **Web Lock** | ★★ | 极小 | ✅ | ✅ | ❌ | ⭐⭐ |
| **WebSocket** | ★★★★ | 大 | ✅ | ✅ | ⚠️ | ⭐⭐ |
| **静音音频** | ★★★ | 极小 | ✅ | ✅ | ✅ | ⭐⭐ |
| **SharedWorker** | ★★★ | 中 | ⚠️ | ❌ | ❌ | ⭐ |

---

## 推荐实施方案

### 第一阶段：快速见效（1-2 小时）

**Visibility API + Web Lock + keepalive 组合**

```typescript
// utils/backgroundKeepAlive.ts

let chatLock: Promise<void> | null = null;

export function withKeepAlive<T>(fetchFn: () => Promise<T>): Promise<T> {
  // 1. 请求 Web Lock（如果可用）
  if ('locks' in navigator) {
    chatLock = navigator.locks.request('ai-chat', { mode: 'exclusive' }, async () => {
      // 锁会持续到 fetch 完成
      await fetchFn();
    });
  }

  // 2. 监听页面隐藏
  const onHide = () => {
    // 页面进入后台时的处理逻辑
    console.log('[KeepAlive] 页面进入后台，请求继续中...');
  };
  document.addEventListener('visibilitychange', onHide);

  return fetchFn().finally(() => {
    document.removeEventListener('visibilitychange', onHide);
    chatLock = null;
  });
}
```

### 第二阶段：Service Worker 方案（半天-1天）

1. 新建 `public/chat-sw.js` — 聊天专用 Service Worker
2. 在 `useChatAI.ts` 中注册 SW
3. 聊天请求通过 `postMessage` 委托给 SW
4. SW 完成 fetch 后将结果存入 IndexedDB
5. 页面恢复后从 IndexedDB 读取结果

```
[页面] --postMessage--> [SW] --fetch--> [API]
                         |
                    [IndexedDB]  <-- 结果缓存
                         |
[页面恢复] --读取--> [IndexedDB]
```

### 第三阶段：Android 原生加持（可选）

1. 安装 `@capawesome-team/capacitor-android-foreground-service`
2. 聊天请求发起时启动前台服务
3. 请求完成后关闭前台服务
4. 通知栏显示 "AI 思考中..."

---

## iOS 特殊说明

iOS 是最难处理的平台。Safari 和 iOS WebView 在进入后台 ~3 秒后会冻结所有 JS 执行和网络请求。目前没有完美的纯前端方案。可选：

1. **Push Notification**：后端处理完后推送通知，用户点通知回到 App
2. **Background URL Session**（需要 Capacitor 原生插件，类似 iOS NSURLSession 后台模式）
3. **接受限制**：在 UI 上提示用户"请勿离开页面"，并在回来时自动重试

---

## 结论

**最实际的路径**：

1. **立刻做**：Visibility API + Web Lock 组合（几行代码，立刻有改善）
2. **短期做**：Service Worker 方案（Web + Android 都能受益）
3. **按需做**：Android 前台服务（Capacitor 原生，最可靠）
4. **长期考虑**：Push Notification（解决 iOS 问题）

---

## 参考资料

- [Background Synchronization API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [Background Fetch API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Background_Fetch_API)
- [Page Visibility API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Web Locks API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Inactive Tab Throttling in Browsers](https://aboutfrontend.blog/tab-throttling-in-browsers/)
- [Capacitor Background Runner](https://capacitorjs.com/docs/apis/background-runner)
- [Android Foreground Service Plugin](https://capawesome.io/plugins/android-foreground-service/)
- [@capawesome/capacitor-background-task](https://github.com/capawesome-team/capacitor-background-task)
- [Periodic Background Sync - web.dev](https://web.dev/patterns/web-apps/periodic-background-sync)
- [Offline and background operation - MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
