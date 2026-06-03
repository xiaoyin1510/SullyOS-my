#!/usr/bin/env python3
"""
Deterministic reference oracle for the xhshow signing algorithm.

It patches ALL randomness to fixed values so the output is reproducible, then
emits a set of test vectors as JSON. The JavaScript port (src/sign.js) is run
with the same fixed randomness and must produce byte-identical output.

Usage:
    PYTHONPATH=/tmp/xhshow/src python3 oracle.py > vectors.json
"""
import json
import random

# --- Force every random draw to its minimum so results are reproducible. -----
# build_payload_array draws, in order:
#   generate_random_int()            -> randint(0, 0xFFFFFFFF)   => 0
#   generate_random_byte_in_range()  -> randint(10, 50)          => 10  (time offset)
#   generate_random_byte_in_range()  -> randint(15, 50)          => 15  (sequence)
#   generate_random_byte_in_range()  -> randint(1000, 1200)      => 1000(window props)
random.randint = lambda a, b: a  # noqa: E731

from xhshow import Xhshow  # noqa: E402

client = Xhshow()

FIXED_TS = 1764896636.081  # seconds; -> x-t 1764896636081
A1 = "198abcdef0123456789deadbeef0011223344556677"

vectors = []


def add(name, value):
    vectors.append({"name": name, "value": value})


# 1) x-s for a GET with params
add("xs_get_feed", client.sign_xs(
    "GET", "/api/sns/web/v1/feed", A1, payload={"num": "30", "image_formats": "jpg,webp,avif"},
    timestamp=FIXED_TS,
))

# 2) x-s for a GET with no params
add("xs_get_noparams", client.sign_xs(
    "GET", "/api/sns/web/v2/user/me", A1, payload=None, timestamp=FIXED_TS,
))

# 3) x-s for a POST with a JSON body (homefeed)
add("xs_post_homefeed", client.sign_xs(
    "POST", "/api/sns/web/v1/homefeed", A1,
    payload={"cursor_score": "", "num": 20, "refresh_type": 1, "note_index": 0, "category": "homefeed_recommend"},
    timestamp=FIXED_TS,
))

# 4) x-s for a POST with unicode body (comment)
add("xs_post_comment", client.sign_xs(
    "POST", "/api/sns/web/v1/comment/post", A1,
    payload={"note_id": "abc123", "content": "你好世界 hello", "at_users": []},
    timestamp=FIXED_TS,
))

# --- x-s-common deterministic core ------------------------------------------
from xhshow.config import CryptoConfig          # noqa: E402
from xhshow.core.crc32_encrypt import CRC32     # noqa: E402
from xhshow.generators.fingerprint import FingerprintGenerator  # noqa: E402
from xhshow.utils.encoder import Base64Encoder  # noqa: E402

cfg = CryptoConfig()
enc = Base64Encoder(cfg)

# encode() of a fixed string (custom-base64 of utf-8)
add("encode_ascii", enc.encode("hello world 123"))
add("encode_unicode", enc.encode('{"x5":"你好","x8":"a/b+c="}'))

# crc32_js_int (signed) of a fixed string
add("crc32_hello", CRC32.crc32_js_int("hello world"))
add("crc32_unicode", CRC32.crc32_js_int("你好abc"))

# generate_b1 of a FIXED fingerprint dict (RC4 + custom-base64)
fp = {f"x{i}": "0" for i in range(1, 90)}
fp.update({
    "x33": "0", "x34": "1", "x35": "2", "x36": "3", "x37": "a|b|c", "x38": "d|e",
    "x39": 0, "x42": "3.4.4", "x43": "deadbeefcafebabe", "x44": "1764896636081",
    "x45": "__SEC__", "x46": "false", "x48": "", "x49": "{list:[],type:}",
    "x50": "", "x51": "", "x52": "", "x82": "_0x17a2|_0x1954",
})
fpg = FingerprintGenerator(cfg)
add("b1_fixed_fp", fpg.generate_b1(fp))

# full x-s-common with a FIXED cookie + FIXED fp/b1 (patch generate to fixed fp)
fpg_patched = FingerprintGenerator(cfg)
fpg_patched.generate = lambda cookies, user_agent: fp  # type: ignore
from xhshow.core.common_sign import XsCommonSigner  # noqa: E402
signer = XsCommonSigner(cfg)
signer._fp_generator = fpg_patched
add("xscommon_fixed", signer.sign({"a1": A1, "web_session": "040069xyz"}))

print(json.dumps(vectors, ensure_ascii=False, indent=2))
