import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import { decodeVoiceEvent } from "../../src/remote-control/voice-protocol";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";
import { standaloneVoiceConfig } from "../../src/remote-control/voice-standalone";

const base = { outputModality: "audio", includeStartupContext: false, prompt: "fixture instructions" };

test("standalone WebSocket defaults to the pinned v2 session and URL", () => {
	const config = standaloneVoiceConfig({ ...base, threadId: "thread-fixture" }, "excluded context");
	expect(config.version).toBe("v2");
	expect(config.realtimeSessionId).toBe("thread-fixture");
	expect(config.url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5");
	expect(config.session).toEqual({
		type: "realtime",
		instructions: "fixture instructions",
		output_modalities: ["audio"],
		audio: {
			input: {
				format: { type: "audio/pcm", rate: 24000 },
				noise_reduction: { type: "near_field" },
				transcription: { model: "gpt-4o-mini-transcribe" },
				turn_detection: {
					type: "server_vad",
					interrupt_response: true,
					create_response: true,
					silence_duration_ms: 500,
				},
			},
			output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin" },
		},
		tools: [
			expect.objectContaining({ type: "function", name: "background_agent", parameters: expect.any(Object) }),
			expect.objectContaining({ type: "function", name: "remain_silent", parameters: expect.any(Object) }),
		],
		tool_choice: "auto",
	});
});

test.each([
	{
		version: "v1",
		url: "wss://api.openai.com/v1/realtime?intent=quicksilver&model=gpt-realtime-1.5",
		alpha: "quicksilver=v1",
	},
	{ version: "v3", url: "wss://api.openai.com/v1/live?model=gpt-live-1-codex", alpha: "quicksilver=v2" },
] as const)("standalone $version uses the pinned URL and session family", ({ version, url, alpha }) => {
	const config = standaloneVoiceConfig({ ...base, version, transport: { type: "websocket" } }, "");
	expect(config.url).toBe(url);
	expect(config.alpha).toBe(alpha);
	expect(config.session.instructions).toBe("fixture instructions");
	expect(config.session.audio.output.voice).toBe("cove");
	expect(config.session.type).toBe(version === "v1" ? "quicksilver" : undefined);
});

test("standalone v2 accepts text output and rejects version-specific invalid options", () => {
	expect(standaloneVoiceConfig({ ...base, outputModality: "text" }, "").session.output_modalities).toEqual(["text"]);
	for (const params of [
		{ ...base, version: "v1", outputModality: "text" },
		{ ...base, version: "v3", outputModality: "text" },
		{ ...base, version: "v2", voice: "cove" },
		{ ...base, version: "v1", voice: "marin" },
		{ ...base, version: "v2", initialItems: [{ role: "user", text: "unsupported" }] },
		{ ...base, version: "v4" },
	])
		expect(() => standaloneVoiceConfig(params, "")).toThrow();
});

function socketFixture(delegate: VoiceDependencies["delegate"] = async () => "done") {
	const sent: Record<string, unknown>[] = [];
	const events: { method: string; params: Record<string, unknown> }[] = [];
	let handlers!: VoiceHandlers;
	let subscriptionCalls = 0;
	let apiKeyCalls = 0;
	const deps: VoiceDependencies = {
		authenticate: async () => {
			subscriptionCalls++;
			throw new Error("subscription must not authenticate");
		},
		authenticateApiKey: async () => {
			apiKeyCalls++;
			return "standalone-fixture-key";
		},
		open: async (url, headers, value) => {
			handlers = value;
			expect(url).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5");
			expect(headers).toEqual({
				Authorization: "Bearer standalone-fixture-key",
				originator: "xcsh",
				"x-session-id": "thread-fixture",
			});
			return { send: data => sent.push(JSON.parse(data)), close() {}, bufferedAmount: 0 };
		},
		emit: (method, params) => events.push({ method, params }),
		records: () => [],
		record: async () => {},
		delegate,
	};
	return {
		voice: new NativeVoice(deps),
		sent,
		events,
		handlers: () => handlers,
		subscriptionCalls: () => subscriptionCalls,
		apiKeyCalls: () => apiKeyCalls,
	};
}

test("standalone uses API-key auth, initializes once, and accepts thread audio", async () => {
	const f = socketFixture();
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		expect(f.subscriptionCalls()).toBe(0);
		expect(f.apiKeyCalls()).toBe(1);
		expect(f.sent[0]).toMatchObject({ type: "session.update", session: { type: "realtime" } });
		expect(f.events).toContainEqual({
			method: "thread/realtime/started",
			params: { realtimeSessionId: "thread-fixture", version: "v2" },
		});
		f.voice.appendAudio({
			data: "AQID",
			sampleRate: 48000,
			numChannels: 1,
			samplesPerChannel: 960,
			itemId: "input-item",
		});
		expect(f.sent.at(-1)).toEqual({ type: "input_audio_buffer.append", audio: "AQID" });
	} finally {
		await f.voice.stop();
	}
});

