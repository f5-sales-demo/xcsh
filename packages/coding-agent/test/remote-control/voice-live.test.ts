import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import { decodeVoiceEvent } from "../../src/remote-control/voice-protocol";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";
import { standaloneVoiceConfig } from "../../src/remote-control/voice-standalone";

const persona = { tools: [], history: "fixture history" };
const base = {
	version: "v3",
	outputModality: "audio",
	includeStartupContext: false,
	prompt: "fixture instructions",
};

test("standalone uses the single Live endpoint and session shape", () => {
	const config = standaloneVoiceConfig({ ...base, threadId: "thread-fixture" }, persona);
	expect(config).toMatchObject({
		kind: "websocket",
		url: "wss://api.openai.com/v1/live?model=gpt-live-1-codex",
		alpha: "quicksilver=v2",
		realtimeSessionId: "thread-fixture",
		session: {
			audio: { output: { voice: "cove" } },
			delegation: { type: "client" },
		},
	});
	expect(config.session.instructions).toContain("fixture instructions");
	for (const override of [
		{ version: "v1" },
		{ version: "v2" },
		{ outputModality: "text" },
		{ voice: "marin" },
		{ initialItems: [{ role: "tool", text: "private" }] },
	])
		expect(() => standaloneVoiceConfig({ ...base, ...override }, persona)).toThrow();
});

test("Live decoder accepts only the current event family", () => {
	expect(decodeVoiceEvent({ type: "input_transcript.added", item: { text: "hello" } })).toEqual({
		kind: "transcript",
		done: false,
		role: "user",
		text: "hello",
	});
	expect(
		decodeVoiceEvent({
			type: "delegation.created",
			item: { type: "delegation", target: "client", id: "d1", content: [{ type: "input_text", text: "work" }] },
		}),
	).toEqual({ kind: "delegation", id: "d1", text: "work" });
	expect(decodeVoiceEvent({ type: "output_audio.delta", audio: "AQID", sample_rate: 48000 })).toEqual({
		kind: "audio",
		data: "AQID",
		sampleRate: 24000,
		numChannels: 1,
	});
	for (const event of [
		{ type: "conversation.handoff.requested", handoff_id: "legacy", input_transcript: "work" },
		{ type: "conversation.output_audio.delta", delta: "AQID" },
		{ type: "response.output_audio.delta", delta: "AQID" },
	])
		expect(decodeVoiceEvent(event)).toBeNull();
});

function fixture(apiKey: string | null = "standalone-fixture-key") {
	const sent: Record<string, unknown>[] = [];
	const events: { method: string; params: Record<string, unknown> }[] = [];
	let handlers!: VoiceHandlers;
	const deps: VoiceDependencies = {
		authenticate: async () => {
			throw new Error("subscription must not authenticate");
		},
		authenticateApiKey: async () => apiKey ?? undefined,
		persona: async () => persona,
		open: async (url, headers, value) => {
			handlers = value;
			expect(url).toBe("wss://api.openai.com/v1/live?model=gpt-live-1-codex");
			expect(headers).toMatchObject({ Authorization: "Bearer standalone-fixture-key", originator: "xcsh" });
			return { send: data => sent.push(JSON.parse(data)), close() {}, bufferedAmount: 0 };
		},
		emit: (method, params) => events.push({ method, params }),
		records: () => [],
		record: async () => {},
		delegate: async () => "done",
	};
	return { voice: new NativeVoice(deps), sent, events, handlers: () => handlers };
}

test("standalone initializes Live once and forwards audio and text", async () => {
	const f = fixture();
	const started = f.voice.start({ ...base, threadId: "thread-fixture" });
	await Bun.sleep(0);
	expect(f.sent[0]).toMatchObject({ type: "session.update" });
	expect(f.events.some(event => event.method === "thread/realtime/started")).toBe(false);
	f.handlers().message(JSON.stringify({ type: "session.updated", session: { id: "server-session" } }));
	await started;
	expect(f.events).toContainEqual({
		method: "thread/realtime/started",
		params: { realtimeSessionId: "thread-fixture", version: "v3" },
	});
	f.voice.appendAudio({ data: "AQID", sampleRate: 24000, numChannels: 1 });
	expect(f.sent.at(-1)).toEqual({ type: "input_audio.append", audio: "AQID" });
	f.voice.appendText("speak this", "assistant", true);
	expect(f.sent.at(-1)).toEqual({
		type: "session.context.append",
		channel: "speakable",
		content: [{ type: "input_text", text: "speak this" }],
	});
	await f.voice.stop();
	expect(f.sent.at(-1)).toEqual({ type: "session.close" });
});

test("standalone accepts session.started as the canonical first V3 event", async () => {
	const f = fixture();
	const started = f.voice.start({ ...base, threadId: "thread-fixture" });
	await Bun.sleep(0);
	f.handlers().message(JSON.stringify({ type: "session.started", session: { id: "server-session" } }));
	await started;
	expect(f.events).toContainEqual({
		method: "thread/realtime/started",
		params: { realtimeSessionId: "thread-fixture", version: "v3" },
	});
	await f.voice.stop();
});

test("standalone rejects malformed audio and missing API-key authentication", async () => {
	const f = fixture();
	const started = f.voice.start({ ...base, threadId: "thread-fixture" });
	await Bun.sleep(0);
	f.handlers().message(JSON.stringify({ type: "session.updated", session: { id: "server-session" } }));
	await started;
	for (const audio of [null, { data: 12 }, { data: "AQID", sampleRate: -1, numChannels: 1 }])
		expect(() => f.voice.appendAudio(audio)).toThrow("Invalid realtime audio input");
	await f.voice.stop();

	const missing = fixture(null);
	await expect(missing.voice.start({ ...base, threadId: "thread-fixture" })).rejects.toThrow("requires API key auth");
});
