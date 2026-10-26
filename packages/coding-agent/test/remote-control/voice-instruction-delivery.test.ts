import { expect, test } from "bun:test";
import { NativeVoice } from "../../src/remote-control/voice";
import { voicePersonaInstructions } from "../../src/remote-control/voice-persona";
import { inspectVoiceEvent } from "../../src/remote-control/voice-protocol";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

async function fixture(apiKey = true, owned = false) {
	let handlers!: VoiceHandlers;
	const sent: any[] = [],
		records: any[] = [],
		events: string[] = [],
		work: string[] = [];
	let connections = 0;
	const voice = new NativeVoice({
		authenticateApiKey: async () => "api-fixture",
		createCall: async () => ({ callId: "owned-fixture", sdp: "v=0\r\n" }),
		closureTimeoutMs: 20,
		authenticate: async () => ({ accessToken: "fixture", accountId: "<ACCOUNT_ID>" }),
		open: async (_url, _headers, next) => {
			handlers = next;
			connections++;
			queueMicrotask(() => next.message(JSON.stringify({ type: "session.started", session: { id: "fixture" } })));
			return { bufferedAmount: 0, close: () => {}, send: text => sent.push(JSON.parse(text)) };
		},
		record: async record => {
			records.push(record);
		},
		records: () => records,
		emit: method => events.push(method),
		delegate: async (_id, text) => {
			work.push(text);
			return "Read complete.";
		},
	});
	await voice.start({
		version: "v3",
		outputModality: "audio",
		transport: apiKey
			? { type: "websocket" }
			: owned
				? { type: "webrtc", sdp: "v=0\r\n" }
				: { type: "existingCall", callId: "fixture" },
	});
	return {
		voice,
		sent,
		records,
		events,
		work,
		connections: () => connections,
		receive: (event: any) => handlers.message(JSON.stringify(event)),
		disconnect: () => handlers.closed(),
	};
}
const updates = (f: Awaited<ReturnType<typeof fixture>>) =>
	f.sent.filter(e => e.type === "session.instructions.append");
const outcomes = (f: Awaited<ReturnType<typeof fixture>>) =>
	f.records.filter(r => r.kind === "voiceInstructionDelivery");
const ack = (id: string) => ({ type: "session.instructions.appended", client_event_id: id, start_ms: 0, end_ms: 0 });

