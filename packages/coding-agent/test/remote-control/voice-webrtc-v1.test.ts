import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import { createVoiceCall, voiceCallConfig } from "../../src/remote-control/voice-call";
import { voiceDelegation } from "../../src/remote-control/voice-delegation";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

// Derived from pinned methods_v1.rs/session_update_session and realtime_call.rs.
// This is a source-contract fixture, not a recording of a phone conversation.
const session = {
	type: "quicksilver",
	model: "gpt-realtime-1.5",
	instructions: "fixture instructions",
	audio: { input: { format: { type: "audio/pcm", rate: 24000 } }, output: { voice: "cove" } },
};
const params = {
	transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	outputModality: "audio",
	includeStartupContext: false,
	prompt: "fixture instructions",
};

test.each([{ version: undefined }, { version: null }, { version: "v1" }])(
	"WebRTC defaults and explicit v1 retain the pinned HTTP session shape: %j",
	async override => {
		const config = voiceCallConfig({ ...params, ...override }, "private context excluded");
		let requests = 0;
		await createVoiceCall(config, { accessToken: "fixture-key", accountId: "example-voice-account" }, {}, (async (
			url,
			init,
		) => {
			requests++;
			expect(url).toBe("https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas");
			expect(new Headers(init?.headers).get("openai-alpha")).toBe("quicksilver=v1");
			expect(JSON.parse(String(init?.body))).toEqual({ sdp: params.transport.sdp, session });
			return new Response("v=0\r\nfixture-answer", { headers: { Location: "/v1/realtime/calls/rtc_fixture" } });
		}) as typeof fetch);
		expect(requests).toBe(1);
	},
);

test("v1 rejects v3-only initial items and text output", () => {
	for (const override of [
		{ initialItems: [{ role: "user", text: "v3 history" }] },
		{ outputModality: "text" },
		{ version: "v2" },
	])
		expect(() => voiceCallConfig({ ...params, version: "v1", ...override }, "")).toThrow();
});

test.each(["v1", "v3"])("WebRTC %s requires the pinned App Server output modality field", version => {
	for (const outputModality of [undefined, null])
		expect(() => voiceCallConfig({ ...params, version, outputModality }, "")).toThrow();
});

function fixture(onInitialize?: (handlers: VoiceHandlers) => void) {
	const events: { method: string; params: Record<string, unknown> }[] = [];
	const records: Record<string, unknown>[] = [];
	const sent: any[] = [];
	const instructions: string[] = [];
	const delegated: string[] = [];
	let receive = (_event: string) => {};
	let closed = 0;
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "fixture-key", accountId: "example-voice-account" }),
		createCall: async config => {
			expect(config.session).toEqual(session);
			return { sdp: "v=0\r\nfixture-answer", callId: "rtc_fixture" };
		},
		open: async (url, headers, handlers) => {
			expect(url).toBe("wss://api.openai.com/v1/realtime?intent=quicksilver&call_id=rtc_fixture");
			expect(headers["openai-alpha"]).toBe("quicksilver=v1");
			receive = handlers.message;
			return {
				send: data => {
					sent.push(JSON.parse(data));
					if (JSON.parse(data).type === "session.update") onInitialize?.(handlers);
				},
				close: () => {
					closed++;
				},
				bufferedAmount: 0,
			};
		},
		modeChanged: async (active, options) => {
			const phase = active ? "start" : "end",
				text = options[phase];
			instructions.push(`${phase}:${text}`);
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
			return "Fixture done";
		},
	};
	return {
		deps,
		voice: new NativeVoice(deps),
		events,
		records,
		sent,
		instructions,
		delegated,
		receive: (event: unknown) => receive(JSON.stringify(event)),
		closed: () => closed,
	};
}

test("created v1 WebRTC initializes its sideband once and keeps delegation on the owning agent", async () => {
	const f = fixture();
	try {
		await f.voice.start({
			...params,
			realtimeStartInstructions: "Start fixture",
			realtimeEndInstructions: "End fixture",
		});
		expect(f.sent).toEqual([
			{
				type: "session.update",
				session: {
					type: session.type,
					instructions: session.instructions,
					audio: session.audio,
				},
			},
		]);
		expect(f.events.find(event => event.method === "thread/realtime/started")?.params.version).toBe("v1");
		expect(f.events.some(event => event.method === "thread/realtime/sdp")).toBe(true);
		f.receive({
			type: "conversation.handoff.requested",
			handoff_id: "h1",
			item_id: "i1",
			input_transcript: "Do fixture work",
		});
		f.receive({
			type: "conversation.handoff.requested",
			handoff_id: "h1",
			item_id: "i1",
			input_transcript: "Do fixture work",
		});
		await Bun.sleep(0);
		expect(f.delegated).toEqual([voiceDelegation("Do fixture work", "user: Do fixture work")]);
		expect(f.sent.filter(frame => frame.type === "conversation.handoff.append")).toEqual([
			{
				type: "conversation.handoff.append",
				handoff_id: "h1",
				output_text: '"Agent Final Message":\n\nFixture done',
			},
		]);
	} finally {
		await f.voice.stop();
	}
	expect(f.instructions).toEqual(["start:Start fixture", "end:End fixture"]);
	expect(f.closed()).toBe(1);
	expect(f.sent.some(frame => frame.type === "session.close")).toBe(false);
});

test("attaching an existing v1 call leaves its client configuration intact", async () => {
	const f = fixture();
	try {
		await f.voice.start({
			transport: { type: "existingCall", callId: "rtc_fixture" },
			includeStartupContext: false,
			outputModality: "audio",
		});
		expect(f.sent).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});

test.each(["throw", "close"])("v1 sideband initialization %s cannot leave voice open", async failure => {
	const f = fixture(handlers => {
		if (failure === "throw") throw new Error("private fixture transport detail");
		handlers.closed();
	});
	await expect(f.voice.start(params)).rejects.toThrow("Native realtime connection failed");
	await f.voice.stop();
	expect(f.voice.active).toBe(false);
	expect(f.closed()).toBe(1);
	expect(f.events.filter(event => event.method === "thread/realtime/closed")).toHaveLength(1);
	expect(f.records.filter(record => record.kind === "voiceDiagnostic" && record.connected === true)).toEqual([]);
	f.receive({ type: "conversation.handoff.requested", handoff_id: "late", input_transcript: "Do not execute" });
	await Bun.sleep(0);
	expect(f.delegated).toEqual([]);
	expect(JSON.stringify(f.events)).not.toContain("private fixture transport detail");
	expect(JSON.stringify(f.records)).not.toContain("private fixture transport detail");
});

test("speech received during v1 sideband initialization follows session history startup", async () => {
	const f = fixture(handlers =>
		handlers.message(
			JSON.stringify({
				type: "conversation.item.input_audio_transcription.completed",
				item_id: "early",
				transcript: "Fixture speech",
			}),
		),
	);
	try {
		await f.voice.start(params);
		await Bun.sleep(0);
		expect(
			f.events.filter(event => event.method === "thread/realtime/transcript/done").map(event => event.params),
		).toEqual([{ role: "user", text: "Fixture speech" }]);
		const started = f.events.findIndex(event => event.method === "thread/realtime/started");
		const transcript = f.events.findIndex(event => event.method === "thread/realtime/transcript/done");
		expect(started).toBeLessThan(transcript);
		expect(f.delegated).toEqual([]);
	} finally {
		await f.voice.stop();
	}
});
