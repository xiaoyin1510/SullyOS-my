/**
 * Config + wire-up for the optional Cloudflare Worker that accelerates
 * Proactive Chat via Web Push.  All state lives in localStorage so the
 * Service Worker and the main thread can both read it synchronously.
 *
 * When disabled or misconfigured, every function becomes a no-op and the
 * existing local-timer path in proactiveChat.ts keeps working unchanged.
 *
 * Worker URL / VAPID public key / client token are baked in here as
 * constants — end users never see them.  After deploying the Worker via
 * the Cloudflare dashboard (see worker/proactive-push/README.md), fill
 * these three values and rebuild.  VAPID public keys are meant to be
 * public; the client token is weak "through obscurity" gating for a
 * personal-scale deployment.
 */

// ═══════════════════════════════════════════════════════════════════
//   FILL THESE IN AFTER DEPLOYING THE CLOUDFLARE WORKER
//   (all three are safe to ship in the client bundle)
// ═══════════════════════════════════════════════════════════════════
const WORKER_URL = 'https://noir2.cc.cd';
const VAPID_PUBLIC_KEY = 'BAKnuYYBsb6LXnpGApVCpMkumFqDLjZOSDmzjVPx32jIA5fbz-OWaRdk0RH8qftpVuNwzNO-l49CBEwieyezh0g';
const CLIENT_TOKEN = 'weqwqewqeqwdcsccagdgs32132';
// ═══════════════════════════════════════════════════════════════════

const ENABLED_STORAGE_KEY = 'proactive_push_enabled_v1';
const LAST_WAKE_AT_KEY = 'proactive_push_last_wake_at_v1';
const LAST_WAKE_CHAR_KEY = 'proactive_push_last_wake_char_v1';

export interface ProactivePushConfig {
  enabled: boolean;
  workerUrl: string;
  vapidPublicKey: string;
  clientToken: string;
}

export function loadPushConfig(): ProactivePushConfig {
  let enabled = false;
  try {
    enabled = localStorage.getItem(ENABLED_STORAGE_KEY) === 'true';
  } catch { /* ignore */ }
  return {
    enabled,
    workerUrl: WORKER_URL.trim().replace(/\/+$/, ''),
    vapidPublicKey: VAPID_PUBLIC_KEY.trim(),
    clientToken: CLIENT_TOKEN.trim(),
  };
}

/** Only the user-controlled enabled flag is persisted. URL/keys come from constants. */
export function savePushConfig(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch { /* ignore */ }
}

/** True if constants are filled AND the user toggle is on. */
export function isPushConfigReady(cfg: ProactivePushConfig = loadPushConfig()): boolean {
  return cfg.enabled
    && cfg.workerUrl.startsWith('https://')
    && cfg.vapidPublicKey.length > 80;
}

/** True if the deployment constants have been filled in (regardless of toggle). */
export function isPushConfigAvailable(): boolean {
  return WORKER_URL.startsWith('https://') && VAPID_PUBLIC_KEY.length > 80;
}

// ---------- Web Push subscription helpers ----------

