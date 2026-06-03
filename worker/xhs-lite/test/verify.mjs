/**
 * Verifies the XHS signing EMBEDDED in worker/index.js (the deployed worker,
 * https://sullymeow.ccwu.cc) is byte-identical to the Python xhshow reference
 * (test/vectors.json), using the same deterministic RNG.
 *
 *   PYTHONPATH=/tmp/xhshow/src python3 oracle.py > vectors.json
 *   node verify.mjs
 */
import { readFileSync } from 'fs';
import { __xhsLiteTest } from '../../index.js';

const { RNG, signXs, signXsCommon, generateB1, _internals } = __xhsLiteTest;

// deterministic: mirror oracle.py (random.randint(a,b) -> a)
RNG.randint = (a) => a;

const A1 = '198abcdef0123456789deadbeef0011223344556677';
const FIXED_TS = 1764896636.081;

const fp = {};
for (let i = 1; i < 90; i++) fp['x' + i] = '0';
Object.assign(fp, {
  x33: '0', x34: '1', x35: '2', x36: '3', x37: 'a|b|c', x38: 'd|e',
  x39: 0, x42: '3.4.4', x43: 'deadbeefcafebabe', x44: '1764896636081',
  x45: '__SEC__', x46: 'false', x48: '', x49: '{list:[],type:}',
  x50: '', x51: '', x52: '', x82: '_0x17a2|_0x1954',
});

const got = {
  xs_get_feed: signXs('GET', '/api/sns/web/v1/feed', A1, { payload: { num: '30', image_formats: 'jpg,webp,avif' }, timestampSec: FIXED_TS }),
  xs_get_noparams: signXs('GET', '/api/sns/web/v2/user/me', A1, { payload: null, timestampSec: FIXED_TS }),
  xs_post_homefeed: signXs('POST', '/api/sns/web/v1/homefeed', A1, { payload: { cursor_score: '', num: 20, refresh_type: 1, note_index: 0, category: 'homefeed_recommend' }, timestampSec: FIXED_TS }),
  xs_post_comment: signXs('POST', '/api/sns/web/v1/comment/post', A1, { payload: { note_id: 'abc123', content: '你好世界 hello', at_users: [] }, timestampSec: FIXED_TS }),
  encode_ascii: _internals.encodeCustomStr('hello world 123'),
  encode_unicode: _internals.encodeCustomStr('{"x5":"你好","x8":"a/b+c="}'),
  crc32_hello: _internals.crc32JsInt('hello world'),
  crc32_unicode: _internals.crc32JsInt('你好abc'),
  b1_fixed_fp: generateB1(fp),
  xscommon_fixed: signXsCommon({ a1: A1, web_session: '040069xyz' }, fp),
};

const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url)));
let pass = 0, fail = 0;
for (const { name, value } of vectors) {
  const mine = got[name];
  if (mine === undefined) { console.log(`?? ${name}: no JS counterpart`); continue; }
  const ok = String(mine) === String(value);
  if (ok) { pass++; console.log(`OK  ${name}`); }
  else { fail++; console.log(`XX  ${name}`); console.log(`    py: ${value}`); console.log(`    js: ${mine}`); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
