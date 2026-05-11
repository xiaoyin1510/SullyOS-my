/**
 * Service Worker: Background Keep-Alive + Proactive Timers
 *
 * A) Keep-alive: prevent browser from suspending during long AI fetch requests
 * B) Proactive timers: periodically notify the main thread to trigger AI messages
 *    for any number of characters independently.
 */

const PING_INTERVAL = 15_000;
const MAX_MANUAL_ALIVE_MS = 5 * 60_000;

// --- Keep-Alive ---
let pingTimer = null;
let manualKeepAliveCount = 0;
let manualKeepAliveStartedAt = 0;

function hasActiveProactiveSchedules() {
  return proactiveTimers.size > 0;
}

function shouldKeepAlive() {
  return manualKeepAliveCount > 0 || hasActiveProactiveSchedules();
}

function stopPingLoop() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function ensurePingLoop() {
  if (pingTimer) return;

  pingTimer = setInterval(() => {
    if (manualKeepAliveCount > 0 && Date.now() - manualKeepAliveStartedAt > MAX_MANUAL_ALIVE_MS) {
      console.log('[SW] Manual keep-alive auto-stopped (max duration)');
      manualKeepAliveCount = 0;
      manualKeepAliveStartedAt = 0;
    }

    if (!shouldKeepAlive()) {
      stopPingLoop();
      return;
    }

    self.registration.active && self.registration.active.postMessage({ type: 'ping' });
  }, PING_INTERVAL);
}

function refreshKeepAlive() {
  if (shouldKeepAlive()) ensurePingLoop();
  else stopPingLoop();
}

function startKeepAlive() {
  manualKeepAliveCount += 1;
  if (!manualKeepAliveStartedAt) {
    manualKeepAliveStartedAt = Date.now();
  }
  refreshKeepAlive();
}

function stopKeepAlive() {
  if (manualKeepAliveCount > 0) {
    manualKeepAliveCount -= 1;
  }
  if (manualKeepAliveCount === 0) {
    manualKeepAliveStartedAt = 0;
  }
  refreshKeepAlive();
}

// --- Proactive Timers ---
const proactiveSchedules = new Map();
const proactiveTimers = new Map();

async function notifyClients(data) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage(data);
  }
}

function fireProactiveTrigger(charId) {
  console.log('[SW] Proactive trigger fired for', charId);
  notifyClients({ type: 'proactive-trigger', charId });
}

function stopProactive(charId) {
  const timer = proactiveTimers.get(charId);
  if (timer) {
    clearInterval(timer);
    proactiveTimers.delete(charId);
  }
  proactiveSchedules.delete(charId);
}

function upsertProactive(config) {
  const prev = proactiveSchedules.get(config.charId);
  const unchanged = prev && prev.intervalMs === config.intervalMs;
  if (unchanged && proactiveTimers.has(config.charId)) {
    return;
  }

  stopProactive(config.charId);
  proactiveSchedules.set(config.charId, config);

  console.log(`[SW] Proactive timer started: ${config.charId}, every ${config.intervalMs / 60000}min`);
  const timer = setInterval(() => fireProactiveTrigger(config.charId), config.intervalMs);
  proactiveTimers.set(config.charId, timer);
}

function syncProactive(configs) {
  const nextIds = new Set((configs || []).map(config => config.charId));

  for (const charId of Array.from(proactiveSchedules.keys())) {
    if (!nextIds.has(charId)) {
      stopProactive(charId);
    }
  }

  for (const config of configs || []) {
    if (config && config.charId && config.intervalMs > 0) {
      upsertProactive(config);
    }
  }

  refreshKeepAlive();
}

// --- Message handler ---
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  switch (type) {
    case 'keepalive-start':
      startKeepAlive();
      break;
    case 'keepalive-stop':
      stopKeepAlive();
      break;
    case 'proactive-start':
      if (event.data.config) {
        syncProactive([...proactiveSchedules.values(), event.data.config]);
      }
      break;
    case 'proactive-stop':
      if (event.data.charId) {
        stopProactive(event.data.charId);
        refreshKeepAlive();
      } else {
        syncProactive([]);
      }
      break;
    case 'proactive-sync':
      syncProactive(event.data.configs || []);
      break;
  }
});

// --- Push Notifications (ActiveMsg 2.0) ---
var ACTIVE_MSG_DB_NAME = 'ActiveMsg';
var ACTIVE_MSG_DB_VERSION = 1;
var ACTIVE_MSG_INBOX_STORE = 'inbox';

function openInboxDb() {
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open(ACTIVE_MSG_DB_NAME, ACTIVE_MSG_DB_VERSION);
    request.onerror = function () { reject(request.error); };
    request.onsuccess = function () { resolve(request.result); };
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains(ACTIVE_MSG_INBOX_STORE)) {
        db.createObjectStore(ACTIVE_MSG_INBOX_STORE, { keyPath: 'messageId' });
      }
    };
  });
}

