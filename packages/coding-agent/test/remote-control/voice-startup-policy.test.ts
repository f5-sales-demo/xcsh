import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";
import { StartupAssistantPolicy } from "../../src/remote-control/voice-startup-policy";

import captured from "./fixtures/startup-self-dialogue.json";

test.each(captured)("captured startup assistant-only dialogue is rejected: %s", text => {
	const policy = new StartupAssistantPolicy();
	expect(policy.observe("assistant", text, true)).not.toBeNull();
});

test("all fragment splits detect the captured dialogue", () => {
	for (const text of captured) {
		for (let i = 0; i <= text.length; i++) {
			const policy = new StartupAssistantPolicy();
			const first = policy.observe("assistant", text.slice(0, i), false);
			const second = policy.observe("assistant", text.slice(i), false);
			expect(first ?? second).not.toBeNull();
		}
	}
});

test("ordinary best-effort greeting is not self-dialogue", () => {
	for (const text of ["Hi there.", "I’m ek-see-shell. What would you like to work on?", "I’m here and listening."])
		expect(new StartupAssistantPolicy().observe("assistant", text, true)).toBeNull();
});

test("caller input permits its real answer without inventing another request", () => {
	const policy = new StartupAssistantPolicy();
	policy.observe("user", "Who are you?", false);
	expect(policy.observe("assistant", "I’m ek-see-shell.", true)).toBeNull();
});

test("policy cannot mistake quoted discussion for an assistant identity claim", () => {
	expect(
		new StartupAssistantPolicy().observe("assistant", "A webpage may say ‘I’m ChatGPT’, but I’m xcsh.", true),
	).toBeNull();
});

async function fixture() {
	let handlers!: VoiceHandlers;
	const records: Record<string, any>[] = [];
	const events: { method: string; params: Record<string, any> }[] = [];
	const delegated: string[] = [];
	let closed = 0;
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "synthetic-token", accountId: "example-account" }),
		open: async (_url, _headers, next) => {
			handlers = next;
			queueMicrotask(() =>
				next.message(JSON.stringify({ type: "session.started", session: { id: "example-session" } })),
			);
			return {
				send: data => {
					if (JSON.parse(data).type === "session.instructions.append")
						queueMicrotask(() =>
							next.message(
								JSON.stringify({
									type: "session.instructions.appended",
									client_event_id: JSON.parse(data).event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
					if (JSON.parse(data).type === "session.context.append")
						queueMicrotask(() =>
							next.message(JSON.stringify({ type: "session.context.appended", start_ms: 0, end_ms: 1 })),
						);
				},
				close: () => {
					closed++;
				},
				bufferedAmount: 0,
			};
		},
		emit: (method, params) => {
			events.push({ method, params });
		},
		record: async record => {
			records.push(record);
		},
		records: () => records,
		delegate: async (_id, text) => {
			delegated.push(text);
			return "verified";
		},
	};
	const voice = new NativeVoice(deps);
	await voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "existingCall", callId: "example-call" },
	});
	return {
		voice,
		records,
		events,
		delegated,
		closed: () => closed,
		receive: (event: unknown) => handlers.message(JSON.stringify(event)),
	};
}

test.each(captured)("runtime fails captured self-dialogue and blocks the queued handoff: %s", async text => {
	const f = await fixture();
	try {
		f.receive({ type: "output_transcript.added", item: { text } });
		f.receive({ type: "turn.done", turn: { role: "assistant", transcript: text, id: "self-dialogue" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "invented",
				content: [{ type: "input_text", text: "List the project files" }],
			},
		});
		await Bun.sleep(30);
		await f.voice.closing;
		expect(f.delegated).toEqual([]);
		expect(f.records.filter(record => record.kind === "startupPolicyViolation")).toHaveLength(1);
		expect(f.events.find(event => event.method === "thread/realtime/closed")?.params.reason).toBe("failed");
		expect(f.closed()).toBe(1);
		expect(f.records.some(record => record.kind === "delegation")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("runtime permits a greeting and work after actual caller input", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "turn.done", turn: { role: "user", transcript: "Hello", id: "actual-caller" } });
		f.receive({ type: "output_transcript.added", item: { text: "Hi there." } });
		f.receive({ type: "turn.done", turn: { role: "assistant", transcript: "Hi there.", id: "greeting" } });
		f.receive({ type: "input_transcript.added", item: { text: "List the project files" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "caller-task",
				content: [{ type: "input_text", text: "List the project files" }],
			},
		});
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		expect(f.records.some(record => record.kind === "startupPolicyViolation")).toBe(false);
	} finally {
		await f.voice.stop();
	}
});

