/**
 * Keep-Alive utility — signals the Service Worker to prevent background suspension
 * during long-running AI API calls (especially on mobile / Capacitor).
 *
 * Usage:
 *   import { KeepAlive } from '../utils/keepAlive';
 *
 *   KeepAlive.start();   // before API call
 *   await fetch(...);
 *   KeepAlive.stop();    // after API call completes
 */

let registered = false;

async function ensureRegistered(): Promise<void> {
  if (registered || !('serviceWorker' in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL || '/';
    const scriptUrl = base + 'sw-keep-alive.js';
    const reg = await navigator.serviceWorker.register(scriptUrl, { scope: base });
    await navigator.serviceWorker.ready;
    registered = true;
    console.log('[KeepAlive] Service Worker registered', reg.scope);
  } catch (e) {
    console.warn('[KeepAlive] SW registration failed, keep-alive disabled:', e);
  }
}

function postToSW(msg: { type: string }) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage(msg);
}

export const KeepAlive = {
  /** Register the SW on app startup (idempotent, call early). */
  init: ensureRegistered,

  /** Signal that a long-running request is starting. */
  async start() {
    await ensureRegistered();
    postToSW({ type: 'keepalive-start' });
  },

  /** Signal that the request has finished. */
  stop() {
    postToSW({ type: 'keepalive-stop' });
  },
};
