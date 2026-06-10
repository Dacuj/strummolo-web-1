-- Migrazione: tabella delle statistiche aggregate per pagina (analytics privacy-friendly).
-- Niente dati personali: solo contatori giornalieri per percorso (visite e secondi di lettura).
-- Applicare in produzione con:
--   npx wrangler d1 execute sturmmolo-chat --remote --file=./migrations/0002_add_page_stats.sql

CREATE TABLE IF NOT EXISTS page_stats (
  day TEXT NOT NULL,      -- giorno UTC in formato YYYY-MM-DD
  path TEXT NOT NULL,     -- percorso della pagina (es. /taccuino/j-adorami)
  views INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