/** Convert base64url string to Uint8Array (for VAPID applicationServerKey). */
function b64uToBytes(b64u: string): Uint8Array {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface SubscriptionInfo {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * True if a subscription's endpoint is a Chrome-internal "permanently
 * removed" sentinel.  Browsers occasionally revoke subscriptions due to
 * long inactivity, abuse signals, or the site being visited too rarely;
 * `getSubscription()` then returns an object whose endpoint URL is
 * `https://permanently-removed.invalid/...`.  `.invalid` is an RFC 2606
 * reserved TLD that never resolves, so any push send would fail with a
 * generic upstream error (which Cloudflare Workers wraps as HTTP 530).
 *
 * Detect this and treat the subscription as dead — unsubscribe + re-create.
 */
export function isDeadSubscriptionEndpoint(endpoint: string | null | undefined): boolean {
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
function explainSubscribeError(e: any): string {
  const name = e?.name || '';
  const msg = e?.message || String(e || '未知错误');
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
    return '订阅状态冲突（InvalidStateError）——可能旧订阅没清干净，再点一次"重置订阅"';
  }
  return `订阅创建失败（${name || 'Error'}：${msg}）`;
}

interface SubscribeAttempt {
  sub: SubscriptionInfo | null;
  reason?: string;
}

export async function getOrCreateSubscription(vapidPublicKey: string): Promise<SubscribeAttempt> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { sub: null, reason: '当前浏览器不支持 Service Worker 或 Push API' };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();

  if (sub) {
    // Drop the existing sub if it's been zombified by the browser
    // (`permanently-removed.invalid` endpoint) — those can never deliver.
    if (isDeadSubscriptionEndpoint(sub.endpoint)) {
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      sub = null;
    }
  }

  if (sub) {
    // If an old subscription exists with a different VAPID key, we'd get
    // errors on send — re-subscribe in that case.
    try {
      const existingKey = bytesToB64u(sub.options.applicationServerKey);
      if (existingKey && existingKey !== vapidPublicKey) {
        await sub.unsubscribe();
        sub = null;
      }
    } catch {
      // Fall through; try to reuse.
    }
  }

  if (!sub) {
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return { sub: null, reason: '通知权限未授予' };
    } else if (Notification.permission === 'denied') {
      return { sub: null, reason: '通知权限已被拒绝（请到浏览器站点设置里手动开启）' };
    }
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToBytes(vapidPublicKey),
      });
    } catch (e) {
      console.warn('[ProactivePush] pushManager.subscribe failed', e);
      return { sub: null, reason: explainSubscribeError(e) };
    }
  }

  // Final paranoia: subscribe() in some Chrome versions can also return a
  // dead sentinel.  Fail loudly rather than ship a useless endpoint to D1.
  if (isDeadSubscriptionEndpoint(sub.endpoint)) {
    console.warn('[ProactivePush] subscribe() returned a dead sentinel endpoint; giving up');
    try { await sub.unsubscribe(); } catch { /* ignore */ }
    return { sub: null, reason: '浏览器返回的订阅地址是 permanently-removed.invalid（zombie endpoint），无法投递' };
  }

  const p256dh = bytesToB64u(sub.getKey('p256dh'));
  const auth = bytesToB64u(sub.getKey('auth'));
  if (!p256dh || !auth) return { sub: null, reason: '订阅缺少加密公钥（p256dh / auth）' };
  return { sub: { endpoint: sub.endpoint, p256dh, auth } };
}

function buildHeaders(cfg: ProactivePushConfig): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.clientToken) headers['X-Client-Token'] = cfg.clientToken;
  return headers;
}

/**
 * Register or update a schedule on the Worker.  Returns true on success.
 * Failures are swallowed — the local-timer path still works regardless.
 */
