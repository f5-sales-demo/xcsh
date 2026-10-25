import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";
import { StartupAssistantPolicy } from "../../src/remote-control/voice-startup-policy";

const request = {
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
	transport: { type: "existingCall", callId: "synthetic-caller-first-call" },
};
async function fixture(
	snapshot: () => any = () => ({ tools: [], history: "", runtime: { workspace: "/tmp/caller-first" } }),
	owned = false,
	holdInitialPolicy = false,
) {
	let handlers!: VoiceHandlers;
	let autoAck = !holdInitialPolicy;
	let buffered = 0;
	const sent: Record<string, any>[] = [];
	const delegated: string[] = [];
	const records: Record<string, any>[] = [];
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-account" }),
		persona: async () => snapshot(),
		createCall: async () => ({ callId: "synthetic-owned-call", sdp: "v=0\r\nsynthetic-answer" }),
		open: async (_url, _headers, next) => {
			handlers = next;
			queueMicrotask(() =>
				next.message(JSON.stringify({ type: "session.started", session: { id: "synthetic-session" } })),
			);
			return {
				send: text => {
					const event = JSON.parse(text);
					if (event.type === "session.instructions.append") {
						queueMicrotask(() =>
							next.message(
								JSON.stringify({
									type: "session.instructions.appended",
									client_event_id: event.event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
						return;
					}
					sent.push(event);
					buffered += Buffer.byteLength(text);
					if (
						autoAck &&
						event.type === "session.context.append" &&
						event.content?.[0]?.text?.startsWith("You are xcsh")
					)
						queueMicrotask(() =>
							next.message(
								JSON.stringify({
									type: "session.context.appended",
									client_event_id: event.event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
				},
				close() {},
				get bufferedAmount() {
					return buffered;
				},
			};
		},
		record: async value => {
			records.push(value);
		},
		records: () => records,
		emit() {},
		delegate: async (_id, text) => {
			delegated.push(text);
			return "verified fixture result";
		},
	};
	const voice = new NativeVoice(deps);
	const opening = voice.start(
		owned ? { ...request, transport: { type: "webrtc", sdp: "v=0\r\nsynthetic-offer" } } : request,
	);
	void opening.catch(() => {});
	if (holdInitialPolicy) await Bun.sleep(10);
	else {
		await opening;
		sent.length = 0;
	}
	return {
		voice,
		sent,
		delegated,
		records,
		opening,
		acknowledge: async () => {
			for (const event of sent.filter(
				e => e.type === "session.context.append" && e.content?.[0]?.text?.startsWith("You are xcsh"),
			))
				handlers.message(
					JSON.stringify({
						type: "session.context.appended",
						client_event_id: event.event_id,
						start_ms: 0,
						end_ms: 1,
					}),
				);
			await opening.catch(() => {});
		},
		disconnect: () => handlers.closed(),
		hold: () => {
			autoAck = false;
		},
		receive: (value: unknown) => handlers.message(JSON.stringify(value)),
	};
}

test("typed caller requests do not reintroduce a creation-policy append", async () => {
	const f = await fixture();
	try {
		f.voice.appendText("first typed request");
		f.voice.appendText("second typed request");
		await Bun.sleep(20);
		expect(f.sent.filter(e => e.type === "session.context.append").map(e => e.content[0].text)).toEqual([
			"first typed request",
			"second typed request",
		]);
		expect(f.delegated).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});

test("caller fragments retain arrival order without a policy mutation", async () => {
	const f = await fixture(undefined, false, true);
	try {
		f.hold();
		f.receive({ type: "input_transcript.added", item: { text: "What do you" } });
		await Bun.sleep(20);
		f.receive({ type: "input_transcript.added", item: { text: " know about me?" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "profile",
				content: [{ type: "input_text", text: "What do you know about me?" }],
			},
		});
		await f.acknowledge();
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		expect(f.delegated[0]).toContain("user: What do you know about me?");
		expect(f.records.filter(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toHaveLength(0);
	} finally {
		await f.voice.stop();
	}
});

test("empty typed context does not excuse unsolicited startup output", async () => {
	const f = await fixture();
	try {
		expect(() => f.voice.appendText(" ")).toThrow("Invalid realtime text input");
		f.receive({ type: "output_transcript.added", item: { text: "Mm-mm." } });
		await Bun.sleep(30);
		expect(f.records.some(r => r.kind === "startupPolicyViolation" && r.reason === "startup-speech")).toBe(true);
		expect(f.sent.filter(e => e.type === "session.context.append")).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});

test("closing after a caller fragment preserves its text without admitting work", async () => {
	const f = await fixture(undefined, false, true);
	f.hold();
	f.receive({ type: "input_transcript.added", item: { text: "What do you know about me?" } });
	await Bun.sleep(20);
	await f.voice.stop();
	await f.acknowledge();
	expect(f.delegated).toEqual([]);
	expect(
		f.records.some(
			r =>
				r.kind === "voiceTimeline" &&
				r.item?.type === "transcriptSegment" &&
				r.item.text === "What do you know about me?",
		),
	).toBe(true);
	expect(f.records.some(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toBe(false);
});

test("runtime refresh uses current facts only after caller input", async () => {
	let workspace = "/tmp/old";
	const f = await fixture(() => ({ tools: [], history: "", runtime: { workspace } }));
	try {
		workspace = "/tmp/current";
		await f.voice.refreshContext();
		expect(f.sent).toEqual([]);
		f.receive({ type: "input_transcript.added", item: { text: "Which workspace?" } });
		await Bun.sleep(20);
		await f.voice.refreshContext();
		expect(f.sent).toHaveLength(1);
		expect(f.sent[0].content[0].text).toContain("/tmp/current");
		expect(f.sent[0].content[0].text).not.toContain("/tmp/old");
		expect(f.sent[0].content[0].text).not.toContain("You are xcsh");
	} finally {
		await f.voice.stop();
	}
});

test("caller-first attachment supplies no conversational context during silent startup", async () => {
	const f = await fixture();
	try {
		expect(f.sent).toEqual([]);
		expect(f.delegated).toEqual([]);
		expect(
			f.records.some(
				r => r.kind === "voicePolicyDiagnostic" && r.outcome === "prepared" && r.creationOwnership === "phone",
			),
		).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("the first real request is admitted once without replaying creation instructions", async () => {
	const f = await fixture();
	const event = {
		type: "delegation.created",
		item: {
			type: "delegation",
			target: "client",
			id: "caller-request",
			content: [{ type: "input_text", text: "Read the project" }],
		},
	};
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Read the project" } });
		f.receive(event);
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		f.receive(event);
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		expect(f.sent.some(e => e.content?.[0]?.text?.startsWith("You are xcsh"))).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("empty caller metadata cannot authorize captured nonverbal startup output", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "input_transcript.added", item: { text: " " } });
		f.receive({ type: "output_transcript.added", item: { text: "Mm-mm." } });
		await Bun.sleep(30);
		expect(f.records.some(r => r.kind === "startupPolicyViolation" && r.reason === "startup-speech")).toBe(true);
		expect(f.delegated).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});

test("caller-first policy recognizes every fragment split of the captured filler", () => {
	const text = "Mm-mm.";
	for (let index = 0; index <= text.length; index++) {
		const policy = new StartupAssistantPolicy({ callerFirst: true });
		const first = policy.observe("assistant", text.slice(0, index), false);
		const second = policy.observe("assistant", text.slice(index), false);
		expect(first ?? second).toBe("startup-speech");
	}
});

test("a real caller request permits the subsequent assistant response", () => {
	const policy = new StartupAssistantPolicy({ callerFirst: true });
	expect(policy.observe("assistant", " ", false)).toBeNull();
	policy.observe("user", "Who are you?", false);
	expect(policy.observe("assistant", "I’m ek-see-shell.", true)).toBeNull();
});

test("a genuine delegation preceding its transcript does not mutate creation policy", async () => {
	const f = await fixture();
	try {
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "profile-before-transcript",
				content: [{ type: "input_text", text: "What do you know about me?" }],
			},
		});
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		expect(f.delegated[0]).toContain("What do you know about me?");
		expect(f.sent.some(e => e.content?.[0]?.text?.startsWith("You are xcsh"))).toBe(false);
		f.receive({ type: "output_transcript.added", item: { text: "The saved profile was read." } });
		await Bun.sleep(20);
		expect(f.records.some(r => r.kind === "startupPolicyViolation")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("startup failure explicitly retires the provider call instead of only its sideband", async () => {
	const f = await fixture();
	f.receive({ type: "output_transcript.added", item: { text: "Mm-mm." } });
	await Bun.sleep(30);
	await f.voice.closing;
	expect(f.sent.filter(e => e.type === "session.close")).toHaveLength(1);
	expect(f.delegated).toEqual([]);
});

test("typed output remains bounded under socket backpressure", async () => {
	const f = await fixture(undefined, false, true);
	try {
		f.hold();
		for (let i = 0; i < 30 && f.voice.active; i++) f.voice.appendText("x".repeat(65536));
		expect(f.voice.active).toBe(false);
		expect(f.delegated).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});

test("typed input queued during reconnect is transmitted once after attachment", async () => {
	const f = await fixture();
	try {
		f.hold();
		f.disconnect();
		f.voice.appendText("typed while reattaching");
		const deadline = Date.now() + 2000;
		while (!f.sent.some(e => e.type === "session.context.append") && Date.now() < deadline) await Bun.sleep(10);
		expect(f.sent.filter(e => e.type === "session.context.append")).toHaveLength(1);
		await f.acknowledge();
		await Bun.sleep(30);
		expect(f.sent.some(e => e.content?.[0]?.text === "typed while reattaching")).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("backend mirroring and assistant context cannot break caller-first silence", async () => {
	const f = await fixture();
	try {
		f.voice.mirrorText("The saved plan is ready.");
		f.voice.appendText("Old assistant context", "assistant", true);
		await Bun.sleep(20);
		expect(f.sent).toEqual([]);
		expect(f.delegated).toEqual([]);
		f.receive({ type: "input_transcript.added", item: { text: "Read the plan" } });
		await Bun.sleep(20);
		f.voice.mirrorText("The requested plan is ready.");
		expect(f.sent.some(e => e.content?.[0]?.text === "The requested plan is ready.")).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("owned-call delegation before ASR counts as genuine caller input", async () => {
	const f = await fixture(undefined, true);
	try {
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "owned-request",
				content: [{ type: "input_text", text: "Read the project" }],
			},
		});
		await Bun.sleep(20);
		expect(f.delegated).toHaveLength(1);
		f.receive({ type: "output_transcript.added", item: { text: "The project was read." } });
		await Bun.sleep(20);
		expect(f.records.some(r => r.kind === "startupPolicyViolation")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("owned-call runtime refresh stays silent until genuine caller input", async () => {
	let workspace = "/tmp/before";
	const f = await fixture(() => ({ tools: [], history: "", runtime: { workspace } }), true);
	try {
		workspace = "/tmp/after";
		await f.voice.refreshContext();
		expect(f.sent).toEqual([]);
		f.receive({ type: "input_transcript.added", item: { text: "Which workspace?" } });
		await Bun.sleep(20);
		await f.voice.refreshContext();
		expect(f.sent.some(e => e.content?.[0]?.text?.includes("/tmp/after"))).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("records premature assistant speech while a caller turn is still unfinished", async () => {
	const f = await fixture();
	try {
		f.receive({
			type: "turn.created",
			turn: { id: "caller", role: "user", transcript: "Using my", start_ms: 8000, end_ms: 8200 },
		});
		f.receive({ type: "input_transcript.added", item: { text: "Using my" }, start_ms: 8000, end_ms: 8200 });
		f.receive({ type: "output_transcript.added", item: { text: "Sure" }, start_ms: 9000, end_ms: 9200 });
		await Bun.sleep(20);
		expect(
			f.records.some(r => r.kind === "voiceTurnTakingDiagnostic" && r.assistantBeforeCallerTurnCompleted === true),
		).toBe(true);
		expect(f.voice.active).toBe(true);
		f.receive({
			type: "turn.done",
			turn: {
				id: "caller",
				role: "user",
				transcript: "Using my context, inspect plugins.",
				start_ms: 8000,
				end_ms: 10000,
			},
		});
		f.receive({
			type: "output_transcript.added",
			item: { text: "Checking the plugins." },
			start_ms: 10200,
			end_ms: 10600,
		});
		await Bun.sleep(20);
		expect(f.records.filter(r => r.kind === "voiceTurnTakingDiagnostic")).toHaveLength(1);
	} finally {
		await f.voice.stop();
	}
});
