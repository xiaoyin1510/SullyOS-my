-- Proactive Push Accelerator — D1 schema
--
-- 一张表够用。endpoint + char_id 作为联合主键：一个浏览器订阅对多
-- 个角色独立调度，互不影响。

CREATE TABLE IF NOT EXISTS schedules (
  endpoint        TEXT    NOT NULL,
  char_id         TEXT    NOT NULL,
  p256dh          TEXT    NOT NULL,
  auth            TEXT    NOT NULL,
  interval_ms     INTEGER NOT NULL,
  next_fire_at    INTEGER NOT NULL,    -- epoch ms，下次应当发 wake push 的时间
  last_heartbeat  INTEGER NOT NULL,    -- epoch ms，客户端最近一次 heartbeat
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (endpoint, char_id)
);

-- cron 每次都按 next_fire_at 扫，单列索引足够。
CREATE INDEX IF NOT EXISTS idx_schedules_next_fire ON schedules(next_fire_at);
