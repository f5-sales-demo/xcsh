import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import { voiceDelegation } from "../../src/remote-control/voice-delegation";
import { CheckpointStore, VoiceDiagnosticRuntime } from "../../src/remote-control/voice-diagnostics";
import {
	contextChunks,
	decodeVoiceEvent,
	existingCallConfig,
	inspectVoiceEvent,
} from "../../src/remote-control/voice-protocol";
import phoneDelegation from "./fixtures/codex-0.153.4-phone-delegation.json";
import phoneRecall from "./fixtures/codex-0.153.4-phone-recall.json";
import itemCompletedSchema from "./fixtures/ThreadRealtimeItemCompletedNotification.json";
import itemStartedSchema from "./fixtures/ThreadRealtimeItemStartedNotification.json";
import itemDeltaSchema from "./fixtures/ThreadRealtimeItemTranscriptDeltaNotification.json";

const start = {
	transport: { type: "existingCall", callId: "fixture-call" },
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
};
function fixture(records: Record<string, unknown>[] = [], diagnostics?: VoiceDiagnosticRuntime) {
	const sent: unknown[] = [];
	const policySent: unknown[] = [];
	const events: { method: string; params: Record<string, unknown> }[] = [];
	const delegated: string[] = [];
	const titles: string[] = [];
	let receive: (data: string) => void = () => {};
	let closed = 0;
	let finish: (text: string) => void = () => {};
	const deps: VoiceDependencies = {
		diagnostics,
		authenticate: async () => ({ accessToken: "fixture-secret", accountId: "example-voice-account" }),
		open: async (url, headers, handlers) => {
			expect(url).toBe("wss://api.openai.com/v1/live/fixture-call");
			expect(headers.Authorization).toBe("Bearer fixture-secret");
			expect(headers.originator).toBe("xcsh");
			receive = handlers.message;
			queueMicrotask(() =>
				handlers.message(JSON.stringify({ type: "session.created", session: { id: "fixture" } })),
			);
			return {
				send: data => {
					if (JSON.parse(data).type === "session.close") {
						handlers.message(
							JSON.stringify({ type: "session.closed", usage: { seconds: 1 }, reason: "close_requested" }),
						);
					}
					if (JSON.parse(data).type === "session.instructions.append") {
						const event = {
							type: "session.instructions.appended",
							client_event_id: JSON.parse(data).event_id,
							start_ms: 0,
							end_ms: 1,
						};
						queueMicrotask(() => handlers.message(JSON.stringify(event)));
						return;
					}
					if (
						JSON.parse(data).type === "session.update" &&
						JSON.stringify(JSON.parse(data).session) ===
							JSON.stringify({ delegation: { type: "client", ack_filler: false } })
					) {
						queueMicrotask(() =>
							handlers.message(JSON.stringify({ type: "session.updated", session: { id: "fixture" } })),
						);
						return;
					}
					if (
						JSON.parse(data).type === "session.context.append" &&
						JSON.parse(data).content?.[0]?.text?.startsWith("You are xcsh")
					)
						policySent.push(JSON.parse(data));
					else sent.push(JSON.parse(data));
					if (
						JSON.parse(data).type === "session.context.append" &&
						JSON.parse(data).content?.[0]?.text?.startsWith("You are xcsh")
					)
						queueMicrotask(() =>
							handlers.message(
								JSON.stringify({
									type: "session.context.appended",
									client_event_id: JSON.parse(data).event_id,
									start_ms: 0,
									end_ms: 1,
								}),
							),
						);
					if (JSON.parse(data).type === "session.context.append")
						queueMicrotask(() =>
							handlers.message(
								JSON.stringify({
									type: "session.context.appended",

									start_ms: performance.now(),
									end_ms: performance.now() + 1,
								}),
							),
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
		records: () => records,
		record: async record => {
			records.push(record);
		},
		title: text => {
			titles.push(text);
		},
		delegate: async (_id, text) => {
			delegated.push(text);
			return new Promise<string>(resolve => {
				finish = resolve;
			});
		},
	};
	return {
		voice: new NativeVoice(deps),
		deps,
		sent,
		policySent,
		events,
		delegated,
		titles,
		records,
		receive: (event: unknown) => receive(JSON.stringify(event)),
		closed: () => closed,
		finish: (text: string) => finish(text),
	};
}

test("native voice drives crash-safe lifecycle diagnostics", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-native-voice-diagnostics-"));
	try {
		const file = join(root, "checkpoint.json");
		const diagnostics = new VoiceDiagnosticRuntime({
			checkpointFile: file,
			resources: () => ({ rssBytes: 1, fileDescriptors: 2, sockets: 1, processState: "running" }),
		});
		const f = fixture([], diagnostics);
		await f.voice.start(start);
		f.receive({ type: "session.updated", session: {} });
		f.receive({ type: "session.context.appended", start_ms: 0, end_ms: 1 });
		await Bun.sleep(0);
		await f.voice.stop();
		expect(new CheckpointStore(file).read()).toMatchObject({
			lifecycle: "closed",
			eventCount: expect.any(Number),
			eventDispositions: { handled: 2, observed: expect.any(Number), rejected: 1 },
			inboundQueueHighWaterBytes: expect.any(Number),
			outboundQueueHighWaterBytes: expect.any(Number),
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
const delegation = {
	type: "delegation.created",
	item: { type: "delegation", target: "client", id: "d1", content: [{ type: "input_text", text: "change fixture" }] },
};

test.each([...phoneRecall.scenarios, phoneDelegation.scenario])(
	"native voice reproduces the recorded $name notification sequence",
	async scenario => {
		const f = fixture();
		f.deps.createCall = async () => ({ callId: "fixture-call", sdp: "v=0\r\nfixture-answer" });
		await f.voice.start({
			version: "v3",
			outputModality: "audio",
			includeStartupContext: false,
			realtimeSessionId: "fixture-session",
			transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		});
		const texts = { user: "", assistant: "" };
		for (const row of scenario.events) {
			const event = row.message as { method: string; params: { role?: "user" | "assistant" } };
			if (row.direction !== "out") continue;
			if (event.method === "thread/realtime/itemAdded") {
				f.receive({
					...delegation,
					item: { ...delegation.item, content: [{ type: "input_text", text: texts.user }] },
				});
				await Bun.sleep(0);
				f.finish("Fixture created and read back.");
				continue;
			}
			if (!event.params.role) continue;
			const role = event.params.role;
			if (event.method === "thread/realtime/transcript/delta") {
				// Private speech is deliberately replaced; frame count, roles, and order come from the recording.
				texts[role] += "fixture ";
				f.receive({
					type: role === "user" ? "input_transcript.added" : "output_transcript.added",
					item: { text: "fixture " },
				});
			} else if (event.method === "thread/realtime/transcript/done") {
				f.receive({ type: "turn.done", turn: { id: `fixture-${role}`, role, transcript: texts[role] } });
			}
			await Bun.sleep(0);
		}
		await f.voice.stop();
		const expectedMethods = scenario.events.filter(row => row.direction === "out").map(row => row.message.method);
		const started = expectedMethods.indexOf("thread/realtime/started");
		const sdp = expectedMethods.indexOf("thread/realtime/sdp");
		if (started >= 0 && sdp === started + 1)
			expectedMethods.splice(started, 2, "thread/realtime/sdp", "thread/realtime/started");
		expect(f.events.filter(event => !event.method.startsWith("xcsh/")).map(event => event.method)).toEqual(
			expectedMethods,
		);
		const completed = f.records.filter(record => record.kind === "voiceTimeline");
		expect(completed).toHaveLength(4);
		const handoff = f.events.find(event => event.method === "thread/realtime/itemAdded")?.params.item as
			| { active_transcript: { role: string; text: string }[] }
			| undefined;
		expect(f.delegated).toEqual(
			scenario.name === "beta-delegation"
				? [
						voiceDelegation(
							texts.user,
							handoff!.active_transcript.map(entry => `${entry.role}: ${entry.text}`).join("\n"),
						),
					]
				: [],
		);
		const ajv = new Ajv({ strict: false });
		ajv.addFormat("uint32", {
			type: "number",
			validate: value => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff,
		});
		for (const [method, schema] of [
			["thread/realtime/item/started", itemStartedSchema],
			["thread/realtime/item/completed", itemCompletedSchema],
			["thread/realtime/item/transcript/delta", itemDeltaSchema],
		] as const) {
			const validate = ajv.compile(schema);
			for (const event of f.events.filter(event => event.method === method)) {
				expect(validate({ threadId: "fixture-thread", ...event.params })).toBe(true);
			}
		}
	},
);

test("handoff notification retains active speech once and appends missing request text", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "turn.done", turn: { role: "user", transcript: "Hello", id: "caller-opening" } });
	f.receive({ type: "output_transcript.added", item: { text: "How can I help?" } });
	f.receive(delegation);
	f.receive(delegation);
	await Bun.sleep(0);
	expect(f.events.filter(event => event.method === "thread/realtime/itemAdded")).toEqual([
		{
			method: "thread/realtime/itemAdded",
			params: {
				item: {
					type: "handoff_request",
					handoff_id: "d1",
					item_id: "d1",
					input_transcript: "change fixture",
					active_transcript: [
						{ role: "user", text: "Hello" },
						{ role: "assistant", text: "How can I help?" },
						{ role: "user", text: "change fixture" },
					],
				},
			},
		},
	]);
	expect(f.delegated).toEqual([
		voiceDelegation("change fixture", "user: Hello\nassistant: How can I help?\nuser: change fixture"),
	]);
	f.finish("Done.");
	await f.voice.stop();
});

test("v3 transcript reconciliation follows the latest matching speaker across interleaved deltas", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "input_transcript.added", item: { text: "please " } });
	f.receive({ type: "output_transcript.added", item: { text: "I can " } });
	f.receive({ type: "output_transcript.added", item: { text: "help" } });
	f.receive({ type: "input_transcript.added", item: { text: "check" } });
	f.receive({ type: "turn.done", turn: { id: "assistant-1", role: "assistant", transcript: "I can help." } });
	f.receive({ type: "turn.done", turn: { id: "user-1", role: "user", transcript: "please check" } });
	f.receive({ ...delegation, item: { ...delegation.item, content: [{ type: "input_text", text: "please check" }] } });
	await Bun.sleep(0);
	const handoff = f.events.find(event => event.method === "thread/realtime/itemAdded")?.params.item as any;
	expect(handoff?.active_transcript).toEqual([
		{ role: "user", text: "please check" },
		{ role: "assistant", text: "I can help." },
	]);
	f.finish("Done.");
	await f.voice.stop();
});

test("v3 transcript boundaries preserve delayed finals and repeated or final-only utterances", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "input_transcript.added", item: { text: "first" } });
	f.receive({ type: "input_audio_buffer.speech_started", item_id: "user-2" });
	f.receive({ type: "input_transcript.added", item: { text: "second" } });
	f.receive({ type: "turn.done", turn: { id: "user-1", role: "user", transcript: "first final" } });
	f.receive({ type: "turn.done", turn: { id: "user-3", role: "user", transcript: "yes" } });
	f.receive({ type: "turn.done", turn: { id: "user-4", role: "user", transcript: "yes" } });
	f.receive({ type: "response.created", response: { id: "assistant-1" } });
	f.receive({ type: "output_transcript.added", item: { text: "answer" } });
	f.receive({ type: "response.created", response: { id: "assistant-2" } });
	f.receive({ type: "output_transcript.added", item: { text: "answer" } });
	f.receive({
		...delegation,
		item: { ...delegation.item, content: [{ type: "input_text", text: "delegate" }] },
	});
	await Bun.sleep(0);
	const handoff = f.events.find(event => event.method === "thread/realtime/itemAdded")?.params.item as any;
	expect(handoff?.active_transcript).toEqual([
		{ role: "user", text: "first" },
		{ role: "user", text: "second" },
		{ role: "user", text: "yes" },
		{ role: "user", text: "yes" },
		{ role: "assistant", text: "answer" },
		{ role: "assistant", text: "answer" },
		{ role: "user", text: "delegate" },
	]);
	f.finish("Done.");
	await f.voice.stop();
});