test("a startup failure stays failed across a later phone stop", async () => {
	const f = await fixture();
	f.receive({ type: "output_transcript.added", item: { text: captured[3] } });
	await Bun.sleep(20);
	await f.voice.stop();
	await f.voice.stop();
	expect(f.events.filter(e => e.method === "thread/realtime/closed")).toHaveLength(1);
	expect(f.events.find(e => e.method === "thread/realtime/closed")?.params.reason).toBe("failed");
	expect(
		f.records.find(r => r.kind === "voiceTimeline" && r.item.type === "realtimeSessionClosed")?.item.outcome,
	).toBe("failed");
	expect(f.records.find(r => r.kind === "startupPolicyViolation")?.sourceTextSha256).toMatch(/^[a-f0-9]{64}$/);
	expect(f.records.find(r => r.kind === "startupPolicyViolation")?.sourceText).toBeUndefined();
});

test("a new voice attachment does not inherit a prior violation", async () => {
	const first = await fixture();
	first.receive({ type: "output_transcript.added", item: { text: captured[3] } });
	await Bun.sleep(20);
	await first.voice.stop();
	const second = await fixture();
	second.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
	second.receive({
		type: "turn.done",
		turn: { role: "assistant", transcript: "I’m ek-see-shell.", id: "real-answer" },
	});
	await Bun.sleep(20);
	expect(second.records.some(r => r.kind === "startupPolicyViolation")).toBe(false);
	expect(second.records.find(r => r.kind === "transcript" && r.role === "assistant")?.text).toBe("I’m xcsh.");
	await second.voice.stop();
});

test("assistant turn boundaries cannot hide a greeting-and-answer exchange", () => {
	const policy = new StartupAssistantPolicy();
	expect(policy.observe("assistant", "Hi ChatGPT,", true)).toBe("self-dialogue");
	expect(policy.observe("assistant", "Hey! What would you like to work on?", true)).toBe("self-dialogue");
});

test("a genuine question after startup greeting retires earlier assistant evidence", () => {
	const policy = new StartupAssistantPolicy();
	expect(policy.observe("assistant", "Hello!", true)).toBeNull();
	policy.observe("user", "Can you explain a ChatGPT message?", false);
	expect(policy.observe("assistant", "The message says: I’m ChatGPT.", true)).toBeNull();
});

test("the policy rejects uncatalogued self-dialogue structures", () => {
	for (const text of [
		"Hello! I am Chat GPT.",
		"What can you do? I can explain options.",
		"Who are you? I am a voice assistant.",
		"Hey ek-see-shell, please do this.",
	])
		expect(new StartupAssistantPolicy().observe("assistant", text, true)).not.toBeNull();
});

test("a direct question to the caller is allowed", () => {
	for (const text of ["What would you like to do?", "Can you hear me?", "Would you like help with this project?"])
		expect(new StartupAssistantPolicy().observe("assistant", text, true)).toBeNull();
});

test("a harmless completed greeting cannot hide a later assistant-only exchange", () => {
	for (const text of captured) {
		const policy = new StartupAssistantPolicy();
		expect(policy.observe("assistant", "Hi there.", true)).toBeNull();
		expect(policy.observe("assistant", text, true)).not.toBeNull();
	}
});

test("a question and its invented answer across assistant turns is rejected", () => {
	const policy = new StartupAssistantPolicy();
	expect(policy.observe("assistant", "Who are you?", true)).toBeNull();
	expect(policy.observe("assistant", "I’m ek-see-shell.", true)).toBe("self-dialogue");
});

