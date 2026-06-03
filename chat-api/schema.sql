CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  nickname TEXT DEFAULT 'Anonimo',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabella di supporto per il rate-limiting per IP (anti-spam).
-- Non viene mai esposta dall'endpoint GET pubblico.
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_time ON rate_limits (ip, created_at);