test("v2 decodes control events and preserves output audio identity", () => {
	expect(
		decodeVoiceEvent("v2", {
			type: "conversation.item.done",
			item: {
				type: "function_call",
				name: "background_agent",
				id: "item-1",
				call_id: "call-1",
				arguments: JSON.stringify({ query: "  inspect the fixture  " }),
			},
		}),
	).toEqual({ kind: "delegation", id: "call-1", itemId: "item-1", text: "inspect the fixture" });
	expect(
		decodeVoiceEvent("v2", {
			type: "conversation.item.done",
			item: { type: "function_call", name: "remain_silent", id: "silent-item", call_id: "silent-call" },
		}),
	).toEqual({ kind: "noop", id: "silent-call", itemId: "silent-item" });
	expect(decodeVoiceEvent("v2", { type: "response.created", response: { id: "response-1" } })).toEqual({
		kind: "responseCreated",
		id: "response-1",
	});
	expect(decodeVoiceEvent("v2", { type: "response.done", response_id: "response-1" })).toEqual({
		kind: "responseDone",
		id: "response-1",
	});
	expect(decodeVoiceEvent("v2", { type: "response.cancelled", response: {} })).toEqual({
		kind: "responseCancelled",
	});
	expect(decodeVoiceEvent("v2", { type: "input_audio_buffer.speech_started", item_id: "audio-1" })).toEqual({
		kind: "speechStarted",
		itemId: "audio-1",
	});
	expect(
		decodeVoiceEvent("v2", { type: "conversation.item.created", item: { type: "message", id: "item-2" } }),
	).toEqual({ kind: "itemAdded", item: { type: "message", id: "item-2" } });
	expect(
		decodeVoiceEvent("v2", {
			type: "response.output_audio.delta",
			delta: "AQIDBA==",
			item_id: "audio-1",
			sample_rate: 24000,
			channels: 1,
			samples_per_channel: 960,
		}),
	).toEqual({
		kind: "audio",
		data: "AQIDBA==",
		itemId: "audio-1",
		sampleRate: 24000,
		numChannels: 1,
		samplesPerChannel: 960,
	});
});

test("v2 prefixes appended text and requests speech without overlapping responses", async () => {
	const f = socketFixture();
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		f.voice.appendText("typed request");
		f.voice.appendText("say this", "user", true);
		expect(f.sent.slice(1)).toEqual([
			{
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "[USER] typed request" }],
				},
			},
			{
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "[BACKEND] say this" }],
				},
			},
			{ type: "response.create" },
		]);

		f.handlers().message(JSON.stringify({ type: "response.created", response: { id: "active" } }));
		await Bun.sleep(0);
		f.voice.appendText("queued speech", "user", true);
		expect(f.sent.at(-1)).toMatchObject({ item: { content: [{ text: "[BACKEND] queued speech" }] } });
		f.handlers().message(JSON.stringify({ type: "response.done", response: { id: "active" } }));
		await Bun.sleep(0);
		expect(f.sent.at(-1)).toEqual({ type: "response.create" });
	} finally {
		await f.voice.stop();
	}
});

