import { expect, test } from "bun:test";
import { openDiagnosticVoiceSocket } from "../../src/remote-control/voice-socket-diagnostic";

const handlers = { message: (_data: string) => {}, closed: () => {} };
test.each([401, 403, 404, 410, 429, 503])(
	"diagnostic handshake reports actual HTTP %s without response contents",
	async status => {
		const events: any[] = [];
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("private-body", { status, headers: { "set-cookie": "private-cookie" } }),
		});
		try {
			await expect(
				openDiagnosticVoiceSocket(
					`ws://127.0.0.1:${server.port}`,
					{ Authorization: "Bearer private-token" },
					handlers,
					{
						record: (layer, direction, message) => events.push({ layer, direction, message }),
						close() {},
						invalidate() {},
					},
				),
			).rejects.toThrow(`HTTP ${status}`);
			expect(events).toContainEqual({
				layer: "connection",
				direction: "in",
				message: { type: "error", opened: false, httpStatus: status },
			});
			expect(JSON.stringify(events)).not.toContain("private");
		} finally {
			server.stop(true);
		}
	},
);
test("diagnostic handshake cancels pending upgrade and closes capture once", async () => {
	const gate = Promise.withResolvers<void>();
	let requested = false;
	let closed = 0;
	const abort = new AbortController();
	const events: any[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch() {
			requested = true;
			await gate.promise;
			return new Response(null, { status: 403 });
		},
	});
	try {
		const p = openDiagnosticVoiceSocket(
			`ws://127.0.0.1:${server.port}`,
			{},
			handlers,
			{
				record: (_l, _d, m) => events.push(m),
				close: () => {
					closed++;
				},
				invalidate() {},
			},
			abort.signal,
		);
		while (!requested) await Bun.sleep(1);
		abort.abort();
		await expect(p).rejects.toThrow("cancelled");
		gate.resolve();
		await Bun.sleep(10);
		expect(closed).toBe(1);
		expect(events).toEqual([{ type: "cancelled", opened: false }]);
	} finally {
		gate.resolve();
		server.stop(true);
	}
});

test("diagnostic rejects redirects without forwarding credentials", async () => {
	let reached = false;
	const target = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			reached = true;
			return new Response(null, { status: 403 });
		},
	});
	const source = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(null, { status: 302, headers: { location: `http://127.0.0.1:${target.port}` } }),
	});
	try {
		await expect(
			openDiagnosticVoiceSocket(
				`ws://127.0.0.1:${source.port}`,
				{ Authorization: "Bearer private-token" },
				handlers,
			),
		).rejects.toThrow("HTTP 302");
		expect(reached).toBe(false);
	} finally {
		source.stop(true);
		target.stop(true);
	}
});
test("diagnostic delivers messages and records one capture closure", async () => {
	const messages: string[] = [];
	let closed = 0;
	let captures = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req, server) {
			if (server.upgrade(req)) return;
			return new Response(null, { status: 400 });
		},
		websocket: {
			message(ws, data) {
				ws.send(data);
				ws.close();
			},
		},
	});
	try {
		const ws = await openDiagnosticVoiceSocket(
			`ws://127.0.0.1:${server.port}`,
			{},
			{
				message: data => messages.push(data),
				closed: () => {
					closed++;
				},
			},
			{
				record() {},
				close() {
					captures++;
				},
				invalidate() {},
			},
		);
		ws.send('{"type":"session.close"}');
		const end = Date.now() + 1000;
		while (!closed && Date.now() < end) await Bun.sleep(1);
		expect(messages).toEqual(['{"type":"session.close"}']);
		expect(closed).toBe(1);
		expect(captures).toBe(1);
	} finally {
		server.stop(true);
	}
});

test.each([
	{ mode: "provider" as const, code: 1008, localCloseRequested: false, reasonBytes: 21 },
	{ mode: "local" as const, code: 1005, localCloseRequested: true, reasonBytes: 0 },
	{ mode: "abrupt" as const, code: 1006, localCloseRequested: false, reasonBytes: 0 },
])("diagnostic retains bounded close facts for $mode closure without reason text", async expected => {
	const events: any[] = [];
	let closed = 0;
	let captures = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req, server) {
			if (server.upgrade(req)) return;
			return new Response(null, { status: 400 });
		},
		websocket: {
			message(ws) {
				if (expected.mode === "provider") ws.close(1008, "private-provider-data");
				else if (expected.mode === "abrupt") ws.terminate();
			},
		},
	});
	try {
		const connection = await openDiagnosticVoiceSocket(
			`ws://127.0.0.1:${server.port}`,
			{ Authorization: "Bearer private-token" },
			{
				message() {},
				closed: () => {
					closed++;
				},
			},
			{
				record: (_layer, _direction, message) => events.push(message),
				close: () => {
					captures++;
				},
				invalidate() {},
			},
		);
		if (expected.mode === "local") connection.close();
		else connection.send("finish");
		const deadline = Date.now() + 1000;
		while (!closed && Date.now() < deadline) await Bun.sleep(1);
		expect(closed).toBe(1);
		expect(captures).toBe(1);
		expect(events.find(event => event.type === "closed")).toEqual({
			type: "closed",
			opened: true,
			closeCode: expected.code,
			closeReasonBytes: expected.reasonBytes,
			localCloseRequested: expected.localCloseRequested,
		});
		expect(JSON.stringify(events)).not.toContain("private");
	} finally {
		server.stop(true);
	}
});
