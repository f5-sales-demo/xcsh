import { expect, spyOn, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

// Existing-call attachment preserves the creation policy. Its actual phone
// handoff still requires separate physical evidence.
const request = {
	transport: { type: "existingCall", callId: "synthetic-phone-call" },
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
};
const persona = { tools: [{ name: "read" }], history: "" };
function fixture(
	snapshot: () => any = () => persona,
	delegate: VoiceDependencies["delegate"] = async () => "synthetic-result",
	autoAck = true,
) {
	let handlers!: VoiceHandlers;
	let closed = 0;
	const sent: Record<string, any>[] = [];
	const records: Record<string, any>[] = [];
	const events: string[] = [];
	const deps: VoiceDependencies = {
		persona: async () => snapshot(),
		authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-voice-account" }),
		open: async (url, _headers, next) => {
			expect(url).toBe("wss://api.openai.com/v1/live/synthetic-phone-call");
			handlers = next;
			queueMicrotask(() =>
				next.message(JSON.stringify({ type: "session.started", session: { id: "synthetic-session" } })),
			);
			return {
				send: text => {
					const event = JSON.parse(text);
					sent.push(event);
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
				close: () => closed++,
				bufferedAmount: 0,
			};
		},
		record: async record => {
			records.push(record);
		},
		records: () => records,
		emit: method => events.push(method),
		delegate,
	};
	return {
		voice: new NativeVoice(deps),
		autoAck,
		opening: undefined as Promise<void> | undefined,
		sent,
		records,
		events,
		closed: () => closed,
		receive: (event: unknown) => handlers.message(JSON.stringify(event)),
	};
}

async function caller(f: ReturnType<typeof fixture>) {
	f.opening = f.voice.start(request);
	void f.opening.catch(() => {});
	await Bun.sleep(10);
	if (f.autoAck) await f.opening;
	f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
	await Bun.sleep(10);
}
async function acknowledge(f: ReturnType<typeof fixture>) {
	for (const event of f.sent.filter(
		e => e.type === "session.context.append" && e.content?.[0]?.text?.startsWith("You are xcsh"),
	))
		f.receive({ type: "session.context.appended", client_event_id: event.event_id, start_ms: 0, end_ms: 1 });
	await f.opening?.catch(() => {});
	await Bun.sleep(10);
}

test("phone-created call leaves its creation policy unchanged", async () => {
	const f = fixture();
	await f.voice.start(request);
	try {
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		expect(f.events).toContain("thread/realtime/started");
		expect(
			f.records.some(
				r => r.kind === "voicePolicyDiagnostic" && r.outcome === "prepared" && r.creationOwnership === "phone",
			),
		).toBe(true);
		f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
		await Bun.sleep(10);
		expect(
			f.sent.filter(e => e.type !== "session.context.append" && e.type !== "session.instructions.append"),
		).toEqual([{ type: "session.update", session: { delegation: { type: "client", ack_filler: false } } }]);
		expect(f.records.some(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("initial session event does not invent a policy acknowledgment", async () => {
	const f = fixture(undefined, undefined, false);
	await caller(f);
	f.receive({ type: "session.started", session: { id: "synthetic-session" } });
	await Bun.sleep(10);
	try {
		expect(f.records.some(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("provider rejection fails the call without policy mutation or replay", async () => {
	const f = fixture(undefined, undefined, false);
	await caller(f);
	f.receive({ type: "error", error: { message: "synthetic private provider payload" } });
	await Bun.sleep(10);
	await f.voice.closing;
	expect(f.voice.active).toBe(false);
	expect(
		f.sent.filter(
			event => event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh"),
		).length,
	).toBe(0);
	expect(f.closed()).toBe(1);
	expect(f.records.some(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toBe(false);
	expect(JSON.stringify(f.records)).not.toContain("synthetic private provider payload");
});

test("unrelated acknowledgment cannot complete policy delivery", async () => {
	const f = fixture(undefined, undefined, false);
	await caller(f);
	f.receive({ type: "session.instructions.appended", client_event_id: "unrelated-event", start_ms: 0, end_ms: 1 });
	await Bun.sleep(10);
	expect(f.records.some(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toBe(false);
	await f.voice.stop();
});

test("observed voice model is recorded without prompt or provider payload", async () => {
	const f = fixture();
	const opening = f.voice.start(request);
	await Bun.sleep(10);
	f.receive({
		type: "session.updated",
		session: { id: "synthetic-session", model: "gpt-live-1-codex", instructions: "private-input" },
	});
	for (let index = 0; index < 20 && !f.events.includes("thread/realtime/started"); index++) {
		f.receive({ type: "session.context.appended", start_ms: 0, end_ms: 1 });
		await Bun.sleep(1);
	}
	await opening;
	await f.voice.stop();
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "voiceModelDiagnostic", observedModel: "gpt-live-1-codex" }),
	);
	expect(JSON.stringify(f.records)).not.toContain("private-input");
});

test("existing-call startup never sends the oversized subscription policy append", async () => {
	const f = fixture();
	await caller(f);
	const contexts = f.sent.filter(e => e.type === "session.instructions.append");
	expect(contexts).toEqual([]);
	expect(
		f.records.some(
			r => r.kind === "voicePolicyDiagnostic" && r.outcome === "prepared" && r.creationOwnership === "phone",
		),
	).toBe(true);
	await f.voice.stop();
});

test("closing after caller input does not admit queued work or invent acknowledgments", async () => {
	let admissions = 0;
	const f = fixture(
		undefined,
		async () => {
			admissions++;
			return "unexpected";
		},
		false,
	);
	await caller(f);
	f.receive({
		type: "delegation.created",
		item: {
			type: "delegation",
			target: "client",
			id: "queued",
			content: [{ type: "input_text", text: "Read project files" }],
		},
	});
	await f.voice.stop();
	await acknowledge(f);
	expect(f.records.some(r => r.kind === "voicePolicyDiagnostic" && r.outcome === "acknowledged")).toBe(false);
	expect(admissions).toBe(0);
	expect(f.closed()).toBe(1);
});

test("provider rejection preserves bounded code and matching command identity without private payload", async () => {
	const f = fixture(undefined, undefined, false);
	await caller(f);
	f.receive({
		type: "error",
		error: {
			type: "invalid_request_error",
			code: "invalid_value",
			param: "type",
			event_id: "provider-event",
			message: "private response containing credentials and user data",
		},
	});
	await Bun.sleep(10);
	await f.voice.closing;
	expect(f.voice.active).toBe(false);
	await f.voice.stop();
	expect(f.records).toContainEqual(
		expect.objectContaining({
			kind: "voiceProviderErrorDiagnostic",
			providerErrorType: "invalid_request_error",
			providerErrorCode: "invalid_value",
			providerErrorParam: "type",
			policyCommandMatched: false,
			failedPolicyEventIdSha256: null,
		}),
	);
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "voiceProviderErrorDiagnostic", policyCommandType: null }),
	);
	expect(JSON.stringify(f.records)).not.toContain("private response containing");
});

test("unknown provider error fields remain redacted and never fabricate command correlation", async () => {
	const f = fixture(undefined, undefined, false);
	await caller(f);
	f.receive({
		type: "error",
		error: {
			type: "private-type",
			code: "private-token",
			param: "/private/path",
			event_id: "unrelated",
			message: "private payload",
		},
	});
	await Bun.sleep(10);
	await f.voice.closing;
	expect(f.voice.active).toBe(false);
	await f.voice.stop();
	expect(f.records).toContainEqual(
		expect.objectContaining({
			kind: "voiceProviderErrorDiagnostic",
			providerErrorType: null,
			providerErrorCode: null,
			providerErrorParam: null,
			policyCommandMatched: false,
		}),
	);
	expect(JSON.stringify(f.records)).not.toContain("private-token");
});

test("verified runtime changes refresh silently and skip unchanged snapshots", async () => {
	let runtime = {
		model: "gpt-6-astra",
		provider: "openai-codex",
		reasoning: "high",
		workspace: "/tmp/first",
		tenant: "example-corp",
		taskStatus: "idle",
	};
	const f = fixture(() => ({ tools: [], history: "private profile must stay outside Live", runtime }));
	await caller(f);
	await acknowledge(f);
	const before = f.sent.length;
	try {
		runtime = { ...runtime, workspace: "/tmp/second", tenant: "example-partners", taskStatus: "running" };
		await f.voice.refreshContext();
		const updates = f.sent.slice(before);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toMatchObject({ type: "session.context.append" });
		expect(updates[0].channel).toBeUndefined();
		expect(updates[0].content[0].text).toContain("/tmp/second");
		expect(updates[0].content[0].text).toContain("example-partners");
		expect(updates[0].content[0].text).not.toContain("private profile");
		await f.voice.refreshContext();
		expect(f.sent).toHaveLength(before + 1);
	} finally {
		await f.voice.stop();
	}
});

test("runtime refresh retires cleared facts and ignores closed calls", async () => {
	let runtime: any = { workspace: "/tmp/first", tenant: "example-corp", taskStatus: "idle" };
	const f = fixture(() => ({ tools: [], history: "", runtime }));
	await caller(f);
	await acknowledge(f);
	try {
		runtime = undefined;
		await f.voice.refreshContext();
		const text = f.sent.at(-1)!.content[0].text;
		expect(text).toContain('"workspace":"unknown"');
		expect(text).toContain('"selectedContext":"unknown"');
		const before = f.sent.length;
		await f.voice.stop();
		runtime = { workspace: "/tmp/late" };
		await f.voice.refreshContext();
		expect(f.sent).toHaveLength(before + 1); // session.close only
	} finally {
		await f.voice.stop();
	}
});
test("runtime refresh prevents private fields and remains bounded on Unicode paths", async () => {
	const { voiceRuntimeContext } = await import("../../src/remote-control/voice-persona");
	const snapshot: any = {
		tools: [],
		history: "secret history",
		runtime: {
			workspace: `/tmp/${"🌳".repeat(900)}`,
			model: "bad\nmodel",
			tenant: null,
			credentials: "never-forward",
			profile: "private@example.com",
			taskStatus: "invented",
		},
	};
	const text = voiceRuntimeContext(snapshot);
	expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1900);
	expect(text).not.toContain("\uFFFD");
	expect(text).not.toContain("never-forward");
	expect(text).not.toContain("private@example.com");
	expect(JSON.parse(text)).toMatchObject({ model: "unknown", selectedContext: "none", taskStatus: "unknown" });
});
test("failed snapshot reads do not poison later runtime refreshes", async () => {
	let fail = false;
	let runtime = { workspace: "/tmp/first" };
	const f = fixture(() => {
		if (fail) throw new Error("Synthetic observer failure");
		return { tools: [], history: "", runtime };
	});
	await caller(f);
	await acknowledge(f);
	try {
		fail = true;
		await expect(f.voice.refreshContext()).rejects.toThrow("Synthetic observer failure");
		fail = false;
		runtime = { workspace: "/tmp/recovered" };
		await f.voice.refreshContext();
		expect(f.sent.at(-1)!.content[0].text).toContain("/tmp/recovered");
	} finally {
		await f.voice.stop();
	}
});
test("a snapshot read completing after voice closure cannot send late context", async () => {
	let pending: Promise<any> | undefined;
	let resolve!: (value: any) => void;
	const f = fixture(() => pending ?? { tools: [], history: "", runtime: { workspace: "/tmp/first" } });
	await caller(f);
	await acknowledge(f);
	pending = new Promise(r => {
		resolve = r;
	});
	const refresh = f.voice.refreshContext();
	await Bun.sleep(0);
	await f.voice.stop();
	const count = f.sent.length;
	resolve({ tools: [], history: "", runtime: { workspace: "/tmp/late" } });
	await refresh;
	expect(f.sent).toHaveLength(count);
});

test("elapsed work inspection refreshes verified context without another delegation", async () => {
	let snapshots = 0;
	const f = fixture(() => {
		snapshots++;
		return { tools: [], history: "", runtime: { taskStatus: snapshots > 1 ? "running" : "idle" } };
	});
	await caller(f);
	await acknowledge(f);
	try {
		await f.voice.inspectWorkStatus();
		expect(snapshots).toBe(2);
		expect(f.sent.at(-1)!.content[0].text).toContain("running");
		expect(f.sent.at(-1)!.channel).toBeUndefined();
	} finally {
		await f.voice.stop();
	}
});

test("elapsed timer inspects pending delegation and closing retires it", async () => {
	let tick = () => {};
	let delay: unknown;
	const intervals = spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms: number) => {
		tick = callback;
		delay = ms;
		return { unref() {} };
	}) as any);
	const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	const inspect = spyOn(NativeVoice.prototype, "inspectWorkStatus").mockResolvedValue();
	const f = fixture(
		() => persona,
		async () => new Promise(() => {}),
	);
	await caller(f);
	await acknowledge(f);
	try {
		tick();
		expect(inspect).toHaveBeenCalledTimes(0);
		expect(delay).toBe(30000);
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "pending",
				content: [{ type: "input_text", text: "Synthetic work" }],
			},
		});
		await Bun.sleep(0);
		tick();
		expect(inspect).toHaveBeenCalledTimes(1);
		await f.voice.stop();
		expect(clear).toHaveBeenCalled();
	} finally {
		await f.voice.stop();
		intervals.mockRestore();
		clear.mockRestore();
		inspect.mockRestore();
	}
});

test("closure separates pre-caller audio from legitimate response audio", async () => {
	const f = fixture();
	await f.voice.start(request);
	const signal = Buffer.alloc(9600);
	for (let i = 0; i < signal.length; i += 2) signal.writeInt16LE(100, i);
	f.receive({ type: "session.output_audio.delta", delta: signal.toString("base64") });
	await Bun.sleep(10);
	f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
	await Bun.sleep(10);
	f.receive({ type: "session.output_audio.delta", delta: signal.toString("base64") });
	await Bun.sleep(10);
	await f.voice.stop();
	expect(f.records.find(r => r.kind === "voiceStartupAudioDiagnostic")).toMatchObject({
		realtimeSessionId: null,
		frames: 1,
		signalFrames: 1,
		callerObserved: true,
	});
	expect(f.records.find(r => r.kind === "voiceAudioDiagnostic")).toMatchObject({ frames: 2, signalFrames: 2 });
});