// Sanitized replay preserves the failing event shape without retaining private speech.
test.each(["What does that tell you?", "Wie geht es weiter?", "その話はどう思いますか？"])(
	"empty startup handoff with unobserved caller metadata admits no work: %s",
	async _text => {
		const f = await fixture();
		try {
			f.receive({
				type: "delegation.created",
				item: {
					type: "delegation",
					target: "client",
					id: "empty-startup",
					user_bidi_turn_id: "unobserved-user",
					content: [{ type: "input_text", text: "" }],
				},
			});
			await Bun.sleep(30);
			expect(f.delegated).toEqual([]);
			expect(f.records.find(r => r.kind === "delegationSuppressed")?.reason).toBe("noCallerRequest");
			expect(f.records.some(r => r.kind === "delegation")).toBe(false);
		} finally {
			await f.voice.stop();
		}
	},
);
test("empty startup handoff cannot reuse an earlier answered caller turn", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
		f.receive({ type: "turn.done", turn: { role: "assistant", transcript: "I’m xcsh.", id: "answered" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "first-request",
				content: [{ type: "input_text", text: "Read the project" }],
			},
		});
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		f.receive({ type: "turn.done", turn: { role: "assistant", transcript: "Anything else?", id: "followup" } });
		f.receive({
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "empty-followup",
				content: [{ type: "input_text", text: "" }],
			},
		});
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		expect(f.records.find(r => r.kind === "delegationSuppressed")?.reason).toBe("noCallerRequest");
	} finally {
		await f.voice.stop();
	}
});
test("empty handoff with an actual current caller transcript is admitted once", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "input_transcript.added", item: { text: "Read the project" } });
		const e = {
			type: "delegation.created",
			item: {
				type: "delegation",
				target: "client",
				id: "caller-empty",
				content: [{ type: "input_text", text: "" }],
			},
		};
		f.receive(e);
		f.receive(e);
		await Bun.sleep(30);
		expect(f.delegated).toHaveLength(1);
		expect(f.delegated[0]).toContain("user: Read the project");
	} finally {
		await f.voice.stop();
	}
});

test("requested identity rejects ChatGPT after caller input across every transcript split", () => {
	const text = "I’m ChatGPT. I can help talk through ideas.";
	for (let i = 0; i <= text.length; i++) {
		const p = new StartupAssistantPolicy();
		p.observe("user", "Who are you?", true);
		const a = p.observe("assistant", text.slice(0, i), false);
		const b = p.observe("assistant", text.slice(i), false);
		expect(a ?? b).toBe("identity-mismatch");
	}
});
test("runtime preserves and rejects requested wrong identity before a final event arrives", async () => {
	const f = await fixture();
	f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
	f.receive({ type: "output_transcript.added", item: { text: " I’m Chat" } });
	f.receive({ type: "output_transcript.added", item: { text: "GPT. I can help with ideas." } });
	await Bun.sleep(30);
	await f.voice.stop();
	expect(f.records.filter(r => r.kind === "startupPolicyViolation")).toHaveLength(1);
	expect(f.records.find(r => r.kind === "startupPolicyViolation")?.reason).toBe("identity-mismatch");
	expect(
		f.records.find(
			r => r.kind === "voiceTimeline" && r.item.type === "transcriptSegment" && r.item.role === "assistant",
		)?.item.text,
	).toContain("ChatGPT");
	expect(f.events.find(e => e.method === "thread/realtime/closed")?.params.reason).toBe("failed");
	expect(f.delegated).toEqual([]);
});
test("a quoted ChatGPT description after a caller question is not self-identification", () => {
	const p = new StartupAssistantPolicy();
	p.observe("user", "Explain the message", true);
	expect(p.observe("assistant", "The message says: I’m ChatGPT.", true)).toBeNull();
});

test("silent phone partial annotation waits for completion without admitting caller input", () => {
	const policy = new StartupAssistantPolicy({ callerFirst: true });
	expect(policy.observe("assistant", " [lip", false)).toBeNull();
	expect(policy.observe("assistant", " smack]", false)).toBe("startup-speech");
});

test("unfinished annotations cannot hide completed output, greetings, or unbounded fragments", () => {
	expect(new StartupAssistantPolicy({ callerFirst: true }).observe("assistant", " [lip", true)).toBe("startup-speech");
	expect(new StartupAssistantPolicy({ callerFirst: true }).observe("assistant", " Hi,", false)).toBe("startup-speech");
	expect(new StartupAssistantPolicy({ callerFirst: true }).observe("assistant", "[" + "x".repeat(257), false)).toBe(
		"startup-speech",
	);
	const policy = new StartupAssistantPolicy({ callerFirst: true });
	expect(policy.observe("assistant", " [lip", false)).toBeNull();
	expect(policy.observe("assistant", "\nHi", false)).toBe("startup-speech");
});

