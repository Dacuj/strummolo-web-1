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

-- Statistiche aggregate per pagina (analytics privacy-friendly).
-- Niente dati personali: solo contatori giornalieri per percorso.
CREATE TABLE IF NOT EXISTS page_stats (
  day TEXT NOT NULL,      -- giorno UTC in formato YYYY-MM-DD
  path TEXT NOT NULL,     -- percorso della pagina (es. /taccuino/j-adorami)
  views INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
