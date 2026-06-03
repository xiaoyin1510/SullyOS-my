/**
 * Proactive Chat - schedule characters to send messages at regular intervals.
 *
 * How it works:
 *  1. Each character can persist an independent proactive schedule.
 *  2. The SW keeps timers for all active schedules and posts 'proactive-trigger'
 *     with the relevant charId.
 *  3. The main thread receives the trigger and runs the normal AI flow.
 *  4. If the app was backgrounded, visibility-change catch-up fires any overdue roles.
 *  5. If the optional Cloudflare Worker accelerator is configured (see
 *     `utils/proactivePushConfig.ts`), `start`/`stop` also register/unregister
 *     a Web Push wake-up schedule on the Worker.  The Worker's cron sends a
 *     `{type:'proactive-wake', charId}` push at interval time; the SW routes
 *     it through the same `proactive-trigger` channel so the main-thread AI
 *     flow runs exactly once per trigger regardless of source.
 */

import {
  loadPushConfig,
  isPushConfigReady,
  registerScheduleOnWorker,
  unregisterScheduleOnWorker,
  startHeartbeat,
  stopHeartbeat,
} from './proactivePushConfig';

export interface ProactiveSchedule {
  charId: string;
  intervalMs: number; // must be multiple of 30 * 60 * 1000
}

type ProactiveScheduleMap = Record<string, ProactiveSchedule>;
type LastFireMap = Record<string, number>;

const STORAGE_KEY = 'proactive_schedules';
const LAST_FIRE_KEY = 'proactive_last_fire_map';
const LEGACY_STORAGE_KEY = 'proactive_schedule';
const LEGACY_LAST_FIRE_KEY = 'proactive_last_fire';

