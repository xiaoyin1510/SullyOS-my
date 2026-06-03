/**
 * Minimal Web Push sender for Cloudflare Workers.
 *
 * Implements VAPID (RFC 8292) + aes128gcm content encoding (RFC 8188/8291)
 * using Web Crypto only. No external dependencies so we stay on the CF
 * Workers free tier without pulling Node polyfills.
 *
 * Usage:
 *   const vapid = await prepareVapid(PUBLIC_B64U, PRIVATE_B64U, SUBJECT);
 *   await sendPush(vapid, { endpoint, p256dh, auth }, jsonPayload);
 *
 * If the push service returns 404/410 the subscription is dead — caller
 * should delete it from the DB.
 */

// ---------- base64url ----------
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
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

export function b64uDecode(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ---------- VAPID ----------
export interface VapidContext {
  publicKeyB64u: string;
  signingKey: CryptoKey;
  subject: string;
}

export async function prepareVapid(publicKeyB64u: string, privateKeyB64u: string, subject: string): Promise<VapidContext> {
  const pub = b64uDecode(publicKeyB64u);      // 65 bytes uncompressed (0x04 || X || Y)
  const priv = b64uDecode(privateKeyB64u);    // 32 bytes
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

async function buildVapidJwt(audience: string, vapid: VapidContext): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const claim = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // max 24h per spec; 12h is safe
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

// ---------- HKDF ----------
async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

// ---------- aes128gcm content encoding (RFC 8188 + RFC 8291) ----------
async function encryptAes128Gcm(payload: Uint8Array, clientP256dh: Uint8Array, clientAuth: Uint8Array): Promise<Uint8Array> {
  // 1. Ephemeral ECDH key pair on Worker side
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const ephemeralPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

  // 2. Client public key
  const clientPubKey = await crypto.subtle.importKey(
    'raw',
    clientP256dh,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  // 3. ECDH shared secret
  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey },
    ephemeral.privateKey,
    256,
  ));

  // 4. PRK = HKDF(ikm, salt=auth, info="WebPush: info\0" || clientPub || ephemeralPub)  → 32 bytes
  const prk = await hkdf(
    ikm,
    clientAuth,
    concatBytes(new TextEncoder().encode('WebPush: info\0'), clientP256dh, ephemeralPubRaw),
    32,
  );

  // 5. Random 16-byte salt for CEK/nonce derivation
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 6. Content Encryption Key + nonce
  const cek = await hkdf(prk, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(prk, salt, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // 7. Pad — single-record push: payload || 0x02 (end-of-stream delimiter)
  const padded = new Uint8Array(payload.length + 1);
  padded.set(payload, 0);
  padded[payload.length] = 0x02;

  // 8. AES-GCM encrypt
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded));

  // 9. Header: salt(16) || rs(4 BE) || keyId-len(1) || keyId(ephemeralPub 65)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  const dv = new DataView(header.buffer);
  dv.setUint32(16, rs, false);
  header[20] = 65;
  header.set(ephemeralPubRaw, 21);

  return concatBytes(header, ciphertext);
}

// ---------- sendPush ----------
export interface PushSubscription {
  endpoint: string;
  p256dh: string;   // base64url
  auth: string;     // base64url
}

export interface PushResult {
  status: number;
  ok: boolean;
  /** true when the subscription is permanently dead (410/404) — caller should delete it. */
  gone: boolean;
  responseText?: string;
}

export async function sendPush(vapid: VapidContext, sub: PushSubscription, payload: Uint8Array | string): Promise<PushResult> {
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
      'TTL': '60',                                 // 60s — these are "wake up" pings, stale ones are useless
      'Urgency': 'high',
      'Authorization': `vapid t=${jwt}, k=${vapid.publicKeyB64u}`,
    },
    body: encrypted,
  });

  const gone = res.status === 404 || res.status === 410;
  let responseText: string | undefined;
  if (!res.ok && !gone) {
    try { responseText = await res.text(); } catch { /* ignore */ }
  }
  return { status: res.status, ok: res.ok, gone, responseText };
}