test("misalignment retires later handoffs while unrelated provider failures remain admissible", async () => {
	for (const providerFailure of ["misalignmentPolicyViolation", "otherProviderFailure"] as const) {
		const f = fixture();
		const delegated: string[] = [];
		f.deps.delegate = async id => {
			delegated.push(id);
			if (delegated.length === 1) {
				const error = new Error("sanitized backing failure") as Error & { codexErrorInfo?: string };
				error.codexErrorInfo = providerFailure;
				throw error;
			}
			return "Recovered.";
		};
		await f.voice.start(start);
		f.receive(delegation);
		f.receive({ ...delegation, item: { ...delegation.item, id: "d2" } });
		await Bun.sleep(0);
		expect(delegated).toEqual(
			providerFailure === "misalignmentPolicyViolation"
				? [expect.any(String)]
				: [expect.any(String), expect.any(String)],
		);
		expect(f.voice.active).toBe(true);
		expect(f.events.filter(event => event.method === "thread/realtime/error")).toEqual([]);
		expect(f.records).toContainEqual(
			expect.objectContaining({ kind: "delegationFailure", failureClass: "execution" }),
		);
		await f.voice.stop();
	}
});

test("pinned existing-call URL encodes one path segment and retains client-owned configuration", () => {
	expect(existingCallConfig(start)).toMatchObject({ url: "wss://api.openai.com/v1/live/fixture-call" });
	expect(existingCallConfig({ ...start, includeStartupContext: undefined })).toMatchObject({
		url: "wss://api.openai.com/v1/live/fixture-call",
	});
	expect(existingCallConfig({ ...start, transport: { type: "existingCall", callId: "../../admin" } }).url).toContain(
		"..%2F..%2Fadmin",
	);
	for (const callId of ["", ".", ".."])
		expect(() => existingCallConfig({ ...start, transport: { type: "existingCall", callId } })).toThrow();
	for (const override of [
		{ includeStartupContext: true },
		{ model: "different" },
		{ prompt: null },
		{ version: "v2" },
		{ outputModality: "text" },
		{ initialItems: [{ role: "user", text: "override" }] },
	])
		expect(() => existingCallConfig({ ...start, ...override })).toThrow();
});
test("context chunks preserve Unicode within the pinned 500 UTF-8 byte bound", () => {
	const text = `${"a".repeat(499)}🌳${"é".repeat(600)}`;
	const chunks = contextChunks(text);
	expect(chunks.join("")).toBe(text);
	expect(chunks.every(chunk => Buffer.byteLength(chunk) <= 500)).toBe(true);
});
test("Live events distinguish transcripts from delegated work and ignore malformed data", () => {
	expect(decodeVoiceEvent({ type: "session.created", session: { id: "s0" } })).toEqual({
		kind: "sessionUpdated",
		id: "s0",
	});
	expect(decodeVoiceEvent({ type: "session.started", session: { id: "s1" } })).toEqual({
		kind: "sessionUpdated",
		id: "s1",
	});
	expect(decodeVoiceEvent({ type: "turn.done", turn: { id: "t1", role: "user", transcript: "hello" } })).toEqual({
		kind: "transcript",
		done: true,
		id: "t1",
		role: "user",
		text: "hello",
	});
	expect(decodeVoiceEvent(delegation)).toMatchObject({ kind: "delegation", id: "d1", text: "change fixture" });
	expect(
		decodeVoiceEvent({
			...delegation,
			item: { ...delegation.item, id: "empty", content: [{ type: "input_text", text: "" }] },
		}),
	).toEqual({ kind: "delegation", id: "empty", text: "" });
	for (const event of [
		null,
		[],
		{ type: "turn.done" },
		{ ...delegation, item: { ...delegation.item, target: "server" } },
	])
		expect(decodeVoiceEvent(event)).toBeNull();
});
test("Live event inspection distinguishes handled, observed, and rejected traffic", () => {
	for (const event of [
		{ type: "session.input_audio.append", audio: "AQID" },
		{ type: "session.usage.updated", usage: { audio_duration_ms: 12 }, usage_limit: null },
		{ type: "turn.created", turn: { id: "t1", role: "user", start_ms: 1, end_ms: 2, transcript: "" } },
		{ type: "turn.delta", turn_id: "t1", start_ms: 1, end_ms: 2, delta: "hello" },
		{ type: "delegation.context.appended", delegation_item_id: "d1", start_ms: 1, end_ms: 2 },
	])
		expect(inspectVoiceEvent(event)).toMatchObject({ disposition: "observed", rejection: undefined });
	expect(inspectVoiceEvent({ type: "session.output_audio.delta", delta: "AQID" }, { sideband: true })).toMatchObject({
		disposition: "observed",
	});
	expect(inspectVoiceEvent({ type: "session.output_audio.delta", delta: "AQID" })).toMatchObject({
		disposition: "handled",
		event: { kind: "audio", data: "AQID" },
	});
	for (const event of [
		{ type: "session.input_audio.append", audio: 1 },
		{ type: "turn.delta", turn_id: "", delta: "hello" },
		{ type: "future.private_event" },
	])
		expect(inspectVoiceEvent(event).disposition).toBe("rejected");
});
test("empty Live delegations with caller text preserve identity for the backing workflow", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "input_transcript.added", item: { text: "Read the project" } });
	f.receive({
		...delegation,
		item: { ...delegation.item, id: "empty", content: [{ type: "input_text", text: "" }] },
	});
	await Bun.sleep(0);
	expect(f.events).toContainEqual({
		method: "thread/realtime/itemAdded",
		params: {
			item: {
				type: "handoff_request",
				handoff_id: "empty",
				item_id: "empty",
				input_transcript: "",
				active_transcript: [{ role: "user", text: "Read the project" }],
			},
		},
	});
	expect(f.delegated).toEqual([voiceDelegation("", "user: Read the project")]);
	f.finish("Done.");
	await f.voice.stop();
});

