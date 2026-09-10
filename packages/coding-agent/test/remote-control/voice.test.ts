import { expect, test } from "bun:test";
import Ajv from "ajv";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import { contextChunks, decodeVoiceEvent, existingCallConfig } from "../../src/remote-control/voice-protocol";
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
function fixture(records: Record<string, unknown>[] = []) {
	const sent: unknown[] = [];
	const events: { method: string; params: Record<string, unknown> }[] = [];
	const delegated: string[] = [];
	let receive: (data: string) => void = () => {};
	let closed = 0;
	let finish: (text: string) => void = () => {};
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "fixture-secret", accountId: "example-voice-account" }),
		open: async (url, headers, handlers) => {
			expect(url).toBe("wss://api.openai.com/v1/live/fixture-call");
			expect(headers.Authorization).toBe("Bearer fixture-secret");
			expect(headers.originator).toBe("xcsh");
			receive = handlers.message;
			return {
				send: data => {
					sent.push(JSON.parse(data));
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
		events,
		delegated,
		records,
		receive: (event: unknown) => receive(JSON.stringify(event)),
		closed: () => closed,
		finish: (text: string) => finish(text),
	};
}
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
		expect(f.events.map(event => event.method)).toEqual(
			scenario.events.filter(row => row.direction === "out").map(row => row.message.method),
		);
		const completed = f.records.filter(record => record.kind === "voiceTimeline");
		expect(completed).toHaveLength(4);
		expect(f.delegated).toEqual(scenario.name === "beta-delegation" ? [texts.user] : []);
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
						{ role: "assistant", text: "How can I help?" },
						{ role: "user", text: "change fixture" },
					],
				},
			},
		},
	]);
	expect(f.delegated).toEqual(["change fixture"]);
	f.finish("Done.");
	await f.voice.stop();
});

test("legacy handoff notification preserves distinct handoff and item identities", async () => {
	const f = fixture();
	f.deps.open = async (_url, _headers, handlers) => {
		queueMicrotask(() =>
			handlers.message(
				JSON.stringify({
					type: "conversation.handoff.requested",
					handoff_id: "h1",
					item_id: "i1",
					input_transcript: "legacy work",
				}),
			),
		);
		return { send: () => {}, close: () => {}, bufferedAmount: 0 };
	};
	await f.voice.start({ ...start, version: "v1" });
	await Bun.sleep(0);
	expect(f.events.find(event => event.method === "thread/realtime/itemAdded")?.params).toMatchObject({
		item: { type: "handoff_request", handoff_id: "h1", item_id: "i1", input_transcript: "legacy work" },
	});
	f.finish("Done.");
	await f.voice.stop();
});