test("v2 streams delegated results, acknowledges completion and handles silence", async () => {
	let output!: (update: { id: string; text: string; done: boolean }) => void;
	let complete!: (text: string) => void;
	const f = socketFixture(
		async (_id, _text, send) =>
			new Promise<string>(resolve => {
				output = send!;
				complete = resolve;
			}),
	);
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		f.handlers().message(
			JSON.stringify({
				type: "conversation.item.done",
				item: {
					type: "function_call",
					name: "background_agent",
					id: "item-1",
					call_id: "call-1",
					arguments: JSON.stringify({ prompt: "make the change" }),
				},
			}),
		);
		await Bun.sleep(0);
		output({ id: "answer", text: "work complete", done: true });
		complete("work complete");
		await Bun.sleep(0);
		await Bun.sleep(0);
		expect(f.sent.slice(-3)).toEqual([
			{
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "[BACKEND] work complete" }],
				},
			},
			{
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: "call-1",
					output: "Background agent finished. Use the preceding [BACKEND] messages as the result.",
				},
			},
			{ type: "response.create" },
		]);

		f.handlers().message(
			JSON.stringify({
				type: "conversation.item.done",
				item: { type: "function_call", name: "remain_silent", id: "silent-item", call_id: "silent-call" },
			}),
		);
		await Bun.sleep(0);
		expect(f.sent.at(-1)).toEqual({
			type: "conversation.item.create",
			item: { type: "function_call_output", call_id: "silent-call", output: "" },
		});
	} finally {
		await f.voice.stop();
	}
});

test("v2 truncates delivered output audio when input speech starts", async () => {
	const f = socketFixture();
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		f.handlers().message(
			JSON.stringify({
				type: "response.output_audio.delta",
				delta: "AQIDBA==",
				item_id: "audio-1",
				sample_rate: 24000,
				channels: 1,
				samples_per_channel: 2400,
			}),
		);
		f.handlers().message(JSON.stringify({ type: "input_audio_buffer.speech_started", item_id: "audio-1" }));
		await Bun.sleep(0);
		expect(f.sent.at(-1)).toEqual({
			type: "conversation.item.truncate",
			item_id: "audio-1",
			content_index: 0,
			audio_end_ms: 100,
		});
		expect(f.events.at(-1)).toEqual({
			method: "thread/realtime/itemAdded",
			params: { item: { type: "input_audio_buffer.speech_started", item_id: "audio-1" } },
		});
	} finally {
		await f.voice.stop();
	}
});

test("v2 forwards raw conversation items and response cancellation notifications", async () => {
	const f = socketFixture();
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		f.handlers().message(
			JSON.stringify({ type: "conversation.item.added", item: { type: "message", id: "item-2" } }),
		);
		f.handlers().message(JSON.stringify({ type: "response.cancelled", response_id: "response-2" }));
		await Bun.sleep(0);
		expect(f.events.slice(-2)).toEqual([
			{ method: "thread/realtime/itemAdded", params: { item: { type: "message", id: "item-2" } } },
			{
				method: "thread/realtime/itemAdded",
				params: { item: { type: "response.cancelled", response_id: "response-2" } },
			},
		]);
	} finally {
		await f.voice.stop();
	}
});

test("v2 acknowledges a second delegation as steering while preserving the active output owner", async () => {
	const calls: { text: string; hasOutput: boolean }[] = [];
	const f = socketFixture(
		async (_id, text, output) =>
			new Promise<string>(() => {
				calls.push({ text, hasOutput: output !== undefined });
			}),
	);
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		for (const [id, prompt] of [
			["active", "start the task"],
			["steer", "use the other fixture"],
		] as const) {
			f.handlers().message(
				JSON.stringify({
					type: "conversation.item.done",
					item: {
						type: "function_call",
						name: "background_agent",
						id: `${id}-item`,
						call_id: `${id}-call`,
						arguments: JSON.stringify({ prompt }),
					},
				}),
			);
			await Bun.sleep(0);
		}
		expect(calls).toEqual([
			{ text: expect.stringContaining("start the task"), hasOutput: true },
			{ text: expect.stringContaining("use the other fixture"), hasOutput: false },
		]);
		expect(f.sent.slice(-2)).toEqual([
			{
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: "steer-call",
					output: "This was sent to steer the previous background agent task.",
				},
			},
			{ type: "response.create" },
		]);
	} finally {
		await f.voice.stop();
	}
});