test("content-free diagnostics count unknown and invalid Live events", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "future.private_event", secret: "must-not-survive" });
	f.receive({ type: "turn.done", turn: { role: "user", transcript: 42, secret: "must-not-survive" } });
	await Bun.sleep(0);
	await f.voice.stop();
	const diagnostic = f.records.find(record => record.kind === "voiceEventDiagnostic");
	expect(diagnostic).toMatchObject({
		eventTypes: { "future.private_event": 1, "turn.done": 1 },
		dispositions: { rejected: 2 },
		rejections: { invalidPayload: 1, unknownType: 1 },
	});
	expect(JSON.stringify(diagnostic)).not.toContain("must-not-survive");
});
test("existing-call preserves creation policy and the work model", async () => {
	const f = fixture();
	await f.voice.start(start);
	expect(f.policySent).toEqual([]);
	f.receive({ type: "input_transcript.added", item: { text: "Who are you?" } });
	await Bun.sleep(0);
	expect(f.policySent).toEqual([]);
	expect(f.sent.some((event: any) => event.type === "session.update")).toBe(false);
	expect(f.events[2]).toMatchObject({ method: "thread/realtime/started", params: { version: "v3" } });
	f.voice.stop();
	expect(f.closed()).toBe(1);
});
test("transcripts persist with provenance but never execute; delegation executes once", async () => {
	const f = fixture();
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	f.receive({ type: "input_transcript.added", item: { text: "change fixture" } });
	f.receive({ type: "turn.done", turn: { id: "t1", role: "user", transcript: "change fixture" } });
	await Bun.sleep(0);
	expect(f.delegated).toEqual([]);
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "transcript", role: "user", text: "change fixture" }),
	);
	f.receive(delegation);
	f.receive(delegation);
	await Bun.sleep(0);
	expect(f.delegated).toEqual([voiceDelegation("change fixture", "user: change fixture")]);
	f.finish("Updated the fixture.");
	await Bun.sleep(0);
	expect(f.sent).toContainEqual({
		type: "delegation.context.append",
		delegation_item_id: "d1",
		channel: "speakable",
		content: [{ type: "input_text", text: "Updated the fixture." }],
	});
	f.voice.stop();
});
test("completed voice exchange requests one title after both sides without requiring delegation", async () => {
	const f = fixture();
	await f.voice.start(start);
	const userDone = { type: "turn.done", turn: { id: "quick-user", role: "user", transcript: "quick answer" } };
	f.receive(userDone);
	f.receive(userDone);
	await Bun.sleep(0);
	expect(f.titles).toEqual([]);
	const assistantDone = {
		type: "turn.done",
		turn: { id: "quick-assistant", role: "assistant", transcript: "response" },
	};
	f.receive(assistantDone);
	f.receive(assistantDone);
	await Bun.sleep(0);
	expect(f.titles).toEqual(["response"]);
	expect(f.delegated).toEqual([]);
	await f.voice.stop();
});
test("persisted delegation identities suppress replay after attachment recreation", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(0);
	f.voice.stop();
	const resumed = fixture(f.records);
	await resumed.voice.start(start);
	resumed.receive(delegation);
	await Bun.sleep(0);
	expect(resumed.delegated).toEqual([]);
	f.finish("late result");
	resumed.voice.stop();
});
test("prepared delegation outcome is uncertain and is never automatically replayed", async () => {
	const key = createHash("sha256")
		.update(JSON.stringify(["fixture-call", "delegation", "d1"]))
		.digest("hex");
	const f = fixture([{ key, kind: "delegation", state: "prepared", realtimeSessionId: null, text: "change fixture" }]);
	await f.voice.start(start);
	f.receive(delegation);
	f.receive(delegation);
	await Bun.sleep(0);
	expect(f.delegated).toEqual([]);
	expect(f.records).toContainEqual(
		expect.objectContaining({ key, kind: "delegationRecovery", state: "reconciliationRequired" }),
	);
	f.finish("Done.");
	await f.voice.stop();
});
test("ending voice leaves agent work running and ignores late events and output", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(0);
	await f.voice.stop();
	const count = f.events.length;
	f.finish("late answer");
	f.receive({ type: "output_transcript.added", item: { text: "late speech" } });
	await Bun.sleep(0);
	expect(f.events.length).toBe(count);
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toEqual([{ type: "session.close" }]);
});
test("voice startup failures and backend errors never disclose raw credential or payload", async () => {
	const f = fixture();
	f.deps.open = async () => {
		throw new Error("HTTP 401 fixture-secret private body");
	};
	await expect(f.voice.start(start)).rejects.toThrow("401");
	expect(JSON.stringify(f.events)).not.toContain("fixture-secret");
	const g = fixture();
	await g.voice.start(start);
	g.receive({ type: "error", error: { message: "fixture-secret private body" } });
	await Bun.sleep(0);
	expect(JSON.stringify(g.events)).not.toContain("fixture-secret");
	expect(g.closed()).toBe(1);
});

