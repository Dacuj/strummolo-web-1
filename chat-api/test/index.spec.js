import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../src";

const ORIGIN = "https://www.strummolo.com";

// Crea lo schema (messages + rate_limits) prima di ogni test e ripulisce i dati.
async function resetDb() {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, nickname TEXT DEFAULT 'Anonimo', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS page_stats (day TEXT NOT NULL, path TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, path))",
	);
	await env.DB.exec("DELETE FROM messages");
	await env.DB.exec("DELETE FROM rate_limits");
	await env.DB.exec("DELETE FROM page_stats");
}

function postMessage(body, ip = "1.2.3.4") {
	return new Request("https://chat-api.example.com/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: ORIGIN,
			"CF-Connecting-IP": ip,
		},
		body: JSON.stringify(body),
	});
}

async function run(request) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe("chat-api worker", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("accetta un messaggio valido (201) e applica gli header CORS", async () => {
		const res = await run(postMessage({ content: "ciao bacheca", nickname: "tester" }));
		expect(res.status).toBe(201);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
	});

	it("rifiuta un payload senza content (400)", async () => {
		const res = await run(postMessage({ nickname: "tester" }));
		expect(res.status).toBe(400);
	});

	it("rifiuta un messaggio vuoto dopo il trim (400)", async () => {
		const res = await run(postMessage({ content: "    " }));
		expect(res.status).toBe(400);
	});

	it("rifiuta una parola troppo lunga senza spazi (400)", async () => {
		const longWord = "a".repeat(60);
		const res = await run(postMessage({ content: longWord }));
		expect(res.status).toBe(400);
	});

	it("salva il contenuto GREZZO senza HTML-escaping (anti doppio-escaping)", async () => {
		await run(postMessage({ content: "<b> & ok" }));
		const { results } = await env.DB.prepare("SELECT content FROM messages").all();
		expect(results[0].content).toBe("<b> & ok");
	});

	it("la GET non espone mai la colonna ip", async () => {
		await run(postMessage({ content: "messaggio pubblico" }));
		const getReq = new Request("https://chat-api.example.com/messages", {
			headers: { Origin: ORIGIN },
		});
		const res = await run(getReq);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(Array.isArray(data)).toBe(true);
		expect(data[0]).not.toHaveProperty("ip");
		expect(data[0].content).toBe("messaggio pubblico");
	});

	it("applica il rate-limiting per IP (429 dopo il limite)", async () => {
		const ip = "9.9.9.9";
		let lastStatus;
		for (let i = 0; i < 6; i++) {
			const res = await run(postMessage({ content: `msg ${i}` }, ip));
			lastStatus = res.status;
		}
		// I primi 5 passano (201), il 6° viene bloccato.
		expect(lastStatus).toBe(429);
	});

	it("IP diversi non condividono il rate-limit", async () => {
		for (let i = 0; i < 5; i++) {
			await run(postMessage({ content: `msg ${i}` }, "5.5.5.5"));
		}
		const res = await run(postMessage({ content: "altro ip" }, "6.6.6.6"));
		expect(res.status).toBe(201);
	});

	it("risponde 404 su rotte sconosciute", async () => {
		const req = new Request("https://chat-api.example.com/altro", { headers: { Origin: ORIGIN } });
		const res = await run(req);
		expect(res.status).toBe(404);
	});
});

// Il beacon invia il body come text/plain (navigator.sendBeacon con stringa).
function postTrack(body, origin = ORIGIN) {
	return new Request("https://chat-api.example.com/track", {
		method: "POST",
		headers: { "Content-Type": "text/plain", Origin: origin },
		body: JSON.stringify(body),
	});
}

function getStats(token, days) {
	const url = "https://chat-api.example.com/stats" + (days ? `?days=${days}` : "");
	const headers = { Origin: ORIGIN };
	if (token) headers.Authorization = `Bearer ${token}`;
	return new Request(url, { headers });
}

describe("analytics (/track e /stats)", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("registra una visita e aggrega per giorno+percorso", async () => {
		expect((await run(postTrack({ p: "/taccuino/test", v: 1 }))).status).toBe(201);
		expect((await run(postTrack({ p: "/taccuino/test", v: 1 }))).status).toBe(201);
		const { results } = await env.DB.prepare("SELECT * FROM page_stats").all();
		expect(results.length).toBe(1);
		expect(results[0].path).toBe("/taccuino/test");
		expect(results[0].views).toBe(2);
	});

	it("somma i secondi di lettura e applica il tetto per beacon", async () => {
		await run(postTrack({ p: "/", v: 1 }));
		await run(postTrack({ p: "/", s: 90 }));
		await run(postTrack({ p: "/", s: 999999 })); // oltre il tetto di 1800s
		const { results } = await env.DB.prepare("SELECT * FROM page_stats").all();
		expect(results[0].seconds).toBe(90 + 1800);
	});

	it("rifiuta beacon senza percorso valido (400)", async () => {
		expect((await run(postTrack({ v: 1 }))).status).toBe(400);
		expect((await run(postTrack({ p: "no-slash", v: 1 }))).status).toBe(400);
	});

	it("rifiuta beacon da origin non autorizzata (403)", async () => {
		const res = await run(postTrack({ p: "/", v: 1 }, "https://malintenzionato.example"));
		expect(res.status).toBe(403);
	});

	it("non salva mai IP o user-agent nelle statistiche", async () => {
		await run(postTrack({ p: "/", v: 1 }));
		const { results } = await env.DB.prepare("SELECT * FROM page_stats").all();
		expect(Object.keys(results[0]).sort()).toEqual(["day", "path", "seconds", "views"]);
	});

	it("/stats richiede il token (401 senza o con token errato)", async () => {
		expect((await run(getStats())).status).toBe(401);
		expect((await run(getStats("token-sbagliato"))).status).toBe(401);
	});

	it("/stats restituisce le righe aggregate con il token giusto", async () => {
		await run(postTrack({ p: "/about", v: 1 }));
		await run(postTrack({ p: "/about", s: 42 }));
		const res = await run(getStats(env.STATS_TOKEN));
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.days).toBe(30);
		expect(data.rows.length).toBe(1);
		expect(data.rows[0]).toMatchObject({ path: "/about", views: 1, seconds: 42 });
	});

	it("/stats limita la finestra a 365 giorni", async () => {
		const res = await run(getStats(env.STATS_TOKEN, 9999));
		expect((await res.json()).days).toBe(365);
	});
});