export async function registerScheduleOnWorker(charId: string, intervalMs: number): Promise<boolean> {
  const cfg = loadPushConfig();
  if (!isPushConfigReady(cfg)) return false;

  const { sub } = await getOrCreateSubscription(cfg.vapidPublicKey);
  if (!sub) return false;

  try {
    const res = await fetch(`${cfg.workerUrl}/subscribe`, {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify({
        subscription: {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        charId,
        intervalMs,
      }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[ProactivePush] /subscribe failed', e);
    return false;
  }
}

export async function unregisterScheduleOnWorker(charId: string): Promise<boolean> {
  const cfg = loadPushConfig();
  if (!isPushConfigReady(cfg)) return false;

  const reg = await navigator.serviceWorker?.ready?.catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return false;

  try {
    const res = await fetch(`${cfg.workerUrl}/unsubscribe`, {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify({ endpoint: sub.endpoint, charId }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[ProactivePush] /unsubscribe failed', e);
    return false;
  }
}

async function sendHeartbeat(cfg: ProactivePushConfig): Promise<void> {
  const reg = await navigator.serviceWorker?.ready?.catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;

  try {
    await fetch(`${cfg.workerUrl}/heartbeat`, {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Heartbeat failures are expected occasionally (offline, Worker restart);
    // the Worker will simply stop firing after the window closes and pick
    // back up when the next successful heartbeat arrives.
  }
}

// ---------- Heartbeat timer (2-min cadence while any schedule is active) ----------

const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let visListener: (() => void) | null = null;

function shouldHeartbeat(): boolean {
  const cfg = loadPushConfig();
  if (!isPushConfigReady(cfg)) return false;
  // Only heartbeat while the tab is visible — the whole point is "app is alive".
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
  return true;
}

async function heartbeatTick() {
  if (!shouldHeartbeat()) return;
  const cfg = loadPushConfig();
  await sendHeartbeat(cfg);
}

export function startHeartbeat() {
  if (heartbeatTimer) return;
  const cfg = loadPushConfig();
  if (!isPushConfigReady(cfg)) return;

  // Fire one immediately so the Worker knows we're alive right now.
  void heartbeatTick();
  heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS);

  if (typeof document !== 'undefined' && !visListener) {
    visListener = () => {
      if (document.visibilityState === 'visible') void heartbeatTick();
    };
    document.addEventListener('visibilitychange', visListener);
  }
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (visListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visListener);
    visListener = null;
  }
}

// ---------- Upfront subscribe (decoupled from schedules) ----------

export interface SubscribeResult {
  ok: boolean;
  reason?: string;
  endpoint?: string;
}

/**
 * Request notification permission, build a Push subscription, and POST it to
 * the Worker as a "ping" record (intervalMs = a sentinel large value so cron
 * never fires for it; charId = '__ping__' so it doesn't collide with real
 * character schedules).  After this succeeds the user has a working endpoint
 * in D1 even before any character has proactive-msg enabled, which is what
 * /test needs to verify the round-trip.
 */
export async function ensureSubscribed(): Promise<SubscribeResult> {
  const cfg = loadPushConfig();
  if (!cfg.workerUrl.startsWith('https://') || cfg.vapidPublicKey.length < 80) {
    return { ok: false, reason: '推送加速器未配置（前端常量未填写）' };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: '当前浏览器不支持 Service Worker 或 Push API' };
  }
  if (typeof Notification === 'undefined') {
    return { ok: false, reason: '当前环境没有 Notification API' };
  }

  // Request permission first so the popup is tied to the user's click.
  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { ok: false, reason: '通知权限未授予' };
  } else if (Notification.permission === 'denied') {
    return { ok: false, reason: '通知权限已被拒绝（请到浏览器站点设置里手动开启）' };
  }

  const { sub, reason: subReason } = await getOrCreateSubscription(cfg.vapidPublicKey);
  if (!sub) return { ok: false, reason: subReason || '订阅创建失败（未知原因）' };

  // Register a sentinel row so /test can find the endpoint by URL.  We use a
  // very large intervalMs so the cron sweep never picks it up — this row is
  // purely an addressable record of "endpoint X belongs to this device".
  try {
    const NEVER_FIRE_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
    const res = await fetch(`${cfg.workerUrl}/subscribe`, {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        charId: '__ping__',
        intervalMs: NEVER_FIRE_INTERVAL_MS,
      }),
    });
    if (!res.ok) return { ok: false, reason: `Worker /subscribe 返回 HTTP ${res.status}`, endpoint: sub.endpoint };
  } catch (e: any) {
    return { ok: false, reason: `Worker 连接失败：${e?.message || '网络错误'}`, endpoint: sub.endpoint };
  }

  return { ok: true, endpoint: sub.endpoint };
}

/** Ask the Worker to fire a one-shot test push at this device's endpoint. */
export async function sendTestPush(): Promise<{ ok: boolean; status?: number; reason?: string; deadSubscription?: boolean }> {
  const cfg = loadPushConfig();
  if (!cfg.workerUrl.startsWith('https://')) return { ok: false, reason: 'Worker URL 未配置' };

  const reg = await navigator.serviceWorker?.ready?.catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return { ok: false, reason: '本设备没有现有订阅，请先点"开启系统通知"' };

  // Browser-side zombie-endpoint guard — bail before bothering the Worker.
  // Otherwise Worker will fetch permanently-removed.invalid → 530 from CF.
  if (isDeadSubscriptionEndpoint(sub.endpoint)) {
    return {
      ok: false,
      deadSubscription: true,
      reason: '订阅已被浏览器吊销（permanently-removed.invalid），点"重置订阅"重建一次',
    };
  }

  try {
    const res = await fetch(`${cfg.workerUrl}/test`, {
      method: 'POST',
      headers: buildHeaders(cfg),
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) return { ok: false, status: res.status, reason: data?.error || data?.reason || `HTTP ${res.status}` };
    if (!data?.ok) return { ok: false, status: data?.status, reason: data?.reason || data?.error || '推送失败' };
    return { ok: true, status: data?.status };
  } catch (e: any) {
    return { ok: false, reason: e?.message || '网络错误' };
  }
}

/**
 * Tear the local subscription down and rebuild it from scratch.  Used by the
 * diagnostic panel's "重置订阅" button to recover from
 * `permanently-removed.invalid` zombies, scope changes, or a stuck VAPID-key
 * mismatch.  Also tells the Worker to forget the dead row so /test won't
 * keep finding it.
 */
export async function resetSubscription(): Promise<{ ok: boolean; reason?: string; endpoint?: string }> {
  const cfg = loadPushConfig();
  if (!cfg.workerUrl.startsWith('https://') || cfg.vapidPublicKey.length < 80) {
    return { ok: false, reason: '推送加速器未配置' };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: '当前浏览器不支持 Service Worker 或 Push API' };
  }

  const reg = await navigator.serviceWorker?.ready?.catch(() => null);
  const oldSub = reg ? await reg.pushManager.getSubscription() : null;
  const oldEndpoint = oldSub?.endpoint;

  // Tell Worker to drop the row first so /test won't keep returning the
  // dead endpoint.  Best-effort — failures here are non-fatal.
  if (oldEndpoint) {
    try {
      await fetch(`${cfg.workerUrl}/unsubscribe`, {
        method: 'POST',
        headers: buildHeaders(cfg),
        body: JSON.stringify({ endpoint: oldEndpoint }),
      });
    } catch { /* ignore */ }
  }

  if (oldSub) {
    try { await oldSub.unsubscribe(); } catch { /* ignore */ }
  }

  // ensureSubscribed will re-create from clean slate (permission, fresh
  // PushSubscription, fresh D1 row).
  return ensureSubscribed();
}

// ---------- Diagnostic info ----------

export interface PushDiagnostics {
  /** Browser feature support */
  supported: boolean;
  /** Notification.permission (or 'unavailable' if API missing) */
  permission: 'default' | 'granted' | 'denied' | 'unavailable';
  /** SW registration scope, or null if not registered */
  swScope: string | null;
  /** SW state: 'activated' | 'installing' | 'waiting' | 'redundant' | 'none' */
  swState: string;
  /** Current Push subscription endpoint, or null */
  endpoint: string | null;
  /** True if endpoint is a `permanently-removed.invalid` zombie sentinel */
  endpointDead: boolean;
  /** Friendly name of the push channel (FCM/Mozilla/Windows/Apple/...) */
  channel: string;
  /** True if the deployment constants are in place */
  workerConfigured: boolean;
  /** True if the user-facing toggle is on */
  enabled: boolean;
  /** ms since epoch of the last wake we received, or null */
  lastWakeAt: number | null;
  /** charId of the last wake, or null */
  lastWakeChar: string | null;
  /** True if we are inside an iOS Safari that is NOT a standalone PWA */
  iosNeedsPwa: boolean;
  /** True if we are running inside a Capacitor native app (Android/iOS WebView) */
  capacitorNative: boolean;
}

function detectChannelFromEndpoint(endpoint: string | null): string {
  if (!endpoint) return '未知';
  if (/fcm\.googleapis\.com|android\.googleapis\.com/i.test(endpoint)) return 'Google FCM (Chrome / Edge / 安卓)';
  if (/updates\.push\.services\.mozilla\.com/i.test(endpoint)) return 'Mozilla autopush (Firefox)';
  if (/notify\.windows\.com|wns2/i.test(endpoint)) return 'Windows WNS (Edge)';
  if (/web\.push\.apple\.com/i.test(endpoint)) return 'Apple APNs (Safari / iOS PWA)';
  return '未识别厂商';
}

/**
 * True when the page is running inside a Capacitor native shell
 * (Android/iOS WebView), as opposed to a regular browser tab.  We probe
 * the global rather than importing `@capacitor/core` so this util stays
 * tree-shakable in the SW bundle.
 */
function detectCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') {
    try { return !!cap.isNativePlatform(); } catch { /* ignore */ }
  }
  // Fallback for older Capacitor versions
  return cap.platform === 'android' || cap.platform === 'ios';
}

function detectIosNeedsPwa(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  if (!isIos) return false;
  // Consider standalone if either iOS legacy `navigator.standalone` or display-mode media query says so.
  const standalone =
    (navigator as any).standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return !standalone;
}

export async function getPushDiagnostics(): Promise<PushDiagnostics> {
  const cfg = loadPushConfig();
  const supported = typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window;
  const permission: PushDiagnostics['permission'] = typeof Notification === 'undefined'
    ? 'unavailable'
    : (Notification.permission as PushDiagnostics['permission']);

  let swScope: string | null = null;
  let swState = 'none';
  let endpoint: string | null = null;
  if (supported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        swScope = reg.scope;
        const w = reg.active || reg.waiting || reg.installing;
        swState = w ? w.state : 'none';
        const sub = await reg.pushManager.getSubscription();
        endpoint = sub?.endpoint || null;
      }
    } catch { /* ignore */ }
  }

  let lastWakeAt: number | null = null;
  let lastWakeChar: string | null = null;
  try {
    const v = localStorage.getItem(LAST_WAKE_AT_KEY);
    if (v) lastWakeAt = parseInt(v, 10) || null;
    lastWakeChar = localStorage.getItem(LAST_WAKE_CHAR_KEY);
  } catch { /* ignore */ }

  return {
    supported,
    permission,
    swScope,
    swState,
    endpoint,
    endpointDead: isDeadSubscriptionEndpoint(endpoint),
    channel: detectChannelFromEndpoint(endpoint),
    workerConfigured: cfg.workerUrl.startsWith('https://') && cfg.vapidPublicKey.length > 80,
    enabled: cfg.enabled,
    lastWakeAt,
    lastWakeChar,
    iosNeedsPwa: detectIosNeedsPwa(),
    capacitorNative: detectCapacitorNative(),
  };
}

// ---------- Last-wake tracking via SW postMessage ----------

let wakeListenerInstalled = false;

/** Install a one-time global listener that records every wake the SW reports. */
export function installWakeListener() {
  if (wakeListenerInstalled) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  wakeListenerInstalled = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data: any = event.data;
    if (!data || data.type !== 'proactive-wake-received') return;
    try {
      if (data.t) localStorage.setItem(LAST_WAKE_AT_KEY, String(data.t));
      if (data.charId) localStorage.setItem(LAST_WAKE_CHAR_KEY, String(data.charId));
    } catch { /* ignore */ }
  });
}
