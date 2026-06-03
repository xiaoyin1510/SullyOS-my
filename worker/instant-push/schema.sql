-- Instant Push Worker — D1 schema for BlobStore (optional but recommended)
--
-- 默认不需要手动执行本文件：Worker 会在 D1 BlobStore 启用时自动
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS。
-- 这个文件主要留给想提前建表、或排查 D1 状态的人。
--
-- 可选手动部署方法:
--   wrangler d1 create instant-blob-db        # 拿到 database_id
--   wrangler d1 execute instant-blob-db --file schema.sql
--   把 database_id 填到 worker/instant-push/wrangler.toml 的 [[d1_databases]] 里
--
-- 不部署 D1 也能跑：大 payload 默认走 _multipart 分片传输。
-- 启用 D1 后，过期 blob row 会由 Worker 在请求经过时定期清理。

CREATE TABLE IF NOT EXISTS amsg_transient_blobs (
  key        TEXT    PRIMARY KEY,
  body       TEXT    NOT NULL,
  expires_at INTEGER NOT NULL  -- ms epoch
);

CREATE INDEX IF NOT EXISTS idx_amsg_blobs_expires
  ON amsg_transient_blobs(expires_at);
