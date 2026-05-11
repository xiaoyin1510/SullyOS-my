const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1";
const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const XHS_BASE = "https://edith.xiaohongshu.com";
const XHS_MEDIA_HOST_CANDIDATES = [
  "https://edith.xiaohongshu.com",
  "https://creator.xiaohongshu.com",
  "https://www.xiaohongshu.com",
];
const XHS_PUBLISH_HOST_CANDIDATES = [
  "https://edith.xiaohongshu.com",
  "https://www.xiaohongshu.com",
];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Depth, X-Brave-API-Key, X-Notion-API-Key, X-Feishu-Token, X-Xhs-Cookie, X-Netease-Cookie, X-WebDAV-Method, X-WebDAV-Depth, X-WebDAV-Range, X-GitHub-Method, X-GitHub-Api-Version, Mcp-Session-Id, Accept, Range",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(obj, { status = 200, origin } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin),
    },
  });
}

function route(url) {
  const p = url.pathname.replace(/\/+$/, "");
  if (p === "" || p === "/") return { kind: "web" };
  if (p === "/search") return { kind: "web" };
  if (p === "/news") return { kind: "news" };
  if (p === "/videos") return { kind: "videos" };
  if (p === "/images") return { kind: "images" };
  return null;
}

// ================================================================
//  小红书签名 — 基于 xhshow 逆向的真实算法
//  参考: https://github.com/Cloxl/xhshow
// ================================================================

// ---------- Pure-JS MD5 (RFC 1321) ----------
function md5(string) {
  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936);   d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);  b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);      b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);   d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510);    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);   b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);  b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);     d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);   b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);  d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);   b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558);       d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);  b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);   d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);   b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);   b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);   b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844);    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);   d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);  b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);    b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(string);
  let n = bytes.length;
  let tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let i;
  for (i = 0; i < n; i++) tail[i >> 2] |= bytes[i] << ((i % 4) << 3);
  // We need to handle longer strings properly
  let state = [1732584193, -271733879, -1732584194, 271733878];
  let nBlocks = ((n + 8) >> 6) + 1;
  let totalLen = nBlocks * 64;
  let buf = new Uint8Array(totalLen);
  buf.set(bytes);
  buf[n] = 0x80;
  let dv = new DataView(buf.buffer);
  dv.setUint32(totalLen - 8, (n * 8) & 0xFFFFFFFF, true);
  dv.setUint32(totalLen - 4, Math.floor(n * 8 / 0x100000000), true);
  for (let offset = 0; offset < totalLen; offset += 64) {
    let k = [];
    for (let j = 0; j < 16; j++) k[j] = dv.getUint32(offset + j * 4, true);
    md5cycle(state, k);
  }
  const hex = [];
  for (let si = 0; si < 4; si++) {
    for (let bi = 0; bi < 4; bi++) {
      hex.push(((state[si] >> (bi * 8)) & 0xFF).toString(16).padStart(2, '0'));
    }
  }
  return hex.join('');
}

// ---------- Custom Base64 alphabets ----------
const STD_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CUSTOM_B64 = "ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5";
const X3_B64 = "MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G";

function translateB64(input, fromAlpha, toAlpha) {
  let out = "";
  for (const ch of input) {
    const idx = fromAlpha.indexOf(ch);
    out += idx >= 0 ? toAlpha[idx] : ch;
  }
  return out;
}

function bytesToStdB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function customB64Encode(bytes) {
  return translateB64(bytesToStdB64(bytes), STD_B64, CUSTOM_B64);
}

function x3B64Encode(bytes) {
  return translateB64(bytesToStdB64(bytes), STD_B64, X3_B64);
}

// ---------- 124-byte XOR key (from xhshow) ----------
const HEX_KEY = "71a302257793271ddd273bcee3e4b98d9d7935e1da33f5765e2ea8afb6dc77a51a499d23b67c20660025860cbf13d4540d92497f58686c574e508f46e1956344f39139bf4faf22a3eef120b79258145b2feb5193b6478669961298e79bedca646e1a693a926154a5a7a1bd1cf0dedb742f917a747a1e388b234f2277";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes;
}
const XOR_KEY = hexToBytes(HEX_KEY);

// ---------- Constants ----------
const VERSION_BYTES = [119, 104, 96, 41];
const CHECKSUM_FIXED_TAIL = [249, 65, 103, 103, 201, 181, 131, 99, 94, 7, 68, 250, 132, 21];

function intToLE(val, len = 4) {
  const arr = [];
  for (let i = 0; i < len; i++) { arr.push(val & 0xFF); val = Math.floor(val / 256); }
  return arr;
}

// Timestamp fingerprint with XOR key 41
function envFingerprintA(tsMs, xorKey) {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  // Write as two 32-bit ints (little-endian) since BigInt may not be available everywhere
  dv.setUint32(0, tsMs & 0xFFFFFFFF, true);
  dv.setUint32(4, Math.floor(tsMs / 0x100000000) & 0xFFFFFFFF, true);
  const data = new Uint8Array(buf);
  const sum1 = (data[1] + data[2] + data[3] + data[4]) & 0xFF;
  const sum2 = (data[5] + data[6] + data[7]) & 0xFF;
  data[0] = (sum1 + sum2) & 0xFF;
  for (let i = 0; i < data.length; i++) data[i] ^= xorKey;
  return Array.from(data);
}

function envFingerprintB(tsMs) {
  const buf = new ArrayBuffer(8);
  const dv = new DataView(buf);
  dv.setUint32(0, tsMs & 0xFFFFFFFF, true);
  dv.setUint32(4, Math.floor(tsMs / 0x100000000) & 0xFFFFFFFF, true);
  return Array.from(new Uint8Array(buf));
}

// ---------- Build the 124-byte payload ----------
function buildPayloadArray(md5Hex, a1Value, contentStr, timestampSec) {
  const payload = [];

  // [0-3] Version magic
  payload.push(...VERSION_BYTES);

  // [4-7] Random seed
  const seed = new Uint8Array(4);
  crypto.getRandomValues(seed);
  payload.push(...seed);
  const seedByte0 = seed[0];

  // [8-15] Env fingerprint A
  const tsMs = Math.floor(timestampSec * 1000);
  payload.push(...envFingerprintA(tsMs, 41));

  // [16-23] Env fingerprint B (offset timestamp)
  const offset = Math.floor(Math.random() * 40) + 10;
  payload.push(...envFingerprintB(Math.floor((timestampSec - offset) * 1000)));

  // [24-27] sequence value
  payload.push(...intToLE(Math.floor(Math.random() * 36) + 15));

  // [28-31] window props length
  payload.push(...intToLE(Math.floor(Math.random() * 301) + 900));

  // [32-35] content string length
  payload.push(...intToLE(contentStr.length));

  // [36-43] First 8 bytes of MD5, XOR'd with seedByte0
  const md5Bytes = hexToBytes(md5Hex);
  for (let i = 0; i < 8; i++) payload.push(md5Bytes[i] ^ seedByte0);

  // [44] a1 field length marker
  payload.push(52);

  // [45-96] a1 cookie value, padded/truncated to 52 bytes
  const a1Bytes = new TextEncoder().encode(a1Value);
  const a1Padded = new Uint8Array(52);
  a1Padded.set(a1Bytes.slice(0, 52));
  payload.push(...a1Padded);

  // [97] app identifier length marker
  payload.push(10);

  // [98-107] "xhs-pc-web"
  const appId = new TextEncoder().encode("xhs-pc-web");
  const appPadded = new Uint8Array(10);
  appPadded.set(appId.slice(0, 10));
  payload.push(...appPadded);

  // [108-109] fixed values
  payload.push(1);
  payload.push(1); // CHECKSUM_VERSION

  // [110] seed XOR 115
  payload.push(seedByte0 ^ 115);

  // [111-124] fixed tail
  payload.push(...CHECKSUM_FIXED_TAIL);

  return new Uint8Array(payload);
}

// ---------- XOR transform ----------
function xorTransform(payload) {
  const result = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) {
    result[i] = i < XOR_KEY.length ? (payload[i] ^ XOR_KEY[i]) & 0xFF : payload[i] & 0xFF;
  }
  return result;
}

// ---------- CRC32 table for X-s-common ----------
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? ((0xEDB88320 ^ (c >>> 1)) >>> 0) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

// XHS variant of CRC32 — processes first 57 chars
function mrc(e) {
  let o = 0xFFFFFFFF;
  const len = Math.min(57, e.length);
  for (let n = 0; n < len; n++) {
    o = (CRC32_TABLE[(o & 255) ^ e.charCodeAt(n)] ^ (o >>> 8)) >>> 0;
  }
  return ((o ^ 0xFFFFFFFF) ^ 0xEDB88320) >>> 0;
}

// Generate X-s-common header value
function generateXsCommon(xs, xt, a1) {
  const common = {
    s0: 5, s1: "",
    x0: "1", x1: "3.6.8", x2: "Windows",
    x3: "xhs-pc-web", x4: "4.21.1",
    x5: a1, x6: xt, x7: xs,
    x8: "", x9: mrc(xt + xs), x10: 1
  };
  const jsonStr = JSON.stringify(common);
  const encoded = encodeURIComponent(jsonStr);
  const bytes = Array.from(encoded).map(c => c.charCodeAt(0));
  return customB64Encode(bytes);
}