test("attachment sends one bounded string instruction with a unique correlation and no conversational reminder", async () => {
	const f = await fixture();
	try {
		expect(updates(f)).toHaveLength(1);
		const event = updates(f)[0];
		expect(event.delegation_id).toBeNull();
		expect(event.event_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(typeof event.content).toBe("string");
		expect(event.content.length).toBeLessThan(2200);
		expect(f.sent.filter(e => e.type === "session.context.append")).toEqual([]);
		expect(f.sent.filter(e => e.type === "session.update" && e.session?.instructions)).toHaveLength(1);
		expect(f.events).toContain("thread/realtime/started");
		expect(outcomes(f).some(r => r.outcome === "acknowledged")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("only a matching valid acknowledgment proves instruction delivery and duplicates do not add receipts", async () => {
	const f = await fixture();
	try {
		const id = updates(f)[0]?.event_id;
		expect(id).toBeDefined();
		f.receive(ack("unrelated"));
		f.receive({ ...ack(id), end_ms: -1 });
		f.receive({ ...ack(id), start_ms: 20, end_ms: 10 });
		await Bun.sleep(10);
		expect(outcomes(f).some(r => r.outcome === "acknowledged")).toBe(false);
		f.receive(ack(id));
		f.receive(ack(id));
		await Bun.sleep(10);
		expect(outcomes(f).filter(r => r.outcome === "acknowledged")).toHaveLength(1);
		expect(outcomes(f)).toContainEqual(
			expect.objectContaining({
				outcome: "acknowledged",
				transport: "api-websocket",
				correlation: "client_event_id",
				spokenBehaviorVerified: false,
			}),
		);
		expect(JSON.stringify(outcomes(f))).not.toContain(updates(f)[0].content);
	} finally {
		await f.voice.stop();
	}
});

test("a correlated rejection stops the candidate without context fallback or replay", async () => {
	const f = await fixture();
	const id = updates(f)[0]?.event_id;
	expect(id).toBeDefined();
	f.receive({
		type: "error",
		error: { client_event_id: id, code: "unsupported_event", message: "private provider detail" },
	});
	await Bun.sleep(20);
	await f.voice.closing;
	expect(f.voice.active).toBe(false);
	expect(outcomes(f)).toContainEqual(
		expect.objectContaining({ outcome: "rejected", correlation: "error.client_event_id" }),
	);
	expect(f.records).toContainEqual(
		expect.objectContaining({
			kind: "voiceProviderErrorDiagnostic",
			policyCommandMatched: true,
			policyCommandType: "session.instructions.append",
		}),
	);
	expect(f.sent.filter(e => e.type === "session.context.append")).toEqual([]);
	expect(f.work).toEqual([]);
	expect(JSON.stringify(f.records)).not.toContain("private provider detail");
});

test("closing while an instruction is pending preserves its unverified outcome", async () => {
	const f = await fixture();
	await f.voice.stop();
	f.receive(ack(updates(f)[0]?.event_id));
	expect(outcomes(f)).toContainEqual(expect.objectContaining({ outcome: "closed-unacknowledged" }));
	expect(outcomes(f).some(r => r.outcome === "acknowledged")).toBe(false);
	expect(f.work).toEqual([]);
});

test("pending delivery lost with the transport is not silently retried", async () => {
	const f = await fixture();
	f.disconnect();
	await f.voice.closing;
	expect(f.voice.active).toBe(false);
	expect(f.connections()).toBe(1);
	expect(outcomes(f)).toContainEqual(expect.objectContaining({ outcome: "transport-lost-unacknowledged" }));
});

test("API-key transport loss after acknowledgment closes without replaying completed user work", async () => {
	const f = await fixture();
	try {
		f.receive(ack(updates(f)[0]?.event_id));
		f.receive({ type: "input_transcript.added", item: { text: "Read a file" } });
		const request = {
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "read-once",
				content: [{ type: "input_text", text: "Read a file" }],
			},
		};
		f.receive(request);
		await Bun.sleep(30);
		expect(f.work).toHaveLength(1);
		f.disconnect();
		await f.voice.closing;
		f.receive(request);
		await Bun.sleep(30);
		expect(f.connections()).toBe(1);
		expect(f.voice.active).toBe(false);
		expect(updates(f)).toHaveLength(1);
		expect(f.work).toHaveLength(1);
	} finally {
		await f.voice.stop();
	}
});

test("startup and reminder share identity, truthful technology, documented delegation and listening policy", async () => {
	const f = await fixture();
	try {
		const content = updates(f)[0]?.content;
		expect(content).toBeDefined();
		const startup = voicePersonaInstructions({}, { tools: [], history: "" }).instructions;
		expect(startup).toContain(content);
		for (const phrase of [
			"I’m xcsh, your technical coworker",
			"ek-see-shell",
			"underlying technology",
			"verified model/provider",
			"Backchannel policy:",
			"Interruption policy:",
			"Delegation policy:",
			"Generate <|SpawnThinking|> when:",
			"Do not generate <|SpawnThinking|> when:",
			"Keep listening while the caller pauses to think",
			"one or two short sentences",
			"Do not add unsolicited completion questions",
		])
			expect(content).toContain(phrase);
		expect(content).not.toContain("Delegate identity");
	} finally {
		await f.voice.stop();
	}
});

test("instruction acknowledgments validate timeline order but allow an absent optional client identifier", () => {
	expect(inspectVoiceEvent({ ...ack("fixture"), start_ms: 10, end_ms: 0 }).disposition).toBe("rejected");
	expect(inspectVoiceEvent({ type: "session.instructions.appended", start_ms: 0, end_ms: 0 }).disposition).toBe(
		"observed",
	);
});

for (const owned of [false, true]) {
	test(`subscription ${owned ? "owned creation" : "phone attachment"} sends no behavioral attachment mutation`, async () => {
		const f = await fixture(false, owned);
		try {
			expect(updates(f)).toEqual([]);
			expect(f.sent.filter(e => e.type === "session.context.append")).toEqual([]);
			expect(f.sent.filter(e => e.type === "session.update")).toEqual([
				{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } },
			]);
			expect(f.voice.active).toBe(true);
			expect(outcomes(f)).toEqual([]);
		} finally {
			await f.voice.stop();
		}
	});
}
test("missing client correlation leaves API-key instruction delivery unverified", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "session.instructions.appended", start_ms: 0, end_ms: 0 });
		f.receive({ type: "session.instructions.appended", event_id: updates(f)[0].event_id, start_ms: 0, end_ms: 0 });
		await Bun.sleep(10);
		expect(outcomes(f).some(r => r.outcome === "acknowledged")).toBe(false);
		expect(f.voice.active).toBe(true);
	} finally {
		await f.voice.stop();
	}
});
test("subscription reconnect does not mutate policy or replay completed user work", async () => {
	const f = await fixture(false);
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Read a file" } });
		const request = {
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "subscription-read-once",
				content: [{ type: "input_text", text: "Read a file" }],
			},
		};
		f.receive(request);
		await Bun.sleep(30);
		expect(f.work).toHaveLength(1);
		f.disconnect();
		for (let i = 0; i < 100 && f.connections() < 2; i++) await Bun.sleep(10);
		f.receive(request);
		await Bun.sleep(30);
		expect(f.connections()).toBe(2);
		expect(updates(f)).toEqual([]);
		expect(f.sent.every(e => !e.session?.instructions)).toBe(true);
		expect(f.work).toHaveLength(1);
	} finally {
		await f.voice.stop();
	}
});
