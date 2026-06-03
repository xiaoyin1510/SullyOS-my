export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
}

export function bytesToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(b64u: string): Uint8Array {
  const padded = b64u.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function generateVapidKeyPair(): Promise<VapidKeyPair> {
  if (!crypto?.subtle) {
    throw new Error(
      'crypto.subtle 不可用。请确认当前页面通过 HTTPS 或 localhost 访问，Safari 无痕模式下也会禁用 WebCrypto。',
    );
  }
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  // Public key: raw uncompressed = 0x04 || X(32) || Y(32) = 65 bytes
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  // Private key: extract d from JWK (already base64url per JWK spec)
  const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  if (!privJwk.d) {
    throw new Error('导出私钥失败：JWK 缺少 d 字段');
  }
  return {
    publicKey: bytesToBase64Url(pubRaw),
    privateKey: privJwk.d,
  };
}

export function generateClientToken(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return bytesToBase64Url(buf);
}