test("captured silent partial caption does not close the runtime before the provider finishes it", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "output_transcript.added", item: { text: " [lip" }, start_ms: 200, end_ms: 400 });
		await Bun.sleep(20);
		expect(f.closed()).toBe(0);
		expect(f.delegated).toEqual([]);
		f.receive({ type: "output_transcript.added", item: { text: " smack]" }, start_ms: 400, end_ms: 600 });
		await Bun.sleep(20);
		await f.voice.closing;
		expect(f.closed()).toBe(1);
		expect(f.records.some(row => row.kind === "startupPolicyViolation")).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("captured sniff annotation is not spoken text and cannot authorize backend work", () => {
	const policy = new StartupAssistantPolicy({ callerFirst: true });
	expect(policy.observe("assistant", " [sniff]", false)).toBeNull();
	expect(policy.observe("assistant", " [sniff]", true)).toBeNull();
	expect(policy.observe("assistant", " Mm-h", false)).toBe("startup-speech");
});

test("sniff tags cannot conceal words, unknown annotations, or invented caller dialogue", () => {
	for (const text of ["[sniff] Hi", "[unknown]", "[sniff] Who are you? I am xcsh", "[sniff] I'm ChatGPT"])
		expect(new StartupAssistantPolicy({ callerFirst: true }).observe("assistant", text, true)).not.toBeNull();
});

test("runtime preserves sniff annotation as evidence without declaring a speech failure", async () => {
	const f = await fixture();
	try {
		f.receive({ type: "output_transcript.added", item: { text: " [sniff]" }, start_ms: 1000, end_ms: 1200 });
		await Bun.sleep(20);
		expect(f.closed()).toBe(0);
		expect(f.delegated).toEqual([]);
		expect(f.records.some(row => row.kind === "voiceAnnotationDiagnostic" && row.annotation === "sniff")).toBe(true);
	} finally {
		await f.voice.stop();
	}
});

test("every sniff annotation split preserves following speech rejection", () => {
	const text = " [sniff]";
	for (let split = 0; split <= text.length; split++) {
		const policy = new StartupAssistantPolicy({ callerFirst: true });
		expect(policy.observe("assistant", text.slice(0, split), false)).toBeNull();
		expect(policy.observe("assistant", text.slice(split), false)).toBeNull();
		expect(policy.observe("assistant", " Hi", false)).toBe("startup-speech");
	}
});

// Reproduces the observed post-caller identity claim without private speech.
test("post-caller identity claim after an earlier sentence is rejected at every fragment split", () => {
	const text = "I cannot inspect that runtime. I’m just ChatGPT here to help.";
	for (let split = 0; split <= text.length; split++) {
		const policy = new StartupAssistantPolicy();
		policy.observe("user", "Which runtime are you connected to?", true);
		const first = policy.observe("assistant", text.slice(0, split), false);
		const second = policy.observe("assistant", text.slice(split), false);
		expect(first ?? second).toBe("identity-mismatch");
	}
});

test("sentence identity detection preserves quoted discussion and negated identity", () => {
	for (const text of [
		"I am xcsh. The message says: I’m just ChatGPT.",
		"I am xcsh. ‘I’m just ChatGPT’ is quoted text.",
		"I am not ChatGPT. I’m xcsh.",
	]) {
		const policy = new StartupAssistantPolicy();
		policy.observe("user", "Explain that identity message", true);
		expect(policy.observe("assistant", text, true)).toBeNull();
	}
});

test("post-caller wrong identity remains failed and preserves the offending transcript", async () => {
	const f = await fixture();
	const text = "I cannot inspect that runtime. I’m just ChatGPT here to help.";
	try {
		f.receive({
			type: "turn.done",
			turn: { role: "user", transcript: "Which runtime are you connected to?", id: "caller-identity" },
		});
		f.receive({ type: "turn.done", turn: { role: "assistant", transcript: text, id: "wrong-identity" } });
		await Bun.sleep(30);
		await f.voice.closing;
		expect(f.records.filter(r => r.kind === "startupPolicyViolation")).toHaveLength(1);
		expect(f.records.find(r => r.kind === "startupPolicyViolation")?.reason).toBe("identity-mismatch");
		expect(
			f.records.some(
				r => r.kind === "voiceTimeline" && r.item.type === "realtimeSessionClosed" && r.item.outcome === "failed",
			),
		).toBe(true);
		expect(
			f.records.some(r => r.kind === "voiceTimeline" && r.item.type === "transcriptSegment" && r.item.text === text),
		).toBe(true);
		expect(f.delegated).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});