test("stopping while startup history is flushing cannot reopen or announce a late voice session", async () => {
	const f = fixture();
	let release: () => void = () => {};
	const original = f.deps.record;
	f.deps.record = async record => {
		await original(record);
		if (record.kind === "voiceTimeline" && (record.item as any)?.type === "realtimeSessionStarted")
			await new Promise<void>(resolve => {
				release = resolve;
			});
	};
	const starting = f.voice.start(start).catch(error => error);
	await Bun.sleep(0);
	const stopping = f.voice.stop();
	release();
	expect(await starting).toBeInstanceOf(Error);
	await stopping;
	expect(f.voice.active).toBe(false);
	expect(f.events.some(event => event.method === "thread/realtime/started")).toBe(false);
	expect(f.events.at(-1)?.method).toBe("thread/realtime/closed");
});

test("voice closure persists interleaved partial speech once before the final closure notification", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "turn.done", turn: { role: "user", transcript: "initial", id: "initial" } });
	f.receive({ type: "output_transcript.added", item: { text: "first" } });
	f.receive({ type: "input_transcript.added", item: { text: "second" } });
	await f.voice.stop();
	const speech = f.records.filter(
		record => record.kind === "voiceTimeline" && (record.item as any).type === "transcriptSegment",
	);
	expect(speech.map(record => [(record.item as any).role, (record.item as any).text])).toEqual([
		["user", "initial"],
		["assistant", "first"],
		["user", "second"],
	]);
	const count = f.events.length;
	await f.voice.stop();
	f.receive({ type: "turn.done", turn: { id: "late", role: "user", transcript: "second" } });
	await Bun.sleep(0);
	expect(f.events).toHaveLength(count);
	expect(f.events.at(-1)?.method).toBe("thread/realtime/closed");
});

test("speech received during attachment waits for the canonical session start", async () => {
	const f = fixture();
	const open = f.deps.open!;
	f.deps.open = async (url, headers, handlers) => {
		const socket = await open(url, headers, handlers);
		handlers.message(JSON.stringify({ type: "input_transcript.added", item: { text: "early speech" } }));
		await Bun.sleep(0);
		return socket;
	};
	await f.voice.start(start);
	await f.voice.stop();
	expect(f.events.slice(0, 3).map(event => event.method)).toEqual([
		"thread/realtime/item/started",
		"thread/realtime/item/completed",
		"thread/realtime/started",
	]);
	expect(f.records).toContainEqual(
		expect.objectContaining({
			kind: "voiceTimeline",
			item: expect.objectContaining({ type: "transcriptSegment", text: "early speech" }),
		}),
	);
});
test("malformed and oversized incoming frames close voice without executing work", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive({ type: "input_transcript.added", item: { text: "x".repeat(1_100_000) } });
	await Bun.sleep(0);
	expect(f.closed()).toBe(1);
	expect(f.delegated).toEqual([]);
});

test("router advertises pinned voices and routes start/stop to the existing terminal", async () => {
	const { RemoteRouter } = await import("../../src/remote-control/router");
	const router = new RemoteRouter("/tmp/fixture", "fixture");
	const methods: string[] = [];
	router.sessions.set("fixture", {
		thread: { id: "fixture" },
		call: async (_id, method) => {
			methods.push(method);
			return {};
		},
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "thread/realtime/listVoices" })).toMatchObject({
		result: {
			voices: {
				v1: ["juniper", "maple", "spruce", "ember", "vale", "breeze", "arbor", "sol", "cove"],
				v2: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"],
				defaultV1: "cove",
				defaultV2: "marin",
			},
		},
	});
	for (const method of ["thread/realtime/start", "thread/realtime/stop"])
		expect(await router.handle("phone", { id: method, method, params: { ...start, threadId: "fixture" } })).toEqual({
			id: method,
			result: {},
		});
	expect(methods).toEqual(["thread/realtime/start", "thread/realtime/stop"]);
	router.dispose();
});

test("session voice stop is idempotent and malformed startup is rejected explicitly", async () => {
	const { RemoteSession } = await import("../../src/remote-control/session");
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionManager: { getCwd: () => "/tmp", getBranch: () => [] },
		subscribe: () => () => {},
	} as any);
	expect(await remote.call("stop", "thread/realtime/stop", { threadId: "fixture" })).toEqual({});
	await expect(
		remote.call("start", "thread/realtime/start", {
			threadId: "fixture",
			outputModality: "audio",
			transport: { type: "unsupported" },
		}),
	).rejects.toMatchObject({ code: -32602 });
	remote.dispose();
});

test("repeated spoken words remain separate transcript segments", async () => {
	const f = fixture();
	await f.voice.start(start);
	for (let i = 0; i < 2; i++) {
		f.receive({ type: "input_transcript.added", item: { text: "yes" } });
		f.receive({ type: "turn.done", turn: { role: "user", transcript: "yes" } });
	}
	await Bun.sleep(0);
	expect(f.records.filter(r => r.kind === "transcript")).toHaveLength(2);
	f.voice.stop();
});
test("a closed attachment cannot be reused while previous delegation results are pending", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(0);
	f.voice.stop();
	await expect(f.voice.start(start)).rejects.toThrow("new attachment");
	f.finish("old answer");
});

