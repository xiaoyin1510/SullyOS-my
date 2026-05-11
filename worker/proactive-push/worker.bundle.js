// ╔══════════════════════════════════════════════════════════════════╗
// ║  Proactive Push Accelerator — single-file Worker bundle          ║
// ║                                                                  ║
// ║  把整段代码复制到 Cloudflare 面板的 Worker 编辑器里即可部署。      ║
// ║  源码：worker/proactive-push/src/{index,webpush}.ts              ║
// ║                                                                  ║
// ║  绑定要求（在 Worker 面板的 Settings → Variables 里配置）：       ║
// ║    - D1 database binding 名字：DB                                ║
// ║    - Secret VAPID_PUBLIC_KEY                                     ║
// ║    - Secret VAPID_PRIVATE_KEY                                    ║
// ║    - Text var (或 Secret) VAPID_SUBJECT（mailto:xxx@xxx）        ║
// ║    - Text var (或 Secret) CLIENT_TOKEN（可选，建议填）           ║
// ║    - Text var HEARTBEAT_WINDOW_MS（可选，默认 300000）            ║
// ║                                                                  ║
// ║  Triggers → Cron Triggers 添加：* * * * *（每分钟）              ║
// ╚══════════════════════════════════════════════════════════════════╝

// ─────────────────── base64url ───────────────────
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function b64uEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63] + B64_CHARS[(n >> 6) & 63] + B64_CHARS[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += B64_CHARS[(n >> 18) & 63] + B64_CHARS[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64_CHARS[(n >> 6) & 63];
  }
  return out;
}

function b64uDecode(s) {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ─────────────────── VAPID ───────────────────
async function prepareVapid(publicKeyB64u, privateKeyB64u, subject) {
  const pub = b64uDecode(publicKeyB64u);
  const priv = b64uDecode(privateKeyB64u);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID public key must be 65-byte uncompressed P-256 point');
  if (priv.length !== 32) throw new Error('VAPID private key must be 32 bytes');

  const signingKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: b64uEncode(pub.slice(1, 33)),
      y: b64uEncode(pub.slice(33, 65)),
      d: b64uEncode(priv),
      ext: false,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  return { publicKeyB64u, signingKey, subject };
}

async function buildVapidJwt(audience, vapid) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claim = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  };
  const unsigned = b64uEncode(new TextEncoder().encode(JSON.stringify(header))) + '.' +
                   b64uEncode(new TextEncoder().encode(JSON.stringify(claim)));
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.signingKey,
    new TextEncoder().encode(unsigned),
  );
  return unsigned + '.' + b64uEncode(new Uint8Array(sig));
}

// ─────────────────── HKDF ───────────────────
async function hkdf(ikm, salt, info, lengthBytes) {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

// ─────────────────── aes128gcm encryption (RFC 8188/8291) ───────────────────
async function encryptAes128Gcm(payload, clientP256dh, clientAuth) {
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  const clientPubKey = await crypto.subtle.importKey(
    'raw',
    clientP256dh,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey },
    ephemeral.privateKey,
    256,
  ));

  const prk = await hkdf(
    ikm,
    clientAuth,
    concatBytes(new TextEncoder().encode('WebPush: info\0'), clientP256dh, ephemeralPubRaw),
    32,
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(prk, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(prk, salt, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const padded = new Uint8Array(payload.length + 1);
  padded.set(payload, 0);
  padded[payload.length] = 0x02;

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded));

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(16, rs, false);
  header[20] = 65;
  header.set(ephemeralPubRaw, 21);

  return concatBytes(header, ciphertext);
}

async function sendPush(vapid, sub, payload) {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const url = new URL(sub.endpoint);
  const audience = url.origin;

  const jwt = await buildVapidJwt(audience, vapid);
  const encrypted = await encryptAes128Gcm(
    bytes,
    b64uDecode(sub.p256dh),
    b64uDecode(sub.auth),
  );

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '60',
      'Urgency': 'high',
      'Authorization': `vapid t=${jwt}, k=${vapid.publicKeyB64u}`,
    },
    body: encrypted,
  });

  const gone = res.status === 404 || res.status === 410;
  let responseText;
  if (!res.ok && !gone) {
    try { responseText = await res.text(); } catch { /* ignore */ }
  }
  return { status: res.status, ok: res.ok, gone, responseText };
}

// ─────────────────── HTTP helpers ───────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    },
  });
}

