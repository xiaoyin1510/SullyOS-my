-- 彼方虚拟邮局 · D1 schema
-- 默认无需手动执行：Worker 启动时会自动建表（加性、不破坏老数据）。
-- 想提前建表 / 排查时可手动：
--   wrangler d1 create sullyos-post-office
--   wrangler d1 execute sullyos-post-office --file schema.sql

-- 公共信件池
CREATE TABLE IF NOT EXISTS po_letters (
  id          TEXT    PRIMARY KEY,            -- 远端信 id (uuid)
  device      TEXT    NOT NULL,               -- 寄信方匿名 owner_id
  pen         TEXT    NOT NULL,               -- 笔名（角色名/匿名）
  content     TEXT    NOT NULL,
  lang        TEXT,
  created_at  INTEGER NOT NULL,               -- ms epoch
  reply_count INTEGER NOT NULL DEFAULT 0,
  likes       INTEGER NOT NULL DEFAULT 0,     -- 点赞数（按 po_votes 重算）
  dislikes    INTEGER NOT NULL DEFAULT 0,     -- 点踩(=举报)数；达 PO_DISLIKE_LIMIT 即删信
  views       INTEGER NOT NULL DEFAULT 0      -- 被抽到次数（一设备只算一次）
);
-- 老库升级（已有 po_letters 时补列；列已存在会报错，可忽略）：
--   ALTER TABLE po_letters ADD COLUMN likes    INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE po_letters ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE po_letters ADD COLUMN views    INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_po_letters_dev  ON po_letters(device);
CREATE INDEX IF NOT EXISTS idx_po_letters_open ON po_letters(reply_count, created_at);

-- 谁抽到过哪封信（避免同一设备重复抽到同一封）
CREATE TABLE IF NOT EXISTS po_picks (
  device    TEXT    NOT NULL,
  letter_id TEXT    NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (device, letter_id)
);

-- 回信
CREATE TABLE IF NOT EXISTS po_replies (
  id         TEXT    PRIMARY KEY,
  letter_id  TEXT    NOT NULL,                -- 被回的信
  device     TEXT    NOT NULL,                -- 回信方 owner_id
  pen        TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_po_replies_letter ON po_replies(letter_id);

-- owner_id(UUID) ↔ 短整数 uid 映射：多行的投票表只存 uid，省空间
CREATE TABLE IF NOT EXISTS po_devices (
  uid        INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   TEXT    NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- 投票（点赞 vote=1 / 点踩=举报 vote=-1），一设备一票
-- ip_hash：自动删除按「不同 IP」去重，防伪造 device 刷满阈值删信
CREATE TABLE IF NOT EXISTS po_votes (
  letter_id TEXT    NOT NULL,
  uid       INTEGER NOT NULL,                 -- 指向 po_devices.uid
  vote      INTEGER NOT NULL,                 -- 1 赞 / -1 踩
  at        INTEGER NOT NULL,
  ip_hash   TEXT,                             -- 加盐 IP 哈希（旧库 ALTER 补列）
  PRIMARY KEY (letter_id, uid)
);
-- 老库升级：ALTER TABLE po_votes ADD COLUMN ip_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_po_votes_letter ON po_votes(letter_id);

-- 限流计数（固定窗口；bucket = ipHash:action）
CREATE TABLE IF NOT EXISTS po_ratelimit (
  bucket   TEXT    PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