test("pinned existing-call URL encodes one path segment and retains client-owned configuration", () => {
	expect(existingCallConfig(start)).toMatchObject({ version: "v3", url: "wss://api.openai.com/v1/live/fixture-call" });
	expect(existingCallConfig({ ...start, version: "v1" }).url).toBe(
		"wss://api.openai.com/v1/realtime?intent=quicksilver&call_id=fixture-call",
	);
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
test("pinned v3 events distinguish transcripts from delegated work and ignore malformed data", () => {
	expect(decodeVoiceEvent("v3", { type: "turn.done", turn: { id: "t1", role: "user", transcript: "hello" } })).toEqual(
		{ kind: "transcript", done: true, id: "t1", role: "user", text: "hello" },
	);
	expect(decodeVoiceEvent("v3", delegation)).toMatchObject({ kind: "delegation", id: "d1", text: "change fixture" });
	for (const event of [
		null,
		[],
		{ type: "turn.done" },
		{ ...delegation, item: { ...delegation.item, target: "server" } },
	])
		expect(decodeVoiceEvent("v3", event)).toBeNull();
});
test("pinned v1 transcript and handoff event shapes remain compatible", () => {
	expect(decodeVoiceEvent("v1", { type: "conversation.input_transcript.delta", delta: "hello" })).toMatchObject({
		kind: "transcript",
		done: false,
		role: "user",
		text: "hello",
	});
	expect(
		decodeVoiceEvent("v1", {
			type: "conversation.handoff.requested",
			handoff_id: "h1",
			item_id: "i1",
			input_transcript: "work",
		}),
	).toMatchObject({ kind: "delegation", id: "h1", text: "work" });
});
test("existing-call attachment never sends session.update or changes the work model", async () => {
	const f = fixture();
	await f.voice.start(start);
	expect(f.sent).toEqual([]);
	expect(f.events[2]).toMatchObject({ method: "thread/realtime/started", params: { version: "v3" } });
	f.voice.stop();
	expect(f.closed()).toBe(1);
});
test("transcripts persist with provenance but never execute; delegation executes once", async () => {
	const f = fixture();
	await f.voice.start(start);
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
	expect(f.delegated).toEqual(["change fixture"]);
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
	expect(f.sent).toEqual([{ type: "session.close" }]);
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
	f.receive({ type: "output_transcript.added", item: { text: "first" } });
	f.receive({ type: "input_transcript.added", item: { text: "second" } });
	await f.voice.stop();
	const speech = f.records.filter(
		record => record.kind === "voiceTimeline" && (record.item as any).type === "transcriptSegment",
	);
	expect(speech.map(record => [(record.item as any).role, (record.item as any).text])).toEqual([
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
		result: { voices: { defaultV1: "cove", defaultV2: "marin" } },
	});
	for (const method of ["thread/realtime/start", "thread/realtime/stop"])
		expect(await router.handle("phone", { id: method, method, params: { ...start, threadId: "fixture" } })).toEqual({
			id: method,
			result: {},
		});
	expect(methods).toEqual(["thread/realtime/start", "thread/realtime/stop"]);
	router.dispose();
});

test("session voice stop is idempotent and unsupported startup is rejected explicitly", async () => {
	const { RemoteSession } = await import("../../src/remote-control/session");
	const remote = new RemoteSession({ sessionId: "fixture", subscribe: () => () => {} } as any);
	expect(await remote.call("stop", "thread/realtime/stop", { threadId: "fixture" })).toEqual({});
	await expect(
		remote.call("start", "thread/realtime/start", {
			threadId: "fixture",
			outputModality: "audio",
			transport: { type: "websocket" },
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

test("real session voice uses selected subscription and routes delegated work through its sole owner", async () => {
	const { spyOn } = await import("bun:test");
	const { RemoteSession } = await import("../../src/remote-control/session");
	const records: any[] = [],
		messages: any[] = [],
		outputs: any[] = [],
		prompts: string[] = [];
	let sessionListener = (_event: any) => {};
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
			queueMicrotask(() => this.onopen?.());
		}
		send(data: string) {
			outputs.push(JSON.parse(data));
		}
		close() {}
	}
	const mock = spyOn(globalThis as unknown as { WebSocket: (...args: any[]) => any }, "WebSocket").mockImplementation(
		((url: string, options: any) => new MockSocket(url, options)) as any,
	);
	const target: any = {
		sessionId: "fixture-owner",
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		messages,
		sessionManager: {
			getCwd: () => "/tmp",
			getEntries: () => records,
			appendCustomEntry: (customType: string, data: any) => {
				records.push({ type: "custom", customType, data });
			},
			flush: async () => {},
		},
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
			messages.push(
				{ role: "user", content: text },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "private reasoning" },
						{ type: "text", text: "The fixture is updated." },
					],
					stopReason: "stop",
				},
			);
			sessionListener({ type: "agent_end" });
		},
	};
	const remote = new RemoteSession(target);
	try {
		await remote.call("voice-start", "thread/realtime/start", { ...start, threadId: target.sessionId });
		socket.onmessage({ data: JSON.stringify(delegation) });
		socket.onmessage({ data: JSON.stringify(delegation) });
		await Bun.sleep(0);
		expect(selectedSession).toBe("fixture-owner");
		expect(prompts).toEqual(["change fixture"]);
		expect(target.model.id).toBe("gpt-6-astra");
		expect(outputs).toContainEqual(
			expect.objectContaining({
				type: "delegation.context.append",
				content: [{ type: "input_text", text: "The fixture is updated." }],
			}),
		);
		expect(JSON.stringify(outputs)).not.toContain("private reasoning");
		expect(records.some(r => r.customType === "remote-realtime" && r.data.kind === "delegation")).toBe(true);
	} finally {
		remote.dispose();
		mock.mockRestore();
	}
});

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
	expect(f.events.map(event => event.method)).toEqual([
		"thread/realtime/item/started",
		"thread/realtime/item/completed",
		"thread/realtime/started",
		"thread/realtime/sdp",
	]);
	expect(f.events[3].params.sdp).toBe("v=0\r\nfixture-answer");
	expect(f.sent).toEqual([]);
	f.voice.stop();
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
	expect(f.sent).toEqual([]);
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
	await Bun.sleep(0);
	expect(f.delegated).toHaveLength(1);
	expect(f.delegated[0]).toContain("Please update the fixture.");
	expect(f.records.some(r => r.kind === "transcriptTail")).toBe(true);
	f.finish("Updated.");
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
		f.receive({ type: "turn.done", turn: { role: "user", transcript: "change fixture" } });
		f.voice.stop();
		await Bun.sleep(0);
		expect(f.delegated).toEqual(["change fixture"]);
		f.finish("Updated.");
	},
);