// ---------- Generate X-s and X-t ----------
function signXs(method, uri, a1Value, postBody = null) {
  // Step 1: Build content string (POST 需要包含 body)
  let content = uri;
  if (method === "POST" && postBody) {
    content = uri + JSON.stringify(postBody);
  }

  // Step 2: MD5
  const md5Hex = md5(content);

  // Step 3: Build 124-byte payload
  const timestamp = Date.now() / 1000;
  const payloadArray = buildPayloadArray(md5Hex, a1Value, content, timestamp);

  // Step 4: XOR transform
  const xorResult = xorTransform(payloadArray);

  // Step 5: Custom Base64 → x3
  const x3Sig = x3B64Encode(Array.from(xorResult.slice(0, 124)));

  // Step 6: Signature data JSON
  const sigData = {
    x0: "4.2.6",
    x1: "xhs-pc-web",
    x2: "Windows",
    x3: "mns0301_" + x3Sig,
    x4: ""
  };

  // Step 7: Encode entire JSON with custom Base64
  const jsonStr = JSON.stringify(sigData);
  const jsonBytes = Array.from(new TextEncoder().encode(jsonStr));

  // Step 8: Final x-s
  const xs = "XYS_" + customB64Encode(jsonBytes);
  const xt = String(Math.floor(timestamp * 1000));

  return { xs, xt };
}

// ---------- Cookie parser ----------
function getCookieValue(cookieStr, key) {
  const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${key}=([^;]*)`));
  return match ? match[1] : '';
}

// ---------- XHS API fetch ----------
// options: { baseUrl, origin, referer }
function xhsFetch(cookie, api, method = 'GET', body = null, options = {}) {
  const a1 = getCookieValue(cookie, 'a1');
  if (!a1) {
    return Promise.resolve({ ok: false, status: 401, data: { success: false, message: 'Cookie 中缺少 a1' } });
  }

  const { xs, xt } = signXs(method, api, a1, body);
  const xsCommon = generateXsCommon(xs, xt, a1);

  const originHost = options.origin || 'https://www.xiaohongshu.com';
  const refererUrl = options.referer || (originHost + '/');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cookie': cookie,
    'Origin': originHost,
    'Referer': refererUrl,
    'X-s': xs,
    'X-t': xt,
    'X-s-common': xsCommon,
    'X-b3-traceid': crypto.randomUUID().replace(/-/g, '').slice(0, 16),
  };

  const fetchOptions = { method, headers };
  if (method === 'POST' || method === 'PUT') {
    headers['Content-Type'] = 'application/json;charset=UTF-8';
    if (body) fetchOptions.body = JSON.stringify(body);
  }

  const baseUrl = options.baseUrl || XHS_BASE;
  const url = `${baseUrl}${api}`;
  return fetch(url, fetchOptions).then(async (res) => {
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  });
}


// ---------- XHS 图片上传 ----------
// 生成一个最小的有效 PNG 图片 (1080x1080 纯色)
function generateMinimalPNG() {
  // 生成一张 1x1 的深紫色 PNG，小红书会自动拉伸
  // PNG signature + IHDR + IDAT + IEND
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  // IHDR: 1x1, 8-bit RGB
  const ihdr = [
    0, 0, 0, 13, // chunk length
    73, 72, 68, 82, // "IHDR"
    0, 0, 0, 1, // width = 1
    0, 0, 0, 1, // height = 1
    8, 2, // 8-bit RGB
    0, 0, 0, // compression, filter, interlace
    // CRC32 of IHDR
    0x1E, 0x93, 0x09, 0x36
  ];
  // IDAT: deflated [filter_none(0), R, G, B] = [0, 88, 28, 120] (dark purple)
  // Raw deflate of [0, 88, 28, 120]: use stored block
  const rawData = new Uint8Array([0, 88, 28, 120]); // filter=0, R=88, G=28, B=120
  // Zlib: CMF=0x78, FLG=0x01 (no dict, low compression)
  // Stored block: BFINAL=1, BTYPE=00, LEN=4, NLEN=0xFFFB, data, Adler32
  const adler = adler32(rawData);
  const idat_data = new Uint8Array([
    0x78, 0x01, // zlib header
    0x01, // BFINAL=1, BTYPE=00 (stored)
    0x04, 0x00, 0xFB, 0xFF, // LEN=4, NLEN=~4
    ...rawData,
    (adler >> 24) & 0xFF, (adler >> 16) & 0xFF, (adler >> 8) & 0xFF, adler & 0xFF
  ]);
  const idat_crc = crc32Bytes([73, 68, 65, 84, ...idat_data]);
  const idat = [
    (idat_data.length >> 24) & 0xFF, (idat_data.length >> 16) & 0xFF,
    (idat_data.length >> 8) & 0xFF, idat_data.length & 0xFF,
    73, 68, 65, 84, // "IDAT"
    ...idat_data,
    (idat_crc >> 24) & 0xFF, (idat_crc >> 16) & 0xFF, (idat_crc >> 8) & 0xFF, idat_crc & 0xFF
  ];
  // IEND
  const iend = [0, 0, 0, 0, 73, 69, 78, 68, 0xAE, 0x42, 0x60, 0x82];
  return new Uint8Array([...signature, ...ihdr, ...idat, ...iend]);
}

function adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32Bytes(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = (CRC32_TABLE[(crc & 0xFF) ^ data[i]] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 获取 XHS 上传凭证
// ReaJason/xhs 使用 GET edith.xiaohongshu.com/api/media/v1/upload/web/permit?...
// 真实浏览器发布时 Origin 为 creator.xiaohongshu.com
async function getUploadCredentials(cookie, count = 1) {
  const params = { biz_name: 'spectrum', scene: 'image', file_count: count, version: '1', source: 'web' };
  const qs = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
  const getApi = `/api/media/v1/upload/web/permit?${qs}`;
  const attempts = [];

  // 组合: host × origin，优先匹配 ReaJason 库 (edith + 无特殊 origin)
  const originCombos = [
    {}, // 默认 www.xiaohongshu.com
    { origin: 'https://creator.xiaohongshu.com', referer: 'https://creator.xiaohongshu.com/' },
  ];

  for (const baseUrl of XHS_MEDIA_HOST_CANDIDATES) {
    for (const originOpt of originCombos) {
      const result = await xhsFetch(cookie, getApi, 'GET', null, { baseUrl, ...originOpt });
      attempts.push({
        baseUrl,
        origin: originOpt.origin || 'default',
        method: 'GET',
        status: result.status,
        ok: result.ok,
        raw: JSON.stringify(result.data).slice(0, 240),
      });
      if (result.ok && result.data?.data?.uploadTempPermits) {
        return { ...result, debug: { baseUrl, method: 'GET', origin: originOpt.origin || 'default', attempts } };
      }
    }
  }

  return {
    ok: false,
    status: 502,
    data: { message: '所有候选 host + origin 的上传凭证接口均失败' },
    debug: { attempts }
  };
}

// 上传图片字节到 XHS (ros-upload CDN)
async function uploadBytesToXhs(cookie, imgBytes, contentType = 'image/png') {
  // Step 1: 获取上传凭证
  const result = await getUploadCredentials(cookie);
  // 响应格式: { data: { uploadTempPermits: [{ fileIds: [...], token: "..." }] } }
  // 或者:     { uploadTempPermits: [...] }
  const permitRoot = result.data?.data || result.data;
  const tempPermit = permitRoot?.uploadTempPermits?.[0];

  if (!tempPermit?.fileIds?.[0] || !tempPermit?.token) {
    return {
      error: '获取上传凭证失败',
      debug: {
        raw: JSON.stringify(result.data).slice(0, 500),
        attempts: result.debug?.attempts || []
      }
    };
  }

  const fileId = tempPermit.fileIds[0];
  const token = tempPermit.token;

  // Step 2: PUT 上传到 ros-upload CDN
  const uploadUrl = `https://ros-upload.xiaohongshu.com/${fileId}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'X-Cos-Security-Token': token,
      'Content-Type': contentType,
    },
    body: imgBytes
  });

  if (uploadRes.ok) {
    return { file_id: fileId };
  }

  const uploadText = await uploadRes.text().catch(() => '');
  return {
    error: `CDN上传失败: ${uploadRes.status}`,
    debug: { fileId, response: uploadText.slice(0, 300) }
  };
}

// 上传图片到 XHS (通过 image_url 下载后上传)
async function uploadImageToXhs(cookie, imageUrl) {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return { error: `下载图片失败: ${imgRes.status}`, debug: { url: imageUrl } };
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get('content-type') || 'image/jpeg';
    return await uploadBytesToXhs(cookie, imgBytes, ct);
  } catch (e) {
    return { error: `图片上传异常: ${e.message}` };
  }
}

// 上传占位图到 XHS
async function uploadPlaceholderImage(cookie) {
  try {
    const pngData = generateMinimalPNG();
    return await uploadBytesToXhs(cookie, pngData, 'image/png');
  } catch (e) {
    return { error: `占位图上传异常: ${e.message}` };
  }
}

// ================================================================
//  网易云音乐代理 — 转发到用户自部署的 api-enhanced
//  api-enhanced: https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced
//  一键部署到 Vercel, 得到一个类似 https://xxx.vercel.app 的地址后填到下面
// ================================================================
//
// ⚠️ 多上游 —— 可以填 N 个 api-enhanced 部署地址, Worker 会随机挑选 + 自动容灾。
// 推荐组合:
//   1) Vercel (主) — 你现有的这个
//   2) Deno Deploy (备) — 免费 100w req/天, 国外走这个最快
//   3) 另一个 Vercel 账号的二部署 — 双倍配额
// 见 notes/music-scaling.md 部署教程。
const NETEASE_UPSTREAMS = [
  "https://api-enhanced-ochre-kappa.vercel.app",
  // "https://sully-music.deno.dev",          // ← 部署 Deno Deploy 后把 URL 粘贴到这里
  // "https://api-enhanced-mirror.vercel.app", // ← 部署第二个 Vercel 后把 URL 粘贴到这里
];

