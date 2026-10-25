import { expect, test } from "bun:test";
import { NativeVoice } from "../../src/remote-control/voice";

test("subscription attachment uses server readiness without mutating the creation policy", async () => {
	const sent: any[] = [];
	const records: any[] = [];
	const emitted: string[] = [];
	let receive = (_event: string) => {};
	let admitted = 0;
	const persona = { tools: [{ name: "read" }], history: "" };
	const voice = new NativeVoice({
		persona: () => persona,
		authenticate: async () => ({ accessToken: "synthetic", accountId: "example-account" }),
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			queueMicrotask(() => receive(JSON.stringify({ type: "session.started", session: { id: "fixture" } })));
			return { bufferedAmount: 0, close() {}, send: data => sent.push(JSON.parse(data)) };
		},
		records: () => records,
		record: async row => {
			records.push(row);
		},
		emit: method => emitted.push(method),
		delegate: async () => {
			admitted++;
			return "fixture";
		},
	});
	const request = {
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "existingCall", callId: "fixture" },
	};
	const opening = voice.start(request);
	try {
		await Bun.sleep(10);
		expect(sent).toEqual([
			{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } },
		]);
		expect(emitted).toContain("thread/realtime/started");
		receive(
			JSON.stringify({
				type: "session.instructions.appended",
				client_event_id: "unrelated",
				start_ms: 0,
				end_ms: 1,
			}),
		);
		await Bun.sleep(0);
		expect(emitted).toContain("thread/realtime/started");
		receive(JSON.stringify({ type: "session.context.appended", start_ms: 0, end_ms: 1 }));
		await opening;
		expect(emitted).toContain("thread/realtime/started");
		expect(admitted).toBe(0);
	} finally {
		await voice.stop();
		await opening.catch(() => {});
	}
});

test("provider rejection after attachment persists failed lifecycle before one closure", async () => {
	const records: any[] = [];
	const events: string[] = [];
	let admitted = 0;
	let receive = (_event: string) => {};
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "synthetic", accountId: "example-account" }),
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			queueMicrotask(() => receive(JSON.stringify({ type: "session.started", session: { id: "fixture" } })));
			return { bufferedAmount: 0, close() {}, send() {} };
		},
		records: () => records,
		record: async row => {
			records.push(row);
			events.push(`persist:${row.kind}:${(row.item as { type?: string } | undefined)?.type}`);
		},
		emit: method => events.push(method),
		delegate: async () => {
			admitted++;
			return "unexpected";
		},
	});
	await voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		realtimeSessionId: "failed-physical-fixture",
		transport: { type: "existingCall", callId: "fixture" },
	});
	receive(
		JSON.stringify({ type: "error", error: { type: "invalid_request_error", code: "invalid_value", param: "type" } }),
	);
	await Bun.sleep(10);
	await voice.closing;
	await voice.stop();
	const lifecycle = records.filter(row => row.kind === "voiceTimeline").map(row => row.item);
	expect(lifecycle.map(item => item.type)).toEqual(["realtimeSessionStarted", "realtimeSessionClosed"]);
	expect(lifecycle.every(item => item.realtimeSessionId === "failed-physical-fixture")).toBe(true);
	expect(lifecycle[1].outcome).toBe("failed");
	expect(events.indexOf("persist:voiceTimeline:realtimeSessionClosed")).toBeLessThan(
		events.indexOf("thread/realtime/closed"),
	);
	expect(events.filter(name => name === "thread/realtime/closed")).toHaveLength(1);
	expect(events).toContain("thread/realtime/started");
	expect(admitted).toBe(0);
});