async function saveIncomingActiveMessage(payload) {
  var charId = payload && payload.metadata && payload.metadata.charId;
  var charName = (payload && payload.contactName) || (payload && payload.metadata && payload.metadata.charName) || '主动消息';
  var body = String((payload && payload.message) || (payload && payload.body) || '').trim();
  var messageId = String((payload && payload.messageId) || ((charId || 'unknown') + '-' + Date.now()));
  var payloadTimestamp = payload && payload.timestamp;
  var parsedSentAt = payloadTimestamp ? new Date(payloadTimestamp).getTime() : NaN;
  var sentAt = Number.isFinite(parsedSentAt) ? parsedSentAt : Date.now();

  if (!charId || !body) return;

  var db = await openInboxDb();
  await new Promise(function (resolve, reject) {
    var tx = db.transaction(ACTIVE_MSG_INBOX_STORE, 'readwrite');
    tx.objectStore(ACTIVE_MSG_INBOX_STORE).put({
      messageId: messageId,
      charId: charId,
      charName: charName,
      body: body,
      avatarUrl: payload && payload.avatarUrl,
      source: payload && payload.source,
      messageType: payload && payload.messageType,
      messageSubtype: payload && payload.messageSubtype,
      taskId: (payload && payload.taskId) || null,
      metadata: (payload && payload.metadata) || {},
      sentAt: sentAt,
      receivedAt: Date.now(),
    });
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });

  await notifyClients({
    type: 'active-msg-received',
    charId: charId,
    charName: charName,
    body: body,
    avatarUrl: payload && payload.avatarUrl,
    sentAt: sentAt,
  });
}

// --- Proactive wake-up (main-thread runs AI locally) ---
// When the Cloudflare Worker cron fires at a scheduled time, it sends a
// tiny `{type:'proactive-wake', charId}` push.
//
// Two branches:
//  A) Live tab present → postMessage to main thread, which runs runProactive()
//     locally (calls AI, saves messages).  No system notification — the user
//     will see the message inside the app once generation finishes; the
//     in-app "正在送达消息" indicator covers the wait.
//  B) No live tab → spec-compliance silent notification.  We can't run the
//     LLM here (the SW doesn't have the app's full context stack), and the
//     user has explicitly said a "open the app to read" doorbell is more
//     annoying than helpful.  So we satisfy the browser's "every push must
//     show *something*" rule with an empty silent notification that's torn
//     down immediately.  Catch-up runs naturally next time the user opens
//     the app — `checkOverdueSchedules()` in proactiveChat.ts handles that.
async function handleProactiveWake(payload) {
  var charId = payload && payload.charId;
  if (!charId) return;
  var receivedAt = Date.now();

  var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length > 0) {
    for (var i = 0; i < clients.length; i++) {
      clients[i].postMessage({ type: 'proactive-trigger', charId: charId, source: 'push' });
      clients[i].postMessage({ type: 'proactive-wake-received', charId: charId, t: receivedAt, hadLiveClient: true });
    }
    return;
  }

  // No live tab — silent compliance notification, immediately dismissed so
  // it doesn't show in any tray / panel.  Browsers (esp. Chrome) require
  // some visible result per push or they revoke the subscription over time;
  // an immediately-closed notification counts as "shown" without bothering
  // the user.
  var tag = 'proactive-wake-silent-' + charId;
  await self.registration.showNotification('', {
    body: '',
    silent: true,
    tag: tag,
    requireInteraction: false,
  });
  var notifs = await self.registration.getNotifications({ tag: tag });
  for (var j = 0; j < notifs.length; j++) notifs[j].close();
}

self.addEventListener('push', function (event) {
  var payload = null;
  if (event.data) {
    try { payload = event.data.json(); } catch (e) {
      try { payload = { message: event.data.text() }; } catch (e2) { /* ignore */ }
    }
  }
  console.log('[SW] push received', payload);
  if (!payload) return;

  // Branch A: proactive wake-up — main thread handles AI generation.
  if (payload.type === 'proactive-wake') {
    event.waitUntil(handleProactiveWake(payload));
    return;
  }

  // Branch A2: developer-triggered test ping — show a visible notification
  // confirming the round-trip works.  No app-level side effects.
  if (payload.type === 'proactive-test') {
    event.waitUntil(self.registration.showNotification('推送测试成功', {
      body: '后端 → 浏览器这条链路是通的。',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'proactive-test',
      data: { proactiveTest: true, t: Date.now() },
    }));
    return;
  }

  // Branch B: legacy ActiveMsg 2.0 push — server already included the
  // generated message body; save + notify directly.
  var title = (payload && payload.contactName) || '新消息';
  var body = String((payload && payload.message) || (payload && payload.body) || '').trim();
  event.waitUntil(
    Promise.all([
      saveIncomingActiveMessage(payload),
      self.registration.showNotification(title, {
        body: body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data: { payload: payload },
      }),
    ])
  );
});

self.addEventListener('notificationclick', function (event) {
  var data = event.notification.data || {};
  var payload = data.payload || data;
  var charId = (payload.metadata && payload.metadata.charId) || payload.charId || data.charId || '';
  event.notification.close();

  event.waitUntil((async function () {
    var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      var client = clients[0];
      await client.focus();
      client.postMessage({ type: 'active-msg-open', charId: charId });
      return;
    }
    var openUrl = new URL(self.registration.scope || self.location.origin);
    openUrl.searchParams.set('openApp', 'chat');
    if (charId) openUrl.searchParams.set('activeMsgCharId', charId);
    await self.clients.openWindow(openUrl.toString());
  })());
});

// --- Lifecycle ---
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
