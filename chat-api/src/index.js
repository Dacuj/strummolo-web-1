// export default {
// 	async fetch(request, env) {
// 	  const url = new URL(request.url);
	  
// 	  const headers = {
// 		'Access-Control-Allow-Origin': '*', // Permette a chiunque di scrivere. In futuro puoi limitarlo al dominio di sturmmolo.
// 		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
// 		'Access-Control-Allow-Headers': 'Content-Type'
// 	  };
  
// 	  if (request.method === 'OPTIONS') {
// 		return new Response(null, { headers });
// 	  }
  
// 	  if (request.method === 'GET' && url.pathname === '/messages') {
// 		const { results } = await env.DB.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT 50").all();
// 		return Response.json(results, { headers });
// 	  }
	  
// 	  if (request.method === 'POST' && url.pathname === '/messages') {
// 		const { content, nickname } = await request.json();
// 		if(!content) return new Response('Errore', { status: 400 });
		
// 		const author = nickname && nickname.trim() !== '' ? nickname.trim() : 'Anonimo';
		
// 		await env.DB.prepare("INSERT INTO messages (content, nickname) VALUES (?, ?)").bind(content, author).run();
// 		return new Response('Creato', { status: 201, headers });
// 	  }
  
// 	  return new Response('Not Found', { status: 404 });
// 	}
//   };

// Funzione di sanitizzazione lato server (anti-XSS)
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag]));
}

// I tuoi domini autorizzati (Whitelist)
const ALLOWED_ORIGINS = [
    "http://localhost:4321",
    "https://strummolo.com",
    "https://www.strummolo.com"
];

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
        // Il tuo codice originale D1
        const { results } = await env.DB.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT 50").all();
        
        return new Response(JSON.stringify(results), { 
            status: 200, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Errore lettura Database" }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    // 3. Metodo POST: Scrittura nel database D1
    if (request.method === 'POST' && url.pathname === '/messages') {
      try {
        const body = await request.json();

        // Controllo base
        if (!body.content || typeof body.content !== 'string') {
          return new Response(JSON.stringify({ error: "Payload non valido" }), { 
              status: 400, 
              headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // Taglio aggressivo e default nickname
        const rawContent = body.content.trim().substring(0, 250);
        let rawNickname = 'Anonimo';
        
        if (body.nickname && typeof body.nickname === 'string' && body.nickname.trim() !== '') {
            rawNickname = body.nickname.trim().substring(0, 20);
        }

        // Sanitizzazione anti-XSS
        const safeContent = escapeHTML(rawContent);
        const safeNickname = escapeHTML(rawNickname);

        if (safeContent.length === 0) {
          return new Response(JSON.stringify({ error: "Messaggio vuoto" }), { 
              status: 400, 
              headers: { ...corsHeaders, "Content-Type": "application/json" } 
          });
        }

        // Il tuo codice originale D1 per l'inserimento
        await env.DB.prepare("INSERT INTO messages (content, nickname) VALUES (?, ?)")
          .bind(safeContent, safeNickname)
          .run();

        return new Response(JSON.stringify({ success: true, message: "Creato" }), { 
            status: 201, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: "Errore interno del server" }), { 
            status: 500, 
            headers: { ...corsHeaders, "Content-Type": "application/json" } 
        });
      }
    }

    // Rotta non trovata per qualsiasi altra richiesta
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};