import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";

const start = {
	transport: { type: "existingCall", callId: "fixture-call" },
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
};
function fixture() {
	const connections: {
		handlers: Parameters<NonNullable<VoiceDependencies["open"]>>[2];
		sent: any[];
		failSend: boolean;
		closed: number;
	}[] = [];
	const events: { method: string; params: Record<string, unknown> }[] = [];
	const records: Record<string, unknown>[] = [];
	const delegated: string[] = [];
	const authorization: string[] = [];
	let authentications = 0;
	let rejectOpen: Error | undefined;
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: `fixture-${++authentications}`, accountId: "example-voice-account" }),
		open: async (url, headers, handlers) => {
			expect(url).toBe("wss://api.openai.com/v1/live/fixture-call");
			authorization.push(headers.Authorization);
			if (rejectOpen) throw rejectOpen;
			const connection = { handlers, sent: [] as any[], failSend: false, closed: 0 };
			connections.push(connection);
			return {
				bufferedAmount: 0,
				send: data => {
					if (connection.failSend) throw new Error("disconnected");
					connection.sent.push(JSON.parse(data));
				},
				close: () => {
					connection.closed++;
					handlers.closed();
				},
			};
		},
		emit: (method, params) => events.push({ method, params }),
		records: () => records,
		record: async record => {
			records.push(record);
		},
		delegate: async (_id, text) => {
			delegated.push(text);
			return "Done.";
		},
	});
	return {
		voice,
		connections,
		events,
		records,
		delegated,
		authorization,
		reject: (error: Error | undefined) => {
			rejectOpen = error;
		},
	};
}
async function reconnected(f: ReturnType<typeof fixture>) {
	const deadline = Date.now() + 2000;
	while (f.connections.length < 2 && Date.now() < deadline) await Bun.sleep(10);
	expect(f.connections).toHaveLength(2);
}
const delegation = {
	type: "delegation.created",
	item: {
		type: "delegation",
		target: "client",
		id: "fixture-delegation",
		content: [{ type: "input_text", text: "work" }],
	},
};

test("v3 sideband reattaches the same call with refreshed auth and ignores stale socket events", async () => {
	const f = fixture();
	try {
		await f.voice.start(start);
		f.connections[0].handlers.message(JSON.stringify(delegation));
		await Bun.sleep(0);
		f.connections[0].handlers.closed();
		f.connections[0].handlers.closed();
		expect(f.voice.active).toBe(true);
		f.voice.appendText("queued context");
		await reconnected(f);
		expect(f.authorization).toEqual(["Bearer fixture-1", "Bearer fixture-2"]);
		expect(f.connections[1].sent).toEqual([
			{ type: "session.context.append", content: [{ type: "input_text", text: "queued context" }] },
		]);
		f.connections[0].handlers.closed();
		f.connections[0].handlers.message(JSON.stringify({ type: "error" }));
		f.connections[1].handlers.message(JSON.stringify(delegation));
		await Bun.sleep(0);
		expect(f.delegated).toEqual(["work"]);
		expect(f.voice.active).toBe(true);
		expect(f.events.filter(e => /^thread\/realtime\/(started|closed|error)$/.test(e.method))).toHaveLength(1);
		expect(f.records).toContainEqual(
			expect.objectContaining({ kind: "voiceDiagnostic", stage: "sideband-reconnect", connected: true }),
		);
	} finally {
		f.voice.stop();
	}
});
test("failed outbound context survives reconnect while successful chunks are not replayed", async () => {
	const f = fixture();
	try {
		await f.voice.start(start);
		f.voice.appendText("already delivered");
		f.connections[0].failSend = true;
		f.voice.appendText("a".repeat(750));
		await reconnected(f);
		expect(f.connections[1].sent.map(e => e.content[0].text).join("")).toBe("a".repeat(750));
		expect(f.connections[1].sent).toHaveLength(2);
	} finally {
		f.voice.stop();
	}
});
test("ending voice during reconnect cancels recovery and emits closure only once", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.connections[0].handlers.closed();
	f.voice.stop();
	await Bun.sleep(250);
	expect(f.connections).toHaveLength(1);
	expect(f.voice.active).toBe(false);
	expect(f.events.filter(e => e.method === "thread/realtime/closed")).toEqual([
		{ method: "thread/realtime/closed", params: { reason: "requested" } },
	]);
});
test("expired calls end recovery cleanly without disclosing service error bodies", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.reject(new Error("HTTP 410 private fixture-token"));
	f.connections[0].handlers.closed();
	await Bun.sleep(300);
	expect(f.voice.active).toBe(false);
	expect(f.events.filter(e => e.method === "thread/realtime/error")).toEqual([]);
	expect(f.events.at(-1)).toEqual({ method: "thread/realtime/closed", params: { reason: "transportClosed" } });
	expect(JSON.stringify(f.records)).not.toContain("private");
});
test("reconnecting context buffers remain bounded", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.connections[0].handlers.closed();
	for (let i = 0; i < 30 && f.voice.active; i++) f.voice.appendText("x".repeat(65536));
	expect(f.voice.active).toBe(false);
	expect(f.events).toContainEqual({
		method: "thread/realtime/error",
		params: { message: "Realtime output buffer limit reached" },
	});
});

