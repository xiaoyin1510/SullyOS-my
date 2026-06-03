/**
 * Shared Web Push subscribe helpers used by both Instant Push and Proactive
 * Push paths. Both flows hit the same browser race / encoding quirks; this
 * file is the single source of truth so a future browser-quirk patch lands
 * in one place instead of two.
 */

// unsubscribe() resolve 后 Chromium 内部 PushMessagingAppIdentifier 把当前
// 订阅标成 removed-sentinel; 这段时间里紧接着的 subscribe() 会直接吐
// `permanently-removed.invalid` 哨兵, 而不是去 FCM 拿新端点. 等一会再试就好.
// 桌面 Chrome ~ 300ms 够, 移动端 / iOS PWA 给 800ms 起步, 失败再线性退避.
export const SUBSCRIBE_SETTLE_MS = 800;
/** 总尝试次数 (含首次), 不是"重试次数". 当前: 1 次首试 + 2 次重试 = 3 次. */
export const SUBSCRIBE_ATTEMPTS_MAX = 3;

/** Convert base64url string to Uint8Array<ArrayBuffer> (for VAPID applicationServerKey). */
export function b64uToBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob(padded);
  // 显式拿 ArrayBuffer 而不是默认 ArrayBufferLike, 否则 PushManager.subscribe 在
  // 严格 TS lib (ArrayBufferView<ArrayBuffer>) 下会判 SharedArrayBuffer 不兼容.
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * True if a subscription's endpoint is a Chrome-internal "permanently
 * removed" sentinel.  Browsers occasionally revoke subscriptions due to
 * long inactivity, abuse signals, or the site being visited too rarely;
 * `getSubscription()` then returns an object whose endpoint URL is
 * `https://permanently-removed.invalid/...`.  `.invalid` is an RFC 2606
 * reserved TLD that never resolves, so any push send would fail with a
 * generic upstream error (which Cloudflare Workers wraps as HTTP 530).
 */
export function isDeadPushEndpoint(endpoint: string | null | undefined): boolean {
  if (!endpoint) return false;
  return endpoint.includes('permanently-removed.invalid');
}

/**
 * Translate the browser's raw subscribe() rejection into a Chinese,
 * end-user-actionable hint.  The common cases on Android phones without
 * Google Play Services (or in third-party Chromium-based browsers that
 * advertise `PushManager` but route through FCM internally) are
 * `AbortError` / generic network errors when the FCM endpoint cannot be
 * reached.  We surface those distinctly so the user knows it's not a
 * permission issue.
 */
export function explainSubscribeError(e: unknown): string {
  const err = e as { name?: string; message?: string } | null;
  const name = err?.name || '';
  const msg = err?.message || String(e || '未知错误');
  if (name === 'NotAllowedError') {
    return '浏览器拒绝创建订阅（NotAllowedError）——通常是站点权限被拦截或处于隐身模式';
  }
  if (name === 'NotSupportedError') {
    return '当前浏览器不支持网页推送——常见于没装谷歌服务的国行安卓手机（小米/华为/OPPO/vivo 大多默认就没有），或者手机自带的精简浏览器。换 Chrome / Edge / Firefox 桌面版试试';
  }
  if (name === 'AbortError' || /push service|FCM|network/i.test(msg)) {
    return '连不上推送服务器——这台设备的网页推送链路走不通。最常见两种情况：1) 国行安卓手机没装谷歌服务（小米/华为/OPPO/vivo 默认就没有），系统层面就推不了；2) 当前网络挡住了谷歌的推送服务器。建议：换台装了谷歌服务的设备，或者用电脑上的 Chrome / Edge / Firefox 试试';
  }
  if (name === 'InvalidStateError') {
    return '订阅状态冲突（InvalidStateError）——可能旧订阅没清干净，刷新页面或再点一次"重置订阅"';
  }
  return `订阅创建失败（${name || 'Error'}：${msg}）`;
}

/**
 * Subscribe with retry on zombie sentinel.  Wait between attempts is linear:
 * 800ms before attempt #2, 1600ms before attempt #3.  No wait before the
 * first attempt — caller is responsible for any required settle delay after
 * its own unsubscribe().
 */
export async function subscribeWithRetry(
  reg: ServiceWorkerRegistration,
  vapidPublicKey: string,
  logPrefix: string,
): Promise<{ sub: PushSubscription | null; reason?: string }> {
  for (let attempt = 0; attempt < SUBSCRIBE_ATTEMPTS_MAX; attempt++) {
    let sub: PushSubscription;
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToBytes(vapidPublicKey),
      });
    } catch (e) {
      console.warn(`${logPrefix} pushManager.subscribe failed`, e);
      return { sub: null, reason: explainSubscribeError(e) };
    }
    if (!isDeadPushEndpoint(sub.endpoint)) return { sub };
    try { await sub.unsubscribe(); } catch (e) {
      // 如果连 unsubscribe 都抛, 下一次 subscribe() 大概率还是同一个 zombie,
      // 但仍然兜底重试 (重试上限挡着不会死循环).
      console.warn(`${logPrefix} unsubscribe of zombie endpoint threw`, e);
    }
    const isLast = attempt === SUBSCRIBE_ATTEMPTS_MAX - 1;
    if (!isLast) {
      const wait = SUBSCRIBE_SETTLE_MS * (attempt + 1);
      console.warn(`${logPrefix} subscribe() returned zombie endpoint; retry #${attempt + 1} after ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return {
    sub: null,
    reason: `浏览器持续返回 permanently-removed.invalid（已尝试 ${SUBSCRIBE_ATTEMPTS_MAX} 次）— 可能是由于站点参与度 (Site Engagement) 过低或浏览器内部数据残留导致。请尝试清理站点数据后重试，或更换设备/浏览器`,
  };
}
