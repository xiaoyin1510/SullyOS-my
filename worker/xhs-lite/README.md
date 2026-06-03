# XHS Lite — 小红书 Lite 后端（已并入 worker/index.js）

让 SullyOS 角色**无浏览器、无隧道、无 Python、无扫码**地浏览 / 搜索 / 看详情 /
点赞 / 收藏 / 评论 / 发帖（带图），用户**只需粘贴一次 cookie**。

## 它在哪、怎么用

实现已**直接嵌入主 Worker** `worker/index.js`（即已部署的 `https://sullymeow.ccwu.cc`），
作为隔离的 `XHSLite` 模块，对外暴露 `/api/<command>` 桥接接口，和
`scripts/xhs-bridge.mjs` 完全兼容，前端 bridge 模式直接复用。

**部署（运营方做一次）：** 像平时一样重新部署 `worker/index.js` 即可，URL 不变。

**用户侧（不需要电脑/部署）：** SullyOS → 设置 → 实时感知 → 小红书：
- 服务器 URL 已默认 `https://sullymeow.ccwu.cc/api`，一般无需改。
- 粘贴浏览器登录小红书后的完整 cookie（含 `a1` 和 `web_session`），点测试连接。

cookie 存在本地，每次请求经 `X-Xhs-Cookie` 头发给 Worker；Worker 无状态，
一个部署服务所有用户。

## 原理

- `x-s` / `x-s-common` / `x-t`：纯数学算法，移植自
  [Cloxl/xhshow](https://github.com/Cloxl/xhshow)（MIT），无 eval / 无 DOM。
- 图片上传签名 `getSignature`：HMAC-SHA1 + SHA1（来自 Spider_XHS），用 Web Crypto 实现。
- 发帖带图：Worker `fetch` 图床/CDN 图片字节 → 算上传签名 → `PUT` 到小红书 ROS →
  拿 `file_id` 发帖。

> ⚠️ `x-rap-param`（搜索/详情用的 JSVMP）已省略，多数情况不带也能用；若被拦再补。
> 签名随小红书改版会失效，到时同步上游 xhshow 更新 `worker/index.js` 里的 `XHSLite`。

## 验证签名（与 Python 原版逐字节比对）

```bash
git clone https://github.com/Cloxl/xhshow /tmp/xhshow
pip install pycryptodome
cd worker/xhs-lite/test
PYTHONPATH=/tmp/xhshow/src python3 oracle.py > vectors.json
node verify.mjs   # 期望 10 passed, 0 failed —— 直接测 worker/index.js 内嵌实现
```

| 文件 | 作用 |
|------|------|
| `worker/index.js` (XHSLite 段) | 部署用的签名 + API 实现（唯一真源） |
| `test/oracle.py` | Python 参考 oracle（确定性向量） |
| `test/vectors.json` | 参考输出 |
| `test/verify.mjs` | 导入 `worker/index.js` 内嵌实现并逐字节比对 |