// 国内 IP 伪装, 部分接口需要 realIP 参数才会返回内地版权数据
const NETEASE_REAL_IP = "116.25.146.177";

// ========== 边缘缓存 TTL 配置 ==========
// 单位: 秒。0 或未列出的 action 不缓存（登录/用户数据等）。
// 命中缓存 → 不打上游, 零成本。Cloudflare 免费 KV-like 缓存, 每 PoP 独立。
const NETEASE_CACHE_TTL = {
  // 长期稳定 — 激进缓存
  'lyric':              30 * 24 * 3600, // 30天 (歌词几乎不变)
  'lyric/new':          30 * 24 * 3600,
  'song/detail':              3600,     // 1小时
  'album':                    1800,     // 30分
  'artists':                  1800,
  'artist/songs':             1800,
  'mv/detail':                1800,
  // 中期
  'search':                    600,     // 10分
  'search/hot':               1800,
  'search/hot/detail':        1800,
  'search/default':            600,
  'toplist':                   600,
  'toplist/detail':            600,
  'top/playlist':              600,
  'playlist/detail':           600,
  'playlist/track/all':        600,
  'banner':                   1800,
  'personalized':             1800,
  'personalized/newsong':     1800,
  'comment/music':             300,     // 5分
  // 短期 — 签名链接有效期短
  'song/url':                  180,     // 3分 (URL 5分钟过期, 留余量)
  'mv/url':                    180,
  // 用户专属: 不出现在本表 = 不缓存
  //   login/*, captcha/*, user/*, likelist, like, logout,
  //   recommend/songs, personal_fm, daily_signin, check/music
};

// 已知 action → 真实上游路径的特例映射（大多数 api-enhanced 路径和 action 同名，
// 下面只处理名字不同 / 有特殊参数的那几个）。
const NETEASE_ACTION_REWRITE = {
  "search": "/cloudsearch",           // 用 cloudsearch 返回更完整的字段
  "song/url": "/song/url/v1",
  "user/detail": "/user/detail",
  "user/playlist": "/user/playlist",
  "user/record": "/user/record",
  "user/cloud": "/user/cloud",
  "user/subcount": "/user/subcount",
  "likelist": "/likelist",
  "like": "/like",
  "playlist/detail": "/playlist/detail",
  "playlist/track/all": "/playlist/track/all",
  "personal_fm": "/personal_fm",
  "recommend/songs": "/recommend/songs",
  "recommend/resource": "/recommend/resource",
  "daily_signin": "/daily_signin",
  "toplist": "/toplist",
  "toplist/detail": "/toplist/detail",
  "top/playlist": "/top/playlist",
  "personalized": "/personalized",
  "personalized/newsong": "/personalized/newsong",
  "banner": "/banner",
  "login/status": "/login/status",
  "login/cellphone": "/login/cellphone",
  "login/qr/key": "/login/qr/key",
  "login/qr/create": "/login/qr/create",
  "login/qr/check": "/login/qr/check",
  "captcha/sent": "/captcha/sent",
  "captcha/verify": "/captcha/verify",
  "logout": "/logout",
  "song/detail": "/song/detail",
  "lyric": "/lyric",
  "lyric/new": "/lyric/new",
  "comment/music": "/comment/music",
  "album": "/album",
  "artists": "/artists",
  "artist/songs": "/artist/songs",
  "mv/detail": "/mv/detail",
  "mv/url": "/mv/url",
};

// action 白名单 — 只允许 api-enhanced 已知的安全接口（防止被当成开放代理）
const NETEASE_ACTION_ALLOWED = new Set([
  ...Object.keys(NETEASE_ACTION_REWRITE),
  "song/url",
  "search/suggest",
  "search/hot",
  "search/hot/detail",
  "search/default",
  "check/music",
]);

function buildNeteaseUpstream(action, body, cookie) {
  if (!NETEASE_ACTION_ALLOWED.has(action)) return null;

  const p = new URLSearchParams();
  if (cookie && cookie.trim()) p.set("cookie", cookie.trim());
  p.set("realIP", NETEASE_REAL_IP);
  // cache-buster, 避免 Vercel 边缘缓存干扰登录态
  p.set("timestamp", Date.now().toString());

  // Special-case 几个需要重命名 / 默认值的字段
  if (action === "search") {
    p.set("keywords", body.keyword || body.keywords || "");
    p.set("type", String(body.type || 1));
    p.set("limit", String(body.limit || 30));
    p.set("offset", String(body.offset || 0));
  } else if (action === "song/url") {
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (ids.length) p.set("id", ids.join(","));
    p.set("level", body.level || "exhigh");
  } else if (action === "song/detail") {
    const ids = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    if (ids.length) p.set("ids", ids.join(","));
  } else if (action === "user/playlist") {
    if (body.uid != null) p.set("uid", String(body.uid));
    p.set("limit", String(body.limit || 30));
    p.set("offset", String(body.offset || 0));
  } else if (action === "user/record") {
    if (body.uid != null) p.set("uid", String(body.uid));
    p.set("type", String(body.type ?? 1)); // 0: 全部, 1: 最近一周
  } else if (action === "user/cloud") {
    p.set("limit", String(body.limit || 30));
    p.set("offset", String(body.offset || 0));
  } else {
    // 通用：所有其余参数直接透传（字符串化）
    for (const [k, v] of Object.entries(body || {})) {
      if (v == null) continue;
      if (Array.isArray(v)) p.set(k, v.join(","));
      else p.set(k, String(v));
    }
  }

  const upstream = NETEASE_ACTION_REWRITE[action] || `/${action}`;
  return `${upstream}?${p}`;
}

// ========== 缓存 Key 构造 ==========
// 使用"虚拟" URL 作为 Cache API 的 key。只包含业务参数（action + 过滤后的 body），
// 故意剔除 cookie / realIP / timestamp / level(cookie 桶代替) 等不稳定参数。
// 这样同一个 action 的相同查询跨 PoP / 多上游 都能命中同一个缓存条目。
function buildCacheKey(action, body, cookieBucket) {
  const p = new URLSearchParams();
  const skip = new Set(['timestamp', 'realIP', 'cookie', '_']);
  for (const [k, v] of Object.entries(body || {})) {
    if (v == null || skip.has(k)) continue;
    if (Array.isArray(v)) p.set(k, v.join(","));
    else p.set(k, String(v));
  }
  // 排序保证确定性 (对象顺序 / 用户输入顺序不同也能命中同一 key)
  const sorted = [...p.entries()].sort(([a], [b]) => a.localeCompare(b));
  const qs = sorted.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return new Request(
    `https://sully-netease-cache.internal/${action}/${cookieBucket}?${qs}`,
    { method: 'GET' }
  );
}

