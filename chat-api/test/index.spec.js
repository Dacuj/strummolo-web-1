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
	await env.DB.exec("DELETE FROM messages");
	await env.DB.exec("DELETE FROM rate_limits");
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