test("stopping during a pending recovery handshake closes the late socket without reopening voice", async () => {
	let handlers: Parameters<NonNullable<VoiceDependencies["open"]>>[2];
	let resolveOpen: ((socket: any) => void) | undefined;
	let opens = 0,
		closes = 0;
	const events: string[] = [];
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "fixture", accountId: "example-voice-account" }),
		open: async (_url, _headers, next) => {
			handlers = next;
			if (++opens === 1) return { bufferedAmount: 0, send: () => {}, close: () => {} };
			return new Promise(resolve => {
				resolveOpen = resolve;
			});
		},
		emit: method => {
			events.push(method);
		},
		records: () => [],
		record: async () => {},
		delegate: async () => "Done.",
	});
	await voice.start(start);
	handlers!.closed();
	await Bun.sleep(250);
	expect(resolveOpen).toBeDefined();
	voice.stop();
	resolveOpen!({
		bufferedAmount: 0,
		send: () => {},
		close: () => {
			closes++;
			handlers.closed();
		},
	});
	await Bun.sleep(0);
	expect(closes).toBe(1);
	expect(voice.active).toBe(false);
	expect(events).toEqual([
		"thread/realtime/item/started",
		"thread/realtime/item/completed",
		"thread/realtime/started",
		"thread/realtime/item/started",
		"thread/realtime/item/completed",
		"thread/realtime/closed",
	]);
});

test("temporary reconnect failures retry without closing voice or losing queued work", async () => {
	const f = fixture();
	try {
		await f.voice.start(start);
		f.reject(new Error("Realtime connection closed"));
		f.connections[0].handlers.closed();
		await Bun.sleep(300);
		expect(f.voice.active).toBe(true);
		f.voice.appendText("retained during outage");
		f.reject(undefined);
		await reconnected(f);
		expect(f.authorization).toHaveLength(3);
		expect(f.connections[1].sent[0].content[0].text).toBe("retained during outage");
		expect(f.events.filter(e => /closed|error/.test(e.method))).toEqual([]);
	} finally {
		f.voice.stop();
	}
});
test("permanent reconnect rejection fails once with sanitized status evidence", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.reject(new Error("HTTP 403 private fixture-token"));
	f.connections[0].handlers.closed();
	await Bun.sleep(300);
	expect(f.voice.active).toBe(false);
	expect(f.authorization).toHaveLength(2);
	expect(f.records).toContainEqual(
		expect.objectContaining({ stage: "sideband-reconnect", failure: "http", httpStatus: 403 }),
	);
	expect(JSON.stringify(f.records)).not.toContain("private");
});

test("temporary reconnect failures have a finite retry budget", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.reject(new Error("Realtime connection closed"));
	f.connections[0].handlers.closed();
	await Bun.sleep(1600);
	expect(f.voice.active).toBe(false);
	expect(f.authorization).toHaveLength(4);
	expect(f.events.filter(e => e.method === "thread/realtime/error")).toHaveLength(1);
	expect(f.records.filter(e => e.stage === "sideband-reconnect").map(e => e.attempt)).toEqual([1, 2, 3]);
});
