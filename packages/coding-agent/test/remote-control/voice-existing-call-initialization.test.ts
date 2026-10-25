import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

function fixture() {
	const sent: any[] = [];
	const records: any[] = [];
	const admitted: string[] = [];
	let handlers!: VoiceHandlers;
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "synthetic", accountId: "example-account" }),
		persona: async () => ({ tools: [], history: "", runtime: { workspace: "/tmp/voice-attach" } }),
		open: async (_url, _headers, next) => {
			handlers = next;
			queueMicrotask(() => next.message(JSON.stringify({ type: "session.started", session: { id: "server" } })));
			return {
				send(data: string) {
					sent.push(JSON.parse(data));
					if (JSON.parse(data).type === "session.update")
						queueMicrotask(() =>
							handlers.message(JSON.stringify({ type: "session.updated", session: { id: "server" } })),
						);
				},
				close() {},
				bufferedAmount: 0,
			};
		},
		record: async row => {
			records.push(row);
		},
		records: () => records,
		emit() {},
		delegate: async (_id, text) => {
			admitted.push(text);
			return "synthetic result";
		},
	};
	return {
		voice: new NativeVoice(deps),
		sent,
		records,
		admitted,
		receive: (event: unknown) => handlers.message(JSON.stringify(event)),
	};
}

const request = {
	threadId: "thread",
	realtimeSessionId: "realtime",
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
	transport: { type: "existingCall", callId: "call" },
};

test("existing call preserves creator instructions without appending the compiled policy", async () => {
	const f = fixture();
	const start = f.voice.start(request);
	void start.catch(() => {});
	try {
		await Bun.sleep(30);
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		await start;
		await f.voice.refreshContext();
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		expect(f.admitted).toEqual([]);
	} finally {
		await f.voice.stop();
		await start.catch(() => {});
	}
});

test("caller transcript survives attachment without an invented policy acknowledgment", async () => {
	const f = fixture();
	const start = f.voice.start(request);
	void start.catch(() => {});
	try {
		await Bun.sleep(30);
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		await start;
		f.receive({ type: "input_transcript.added", item: { id: "caller", text: "Who are you?" } });
		f.receive({ type: "turn.done", turn: { id: "caller", role: "user", transcript: "Who are you?" } });
		await Bun.sleep(30);
		expect(f.records.some(r => r.kind === "transcript" && r.role === "user" && r.text === "Who are you?")).toBe(true);
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
	} finally {
		await f.voice.stop();
		await start.catch(() => {});
	}
});

test("creator-owned policy does not relax the unsolicited filler guard", async () => {
	const f = fixture();
	const start = f.voice.start(request);
	void start.catch(() => {});
	try {
		await Bun.sleep(30);
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		await start;
		f.receive({ type: "output_transcript.added", item: { text: " Mm" } });
		await Bun.sleep(50);
		expect(f.records.some(r => r.kind === "startupPolicyViolation")).toBe(true);
		expect(f.sent.some(r => r.type === "session.close")).toBe(true);
		expect(f.admitted).toEqual([]);
	} finally {
		await f.voice.stop();
		await start.catch(() => {});
	}
});

test("existing call disables filler without replacing creator instructions", async () => {
	const f = fixture();
	try {
		await f.voice.start(request);
		await Bun.sleep(20);
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		expect(
			f.records.some(
				r => r.kind === "voiceAcknowledgmentFiller" && r.enabled === false && r.providerAcknowledged === true,
			),
		).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("phone attachment sends no behavioral reminder or instruction mutation", async () => {
	const f = fixture();
	try {
		await f.voice.start(request);
		const update = f.sent.find(e => e.type === "session.update");
		expect(update.session.instructions).toBeUndefined();
		expect(f.sent.filter(e => ["session.instructions.append", "session.context.append"].includes(e.type))).toEqual(
			[],
		);
	} finally {
		await f.voice.stop();
	}
});