test.each(
	["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-6-astra"].flatMap(model =>
		[false, true].flatMap(streamed => [false, true].map(asItems => ({ model, streamed, asItems }))),
	),
)(
	"owning $model adapter forwards Live streamed=$streamed items=$asItems output through its sole owner",
	async ({ model, streamed, asItems }) => {
		const { spyOn } = await import("bun:test");
		const { RemoteSession } = await import("../../src/remote-control/session");
		const { SessionManager } = await import("../../src/session/session-manager");
		const manager = SessionManager.inMemory("/tmp");
		const messages: any[] = [],
			outputs: any[] = [],
			prompts: string[] = [];
		const modes: boolean[] = [];
		const runtimeUpdates: any[] = [];
		let terminalInitiated = false;
		let sessionListener = (_event: any) => {};
		const endMessage = (message: any) => {
			message.timestamp ??= Date.now();
			if (message.role === "assistant")
				message.usage ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } };
			messages.push(message);
			sessionListener({ type: "message_end", message });
			manager.appendMessage(message);
		};
		let socket: any;
		let selectedSession = "";
		const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "example-selected-account" } })).toString("base64url")}.fixture`;
		class MockSocket {
			bufferedAmount = 0;
			onopen?: () => void;
			onmessage?: (event: { data: string }) => void;
			constructor(_url: string, options: any) {
				expect(options.headers.Authorization).toBe(`Bearer ${token}`);
				expect(options.headers["ChatGPT-Account-Id"]).toBe("example-selected-account");
				socket = this;
				queueMicrotask(() => {
					this.onopen?.();
					queueMicrotask(() =>
						this.onmessage?.({
							data: JSON.stringify({ type: "session.created", session: { id: "fixture-owner" } }),
						}),
					);
				});
			}
			send(data: string) {
				const frame = JSON.parse(data);
				if (frame.type === "session.instructions.append") {
					const event = {
						type: "session.instructions.appended",
						client_event_id: frame.event_id,
						start_ms: 0,
						end_ms: 1,
					};
					queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(event) }));
					return;
				}
				if (
					frame.type === "session.update" &&
					JSON.stringify(frame.session) === JSON.stringify({ delegation: { type: "client", ack_filler: false } })
				) {
					queueMicrotask(() =>
						this.onmessage?.({
							data: JSON.stringify({ type: "session.updated", session: { id: "fixture-owner" } }),
						}),
					);
					return;
				}
				if (frame.type === "session.context.append" && frame.content?.[0]?.text?.startsWith("You are xcsh"))
					queueMicrotask(() =>
						this.onmessage?.({
							data: JSON.stringify({
								type: "session.context.appended",
								client_event_id: frame.event_id,
								start_ms: 0,
								end_ms: 1,
							}),
						}),
					);

				const content = frame.content?.[0]?.text;
				if (
					frame.type === "session.context.append" &&
					typeof content === "string" &&
					content.startsWith('{"model":')
				) {
					expect(frame.channel).toBeUndefined();
					expect(Buffer.byteLength(content)).toBeLessThanOrEqual(1900);
					runtimeUpdates.push(JSON.parse(content));
				} else if (
					!(frame.type === "session.context.append" && frame.content?.[0]?.text?.startsWith("You are xcsh"))
				)
					outputs.push(frame);
				if (JSON.parse(data).type === "session.context.append")
					queueMicrotask(() =>
						this.onmessage?.({
							data: JSON.stringify({
								type: "session.context.appended",

								start_ms: performance.now(),
								end_ms: performance.now() + 1,
							}),
						}),
					);
			}
			close() {}
		}
		const mock = spyOn(
			globalThis as unknown as { WebSocket: (...args: any[]) => any },
			"WebSocket",
		).mockImplementation(((url: string, options: any) => new MockSocket(url, options)) as any);
		const target: any = {
			setRealtimeMode: (active: boolean) => {
				modes.push(active);
			},
			sessionId: "fixture-owner",
			model: { id: model, provider: "openai-codex" },
			messages,
			sessionManager: manager,
			modelRegistry: {
				authStorage: {
					getCredentialSource: () => "stored-oauth",
					getApiKey: async (_provider: string, session: string) => {
						selectedSession = session;
						return token;
					},
				},
			},
			subscribe: (listener: any) => {
				sessionListener = listener;
				return () => {};
			},
			prompt: async (text: string) => {
				prompts.push(text);
				endMessage({ role: "user", content: text });
				if (streamed) {
					const partial: any = { role: "assistant", content: [], stopReason: "stop" };
					sessionListener({ type: "message_start", message: partial });
					partial.content.push({ type: "thinking", thinking: "private reasoning" });
					sessionListener({
						type: "message_update",
						assistantMessageEvent: {
							type: "thinking_delta",
							contentIndex: 0,
							delta: "private reasoning",
							partial,
						},
					});
					for (const [phase, value] of [
						["commentary", "[COMMENTARY]Updating the fixture."],
						["final_answer", "[FINAL]The fixture is updated."],
					]) {
						partial.content.push({ type: "text", phase, text: value });
						sessionListener({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								contentIndex: partial.content.length - 1,
								delta: value,
								partial,
							},
						});
					}
					await Bun.sleep(250);
					expect(outputs.map(output => output.channel)).toEqual(
						terminalInitiated || asItems ? [] : ["commentary", "speakable"],
					);
					expect(JSON.stringify(outputs)).not.toContain("private reasoning");
					endMessage(partial);
					sessionListener({ type: "agent_end" });
					return;
				}
				endMessage({
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "private reasoning" },
						{ type: "text", text: "The fixture is updated." },
					],
					stopReason: "stop",
				});
				sessionListener({ type: "agent_end" });
			},
		};
		const remote = new RemoteSession(target);
		const ready = new Promise<void>(resolve =>
			remote.subscribe(event => {
				if (event.method === "thread/realtime/started") resolve();
			}),
		);
		try {
			await remote.call("voice-start", "thread/realtime/start", {
				...start,
				version: "v3",
				codexResponseHandoffMode: "bemTags",
				codexResponsesAsItems: asItems,
				threadId: target.sessionId,
			});
			await ready;
			expect(outputs).toEqual([]);
			socket.onmessage({
				data: JSON.stringify({ type: "input_transcript.added", item: { text: "change fixture" } }),
			});
			await Bun.sleep(0);
			expect(outputs).toEqual([]);
			outputs.length = 0;
			const request = delegation;
			socket.onmessage({ data: JSON.stringify(request) });
			socket.onmessage({ data: JSON.stringify(request) });
			await Bun.sleep(streamed ? 300 : 0);
			expect(selectedSession).toBe("fixture-owner");
			expect(prompts).toEqual([voiceDelegation("change fixture", "user: change fixture")]);
			expect(target.model.id).toBe(model);
			expect(modes).toEqual([true]);
			if (asItems) {
				const expected = [
					...(streamed ? [{ text: "[COMMENTARY]Updating the fixture.", channel: "commentary" }] : []),
					{ text: `${streamed ? "[FINAL]" : ""}The fixture is updated.`, channel: "speakable" },
				];
				expect(outputs).toEqual(
					expected.map(({ text, channel }) => ({
						type: "session.context.append",
						channel,
						content: [{ type: "input_text", text }],
					})),
				);
			} else
				expect(outputs).toContainEqual(
					expect.objectContaining({
						type: "delegation.context.append",
						content: [
							{
								type: "input_text",
								text: streamed ? "[FINAL]The fixture is updated." : "The fixture is updated.",
							},
						],
					}),
				);
			expect(JSON.stringify(outputs)).not.toContain("private reasoning");
			expect(
				manager
					.getEntries()
					.some(
						r =>
							r.type === "custom" && r.customType === "remote-realtime" && (r.data as any).kind === "delegation",
					),
			).toBe(true);
			if (streamed) expect(outputs).toHaveLength(2);
			await Bun.sleep(0);
			const standalone = outputs.map(output => {
				if (output.type === "delegation.context.append") {
					const { delegation_item_id: _id, ...rest } = output;
					return { ...rest, type: "session.context.append" };
				}
				return output;
			});
			outputs.length = 0;
			terminalInitiated = true;
			await target.prompt("Terminal follow-up");
			expect(outputs).toEqual(standalone);
			await Bun.sleep(0);
			const runtime = runtimeUpdates.at(-1);
			expect(runtime).toMatchObject({ model, provider: "openai-codex", workspace: "/tmp", taskStatus: "idle" });
			expect(prompts.at(-1)).toBe("Terminal follow-up");
			expect(JSON.stringify(outputs)).not.toContain("private reasoning");
		} finally {
			await remote.close();
			expect(modes).toEqual([true, false]);
			mock.mockRestore();
		}
	},
);

test("WebRTC creates the native call, forwards answer SDP and attaches without overwriting its session", async () => {
	const f = fixture();
	let created = false;
	f.deps.createCall = async (_config, auth) => {
		created = true;
		expect(auth.accountId).toBe("example-voice-account");
		return { callId: "fixture-call", sdp: "v=0\r\nfixture-answer" };
	};
	await f.voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	});
	expect(created).toBe(true);
	expect(f.events.filter(event => !event.method.startsWith("xcsh/")).map(event => event.method)).toEqual([
		"thread/realtime/item/started",
		"thread/realtime/item/completed",
		"thread/realtime/sdp",
		"thread/realtime/started",
	]);
	expect(f.events.find(event => event.method === "thread/realtime/sdp")!.params.sdp).toBe("v=0\r\nfixture-answer");
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toEqual([]);
	await f.voice.stop();
	for (const stage of ["call-create", "sdp-delivery", "sideband-attach"])
		expect(f.records).toContainEqual(
			expect.objectContaining({
				kind: "voiceDiagnostic",
				stage,
				outcome: "succeeded",
				elapsedMs: expect.any(Number),
			}),
		);
});
test("WebRTC uses on-demand person routing without startup person values", async () => {
	const f = fixture();
	let instructions = "";
	f.deps.persona = async () => ({
		systemPrompt: "You are xcsh.",
		userKnowledge: "The user validates F5 sales-engineering workflows.",
		tools: [],
		history: "",
	});
	f.deps.createCall = async config => {
		instructions = String((config.session as { instructions?: unknown }).instructions ?? "");
		return { callId: "fixture-call", sdp: "v=0\r\nfixture-answer" };
	};
	await f.voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	});
	expect(instructions).not.toContain("The user validates F5 sales-engineering workflows.");
	expect(instructions).toContain("Retrieve person and machine data through canonical tools");
	expect(instructions).toContain("never infer person data from project history");
	expect(instructions).toContain("Wait for verified results before reporting facts or completion");
	expect(instructions).toContain("Do not speak private reasoning");
	await f.voice.stop();
});
test("a pending persona snapshot fences concurrent starts and respects stop", async () => {
	const f = fixture();
	const snapshot = Promise.withResolvers<{ tools: []; history: string }>();
	f.deps.persona = () => snapshot.promise;
	const opening = f.voice.start(start);
	await Bun.sleep(0);
	await expect(f.voice.start(start)).rejects.toThrow("new attachment");
	await f.voice.stop();
	snapshot.resolve({ tools: [], history: "" });
	await expect(opening).rejects.toThrow("Voice stopped during persona snapshot");
});
test("WebRTC service rejection persists sanitized gate evidence and never opens a sideband", async () => {
	const f = fixture();
	f.deps.createCall = async () => {
		throw new Error("HTTP 403 fixture-secret private body");
	};
	await expect(
		f.voice.start({
			version: "v3",
			outputModality: "audio",
			includeStartupContext: false,
			transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		}),
	).rejects.toThrow("HTTP 403");
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "voiceDiagnostic", stage: "call-create", httpStatus: 403 }),
	);
	expect(JSON.stringify(f.records)).not.toContain("fixture-secret");
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toEqual([]);
});

test("requested transcript-tail flushing submits unpromoted speech once after voice ends", async () => {
	const f = fixture();
	f.deps.createCall = async () => ({ callId: "fixture-call", sdp: "v=0\r\nfixture-answer" });
	await f.voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		flushTranscriptTailOnSessionEnd: true,
		transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	});
	f.receive({ type: "input_transcript.added", item: { text: "Please update the fixture." } });
	f.receive({ type: "turn.done", turn: { role: "user", transcript: "Please update the fixture." } });
	f.voice.stop();
	f.voice.stop();
	await f.voice.closing;
	await Bun.sleep(0);
	expect(f.delegated).toHaveLength(1);
	expect(f.delegated[0]).toContain("Please update the fixture.");
	expect(f.delegated[0]).toContain("<source>transcript_tail_flush</source>");
	expect(f.records.some(r => r.kind === "transcriptTail")).toBe(true);
	f.finish("Updated.");
});

test("transcript-tail flushing does not reopen work after realtime already answered", async () => {
	const f = fixture();
	f.deps.createCall = async () => ({ callId: "fixture-call", sdp: "v=0\r\nfixture-answer" });
	await f.voice.start({
		version: "v3",
		outputModality: "audio",
		includeStartupContext: false,
		flushTranscriptTailOnSessionEnd: true,
		transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	});
	f.receive({ type: "turn.done", turn: { role: "user", transcript: "Can you make tool calls?" } });
	f.receive({ type: "turn.done", turn: { role: "assistant", transcript: "Yes, when helpful." } });
	f.voice.stop();
	await Bun.sleep(0);
	expect(f.delegated).toEqual([]);
});
test.each([true, false])(
	"delegated input with preceding transcript %s is not resubmitted by a late final",
	async hasTranscript => {
		const f = fixture();
		f.deps.createCall = async () => ({ callId: "fixture-call", sdp: "v=0\r\nfixture-answer" });
		await f.voice.start({
			version: "v3",
			outputModality: "audio",
			includeStartupContext: false,
			flushTranscriptTailOnSessionEnd: true,
			transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		});
		if (hasTranscript) f.receive({ type: "input_transcript.added", item: { text: "change fixture" } });
		f.receive(delegation);
		await Bun.sleep(0); // Establish admission before exercising late-final deduplication.
		f.receive({ type: "turn.done", turn: { role: "user", transcript: "change fixture" } });
		f.voice.stop();
		await Bun.sleep(0);
		expect(f.delegated).toEqual([voiceDelegation("change fixture", "user: change fixture")]);
		f.finish("Updated.");
	},
);

test("a newer handoff cancels queued speech from the older handoff without cancelling work", async () => {
	const f = fixture();
	const updates: ((update: import("../../src/remote-control/voice-handoff").VoiceOutputUpdate) => void)[] = [];
	const finishes: ((text: string) => void)[] = [];
	f.deps.delegate = async (_id, _text, output) => {
		updates.push(output!);
		return new Promise(resolve => finishes.push(resolve));
	};
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	f.receive(delegation);
	await Bun.sleep(0);
	updates[0]({ id: "old-item", text: "[FINAL]Old work", done: false });
	f.receive({ ...delegation, item: { ...delegation.item, id: "d2" } });
	await Bun.sleep(0);
	updates[1]({ id: "new-item", text: "[FINAL]New work", done: false });
	await Bun.sleep(250);
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toEqual([
		{
			type: "delegation.context.append",
			delegation_item_id: "d2",
			channel: "speakable",
			content: [{ type: "input_text", text: "[FINAL]New work" }],
		},
	]);
	finishes[0]("Old work");
	finishes[1]("New work");
	await Bun.sleep(0);
	expect(f.records.filter(record => record.kind === "delegationResult")).toHaveLength(2);
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toHaveLength(1);
	await f.voice.stop();
});

test("client-managed handoffs execute delegated work but suppress automatic streaming and final context", async () => {
	const f = fixture();
	f.deps.delegate = async (_id, _text, output) => {
		output!({ id: "i", text: "[FINAL]Client controls speech", done: true });
		return "Client controls speech";
	};
	await f.voice.start({ ...start, clientManagedHandoffs: true, codexResponseHandoffMode: "bemTags" });
	f.receive(delegation);
	await Bun.sleep(0);
	expect(f.records.filter(record => record.kind === "delegationResult")).toHaveLength(1);
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toEqual([]);
	await f.voice.stop();
});

test("omitted routing mode uses the pinned thinking context channel without disclosing reasoning", async () => {
	const f = fixture();
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(0);
	f.finish("Completed result");
	await Bun.sleep(0);
	expect(
		f.sent.filter(
			(event: any) =>
				!(event.type === "session.context.append" && event.content?.[0]?.text?.startsWith("You are xcsh")),
		),
	).toEqual([
		{
			type: "delegation.context.append",
			delegation_item_id: "d1",
			content: [{ type: "input_text", text: "Completed result" }],
		},
	]);
	await f.voice.stop();
});

test("existing-call RPC acknowledges admission before sideband readiness", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const { SessionManager } = await import("../../src/session/session-manager");
	let release!: () => void;
	const connecting = new Promise<void>(resolve => {
		release = resolve;
	});
	const mock = spyOn(NativeVoice.prototype, "start").mockImplementation(() => connecting);
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionManager: SessionManager.inMemory("/tmp"),
		subscribe: () => () => {},
	} as any);
	try {
		const outcome = await Promise.race([
			remote.call("start", "thread/realtime/start", { ...start, threadId: "fixture" }).then(() => "acknowledged"),
			Bun.sleep(100).then(() => "blocked-on-sideband"),
		]);
		expect(outcome).toBe("acknowledged");
		expect(mock).toHaveBeenCalledTimes(1);
	} finally {
		release();
		await remote.close();
		mock.mockRestore();
	}
});

test("admitted existing-call startup failure emits a terminal outcome without a second RPC result", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const { SessionManager } = await import("../../src/session/session-manager");
	let fail!: (error: Error) => void;
	const connecting = new Promise<void>((_resolve, reject) => {
		fail = reject;
	});
	const mock = spyOn(NativeVoice.prototype, "start").mockImplementation(() => connecting);
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionManager: SessionManager.inMemory("/tmp"),
		subscribe: () => () => {},
	} as any);
	const events: string[] = [];
	remote.subscribe(event => events.push(event.method));
	try {
		expect(await remote.call("start", "thread/realtime/start", { ...start, threadId: "fixture" })).toEqual({});
		fail(new Error("private connection detail"));
		await Bun.sleep(0);
		expect(events.filter(method => method === "thread/realtime/error")).toHaveLength(1);
		expect(events.filter(method => method === "thread/realtime/closed")).toHaveLength(1);
	} finally {
		await remote.close();
		mock.mockRestore();
	}
});

test("duplicate phone stops during admitted existing-call startup close once without late readiness", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const { SessionManager } = await import("../../src/session/session-manager");
	// Hold persona resolution to exercise the actual opening state and stop fence.
	const manager = SessionManager.inMemory("/tmp");
	const gate = Promise.withResolvers<void>();
	const flush = spyOn(manager, "flush").mockImplementation(() => gate.promise);
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionManager: manager,
		modelRegistry: { authStorage: {} },
		subscribe: () => () => {},
	} as any);
	const events: string[] = [];
	remote.subscribe(event => events.push(event.method));
	try {
		expect(await remote.call("start", "thread/realtime/start", { ...start, threadId: "fixture" })).toEqual({});
		expect(remote.voiceActive).toBe(true);
		await remote.call("stop1", "thread/realtime/stop", { threadId: "fixture" });
		await remote.call("stop2", "thread/realtime/stop", { threadId: "fixture" });
		await Bun.sleep(0);
		gate.resolve();
		await Bun.sleep(0);
		expect(events.filter(method => method === "thread/realtime/started")).toHaveLength(0);
		expect(events.filter(method => method === "thread/realtime/closed")).toHaveLength(1);
	} finally {
		gate.resolve();
		await remote.close();
		flush.mockRestore();
	}
});

test("voice stop aborts the pending sideband connector before readiness", async () => {
	const f = fixture();
	let observed!: AbortSignal;
	const entered = Promise.withResolvers<void>();
	const open = f.deps.open;
	f.deps.open = async (_url, _headers, _handlers, signal) => {
		observed = signal!;
		entered.resolve();
		return new Promise((_resolve, reject) =>
			signal!.addEventListener("abort", () => reject(new Error("Realtime connection cancelled")), { once: true }),
		);
	};
	const starting = f.voice.start(start);
	await entered.promise;
	await f.voice.stop();
	expect(observed.aborted).toBe(true);
	await expect(starting).rejects.toMatchObject({ code: -32000 });
	expect(f.events.filter(e => e.method === "thread/realtime/started")).toHaveLength(0);
	expect(f.events.filter(e => e.method === "thread/realtime/closed")).toHaveLength(1);
	f.deps.open = open;
});

test("stopped admitted startup waits for its one closure instead of reporting a second failure", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const { SessionManager } = await import("../../src/session/session-manager");
	const manager = SessionManager.inMemory("/tmp");
	const entered = Promise.withResolvers<void>();
	const token = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture`;
	class PendingSocket {
		bufferedAmount = 0;
		constructor() {
			entered.resolve();
		}
		close() {}
		send() {}
	}
	const ws = spyOn(globalThis as any, "WebSocket").mockImplementation((() => new PendingSocket()) as any);
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionManager: manager,
		modelRegistry: { authStorage: { getCredentialSource: () => "stored-oauth", getApiKey: async () => token } },
		subscribe: () => () => {},
	} as any);
	const events: string[] = [];
	remote.subscribe(e => events.push(e.method));
	try {
		await remote.call("start", "thread/realtime/start", { ...start, threadId: "fixture" });
		await entered.promise;
		await remote.call("stop1", "thread/realtime/stop", { threadId: "fixture" });
		await remote.call("stop2", "thread/realtime/stop", { threadId: "fixture" });
		await Bun.sleep(20);
		expect(events.filter(m => m === "thread/realtime/error")).toHaveLength(0);
		expect(events.filter(m => m === "thread/realtime/closed")).toHaveLength(1);
	} finally {
		await remote.close();
		ws.mockRestore();
	}
});

