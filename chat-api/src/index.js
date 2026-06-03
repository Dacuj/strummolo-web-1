// Worker della chat "Bacheka" di Strummolo.
// Sicurezza:
//  - Le query D1 sono parametrizzate (niente SQL injection).
//  - Il contenuto viene salvato GREZZO: l'escaping anti-XSS avviene SOLO in fase di
//    render lato client (bacheka.astro). Salvare grezzo evita il doppio-escaping
//    (es. "&" che diventava "&amp;").
//  - Validazione lunghezza messaggio/nickname e rifiuto di "parole" troppo lunghe.
//  - Rate-limiting per IP per limitare spam/flood.

// I tuoi domini autorizzati (Whitelist)
const ALLOWED_ORIGINS = [
    "http://localhost:4321",
    "https://strummolo.com",
    "https://www.strummolo.com"
];

// Limiti di validazione
const MAX_CONTENT = 250;
const MAX_NICKNAME = 20;
const MAX_WORD = 40; // un singolo token senza spazi non può superare questa lunghezza

// Rate limiting
const RATE_WINDOW_SECONDS = 60;   // finestra temporale
const RATE_MAX_MESSAGES = 5;      // messaggi consentiti per IP nella finestra
const RATE_CLEANUP_SECONDS = 600; // righe più vecchie di così vengono ripulite

function jsonResponse(body, status, corsHeaders) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // CORS Dinamico: se l'origin è nella lista, lo accettiamo.
    // Altrimenti impostiamo il primo della lista (bloccando di fatto gli intrusi).
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // Headers CORS applicati a TUTTE le risposte
    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // 1. Gestione del Preflight CORS (Metodo OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Metodo GET: Lettura dal database D1
    if (request.method === 'GET' && url.pathname === '/messages') {
      try {
        // Selezioniamo SOLO le colonne pubbliche: l'IP non viene mai esposto.
        const { results } = await env.DB
          .prepare("SELECT id, content, nickname, created_at FROM messages ORDER BY created_at DESC LIMIT 50")
          .all();

        return jsonResponse(results, 200, corsHeaders);
      } catch (e) {
        return jsonResponse({ error: "Errore lettura Database" }, 500, corsHeaders);
      }
    }

    // 3. Metodo POST: Scrittura nel database D1
    if (request.method === 'POST' && url.pathname === '/messages') {
      try {
        const body = await request.json();

        // Controllo base sul tipo
        if (!body.content || typeof body.content !== 'string') {
          return jsonResponse({ error: "Payload non valido" }, 400, corsHeaders);
        }

        // Taglio aggressivo e default nickname
        const content = body.content.trim().substring(0, MAX_CONTENT);
        let nickname = 'Anonimo';
        if (body.nickname && typeof body.nickname === 'string' && body.nickname.trim() !== '') {
            nickname = body.nickname.trim().substring(0, MAX_NICKNAME);
        }

        if (content.length === 0) {
          return jsonResponse({ error: "Messaggio vuoto" }, 400, corsHeaders);
        }

        // Rifiuto "parole" troppo lunghe (token senza spazi) che romperebbero il layout.
        const hasTooLongWord = content.split(/\s+/).some((word) => word.length > MAX_WORD);
        if (hasTooLongWord) {
          return jsonResponse(
            { error: `Parola troppo lunga (max ${MAX_WORD} caratteri senza spazi)` },
            400,
            corsHeaders,
          );
        }

        // --- Rate limiting per IP ---
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        try {
          const { results: rl } = await env.DB
            .prepare(
              `SELECT COUNT(*) AS c FROM rate_limits
               WHERE ip = ? AND created_at > datetime('now', ?)`,
            )
            .bind(ip, `-${RATE_WINDOW_SECONDS} seconds`)
            .all();
          const recent = (rl && rl[0] && rl[0].c) || 0;
          if (recent >= RATE_MAX_MESSAGES) {
            return jsonResponse(
              { error: "Troppi messaggi, riprova tra poco." },
              429,
              corsHeaders,
            );
          }
          // Registriamo il tentativo e ripuliamo le righe vecchie (best-effort).
          await env.DB.prepare("INSERT INTO rate_limits (ip) VALUES (?)").bind(ip).run();
          await env.DB
            .prepare("DELETE FROM rate_limits WHERE created_at < datetime('now', ?)")
            .bind(`-${RATE_CLEANUP_SECONDS} seconds`)
            .run();
        } catch (rlErr) {
          // Se la tabella rate_limits non esiste ancora non blocchiamo la chat:
          // l'inserimento del messaggio prosegue comunque.
        }

        // Salvataggio GREZZO (parametrizzato → sicuro per il DB).
        await env.DB.prepare("INSERT INTO messages (content, nickname) VALUES (?, ?)")
          .bind(content, nickname)
          .run();

        return jsonResponse({ success: true, message: "Creato" }, 201, corsHeaders);

      } catch (e) {
        return jsonResponse({ error: "Errore interno del server" }, 500, corsHeaders);
      }
    }

    // Rotta non trovata per qualsiasi altra richiesta
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