function checkToken(req, env) {
  if (!env.CLIENT_TOKEN) return null;
  const got = req.headers.get('X-Client-Token');
  if (got !== env.CLIENT_TOKEN) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

let cachedVapid = null;
async function getVapid(env) {
  if (cachedVapid) return cachedVapid;
  cachedVapid = await prepareVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
  return cachedVapid;
}

// ─────────────────── Route handlers ───────────────────
async function handleSubscribe(req, env) {
  const body = await readJson(req);
  if (!body) return json({ error: 'invalid json' }, 400);

  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  const charId = body.charId;
  const intervalMs = body.intervalMs;

  if (!endpoint || !p256dh || !auth || !charId || !intervalMs || intervalMs < 60_000) {
    return json({ error: 'missing or invalid fields' }, 400);
  }

  const now = Date.now();
  const nextFireAt = now + intervalMs;

  await env.DB.prepare(`
    INSERT INTO schedules (endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(endpoint, char_id) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      interval_ms = excluded.interval_ms,
      next_fire_at = excluded.next_fire_at,
      last_heartbeat = excluded.last_heartbeat
  `).bind(endpoint, charId, p256dh, auth, intervalMs, nextFireAt, now, now).run();

  return json({ ok: true, nextFireAt });
}

async function handleUnsubscribe(req, env) {
  const body = await readJson(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);

  if (body.charId) {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2`)
      .bind(body.endpoint, body.charId).run();
  } else {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(body.endpoint).run();
  }
  return json({ ok: true });
}

async function handleHeartbeat(req, env) {
  const body = await readJson(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);
  const now = Date.now();
  await env.DB.prepare(`UPDATE schedules SET last_heartbeat = ?1 WHERE endpoint = ?2`)
    .bind(now, body.endpoint).run();
  return json({ ok: true, now });
}

async function handleStatus(req, env) {
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!endpoint) return json({ error: 'endpoint required' }, 400);
  const res = await env.DB.prepare(
    `SELECT char_id, interval_ms, next_fire_at, last_heartbeat FROM schedules WHERE endpoint = ?1`
  ).bind(endpoint).all();
  return json({ ok: true, schedules: res.results });
}

async function handleTest(req, env) {
  const body = await readJson(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);

  const row = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth FROM schedules WHERE endpoint = ?1 LIMIT 1`
  ).bind(body.endpoint).first();
  if (!row) return json({ error: 'subscription not found — open the app once with push enabled, then retry' }, 404);

  const vapid = await getVapid(env);
  const payload = JSON.stringify({ type: 'proactive-test', t: Date.now() });
  try {
    const result = await sendPush(vapid, row, payload);
    if (result.gone) {
      await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(row.endpoint).run();
      return json({ ok: false, status: result.status, reason: 'subscription expired and was removed' }, 410);
    }
    return json({ ok: result.ok, status: result.status, body: result.responseText || '' });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}

// ─────────────────── Scheduled (cron) ───────────────────
async function runScheduledSweep(env) {
  const now = Date.now();
  const hbWindow = parseInt(env.HEARTBEAT_WINDOW_MS || '300000', 10) || 300_000;
  const cutoff = now - hbWindow;

  const due = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, last_heartbeat, created_at
    FROM schedules
    WHERE next_fire_at <= ?1 AND last_heartbeat >= ?2
    ORDER BY next_fire_at ASC
    LIMIT 500
  `).bind(now, cutoff).all();

  if (!due.results || due.results.length === 0) {
    return { fired: 0, dropped: 0 };
  }

  const vapid = await getVapid(env);
  let fired = 0;
  let dropped = 0;

  for (const row of due.results) {
    const payload = JSON.stringify({ type: 'proactive-wake', charId: row.char_id, t: now });
    try {
      const result = await sendPush(
        vapid,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
      );
      if (result.gone) {
        await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(row.endpoint).run();
        dropped++;
        continue;
      }
      if (!result.ok) {
        console.warn(`[cron] push failed status=${result.status} char=${row.char_id} body=${result.responseText || ''}`);
      }
      let next = row.next_fire_at + row.interval_ms;
      if (next <= now) next = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`)
        .bind(next, row.endpoint, row.char_id).run();
      fired++;
    } catch (e) {
      console.error('[cron] push error', e, row.char_id);
    }
  }

  return { fired, dropped };
}

// ─────────────────── Worker entry ───────────────────
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(req.url);

    if (url.pathname === '/vapid-public-key' && req.method === 'GET') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      return json({ ok: true });
    }

    const tokenErr = checkToken(req, env);
    if (tokenErr) return tokenErr;

    if (url.pathname === '/subscribe' && req.method === 'POST') return handleSubscribe(req, env);
    if (url.pathname === '/unsubscribe' && req.method === 'POST') return handleUnsubscribe(req, env);
    if (url.pathname === '/heartbeat' && req.method === 'POST') return handleHeartbeat(req, env);
    if (url.pathname === '/status' && req.method === 'GET') return handleStatus(req, env);
    if (url.pathname === '/test' && req.method === 'POST') return handleTest(req, env);

    return json({ error: 'not found' }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const result = await runScheduledSweep(env);
      if (result.fired || result.dropped) {
        console.log(`[cron] fired=${result.fired} dropped=${result.dropped}`);
      }
    })());
  },
};