test("failed submitted persistence after backend admission cannot replay an uncertain mutation", async () => {
	const original = fixture();
	const record = original.deps.record;
	let mutations = 0;
	original.deps.record = async value => {
		if (value.kind === "delegation" && value.state === "submitted") throw new Error("Synthetic write failure");
		await record(value);
	};
	original.deps.delegate = async () => {
		mutations++;
		return "effect completed";
	};
	await original.voice.start(start);
	original.receive(delegation);
	await Bun.sleep(5);
	await original.voice.stop();
	const resumed = fixture(original.records);
	resumed.deps.delegate = async () => {
		mutations++;
		return "effect completed";
	};
	await resumed.voice.start(start);
	resumed.receive(delegation);
	await Bun.sleep(5);
	await resumed.voice.stop();
	expect(mutations).toBe(1);
	// This fixture completed before recreation; its durable result proves the
	// outcome even though the submitted write failed. It must still not replay.
	expect(resumed.records).toContainEqual(
		expect.objectContaining({ kind: "delegationResult", text: "effect completed" }),
	);
});

test("submitted write failure still observes eventual backend rejection without duplicate work", async () => {
	const f = fixture();
	const record = f.deps.record;
	const rejection = Promise.withResolvers<string>();
	f.deps.record = async value => {
		if (value.kind === "delegation" && value.state === "submitted") throw new Error("Synthetic write failure");
		await record(value);
	};
	f.deps.delegate = async () => rejection.promise;
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(5);
	rejection.reject(new Error("Synthetic execution failure"));
	await Bun.sleep(5);
	await f.voice.stop();
	expect(f.records.some(r => r.kind === "delegationResult")).toBe(false);
	const resumed = fixture(f.records);
	await resumed.voice.start(start);
	resumed.receive(delegation);
	await Bun.sleep(5);
	await resumed.voice.stop();
	expect(resumed.delegated).toEqual([]);
	expect(resumed.records).toContainEqual(
		expect.objectContaining({ kind: "delegationRecovery", state: "reconciliationRequired" }),
	);
});