// ========== 多上游 fetch 带失败转移 ==========
// 从 NETEASE_UPSTREAMS 随机打乱, 依次尝试, 任何一个成功(HTTP 2xx + code!=-460)就返回。
// 自动屏蔽被网易风控的上游 (HTTP 200 但 body 里 code=-460 / -7 = 被限流)。
function shuffleCopy(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchFromAnyUpstream(upstreamPath, timeoutMs = 8000) {
  const order = shuffleCopy(NETEASE_UPSTREAMS);
  const errors = [];
  for (const base of order) {
    const upstreamUrl = base.replace(/\/+$/, '') + upstreamPath;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(upstreamUrl, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: ctrl.signal,
      });
      clearTimeout(t);

      const text = await res.text();
      // HTTP 层挂了直接换下一个
      if (!res.ok) {
        errors.push(`${new URL(base).host} HTTP ${res.status}`);
        continue;
      }
      // 应用层风控: 尝试识别 -460/-7 等明显失败码, 这种情况下换个上游可能成功
      let shouldFailover = false;
      try {
        const j = JSON.parse(text);
        if (j?.code === -460 || j?.code === -7) shouldFailover = true;
      } catch { /* 不是 JSON, 当成功处理 */ }
      if (shouldFailover && order.length > 1) {
        errors.push(`${new URL(base).host} risk-control (code=-460/-7)`);
        continue;
      }
      return { text, status: res.status, upstream: new URL(base).host, error: null };
    } catch (e) {
      errors.push(`${new URL(base).host} ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    }
  }
  return { text: '', status: 502, upstream: '', error: errors.join(' | ') };
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ========== WebDAV 代理 ==========
    if (url.pathname === '/webdav') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, { status: 405, origin });
      }
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing url parameter' }, { status: 400, origin });
      }
      let parsedTarget;
      try {
        parsedTarget = new URL(targetUrl);
        if (parsedTarget.protocol !== 'https:') {
          return jsonResponse({ error: 'Only HTTPS URLs allowed' }, { status: 400, origin });
        }
      } catch {
        return jsonResponse({ error: 'Invalid URL' }, { status: 400, origin });
      }
      const webdavMethod = (request.headers.get('X-WebDAV-Method') || 'GET').toUpperCase();
      const allowedMethods = ['GET', 'PUT', 'PROPFIND', 'MKCOL', 'DELETE'];
      if (!allowedMethods.includes(webdavMethod)) {
        return jsonResponse({ error: 'WebDAV method not allowed' }, { status: 400, origin });
      }
      const forwardHeaders = {};
      const auth = request.headers.get('Authorization');
      if (auth) forwardHeaders['Authorization'] = auth;
      const contentType = request.headers.get('Content-Type');
      if (contentType) forwardHeaders['Content-Type'] = contentType;
      const depth = request.headers.get('X-WebDAV-Depth') || request.headers.get('Depth');
      if (depth) forwardHeaders['Depth'] = depth;
      const range = request.headers.get('X-WebDAV-Range') || request.headers.get('Range');
      if (range) forwardHeaders['Range'] = range;
      forwardHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
      forwardHeaders['Accept'] = '*/*';
      try {
        let body = null;
        if (webdavMethod !== 'GET' && webdavMethod !== 'MKCOL') {
          body = await request.arrayBuffer();
          if (body.byteLength === 0) body = null;
        }
        const upstream = await fetch(targetUrl, {
          method: webdavMethod,
          headers: forwardHeaders,
          body,
        });
        console.log('webdav', webdavMethod, targetUrl, '→', upstream.status);
        const respHeaders = new Headers(corsHeaders(origin));
        const rct = upstream.headers.get('Content-Type');
        if (rct) respHeaders.set('Content-Type', rct);
        // Only forward Content-Length for range responses (size is known and the
        // chunk fully buffers). For full-file 200 streams, omit Content-Length
        // and let chunked transfer-encoding handle it — otherwise a mid-stream
        // disconnect surfaces as ERR_CONTENT_LENGTH_MISMATCH on the client.
        if (upstream.status === 206) {
          const rcl = upstream.headers.get('Content-Length');
          if (rcl) respHeaders.set('Content-Length', rcl);
        }
        const rcr = upstream.headers.get('Content-Range');
        if (rcr) respHeaders.set('Content-Range', rcr);
        const rar = upstream.headers.get('Accept-Ranges');
        if (rar) respHeaders.set('Accept-Ranges', rar);
        respHeaders.set('X-Upstream-Status', String(upstream.status));
        respHeaders.set('X-Upstream-Host', parsedTarget.host);
        respHeaders.set('Access-Control-Expose-Headers', 'X-Upstream-Status, X-Upstream-Host, Content-Length, Content-Range, Accept-Ranges');
        return new Response(upstream.body, {
          status: upstream.status,
          headers: respHeaders,
        });
      } catch (e) {
        return jsonResponse({
          error: `Proxy error: ${String(e && e.message || e)}`,
          stack: String(e && e.stack || '').slice(0, 400),
        }, { status: 502, origin });
      }
    }

    // ========== GitHub 代理 ==========
    // 给国内连不上 github.com 的用户兜底用。只放行 api.github.com 和
    // uploads.github.com，方法用 X-GitHub-Method 头携带。
    if (url.pathname === '/github') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, { status: 405, origin });
      }
      const targetUrl = url.searchParams.get('url');
      if (!targetUrl) {
        return jsonResponse({ error: 'Missing url parameter' }, { status: 400, origin });
      }
      let parsedGh;
      try {
        parsedGh = new URL(targetUrl);
      } catch {
        return jsonResponse({ error: 'Invalid URL' }, { status: 400, origin });
      }
      const allowedHosts = new Set(['api.github.com', 'uploads.github.com']);
      if (parsedGh.protocol !== 'https:' || !allowedHosts.has(parsedGh.hostname)) {
        return jsonResponse({ error: 'Host not allowed' }, { status: 400, origin });
      }
      const ghMethod = (request.headers.get('X-GitHub-Method') || 'GET').toUpperCase();
      const ghAllowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (!ghAllowed.includes(ghMethod)) {
        return jsonResponse({ error: 'Method not allowed' }, { status: 400, origin });
      }
      const ghHeaders = {};
      const ghAuth = request.headers.get('Authorization');
      if (ghAuth) ghHeaders['Authorization'] = ghAuth;
      const ghCt = request.headers.get('Content-Type');
      if (ghCt) ghHeaders['Content-Type'] = ghCt;
      const ghAccept = request.headers.get('Accept');
      if (ghAccept) ghHeaders['Accept'] = ghAccept;
      const ghApiVer = request.headers.get('X-GitHub-Api-Version');
      if (ghApiVer) ghHeaders['X-GitHub-Api-Version'] = ghApiVer;
      // GitHub 拒绝没有 UA 的请求
      ghHeaders['User-Agent'] = 'sully-backup-proxy';
      try {
        let ghBody = null;
        if (ghMethod !== 'GET' && ghMethod !== 'DELETE') {
          ghBody = await request.arrayBuffer();
          if (ghBody.byteLength === 0) ghBody = null;
        }
        const ghUpstream = await fetch(targetUrl, {
          method: ghMethod,
          headers: ghHeaders,
          body: ghBody,
          redirect: 'follow',
        });
        console.log('github', ghMethod, targetUrl, '→', ghUpstream.status);
        const ghRespHeaders = new Headers(corsHeaders(origin));
        const grct = ghUpstream.headers.get('Content-Type');
        if (grct) ghRespHeaders.set('Content-Type', grct);
        if (ghUpstream.status === 206) {
          const grcl = ghUpstream.headers.get('Content-Length');
          if (grcl) ghRespHeaders.set('Content-Length', grcl);
        }
        const grcr = ghUpstream.headers.get('Content-Range');
        if (grcr) ghRespHeaders.set('Content-Range', grcr);
        ghRespHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
        return new Response(ghUpstream.body, {
          status: ghUpstream.status,
          headers: ghRespHeaders,
        });
      } catch (e) {
        return jsonResponse({
          error: `Proxy error: ${String(e && e.message || e)}`,
          stack: String(e && e.stack || '').slice(0, 400),
        }, { status: 502, origin });
      }
    }

    // ========== Notion 代理 ==========
    if (url.pathname.startsWith('/notion/')) {
      const notionKey = request.headers.get("X-Notion-API-Key");
      if (!notionKey) {
        return jsonResponse({ error: "Missing header: X-Notion-API-Key" }, { status: 401, origin });
      }

      // POST /notion/pages - 创建页面
      if (url.pathname === '/notion/pages' && request.method === 'POST') {
        const body = await request.json();
        const notionRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        const text = await notionRes.text();
        return new Response(text, {
          status: notionRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // POST /notion/query - 查询数据库
      if (url.pathname === '/notion/query' && request.method === 'POST') {
        const body = await request.json();
        const dbId = body.database_id;
        if (!dbId) {
          return jsonResponse({ error: "Missing database_id in body" }, { status: 400, origin });
        }
        const notionRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filter: body.filter || undefined,
            sorts: body.sorts || [{ property: 'Date', direction: 'descending' }],
            page_size: body.page_size || 10
          })
        });
        const text = await notionRes.text();
        return new Response(text, {
          status: notionRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // GET /notion/database/:id - 测试连接
      if (url.pathname.startsWith('/notion/database/') && request.method === 'GET') {
        const dbId = url.pathname.replace('/notion/database/', '');
        const notionRes = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28'
          }
        });
        const text = await notionRes.text();
        return new Response(text, {
          status: notionRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // GET /notion/blocks/:pageId - 读取页面内容
      if (url.pathname.startsWith('/notion/blocks/') && request.method === 'GET') {
        const pageId = url.pathname.replace('/notion/blocks/', '');
        const notionRes = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
          headers: {
            'Authorization': `Bearer ${notionKey}`,
            'Notion-Version': '2022-06-28'
          }
        });
        const text = await notionRes.text();
        return new Response(text, {
          status: notionRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      return jsonResponse({ error: "Unknown Notion endpoint" }, { status: 404, origin });
    }

    // ========== 飞书代理 ==========
    if (url.pathname.startsWith('/feishu/')) {
      // POST /feishu/token - 获取 tenant_access_token
      if (url.pathname === '/feishu/token' && request.method === 'POST') {
        const body = await request.json();
        if (!body.app_id || !body.app_secret) {
          return jsonResponse({ error: "Missing app_id or app_secret" }, { status: 400, origin });
        }
        const fsRes = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            app_id: body.app_id,
            app_secret: body.app_secret
          })
        });
        const text = await fsRes.text();
        return new Response(text, {
          status: fsRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // 以下所有 bitable 端点都需要 token
      const feishuToken = request.headers.get("X-Feishu-Token");
      if (!feishuToken) {
        return jsonResponse({ error: "Missing header: X-Feishu-Token" }, { status: 401, origin });
      }
      const feishuHeaders = {
        'Authorization': `Bearer ${feishuToken}`,
        'Content-Type': 'application/json'
      };

      // 解析路径: /feishu/bitable/{appToken}/...
      const bitablePath = url.pathname.replace('/feishu/bitable/', '');
      const segments = bitablePath.split('/');
      if (segments.length < 1 || !segments[0]) {
        return jsonResponse({ error: "Invalid path. Need /feishu/bitable/{appToken}/..." }, { status: 400, origin });
      }

      const appToken = segments[0];
      const rest = segments.slice(1).join('/');

      // GET /feishu/bitable/{appToken}/tables - 列出所有数据表（测试连接）
      if (rest === 'tables' && request.method === 'GET') {
        const fsRes = await fetch(
          `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables`,
          { headers: feishuHeaders }
        );
        const text = await fsRes.text();
        return new Response(text, {
          status: fsRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // 以下端点需要 tableId
      const tableId = segments[1];
      if (!tableId) {
        return jsonResponse({ error: "Missing tableId in path" }, { status: 400, origin });
      }
      const tableRest = segments.slice(2).join('/');

      // POST /feishu/bitable/{appToken}/{tableId}/records - 创建记录
      if (tableRest === 'records' && request.method === 'POST') {
        const body = await request.json();
        const fsRes = await fetch(
          `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
          {
            method: 'POST',
            headers: feishuHeaders,
            body: JSON.stringify(body)
          }
        );
        const text = await fsRes.text();
        return new Response(text, {
          status: fsRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // POST /feishu/bitable/{appToken}/{tableId}/records/search - 搜索记录
      if (tableRest === 'records/search' && request.method === 'POST') {
        const body = await request.json();
        const fsRes = await fetch(
          `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
          {
            method: 'POST',
            headers: feishuHeaders,
            body: JSON.stringify(body)
          }
        );
        const text = await fsRes.text();
        return new Response(text, {
          status: fsRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      // GET /feishu/bitable/{appToken}/{tableId}/records/{recordId} - 获取单条记录
      if (tableRest.startsWith('records/') && tableRest !== 'records/search' && request.method === 'GET') {
        const recordId = tableRest.replace('records/', '');
        const fsRes = await fetch(
          `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
          { headers: feishuHeaders }
        );
        const text = await fsRes.text();
        return new Response(text, {
          status: fsRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
        });
      }

      return jsonResponse({ error: "Unknown Feishu endpoint" }, { status: 404, origin });
    }

    // ========== 小红书代理 ==========
    if (url.pathname.startsWith('/xhs/')) {
      const cookie = request.headers.get("X-Xhs-Cookie");
      if (!cookie) {
        return jsonResponse({ error: "Missing header: X-Xhs-Cookie" }, { status: 401, origin });
      }

      // GET /xhs/debug - 测试签名，返回完整原始响应
      if (url.pathname === '/xhs/debug' && request.method === 'GET') {
        try {
          const testApi = url.searchParams.get('api') || '/api/sns/web/v1/user/selfinfo';
          const a1 = getCookieValue(cookie, 'a1');
          const { xs, xt } = signXs('GET', testApi, a1);
          const result = await xhsFetch(cookie, testApi, 'GET');
          return jsonResponse({
            debug: true,
            api: testApi,
            a1_len: a1.length,
            xs_prefix: xs.slice(0, 20),
            xt,
            response_status: result.status,
            response_ok: result.ok,
            response_data: result.data
          }, { origin });
        } catch (e) {
          return jsonResponse({ debug: true, error: e.message }, { status: 500, origin });
        }
      }

      // GET /xhs/upload-test - 测试图片上传凭证获取（诊断用）
      if (url.pathname === '/xhs/upload-test' && request.method === 'GET') {
        try {
          const credResult = await getUploadCredentials(cookie);
          const permitRoot = credResult.data?.data || credResult.data;
          const tempPermit = permitRoot?.uploadTempPermits?.[0];

          if (tempPermit?.fileIds?.[0] && tempPermit?.token) {
            return jsonResponse({
              success: true,
              message: '上传凭证获取成功',
              file_id: tempPermit.fileIds[0],
              token_prefix: tempPermit.token.slice(0, 30) + '...',
              debug: credResult.debug
            }, { origin });
          }

          return jsonResponse({
            success: false,
            message: '上传凭证获取失败',
            debug: credResult.debug
          }, { origin });
        } catch (e) {
          return jsonResponse({ success: false, message: `上传测试异常: ${e.message}` }, { status: 500, origin });
        }
      }

      // GET /xhs/profile - 测试 Cookie，获取用户信息
      if (url.pathname === '/xhs/profile' && request.method === 'GET') {
        try {
          const api = '/api/sns/web/v1/user/selfinfo';
          const result = await xhsFetch(cookie, api, 'GET');
          const rd = result.data || {};

          // XHS selfinfo 结构: rd.data.basic_info.nickname
          const basicInfo = rd.data?.basic_info || {};
          const nickname = basicInfo.nickname || basicInfo.nick_name || basicInfo.red_id || '';

          if (nickname) {
            return jsonResponse({
              success: true,
              nickname,
              userid: basicInfo.red_id || '',
              avatar: basicInfo.imageb || basicInfo.images || ''
            }, { origin });
          }

          // basic_info 没有但请求本身成功
          if (rd.success || rd.code === 0) {
            return jsonResponse({
              success: true,
              nickname: '已连接',
              _raw: JSON.stringify(rd).slice(0, 600)
            }, { origin });
          }

          // 返回详细错误信息方便调试（含完整原始响应）
          return jsonResponse({
            success: false,
            message: result.data?.msg || 'Cookie 无效或已过期',
            raw_status: result.status,
            debug: {
              code: result.data?.code,
              msg: result.data?.msg,
              raw: JSON.stringify(result.data).slice(0, 500),
              data_keys: result.data?.data ? Object.keys(result.data.data).join(',') : 'NO_DATA',
              full_response_keys: Object.keys(result.data || {}).join(',')
            }
          }, { status: 200, origin });
        } catch (e) {
          return jsonResponse({ success: false, message: `请求失败: ${e.message}` }, { status: 500, origin });
        }
      }

      // GET /xhs/note/:noteId - 获取单条笔记详情
      const noteMatch = url.pathname.match(/^\/xhs\/note\/([a-f0-9]+)$/);
      if (noteMatch && request.method === 'GET') {
        const noteId = noteMatch[1];
        try {
          const api = '/api/sns/web/v1/feed';
          const body = { source_note_id: noteId, image_formats: ['jpg', 'webp'], extra: { need_body_topic: 1 } };
          const result = await xhsFetch(cookie, api, 'POST', body);
          const rd = result.data || {};

          if (rd.data?.items?.[0]?.note_card) {
            const card = rd.data.items[0].note_card;
            const user = card.user || {};
            const interactInfo = card.interact_info || {};
            return jsonResponse({
              success: true,
              note: {
                note_id: noteId,
                title: card.title || card.display_title || '',
                desc: card.desc || '',
                liked_count: parseInt(interactInfo.liked_count || '0') || 0,
                nickname: user.nickname || user.nick_name || '',
                user_id: user.user_id || ''
              }
            }, { origin });
          }

          // Fallback: try HTML scraping
          try {
            const htmlRes = await fetch(`https://www.xiaohongshu.com/explore/${noteId}`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookie,
                'Accept': 'text/html,application/xhtml+xml',
              }
            });
            const html = await htmlRes.text();
            const stateMatch = html.match(/__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*<\/script>/);
            if (stateMatch) {
              const stateStr = stateMatch[1].replace(/undefined/g, 'null');
              const state = JSON.parse(stateStr);
              const noteData = state.note?.noteDetailMap?.[noteId]?.note || state.note?.note;
              if (noteData) {
                return jsonResponse({
                  success: true,
                  note: {
                    note_id: noteId,
                    title: noteData.title || '',
                    desc: noteData.desc || '',
                    liked_count: parseInt(noteData.interactInfo?.likedCount || '0') || 0,
                    nickname: noteData.user?.nickname || '',
                    user_id: noteData.user?.userId || ''
                  }
                }, { origin });
              }
            }
          } catch (htmlErr) {
            console.log('HTML scrape fallback failed:', htmlErr.message);
          }

          return jsonResponse({
            success: false,
            message: '笔记不存在或无法访问',
            debug: { api_code: rd.code, api_msg: rd.msg }
          }, { status: 200, origin });
        } catch (e) {
          return jsonResponse({ success: false, message: `获取笔记失败: ${e.message}` }, { status: 500, origin });
        }
      }

      // POST /xhs/search - 搜索笔记（API + HTML 双重回退）
      if (url.pathname === '/xhs/search' && request.method === 'POST') {
        try {
          const body = await request.json();
          const keyword = body.keyword;
          if (!keyword) {
            return jsonResponse({ success: false, message: '缺少 keyword' }, { status: 400, origin });
          }

          // ---------- search_id: 匹配 ReaJason/xhs 格式 (base36 编码) ----------
          function getSearchId() {
            const ts = BigInt(Date.now()) << 64n;
            const rand = BigInt(Math.floor(Math.random() * 2147483646));
            const combined = ts + rand;
            const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
            let n = combined, s = '';
            while (n > 0n) { s = chars[Number(n % 36n)] + s; n = n / 36n; }
            return s || '0';
          }

          // ---------- 策略 1: API 搜索（带 host/origin 回退） ----------
          const api = '/api/sns/web/v1/search/notes';
          const searchBody = {
            keyword: keyword,
            page: body.page || 1,
            page_size: 20,
            search_id: getSearchId(),
            sort: body.sort || 'general',
            note_type: 0
          };

          // 真实浏览器搜索时 Referer 指向搜索结果页
          const searchReferer = 'https://www.xiaohongshu.com/search_result/' + encodeURIComponent(keyword);
          const apiAttempts = [
            { baseUrl: 'https://edith.xiaohongshu.com', origin: 'https://www.xiaohongshu.com', referer: searchReferer },
            { baseUrl: 'https://edith.xiaohongshu.com', origin: 'https://www.xiaohongshu.com', referer: 'https://www.xiaohongshu.com/' },
          ];

          const apiDebug = [];
          for (const attempt of apiAttempts) {
            const result = await xhsFetch(cookie, api, 'POST', searchBody, attempt);
            apiDebug.push({ host: attempt.baseUrl, referer: attempt.referer, status: result.status, code: result.data?.code, msg: result.data?.msg || '' });

            const items = result.data?.data?.items || [];
            if (items.length > 0) {
              const notes = items.map(item => {
                const note = item.note_card || item;
                return {
                  note_id: note.note_id || item.id || '',
                  title: note.display_title || note.title || '',
                  desc: (note.desc || '').slice(0, 200),
                  liked_count: note.interact_info?.liked_count || note.liked_count || 0,
                  nickname: note.user?.nickname || note.user?.nick_name || '',
                  user_id: note.user?.user_id || ''
                };
              }).filter(n => n.note_id);

              if (notes.length > 0) {
                return jsonResponse({ success: true, notes, source: 'api' }, { origin });
              }
            }

            // 如果不是 461/471 这类签名/风控错误，不再尝试其他 host
            if (result.status !== 461 && result.status !== 471 && result.status < 500) break;
          }

          // ---------- 策略 2: HTML 页面抓取（绕过签名校验） ----------
          const searchUrl = 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword) + '&source=web_search_result_note';
          const htmlRes = await fetch(searchUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Cookie': cookie,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
            },
            redirect: 'follow'
          });

          const html = await htmlRes.text();
          const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*<\/script>/s);
          if (stateMatch) {
            const stateStr = stateMatch[1].replace(/\bundefined\b/g, 'null');
            let state;
            try { state = JSON.parse(stateStr); } catch { state = null; }

            if (state) {
              // 搜索结果可能在各种路径 — 穷举已知 + 自动发现
              let items = [];
              let itemSource = 'unknown';
              const candidates = [
                ['search.notes', state?.search?.notes],
                ['search.items', state?.search?.items],
                ['search.feeds', state?.search?.feeds],
                ['search.noteList', state?.search?.noteList],
                ['search.result', state?.search?.result],
                ['search.results', state?.search?.results],
                ['search.notesResult', state?.search?.notesResult],
                ['search_result.notes', state?.search_result?.notes],
                ['search_result.items', state?.search_result?.items],
                ['note.noteList', state?.note?.noteList],
                ['feed.feeds', state?.feed?.feeds],
              ];
              for (const [name, arr] of candidates) {
                if (Array.isArray(arr) && arr.length > 0) {
                  items = arr;
                  itemSource = name;
                  break;
                }
              }

              // 智能递归: 只接受包含类似笔记对象的数组 (有 id/note_id/noteId 或 note_card/noteCard)
              if (items.length === 0) {
                const looksLikeNote = (obj) => {
                  if (!obj || typeof obj !== 'object') return false;
                  const k = Object.keys(obj);
                  return k.some(key => /^(id|note_id|noteId|model_type|note_card|noteCard|display_title|displayTitle)$/.test(key));
                };
                const findNoteArray = (obj, path = '', depth = 0) => {
                  if (depth > 5 || !obj || typeof obj !== 'object') return null;
                  if (Array.isArray(obj) && obj.length > 2 && looksLikeNote(obj[0])) {
                    return { arr: obj, path };
                  }
                  for (const key of Object.keys(obj)) {
                    const r = findNoteArray(obj[key], path ? `${path}.${key}` : key, depth + 1);
                    if (r) return r;
                  }
                  return null;
                };
                const found = findNoteArray(state);
                if (found) { items = found.arr; itemSource = found.path + '(auto)'; }
              }

              // 尝试提取笔记（兼容 snake_case + camelCase）
              const extractNote = (item) => {
                const note = item.note_card || item.noteCard || item;
                return {
                  note_id: note?.note_id || note?.noteId || note?.id || item?.id || '',
                  title: note?.display_title || note?.displayTitle || note?.title || '',
                  desc: (note?.desc || note?.description || '').slice(0, 200),
                  liked_count: note?.interact_info?.liked_count || note?.interactInfo?.likedCount || note?.liked_count || 0,
                  nickname: note?.user?.nickname || note?.user?.nick_name || note?.user?.nickName || '',
                  user_id: note?.user?.user_id || note?.user?.userId || ''
                };
              };
              const notes = items.map(extractNote).filter(n => n.note_id);

              if (notes.length > 0) {
                return jsonResponse({ success: true, notes, source: 'html_scrape', _debug: { itemSource, apiAttempts: apiDebug } }, { origin });
              }

              // HTML 有数据但映射失败 → 返回详细样本帮助调试
              if (items.length > 0) {
                return jsonResponse({
                  success: false, notes: [],
                  message: `HTML解析到 ${items.length} 条但字段映射失败`,
                  debug: { itemSource, first_keys: items[0] ? Object.keys(items[0]) : [], sample: items.slice(0, 2).map(i => JSON.stringify(i).slice(0, 600)), apiAttempts: apiDebug }
                }, { origin });
              }

              // state 解析成功但没找到笔记列表 → 专门 dump search 对象
              const searchObj = state?.search || {};
              const searchDump = {};
              for (const [k, v] of Object.entries(searchObj)) {
                if (Array.isArray(v)) {
                  searchDump[k] = { type: 'array', len: v.length, first_keys: v[0] && typeof v[0] === 'object' ? Object.keys(v[0]) : typeof v[0], sample: JSON.stringify(v[0]).slice(0, 300) };
                } else if (v && typeof v === 'object') {
                  searchDump[k] = { type: 'object', keys: Object.keys(v) };
                } else {
                  searchDump[k] = { type: typeof v, value: String(v).slice(0, 100) };
                }
              }
              return jsonResponse({
                success: false, notes: [],
                message: '搜索页 __INITIAL_STATE__ 无笔记列表',
                debug: { search_structure: searchDump, state_keys: Object.keys(state), apiAttempts: apiDebug }
              }, { origin });
            }
          }

          // 两条路都没走通
          return jsonResponse({
            success: false, notes: [],
            message: `搜索失败 (API 和 HTML 均未获取到结果)`,
            debug: { apiAttempts: apiDebug, html_status: htmlRes.status, html_len: html.length, html_snippet: html.slice(0, 500) }
          }, { origin });
        } catch (e) {
          return jsonResponse({ success: false, notes: [], message: `搜索异常: ${e.message}` }, { status: 500, origin });
        }
      }

      // POST /xhs/feed - 浏览小红书 (scrape explore page via GET, avoids POST 461)
      if (url.pathname === '/xhs/feed' && request.method === 'POST') {
        try {
          // 策略: GET explore 页面，解析 __INITIAL_STATE__ 里的笔记
          const exploreRes = await fetch('https://www.xiaohongshu.com/explore', {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              'Cookie': cookie,
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
            },
            redirect: 'follow'
          });

          const html = await exploreRes.text();

          // 解析 window.__INITIAL_STATE__ JSON
          const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.+?\})\s*<\/script>/s);
          if (stateMatch) {
            // XHS 用 undefined 代替 null，替换后才能 JSON.parse
            const stateStr = stateMatch[1].replace(/\bundefined\b/g, 'null');
            let state;
            try { state = JSON.parse(stateStr); } catch { state = null; }

            if (state) {
              // 查找笔记列表：尝试多种已知路径
              let feeds = [];
              let feedSource = 'unknown';
              const candidates = [
                ['feed.feeds', state?.feed?.feeds],
                ['explore.feeds', state?.explore?.feeds],
                ['homeFeed.feeds', state?.homeFeed?.feeds],
                ['explore.noteList', state?.explore?.noteList],
                ['feed.noteList', state?.feed?.noteList],
              ];
              for (const [name, arr] of candidates) {
                if (Array.isArray(arr) && arr.length > 0) {
                  feeds = arr;
                  feedSource = name;
                  break;
                }
              }

              // 如果标准路径都没命中，递归找第一个长度 > 5 的数组
              if (feeds.length === 0) {
                const findLargeArray = (obj, path = '', depth = 0) => {
                  if (depth > 3 || !obj || typeof obj !== 'object') return null;
                  if (Array.isArray(obj) && obj.length > 5) return { arr: obj, path };
                  for (const key of Object.keys(obj)) {
                    const result = findLargeArray(obj[key], path ? `${path}.${key}` : key, depth + 1);
                    if (result) return result;
                  }
                  return null;
                };
                const found = findLargeArray(state);
                if (found) {
                  feeds = found.arr;
                  feedSource = found.path + '(auto)';
                }
              }

              // 自适应字段映射：检查第一个 item 的实际结构
              const notes = feeds.map(item => {
                // 笔记可能嵌套在 note_card / noteCard / model_type 下
                const note = item.note_card || item.noteCard || item;
                return {
                  note_id: note?.note_id || note?.noteId || note?.id || item?.id || '',
                  title: note?.display_title || note?.displayTitle || note?.title || note?.name || '',
                  desc: (note?.desc || note?.description || note?.content || '').slice(0, 200),
                  liked_count: note?.interact_info?.liked_count || note?.interactInfo?.likedCount || note?.liked_count || note?.likeCount || 0,
                  nickname: note?.user?.nickname || note?.user?.nickName || note?.user?.nick_name || note?.author || '',
                  user_id: note?.user?.user_id || note?.user?.userId || ''
                };
              }).filter(n => n.note_id);

              // 包含原始样本用于诊断空字段问题
              const rawSample = feeds.slice(0, 2).map(item => JSON.stringify(item).slice(0, 500));

              if (notes.length > 0) {
                return jsonResponse({
                  success: true, notes, source: 'explore_page',
                  _debug: { feedSource, total: feeds.length, sample: rawSample }
                }, { origin });
              }

              // 有 feeds 数组但映射后全空
              if (feeds.length > 0) {
                return jsonResponse({
                  success: false, notes: [],
                  message: `找到 ${feeds.length} 条数据但字段映射失败`,
                  debug: {
                    feedSource,
                    first_item_keys: feeds[0] ? Object.keys(feeds[0]).join(',') : 'empty',
                    sample: rawSample
                  }
                }, { origin });
              }
            }

            // state 解析成功但没有笔记 → 返回 state keys 帮助调试
            return jsonResponse({
              success: false, notes: [],
              message: `Explore页面解析成功但未找到笔记`,
              debug: {
                status: exploreRes.status,
                state_keys: state ? Object.keys(state).join(',') : 'parse_failed',
                state_sample: state ? JSON.stringify(state).slice(0, 800) : ''
              }
            }, { origin });
          }

          // 没匹配到 __INITIAL_STATE__，返回 HTML 片段帮助调试
          return jsonResponse({
            success: false, notes: [],
            message: `Explore页面无 __INITIAL_STATE__ (${exploreRes.status})`,
            debug: {
              status: exploreRes.status,
              html_len: html.length,
              html_snippet: html.slice(0, 500)
            }
          }, { origin });
        } catch (e) {
          return jsonResponse({ success: false, notes: [], message: `浏览异常: ${e.message}` }, { status: 500, origin });
        }
      }

      // POST /xhs/publish - 发布笔记
      // 需要 image_url (外部图片URL) 或 images (已上传的file_id数组)
      if (url.pathname === '/xhs/publish' && request.method === 'POST') {
        try {
          const body = await request.json();
          if (!body.title || !body.content) {
            return jsonResponse({ success: false, message: '缺少 title 或 content' }, { status: 400, origin });
          }

          const rawImages = Array.isArray(body.images) ? body.images : [];
          let images = rawImages.map((img) => {
            if (typeof img === 'string') {
              return {
                file_id: img,
                metadata: { source: -1 },
                stickers: { version: 2, floating: [] },
                extra_info_json: '{"mimeType":"image/jpeg"}'
              };
            }
            return img;
          }).filter(img => img?.file_id);

          const steps = []; // 详细的分步 debug
          const uploadDiagnostics = [];

          // Step 1: 如果提供了 image_url，先下载图片再上传到 XHS
          if (images.length === 0 && body.image_url) {
            const uploadResult = await uploadImageToXhs(cookie, body.image_url);
            if (uploadResult.file_id) {
              images = [{
                file_id: uploadResult.file_id,
                metadata: { source: -1 },
                stickers: { version: 2, floating: [] },
                extra_info_json: '{"mimeType":"image/jpeg"}'
              }];
              steps.push('image_url上传成功: ' + uploadResult.file_id);
            } else {
              steps.push('image_url上传失败: ' + uploadResult.error);
              uploadDiagnostics.push({ stage: 'image_url', ...uploadResult });
            }
          }

          // Step 2: 无论如何都尝试占位图兜底（小红书要求至少一张图片）
          if (images.length === 0) {
            steps.push('尝试上传占位图...');
            const placeholderResult = await uploadPlaceholderImage(cookie);
            if (placeholderResult.file_id) {
              images = [{
                file_id: placeholderResult.file_id,
                metadata: { source: -1 },
                stickers: { version: 2, floating: [] },
                extra_info_json: '{"mimeType":"image/png"}'
              }];
              steps.push('占位图上传成功: ' + placeholderResult.file_id);
            } else {
              steps.push('占位图上传失败: ' + placeholderResult.error);
              uploadDiagnostics.push({ stage: 'placeholder', ...placeholderResult });
            }
          }

          // Step 3: 小红书不支持纯文字笔记，必须有至少一张图片
          if (images.length === 0) {
            return jsonResponse({
              success: false,
              message: '图片上传失败，无法发布笔记。小红书要求每篇笔记至少包含一张图片。请检查上传凭证接口 (GET /xhs/upload-test) 或提供有效的 image_url。',
              debug: { steps, upload_diagnostics: uploadDiagnostics }
            }, { origin });
          }

          // Step 4: 构建发布 body（格式对齐 ReaJason/xhs 库）
          const api = '/web_api/sns/v2/note';
          const commonFields = {
            type: 'normal',
            title: body.title,
            note_id: '',
            desc: body.content,
            source: '{"type":"web","ids":"","extraInfo":"{\\"subType\\":\\"official\\"}"}',
            business_binds: '{"version":1,"noteId":0,"noteOrderBind":{},"notePostTiming":{"postTime":null},"noteCollectionBind":{"id":""}}',
            ats: [],
            hash_tag: (body.tags || []).map(t => ({ id: '', name: t, link: '', type: 'topic' })),
            post_loc: {},
            privacy_info: { op_type: 1, type: 0 },
          };

          const publishBody = { common: commonFields, image_info: { images }, video_info: null };
          steps.push('发布body已构建(有图), images=' + images.length + ', file_id=' + images[0]?.file_id);

          // 发布请求使用 creator.xiaohongshu.com 作为 Origin/Referer（匹配真实浏览器行为）
          const publishOriginOpts = {
            origin: 'https://creator.xiaohongshu.com',
            referer: 'https://creator.xiaohongshu.com/',
          };
          let result = await xhsFetch(cookie, api, 'POST', publishBody, publishOriginOpts);
          const publishHostAttempts = [{
            baseUrl: XHS_BASE,
            origin: publishOriginOpts.origin,
            status: result.status,
            ok: result.ok,
            result: result.data?.result,
            code: result.data?.code,
            msg: result.data?.msg || ''
          }];

          // 如果命中常见风控/网关拦截错误，尝试切换发布 host 再试一次
          const needPublishHostFallback = images.length > 0
            && !result.data?.data?.note_id
            && [-9150, -9110].includes(Number(result.data?.result));
          if (needPublishHostFallback) {
            for (const host of XHS_PUBLISH_HOST_CANDIDATES) {
              if (host === XHS_BASE) continue;
              const retry = await xhsFetch(cookie, api, 'POST', publishBody, { baseUrl: host, ...publishOriginOpts });
              publishHostAttempts.push({
                baseUrl: host,
                origin: publishOriginOpts.origin,
                status: retry.status,
                ok: retry.ok,
                result: retry.data?.result,
                code: retry.data?.code,
                msg: retry.data?.msg || ''
              });
              if (retry.data?.data?.note_id || retry.data?.data?.id) {
                result = retry;
                steps.push('发布host回退成功: ' + host);
                break;
              }
              if (![-9150, -9110].includes(Number(retry.data?.result))) {
                result = retry;
                break;
              }
              result = retry;
            }
          }

          // 严格检查：必须有 note_id 才算真正发布成功
          const noteId = result.data?.data?.note_id || result.data?.data?.id || '';
          if (noteId) {
            return jsonResponse({
              success: true,
              note_id: noteId,
              message: '发布成功'
            }, { origin });
          }

          const resultCode = result.data?.result || result.data?.code;
          const rawText = typeof result.data?.raw === 'string' ? result.data.raw : '';
          const hadImages = images.length > 0;
          let failMessage = result.data?.msg || `发布失败 (${result.status})`;

          if (resultCode === -9150) {
            failMessage = '发布被拒(-9150)：疑似风控/技术升级拦截。可能原因：签名被检测、发布频率过高、账号异常。建议降低频率或更换 Cookie 后重试。';
          } else if (result.status >= 500 && /jarvis-gateway-default/i.test(rawText)) {
            failMessage = '小红书网关暂时不可用（jarvis-gateway-default）。这不是请求体字段错误，建议稍后重试。';
          }

          return jsonResponse({
            success: false,
            message: failMessage,
            debug: {
              steps,
              status: result.status,
              result_code: resultCode,
              had_images: hadImages,
              upload_diagnostics: uploadDiagnostics,
              publish_host_attempts: publishHostAttempts,
              raw: JSON.stringify(result.data).slice(0, 500)
            }
          }, { origin });
        } catch (e) {
          return jsonResponse({ success: false, message: `发布异常: ${e.message}` }, { status: 500, origin });
        }
      }

      // POST /xhs/comment - 评论笔记
      if (url.pathname === '/xhs/comment' && request.method === 'POST') {
        try {
          const body = await request.json();
          if (!body.note_id || !body.content) {
            return jsonResponse({ success: false, message: '缺少 note_id 或 content' }, { status: 400, origin });
          }

          const api = '/api/sns/web/v1/comment/post';
          const commentBody = {
            note_id: body.note_id,
            content: body.content,
            at_users: []
          };

          const result = await xhsFetch(cookie, api, 'POST', commentBody);

          // XHS 可能返回非2xx但body里success=true，以body为准
          if (result.data?.success || result.data?.code === 0 || result.data?.data?.comment) {
            return jsonResponse({ success: true, message: '评论成功' }, { origin });
          }

          return jsonResponse({
            success: false,
            message: result.data?.msg || `评论失败 (${result.status})`,
            debug: { status: result.status, raw: JSON.stringify(result.data).slice(0, 300) }
          }, { origin });
        } catch (e) {
          return jsonResponse({ success: false, message: `评论异常: ${e.message}` }, { status: 500, origin });
        }
      }

      return jsonResponse({ error: "Unknown XHS endpoint. Use /xhs/profile, /xhs/upload-test, /xhs/search, /xhs/feed, /xhs/publish, /xhs/comment" }, { status: 404, origin });
    }

    // ========== Replicate 代理 (写歌 App 用，给 ACE-Step 等模型走) ==========
    // 前端把 Authorization: Bearer r8_xxx 透传过来，Worker 只做路由 + CORS + CDN 兜底。
    //   POST /replicate/predictions          → 起任务 (透传 body 到 api.replicate.com)
    //   GET  /replicate/predictions/:id      → 轮询状态
    //   POST /replicate/predictions/:id/cancel → 取消任务
    //   GET  /replicate/file?url=...         → 下载 replicate.delivery 上的产物 (国内常超时)
    if (url.pathname.startsWith('/replicate/')) {
      // 1) 文件代下载：解决 replicate.delivery / pbxt.replicate.delivery 的国内访问问题
      if (url.pathname === '/replicate/file' && request.method === 'GET') {
        const targetUrl = url.searchParams.get('url');
        if (!targetUrl) {
          return jsonResponse({ error: 'Missing url parameter' }, { status: 400, origin });
        }
        let parsed;
        try {
          parsed = new URL(targetUrl);
        } catch {
          return jsonResponse({ error: 'Invalid URL' }, { status: 400, origin });
        }
        // 白名单：只放行 replicate 的产物 CDN
        const allowed = (host) => host === 'replicate.delivery'
          || host.endsWith('.replicate.delivery')
          || host === 'pbxt.replicate.com'
          || host.endsWith('.replicate.com');
        if (parsed.protocol !== 'https:' || !allowed(parsed.hostname)) {
          return jsonResponse({ error: 'Host not allowed' }, { status: 400, origin });
        }
        try {
          const upstream = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 sully-replicate-proxy',
              'Accept': '*/*',
            },
          });
          const respHeaders = new Headers(corsHeaders(origin));
          const ct = upstream.headers.get('Content-Type');
          if (ct) respHeaders.set('Content-Type', ct);
          const cl = upstream.headers.get('Content-Length');
          if (cl) respHeaders.set('Content-Length', cl);
          respHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
          return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
        } catch (e) {
          return jsonResponse({ error: 'Replicate CDN fetch failed', detail: String(e && e.message || e) }, { status: 502, origin });
        }
      }

      // 2) API 转发：除 /file 外的所有路径，剥掉 /replicate 前缀转给 api.replicate.com
      const auth = request.headers.get('Authorization');
      if (!auth) {
        return jsonResponse({ error: 'Missing Authorization header (Replicate token)' }, { status: 401, origin });
      }
      const apiPath = url.pathname.replace(/^\/replicate/, ''); // e.g. /predictions
      const apiUrl = `https://api.replicate.com/v1${apiPath}${url.search || ''}`;
      const allowedMethods = ['GET', 'POST', 'DELETE'];
      if (!allowedMethods.includes(request.method)) {
        return jsonResponse({ error: 'Method not allowed' }, { status: 405, origin });
      }
      try {
        const forwardHeaders = {
          'Authorization': auth,
          'Content-Type': request.headers.get('Content-Type') || 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'sully-replicate-proxy',
        };
        const init = { method: request.method, headers: forwardHeaders };
        if (request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH') {
          init.body = await request.text();
        }
        const upstream = await fetch(apiUrl, init);
        const text = await upstream.text();
        return new Response(text, {
          status: upstream.status,
          headers: {
            'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
            ...corsHeaders(origin),
          },
        });
      } catch (e) {
        return jsonResponse({ error: 'Replicate upstream fetch failed', detail: String(e && e.message || e) }, { status: 502, origin });
      }
    }

    // ========== 麦当劳 MCP 代理 (浏览器 CORS 兜底, 纯透传) ==========
    // 前端 POST /mcp/mcd  + Authorization: Bearer <user_mcp_token>
    // body 即 MCP JSON-RPC 报文 (initialize / tools/list / tools/call ...)
    // Worker 不读不存 token, 只做 CORS + 转发 https://mcp.mcd.cn
    if (url.pathname === '/mcp/mcd') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, { status: 405, origin });
      }
      const auth = request.headers.get('Authorization');
      if (!auth) {
        return jsonResponse({ error: 'Missing Authorization header (McDonald\'s MCP token)' }, { status: 401, origin });
      }
      try {
        const fwdHeaders = {
          'Authorization': auth,
          'Content-Type': request.headers.get('Content-Type') || 'application/json',
          'Accept': request.headers.get('Accept') || 'application/json, text/event-stream',
          'User-Agent': 'aetheros-mcp-proxy/1.0',
        };
        const sid = request.headers.get('Mcp-Session-Id') || request.headers.get('mcp-session-id');
        if (sid) fwdHeaders['Mcp-Session-Id'] = sid;
        const upstream = await fetch('https://mcp.mcd.cn', {
          method: 'POST',
          headers: fwdHeaders,
          body: await request.text(),
        });
        const text = await upstream.text();
        const respHeaders = new Headers(corsHeaders(origin));
        const ct = upstream.headers.get('Content-Type');
        if (ct) respHeaders.set('Content-Type', ct);
        else respHeaders.set('Content-Type', 'application/json; charset=utf-8');
        const upSid = upstream.headers.get('Mcp-Session-Id') || upstream.headers.get('mcp-session-id');
        if (upSid) respHeaders.set('Mcp-Session-Id', upSid);
        return new Response(text, { status: upstream.status, headers: respHeaders });
      } catch (e) {
        return jsonResponse({ error: 'McDonald MCP upstream fetch failed', detail: String(e && e.message || e) }, { status: 502, origin });
      }
    }

    // ========== 网易云音乐代理 (转发到 api-enhanced, 带边缘缓存 + 多上游容灾) ==========
    // 前端 POST /netease/<action> { ...body }
    // Worker 翻译成 api-enhanced 的 GET 参数形式并转发
    if (url.pathname.startsWith('/netease/')) {
      if (!NETEASE_UPSTREAMS || NETEASE_UPSTREAMS.length === 0) {
        return jsonResponse({
          error: "Worker 里 NETEASE_UPSTREAMS 还没配置",
          hint: "把 api-enhanced 部署到 Vercel/Deno Deploy, 拿到 URL 后改 worker/index.js 开头的 NETEASE_UPSTREAMS 数组, 然后重新部署 Worker"
        }, { status: 500, origin });
      }

      const action = url.pathname.replace('/netease/', '');
      const cookie = request.headers.get("X-Netease-Cookie") || "";
      let body = {};
      if (request.method === 'POST') {
        body = await request.json().catch(() => ({}));
      } else if (request.method === 'GET') {
        body = Object.fromEntries(url.searchParams.entries());
      }

      const upstreamPath = buildNeteaseUpstream(action, body, cookie);
      if (!upstreamPath) {
        return jsonResponse({
          error: "Unknown or unallowed netease action",
          hint: "支持: search, song/url, lyric, song/detail, login/status, login/cellphone, login/qr/key, login/qr/create, login/qr/check, captcha/sent, captcha/verify, user/detail, user/playlist, user/record, user/cloud, user/subcount, likelist, playlist/detail, playlist/track/all, recommend/songs, recommend/resource, personal_fm, daily_signin, toplist, toplist/detail, top/playlist, personalized, personalized/newsong, banner, comment/music, album, artists, artist/songs, mv/detail, mv/url 等"
        }, { status: 404, origin });
      }

      // ── 边缘缓存: 对公共数据(歌词/搜索/song/url 等) 命中直接返回 ──
      const ttl = NETEASE_CACHE_TTL[action] || 0;
      // song/url 受 VIP cookie 影响 → 用 has-cookie 分桶; 其余公共接口 cookie 不影响结果
      const cookieBucket = (action === 'song/url' && cookie) ? 'vip' : 'anon';
      const cacheKey = ttl > 0 ? buildCacheKey(action, body, cookieBucket) : null;
      if (cacheKey) {
        const cached = await caches.default.match(cacheKey);
        if (cached) {
          const text = await cached.text();
          return new Response(text, {
            status: cached.status,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-Sully-Cache': 'HIT',
              ...corsHeaders(origin),
            }
          });
        }
      }

      // ── 多上游 + 容灾: 随机打乱后依次尝试, 任意一个成功就返回 ──
      const { text, status, upstream, error } = await fetchFromAnyUpstream(upstreamPath);
      if (error) {
        return jsonResponse({
          error: "netease upstream fetch failed (all sources)",
          detail: error,
          tried: NETEASE_UPSTREAMS.length,
        }, { status: 502, origin });
      }

      const response = new Response(text, {
        status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Sully-Cache': 'MISS',
          'X-Sully-Upstream': upstream,
          ...corsHeaders(origin),
        }
      });

      // ── 写回缓存 (异步, 不阻塞响应) ──
      if (cacheKey && status >= 200 && status < 400) {
        const cacheResp = new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${ttl}`,
          }
        });
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(caches.default.put(cacheKey, cacheResp));
        } else {
          // dev 环境没有 ctx 时直接 fire-and-forget
          caches.default.put(cacheKey, cacheResp).catch(() => {});
        }
      }

      return response;
    }

    // ========== Brave Search 代理 ==========
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed. Use GET." }, { status: 405, origin });
    }

    const r = route(url);
    if (!r) {
      return jsonResponse({ error: "Not found.", hint: "Use /search, /news, /videos, /notion/*, /feishu/*, or /xhs/*" }, { status: 404, origin });
    }

    const q = url.searchParams.get("q")?.trim();
    if (!q) {
      return jsonResponse({ error: "Missing query param: q" }, { status: 400, origin });
    }

    const userKey = request.headers.get("X-Brave-API-Key")?.trim();
    if (!userKey) {
      return jsonResponse({ error: "Missing header: X-Brave-API-Key" }, { status: 401, origin });
    }

    const braveUrl = new URL(`${BRAVE_ENDPOINT}/${r.kind}/search`);
    braveUrl.searchParams.set("q", q);
    for (const k of ["count", "offset", "country", "safesearch", "spellcheck"]) {
      const v = url.searchParams.get(k);
      if (v) braveUrl.searchParams.set(k, v);
    }

    try {
      const braveRes = await fetch(braveUrl.toString(), {
        headers: { "Accept": "application/json", "X-Subscription-Token": userKey }
      });
      const text = await braveRes.text();
      return new Response(text, {
        status: braveRes.status,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) }
      });
    } catch (e) {
      return jsonResponse({ error: "Upstream fetch failed", detail: String(e) }, { status: 502, origin });
    }
  },
};
