// Worker della chat "Bacheka" di Strummolo + analytics privacy-friendly.
// Sicurezza:
//  - Le query D1 sono parametrizzate (niente SQL injection).
//  - Il contenuto viene salvato GREZZO: l'escaping anti-XSS avviene SOLO in fase di
//    render lato client (bacheka.astro). Salvare grezzo evita il doppio-escaping
//    (es. "&" che diventava "&amp;").
//  - Validazione lunghezza messaggio/nickname e rifiuto di "parole" troppo lunghe.
//  - Rate-limiting per IP per limitare spam/flood.
// Analytics (POST /track, GET /stats):
//  - Nessun dato personale: niente cookie, niente IP, niente user-agent, niente
//    fingerprinting. Si salvano SOLO contatori aggregati per giorno+percorso
//    (visite e secondi di lettura). Non è possibile risalire al singolo visitatore.
//  - GET /stats è protetto dal secret STATS_TOKEN (npx wrangler secret put STATS_TOKEN).
// Moderazione bacheca (GET/DELETE /admin/messages):
//  - protetta dallo stesso STATS_TOKEN; permette di elencare e cancellare i messaggi
//    dal pannello /stats del sito.

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

// Analytics
const MAX_PATH = 200;             // lunghezza massima del percorso tracciato
const MAX_BEACON_SECONDS = 1800;  // tetto per singolo beacon (30 min) contro valori assurdi
const STATS_DEFAULT_DAYS = 30;    // finestra di default per GET /stats
const STATS_MAX_DAYS = 365;       // finestra massima richiedibile

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
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

    // 4. POST /track: beacon analytics anonimo.
    // Il client invia { p: percorso, v: 1 } alla visita e { p: percorso, s: secondi }
    // quando lascia la pagina. Il body arriva come text/plain (navigator.sendBeacon
    // con stringa) per evitare il preflight CORS, quindi parsiamo il testo a mano.
    if (request.method === 'POST' && url.pathname === '/track') {
      // Accettiamo beacon solo dalle origin del sito: blocco minimo anti-rumore.
      if (!ALLOWED_ORIGINS.includes(origin)) {
        return jsonResponse({ error: "Origin non autorizzata" }, 403, corsHeaders);
      }
      try {
        const body = JSON.parse(await request.text());

        // Percorso: deve essere un path assoluto del sito, senza query string.
        if (!body || typeof body.p !== 'string' || !body.p.startsWith('/')) {
          return jsonResponse({ error: "Payload non valido" }, 400, corsHeaders);
        }
        const path = body.p.split('?')[0].substring(0, MAX_PATH);

        // Visite (0 o 1) e secondi di lettura, con tetti anti-abuso.
        const views = body.v === 1 ? 1 : 0;
        let seconds = 0;
        if (typeof body.s === 'number' && Number.isFinite(body.s) && body.s > 0) {
          seconds = Math.min(Math.round(body.s), MAX_BEACON_SECONDS);
        }
        if (views === 0 && seconds === 0) {
          return jsonResponse({ error: "Niente da registrare" }, 400, corsHeaders);
        }

        // UPSERT aggregato: una riga per giorno+percorso, nessun dato individuale.
        await env.DB
          .prepare(
            `INSERT INTO page_stats (day, path, views, seconds) VALUES (date('now'), ?, ?, ?)
             ON CONFLICT(day, path) DO UPDATE SET
               views = views + excluded.views,
               seconds = seconds + excluded.seconds`,
          )
          .bind(path, views, seconds)
          .run();

        return jsonResponse({ success: true }, 201, corsHeaders);
      } catch (e) {
        return jsonResponse({ error: "Errore interno del server" }, 500, corsHeaders);
      }
    }

    // 5. GET /stats: lettura delle statistiche aggregate, riservata all'admin.
    // Richiede l'header "Authorization: Bearer <STATS_TOKEN>".
    if (request.method === 'GET' && url.pathname === '/stats') {
      if (!env.STATS_TOKEN) {
        return jsonResponse({ error: "STATS_TOKEN non configurato sul worker" }, 503, corsHeaders);
      }
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.STATS_TOKEN}`) {
        return jsonResponse({ error: "Non autorizzato" }, 401, corsHeaders);
      }
      try {
        const requested = parseInt(url.searchParams.get("days") || "", 10);
        const days = Math.min(
          Number.isFinite(requested) && requested > 0 ? requested : STATS_DEFAULT_DAYS,
          STATS_MAX_DAYS,
        );

        const { results } = await env.DB
          .prepare(
            `SELECT day, path, views, seconds FROM page_stats
             WHERE day >= date('now', ?) ORDER BY day ASC, views DESC`,
          )
          .bind(`-${days} days`)
          .all();

        return jsonResponse({ days, rows: results }, 200, corsHeaders);
      } catch (e) {
        return jsonResponse({ error: "Errore lettura Database" }, 500, corsHeaders);
      }
    }

    // 6. Moderazione bacheca, riservata all'admin (stesso token delle statistiche).
    //    GET    /admin/messages      → elenco degli ultimi 200 messaggi
    //    DELETE /admin/messages/<id> → elimina un messaggio
    if (url.pathname === '/admin/messages' || url.pathname.startsWith('/admin/messages/')) {
      if (!env.STATS_TOKEN) {
        return jsonResponse({ error: "STATS_TOKEN non configurato sul worker" }, 503, corsHeaders);
      }
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.STATS_TOKEN}`) {
        return jsonResponse({ error: "Non autorizzato" }, 401, corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/admin/messages') {
        try {
          // Anche qui l'IP non viene mai esposto.
          const { results } = await env.DB
            .prepare("SELECT id, content, nickname, created_at FROM messages ORDER BY created_at DESC LIMIT 200")
            .all();
          return jsonResponse(results, 200, corsHeaders);
        } catch (e) {
          return jsonResponse({ error: "Errore lettura Database" }, 500, corsHeaders);
        }
      }

      if (request.method === 'DELETE') {
        const id = parseInt(url.pathname.split('/').pop(), 10);
        if (!Number.isInteger(id) || id <= 0) {
          return jsonResponse({ error: "Id non valido" }, 400, corsHeaders);
        }
        try {
          const res = await env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
          if (!res.meta || res.meta.changes === 0) {
            return jsonResponse({ error: "Messaggio non trovato" }, 404, corsHeaders);
          }
          return jsonResponse({ success: true }, 200, corsHeaders);
        } catch (e) {
          return jsonResponse({ error: "Errore interno del server" }, 500, corsHeaders);
        }
      }
    }

    // Rotta non trovata per qualsiasi altra richiesta
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