test("submitted delegation with no durable outcome requests reconciliation after reopen", async () => {
	const key = createHash("sha256")
		.update(JSON.stringify(["fixture-call", "delegation", "d1"]))
		.digest("hex");
	const f = fixture([
		{ key, kind: "delegation", state: "prepared" },
		{ key, kind: "delegation", state: "submitted" },
	]);
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(0);
	expect(f.delegated).toHaveLength(0);
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "delegationRecovery", state: "reconciliationRequired" }),
	);
	await f.voice.stop();
});

test("backend failure retains call and returns a sanitized recovery result", async () => {
	const f = fixture();
	f.deps.delegate = async () => {
		throw new Error("private failure payload");
	};
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	f.receive(delegation);
	await Bun.sleep(0);
	expect(f.voice.active).toBe(true);
	expect(f.sent.some((frame: any) => frame.content?.[0]?.text?.includes("could not complete"))).toBe(true);
	expect(f.records).toContainEqual(expect.objectContaining({ kind: "delegationFailure", failureClass: "execution" }));
	expect(JSON.stringify(f.records)).not.toContain("private failure payload");
	await f.voice.stop();
});
test("result collector failure does not fabricate backend failure or replay completed work", async () => {
	const f = fixture();
	const record = f.deps.record;
	f.deps.record = async row => {
		if (row.kind === "delegationResult") throw new Error("collector lost");
		await record(row);
	};
	let calls = 0;
	f.deps.delegate = async () => {
		calls++;
		return "Verified completed result";
	};
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	f.receive(delegation);
	await Bun.sleep(0);
	expect(calls).toBe(1);
	expect(
		f.events.some(event => event.params.message === "The backing agent could not complete the voice request"),
	).toBe(false);
	expect(f.sent.some((frame: any) => frame.content?.[0]?.text === "Verified completed result")).toBe(true);
	await f.voice.stop();
});