function loadSchedules(): ProactiveScheduleMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) return {};

      const legacySchedule = JSON.parse(legacyRaw) as ProactiveSchedule | null;
      if (!legacySchedule?.charId || !legacySchedule.intervalMs) return {};

      const migratedSchedules = { [legacySchedule.charId]: legacySchedule };
      saveSchedules(migratedSchedules);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return migratedSchedules;
    }
    const parsed = JSON.parse(raw) as ProactiveScheduleMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSchedules(schedules: ProactiveScheduleMap) {
  const entries = Object.entries(schedules);
  if (entries.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

function loadLastFireTimes(): LastFireMap {
  try {
    const raw = localStorage.getItem(LAST_FIRE_KEY);
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_LAST_FIRE_KEY);
      const schedules = loadSchedules();
      const firstSchedule = Object.values(schedules)[0];
      const legacyTs = parseInt(legacyRaw || '0', 10);
      if (!firstSchedule || !legacyTs) return {};

      const migratedLastFire = { [firstSchedule.charId]: legacyTs };
      saveLastFireTimes(migratedLastFire);
      localStorage.removeItem(LEGACY_LAST_FIRE_KEY);
      return migratedLastFire;
    }
    const parsed = JSON.parse(raw) as LastFireMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLastFireTimes(lastFireMap: LastFireMap) {
  const entries = Object.entries(lastFireMap);
  if (entries.length === 0) {
    localStorage.removeItem(LAST_FIRE_KEY);
    return;
  }
  localStorage.setItem(LAST_FIRE_KEY, JSON.stringify(lastFireMap));
}

function getLastFireTime(charId: string): number {
  return loadLastFireTimes()[charId] || 0;
}

function setLastFireTime(charId: string, ts: number) {
  const lastFireMap = loadLastFireTimes();
  lastFireMap[charId] = ts;
  saveLastFireTimes(lastFireMap);
}

function removeLastFireTime(charId: string) {
  const lastFireMap = loadLastFireTimes();
  delete lastFireMap[charId];
  saveLastFireTimes(lastFireMap);
}

function postToSW(msg: any) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage(msg);
}

function syncSchedulesToSW() {
  const schedules = Object.values(loadSchedules());
  postToSW({ type: 'proactive-sync', configs: schedules });
}

// --- Trigger callback management ---
let triggerCallback: ((charId: string) => void | Promise<void>) | null = null;
let swListener: ((e: MessageEvent) => void) | null = null;
let visibilityListener: (() => void) | null = null;
let focusListener: (() => void) | null = null;
let mainThreadTimer: ReturnType<typeof setInterval> | null = null;
let preciseTimer: ReturnType<typeof setTimeout> | null = null;

// Main-thread polling acts as the bottom-line safety net in case Service
// Worker timers get terminated by the browser AND the precise setTimeout gets
// throttled in a background tab.  20 s is cheap (just a localStorage read)
// and keeps the worst-case delay under one bucket for hidden-tab throttling.
const MAIN_THREAD_CHECK_INTERVAL = 20_000;

function handleSWMessage(e: MessageEvent) {
  if (e.data?.type !== 'proactive-trigger') return;
  const charId = e.data.charId;
  const schedule = loadSchedules()[charId];
  if (!schedule) return;
  if (!triggerCallback) {
    // Callback not ready yet — leave lastFire untouched so the main-thread
    // polling will fire once the callback is registered.
    return;
  }

  // De-dupe: when both the Worker's push and the main-thread catch-up fire
  // within a small window of each other (happens when the user returns after
  // an offline gap), the first one to land wins and the other gets silently
  // dropped.  Without this guard the character would send two proactive
  // messages back-to-back.
  const now = Date.now();
  const lastFire = getLastFireTime(charId);
  const minGap = Math.min(60_000, schedule.intervalMs * 0.1);
  if (lastFire > 0 && now - lastFire < minGap) {
    console.log(`[ProactiveChat] Ignoring duplicate trigger for ${charId} (fired ${Math.round((now - lastFire) / 1000)}s ago)`);
    return;
  }

  setLastFireTime(charId, now);
  schedulePreciseTimer();
  void triggerCallback(charId);
}

/** Check all schedules and fire any that are overdue. */
function checkOverdueSchedules() {
  if (!triggerCallback) return;

  const schedules = Object.values(loadSchedules());
  const now = Date.now();

  for (const schedule of schedules) {
    const lastFire = getLastFireTime(schedule.charId);
    const elapsed = now - lastFire;

    if (lastFire > 0 && elapsed >= schedule.intervalMs) {
      console.log(`[ProactiveChat] Main-thread trigger: ${schedule.charId}, ${Math.round(elapsed / 60000)}min elapsed`);
      setLastFireTime(schedule.charId, now);
      syncSchedulesToSW();
      void triggerCallback(schedule.charId);
    }
  }

  schedulePreciseTimer();
}

/**
 * Schedule a single setTimeout to fire exactly at the next due moment across
 * all active schedules.  This is the primary delivery mechanism while the tab
 * is visible — setInterval / setTimeout are accurate in the foreground, and
 * the user's specific complaint is "在角色也不给我发消息" (messages don't fire
 * when I'm sitting on the character screen).  Backs up the Service Worker
 * timer, which the browser may terminate at any time.
 */
function schedulePreciseTimer() {
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
  if (!triggerCallback) return;

  const schedules = Object.values(loadSchedules());
  if (schedules.length === 0) return;

  const now = Date.now();
  let nextDue = Infinity;
  for (const schedule of schedules) {
    const lastFire = getLastFireTime(schedule.charId);
    const base = lastFire > 0 ? lastFire : now;
    const due = base + schedule.intervalMs;
    if (due < nextDue) nextDue = due;
  }
  if (!Number.isFinite(nextDue)) return;

  // Clamp: at least 500ms to avoid tight loops, at most ~24d to fit a 32-bit timer.
  const delay = Math.min(Math.max(nextDue - now, 500), 2_147_000_000);
  preciseTimer = setTimeout(() => {
    preciseTimer = null;
    checkOverdueSchedules();
  }, delay);
}

function handleVisibility() {
  if (document.visibilityState !== 'visible') return;
  // When the page becomes visible again, do an immediate overdue check and
  // re-arm the precise timer (background throttling may have delayed it).
  checkOverdueSchedules();
}

function handleFocus() {
  checkOverdueSchedules();
}

function startMainThreadTimer() {
  if (mainThreadTimer) return;
  mainThreadTimer = setInterval(checkOverdueSchedules, MAIN_THREAD_CHECK_INTERVAL);
}

function stopMainThreadTimer() {
  if (mainThreadTimer) {
    clearInterval(mainThreadTimer);
    mainThreadTimer = null;
  }
}

function attachListeners() {
  detachListeners();
  swListener = handleSWMessage;
  navigator.serviceWorker?.addEventListener('message', swListener);
  visibilityListener = handleVisibility;
  document.addEventListener('visibilitychange', visibilityListener);
  focusListener = handleFocus;
  window.addEventListener('focus', focusListener);
  startMainThreadTimer();
  schedulePreciseTimer();
}

function detachListeners() {
  if (swListener) {
    navigator.serviceWorker?.removeEventListener('message', swListener);
    swListener = null;
  }
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
  if (focusListener) {
    window.removeEventListener('focus', focusListener);
    focusListener = null;
  }
  stopMainThreadTimer();
  if (preciseTimer) {
    clearTimeout(preciseTimer);
    preciseTimer = null;
  }
}

export const ProactiveChat = {
  /**
   * Register the callback that fires when it's time for a proactive message.
   * Call this once from app code. The callback should inject a system hint
   * and call the normal AI flow.
   */
  onTrigger(callback: (charId: string) => void | Promise<void>) {
    triggerCallback = callback;
    attachListeners();
    // Catch up anything that came due while the callback wasn't registered
    // yet (e.g. between `ProactiveChat.resume()` on boot and OSContext
    // finishing its first render).
    checkOverdueSchedules();
  },

  /**
   * Start or update one character's proactive schedule.
   */
  start(charId: string, intervalMinutes: number) {
    const clamped = Math.max(30, Math.round(intervalMinutes / 30) * 30);
    const intervalMs = clamped * 60 * 1000;
    const schedules = loadSchedules();
    schedules[charId] = { charId, intervalMs };
    saveSchedules(schedules);
    setLastFireTime(charId, Date.now());
    syncSchedulesToSW();
    attachListeners();

    // Cloud accelerator — fire-and-forget; if not configured, this no-ops.
    if (isPushConfigReady(loadPushConfig())) {
      void registerScheduleOnWorker(charId, intervalMs);
      startHeartbeat();
    }

    console.log(`[ProactiveChat] Started: ${charId}, every ${clamped}min`);
  },

  /**
   * Stop one character's proactive schedule.
   */
  stop(charId: string) {
    const schedules = loadSchedules();
    delete schedules[charId];
    saveSchedules(schedules);
    removeLastFireTime(charId);
    syncSchedulesToSW();

    if (isPushConfigReady(loadPushConfig())) {
      void unregisterScheduleOnWorker(charId);
    }

    if (Object.keys(schedules).length === 0) {
      detachListeners();
      stopHeartbeat();
    } else {
      schedulePreciseTimer();
    }

    console.log(`[ProactiveChat] Stopped: ${charId}`);
  },

  /**
   * Resume all saved schedules after page reload.
   */
  resume() {
    const schedules = Object.values(loadSchedules());
    if (schedules.length === 0) return;

    console.log(`[ProactiveChat] Resuming ${schedules.length} proactive schedule(s)`);
    syncSchedulesToSW();
    attachListeners();
    handleVisibility();

    // Re-register schedules on the Worker in case the client token, VAPID
    // key, or push subscription has rotated since last run.  Also restart
    // the heartbeat loop.
    if (isPushConfigReady(loadPushConfig())) {
      for (const schedule of schedules) {
        void registerScheduleOnWorker(schedule.charId, schedule.intervalMs);
      }
      startHeartbeat();
    }
  },

  /** Check if proactive is active for a given character */
  isActiveFor(charId: string): boolean {
    return !!loadSchedules()[charId];
  },

  /** Get current schedule interval in minutes for one character, or null */
  getIntervalMinutes(charId: string): number | null {
    const schedule = loadSchedules()[charId];
    return schedule ? schedule.intervalMs / 60000 : null;
  },

  /** Get current schedule for one character */
  getSchedule(charId: string): ProactiveSchedule | null {
    return loadSchedules()[charId] || null;
  },

  /** Get all active schedules */
  getSchedules(): ProactiveSchedule[] {
    return Object.values(loadSchedules());
  },
};
