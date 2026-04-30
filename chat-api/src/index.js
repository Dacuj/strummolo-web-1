export default {
	async fetch(request, env) {
	  const url = new URL(request.url);
	  
	  const headers = {
		'Access-Control-Allow-Origin': '*', // Permette a chiunque di scrivere. In futuro puoi limitarlo al dominio di sturmmolo.
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
	  };
  
	  if (request.method === 'OPTIONS') {
		return new Response(null, { headers });
	  }
  
	  if (request.method === 'GET' && url.pathname === '/messages') {
		const { results } = await env.DB.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT 50").all();
		return Response.json(results, { headers });
	  }
	  
	  if (request.method === 'POST' && url.pathname === '/messages') {
		const { content, nickname } = await request.json();
		if(!content) return new Response('Errore', { status: 400 });
		
		const author = nickname && nickname.trim() !== '' ? nickname.trim() : 'Anonimo';
		
		await env.DB.prepare("INSERT INTO messages (content, nickname) VALUES (?, ?)").bind(content, author).run();
		return new Response('Creato', { status: 201, headers });
	  }
  
	  return new Response('Not Found', { status: 404 });
	}
  };