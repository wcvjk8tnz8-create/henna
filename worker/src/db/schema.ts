/**
 * D1 schema —— 与 worker/migrations/0001_init.sql 保持完全一致。
 * /api/init 端点会执行这份 SQL（幂等，全部 IF NOT EXISTS）。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  quota         INTEGER NOT NULL DEFAULT 50,
  used          INTEGER NOT NULL DEFAULT 0,
  api_key       TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);

CREATE TABLE IF NOT EXISTS mail_address (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  address    TEXT NOT NULL UNIQUE,
  domain     TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_address_user ON mail_address(user_id);

CREATE TABLE IF NOT EXISTS mail_message (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  address_id INTEGER,
  direction  TEXT NOT NULL DEFAULT 'in',
  message_id TEXT,
  from_addr  TEXT NOT NULL DEFAULT '',
  from_name  TEXT NOT NULL DEFAULT '',
  to_addr    TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT '',
  text_body  TEXT,
  html_body  TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  is_star    INTEGER NOT NULL DEFAULT 0,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_user ON mail_message(user_id, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_addr ON mail_message(address_id);

CREATE TABLE IF NOT EXISTS mail_attachment (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
  size       INTEGER NOT NULL DEFAULT 0,
  r2_key     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_att_msg ON mail_attachment(message_id);

CREATE TABLE IF NOT EXISTS mail_provider (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  enabled    INTEGER NOT NULL DEFAULT 1,
  weight     INTEGER NOT NULL DEFAULT 100,
  daily_used INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  provider_id INTEGER,
  provider    TEXT NOT NULL DEFAULT '',
  from_addr   TEXT NOT NULL DEFAULT '',
  to_addr     TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'success',
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_user ON mail_log(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mail_rule (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  match_address TEXT NOT NULL DEFAULT '',
  match_from    TEXT NOT NULL DEFAULT '',
  match_subject TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL DEFAULT 'webhook',
  target        TEXT NOT NULL DEFAULT '',
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_user ON mail_rule(user_id);

CREATE TABLE IF NOT EXISTS invite_code (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'user',
  quota      INTEGER NOT NULL DEFAULT 50,
  max_use    INTEGER NOT NULL DEFAULT 1,
  used       INTEGER NOT NULL DEFAULT 0,
  expire_at  INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** 拆分执行：D1 的 prepare().all() 不接受多语句，必须手工切分 */
export function splitSql(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));
}

export async function ensureSchema(db: D1Database): Promise<void> {
  for (const stmt of splitSql(SCHEMA_SQL)) {
    await db.prepare(stmt).run();
  }
}