test("standalone v3 reports started only after the first session.updated event", async () => {
	const sent: Record<string, unknown>[] = [];
	const events: { method: string; params: Record<string, unknown> }[] = [];
	let handlers!: VoiceHandlers;
	const voice = new NativeVoice({
		authenticate: async () => {
			throw new Error("subscription must not authenticate");
		},
		authenticateApiKey: async () => "standalone-fixture-key",
		open: async (url, headers, value) => {
			handlers = value;
			expect(url).toBe("wss://api.openai.com/v1/live?model=gpt-live-1-codex");
			expect(headers["openai-alpha"]).toBe("quicksilver=v2");
			return { send: data => sent.push(JSON.parse(data)), close() {}, bufferedAmount: 0 };
		},
		emit: (method, params) => events.push({ method, params }),
		records: () => [],
		record: async () => {},
		delegate: async () => "done",
	});
	const started = voice.start({ ...base, version: "v3", threadId: "thread-v3" });
	await Bun.sleep(0);
	expect(sent[0]).toMatchObject({ type: "session.update" });
	expect(events.some(event => event.method === "thread/realtime/started")).toBe(false);
	handlers.message(JSON.stringify({ type: "session.updated", session: { id: "server-session-v3" } }));
	await started;
	expect(events).toContainEqual({
		method: "thread/realtime/started",
		params: { realtimeSessionId: "thread-v3", version: "v3" },
	});
	await voice.stop();
});

test("standalone v3 rejects a recognized event before session.updated", async () => {
	const events: string[] = [];
	let handlers!: VoiceHandlers;
	const voice = new NativeVoice({
		authenticate: async () => {
			throw new Error("subscription must not authenticate");
		},
		authenticateApiKey: async () => "standalone-fixture-key",
		open: async (_url, _headers, value) => {
			handlers = value;
			return { send() {}, close() {}, bufferedAmount: 0 };
		},
		emit: method => events.push(method),
		records: () => [],
		record: async () => {},
		delegate: async () => "done",
	});
	const started = voice.start({ ...base, version: "v3", threadId: "thread-v3" });
	await Bun.sleep(0);
	handlers.message(JSON.stringify({ type: "output_audio.delta", audio: "AQID" }));
	await expect(started).rejects.toThrow("Native realtime connection failed");
	expect(events).not.toContain("thread/realtime/started");
});

test("v2 response-item mode uses developer context and an empty completion output", async () => {
	let output!: (update: { id: string; text: string; done: boolean }) => void;
	let complete!: (text: string) => void;
	const f = socketFixture(
		async (_id, _text, send) =>
			new Promise<string>(resolve => {
				output = send!;
				complete = resolve;
			}),
	);
	try {
		await f.voice.start({
			...base,
			threadId: "thread-fixture",
			codexResponsesAsItems: true,
			codexResponseItemPrefix: "Silent context",
		});
		f.handlers().message(
			JSON.stringify({
				type: "conversation.item.done",
				item: {
					type: "function_call",
					name: "background_agent",
					id: "item-1",
					call_id: "call-1",
					arguments: JSON.stringify({ prompt: "make the change" }),
				},
			}),
		);
		await Bun.sleep(0);
		output({ id: "answer", text: "work complete", done: true });
		complete("work complete");
		await Bun.sleep(0);
		await Bun.sleep(0);
		expect(f.sent.slice(-2)).toEqual([
			{
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "developer",
					content: [{ type: "input_text", text: "Silent context\n\n[BACKEND] work complete" }],
				},
			},
			{
				type: "conversation.item.create",
				item: { type: "function_call_output", call_id: "call-1", output: "" },
			},
		]);
	} finally {
		await f.voice.stop();
	}
});

test("standalone audio rejects malformed frames", async () => {
	const f = socketFixture();
	try {
		await f.voice.start({ ...base, threadId: "thread-fixture" });
		for (const audio of [null, { data: 12 }, { data: "AQID", sampleRate: -1, numChannels: 1 }])
			expect(() => f.voice.appendAudio(audio)).toThrow("Invalid realtime audio input");
	} finally {
		await f.voice.stop();
	}
});

test("standalone rejects missing key auth without exposing credential details", async () => {
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "subscription-secret", accountId: "example-voice-account" }),
		authenticateApiKey: async () => undefined,
		emit: () => {},
		records: () => [],
		record: async () => {},
		delegate: async () => "",
	});
	await expect(voice.start({ ...base, threadId: "thread-fixture" })).rejects.toThrow("requires API key auth");
});
