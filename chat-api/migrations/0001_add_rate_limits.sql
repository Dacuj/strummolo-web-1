-- Migrazione: tabella di rate-limiting per IP (anti-spam) per la chat Bacheka.
-- Applicare in produzione con:
--   npx wrangler d1 execute sturmmolo-chat --remote --file=./migrations/0001_add_rate_limits.sql

CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_time ON rate_limits (ip, created_at);