test("phone retains healthy voice after backend failure without fatal realtime error", async () => {
	const f = fixture();
	let calls = 0;
	f.deps.delegate = async () => {
		calls++;
		if (calls === 1) throw new Error("Synthetic server_error after verified read");
		return "Verified second request";
	};
	const emit = f.deps.emit;
	let phoneStops = 0;
	f.deps.emit = (method, params) => {
		emit(method, params);
		if (method === "thread/realtime/error") {
			phoneStops++;
			void f.voice.stop();
		}
	};
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	f.receive(delegation);
	await Bun.sleep(5);
	expect(phoneStops).toBe(0);
	expect(f.voice.active).toBe(true);
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "delegationFailure", failureClass: "execution", outcome: "unresolved" }),
	);
	expect(f.sent.some((frame: any) => frame.content?.[0]?.text?.includes("outcome is unresolved"))).toBe(true);
	expect(
		f.sent.some((frame: any) =>
			frame.content?.[0]?.text?.includes("This is a backend task failure, not a diagnosed infrastructure problem"),
		),
	).toBe(true);
	f.receive({ ...delegation, item: { ...delegation.item, id: "second-after-failure" } });
	await Bun.sleep(5);
	expect(calls).toBe(2);
	expect(f.sent.some((frame: any) => frame.content?.[0]?.text === "Verified second request")).toBe(true);
	await f.voice.stop();
});

test("startup replay of previous typed request cannot admit work without new caller speech", async () => {
	const f = fixture();
	const previous = "Make a concise read-only plan to list the files.";
	(f.deps as any).isStartupHistoryRequest = (text: string) => text.trim() === previous;
	f.deps.delegate = async () => "verified new result";
	let admissions = 0;
	f.deps.delegate = async () => {
		admissions++;
		return "verified new result";
	};
	await f.voice.start({ ...start, codexResponseHandoffMode: "bemTags" });
	const replay = { ...delegation, item: { ...delegation.item, content: [{ type: "input_text", text: previous }] } };
	f.receive(replay);
	f.receive(replay);
	await Bun.sleep(5);
	expect(admissions).toBe(0);
	expect(f.events.filter(x => x.method === "thread/realtime/error")).toEqual([]);
	expect(f.voice.active).toBe(true);
	expect(f.records.some(x => x.kind === "delegation" && x.state === "submitted")).toBe(false);
	expect(f.records).toContainEqual(
		expect.objectContaining({ kind: "delegationSuppressed", reason: "startupHistoryReplay" }),
	);
	// A later spoken request may legitimately repeat the same words. Consume
	// speech deltas as well as final transcripts, since delegation can precede turn.done.
	f.receive({ type: "input_transcript.added", item: { text: previous } });
	f.receive({ ...replay, item: { ...replay.item, id: "fresh-user-request" } });
	await Bun.sleep(5);
	expect(admissions).toBe(1);
	await f.voice.stop();
});
test("new startup delegation text remains admissible when transcript delivery lags", async () => {
	const f = fixture();
	(f.deps as any).isStartupHistoryRequest = (text: string) => text === "old request";
	let admissions = 0;
	f.deps.delegate = async () => {
		admissions++;
		return "verified";
	};
	await f.voice.start(start);
	f.receive(delegation);
	await Bun.sleep(5);
	expect(admissions).toBe(1);
	await f.voice.stop();
});

test("session freezes typed request fingerprints before attaching voice", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const { SessionManager } = await import("../../src/session/session-manager");
	const messages: any[] = [{ role: "user", content: [{ type: "text", text: "Previous  plan\nrequest" }] }];
	let matches: (text: string) => boolean = () => false;
	const mock = spyOn(NativeVoice.prototype, "start").mockImplementation(function (this: any) {
		matches = this.deps.isStartupHistoryRequest;
		return Promise.resolve();
	});
	const remote = new RemoteSession({
		sessionId: "fixture",
		messages,
		sessionManager: SessionManager.inMemory("/tmp"),
		subscribe: () => () => {},
	} as any);
	try {
		await remote.call("start", "thread/realtime/start", { ...start, threadId: "fixture" });
		expect(matches("Previous plan request")).toBe(true);
		expect(matches("previous plan request")).toBe(false);
		messages.push({ role: "user", content: "new request" });
		expect(matches("new request")).toBe(false);
	} finally {
		await remote.close();
		mock.mockRestore();
	}
});
