import { expect, test } from "bun:test";
import { NativeVoice, type VoiceDependencies } from "../../src/remote-control/voice";
import type { VoiceHandlers } from "../../src/remote-control/voice-socket";

// Codex 0.153.4 core/src/realtime_conversation.rs: build_realtime_session_config,
// prepare_realtime_start and realtime_request_headers. Source contract, not phone capture.
const identities = [undefined, null, "example-voice-session", ""];
const cases = ["v1", "v3"].flatMap(version =>
	["webrtc", "existingCall"].flatMap(type => identities.map(identity => ({ version, type, identity }))),
);

function fixture() {
	const events: { method: string; params: Record<string, unknown> }[] = [];
	const records: Record<string, unknown>[] = [];
	const calls: Record<string, string>[] = [];
	const connections: { headers: Record<string, string>; handlers: VoiceHandlers }[] = [];
	const deps: VoiceDependencies = {
		authenticate: async () => ({ accessToken: "fixture-key", accountId: "example-voice-account" }),
		createCall: async (_config, _auth, headers) => {
			calls.push(headers);
			return { callId: "rtc_fixture", sdp: "v=0\r\nfixture-answer" };
		},
		open: async (_url, headers, handlers) => {
			connections.push({ headers, handlers });
			return { send: () => {}, close: () => {}, bufferedAmount: 0 };
		},
		emit: (method, params) => events.push({ method, params }),
		records: () => records,
		record: async record => {
			records.push(record);
		},
		delegate: async () => "Fixture complete",
	};
	return { voice: new NativeVoice(deps), events, records, calls, connections };
}

test.each(cases)("$type $version preserves the pinned identity semantics for $identity", async testCase => {
	const { version, type, identity } = testCase;
	const f = fixture();
	const expected = identity ?? (type === "webrtc" ? "example-thread" : null);
	try {
		await f.voice.start({
			threadId: "example-thread",
			version,
			outputModality: "audio",
			includeStartupContext: false,
			...(identity === undefined ? {} : { realtimeSessionId: identity }),
			transport: type === "webrtc" ? { type, sdp: "v=0\r\nfixture-offer" } : { type, callId: "rtc_fixture" },
		});
		expect(f.events.find(event => event.method === "thread/realtime/started")?.params.realtimeSessionId).toBe(
			expected,
		);
		expect(f.calls).toHaveLength(type === "webrtc" ? 1 : 0);
		for (const headers of [...f.calls, f.connections[0].headers]) {
			expect(Object.hasOwn(headers, "x-session-id")).toBe(expected !== null);
			if (expected !== null) expect(headers["x-session-id"]).toBe(expected);
		}
		if (version === "v3") {
			f.connections[0].handlers.closed();
			const deadline = Date.now() + 2000;
			while (f.connections.length < 2 && Date.now() < deadline) await Bun.sleep(10);
			expect(f.connections).toHaveLength(2);
			expect(f.connections[1].headers).toEqual(f.connections[0].headers);
			expect(f.events.filter(event => event.method === "thread/realtime/started")).toHaveLength(1);
		}
	} finally {
		await f.voice.stop();
	}
	const items = f.records.filter(record => record.kind === "voiceTimeline").map(record => record.item as any);
	expect(items.map(item => item.type)).toEqual(["realtimeSessionStarted", "realtimeSessionClosed"]);
	expect(items[0].realtimeSessionId).toEqual(expected ?? expect.any(String));
	expect(items[1].realtimeSessionId).toBe(items[0].realtimeSessionId);
});
