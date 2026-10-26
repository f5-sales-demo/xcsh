import { expect, test } from "bun:test";
import { BrowserVoiceClient, type VoiceTransport } from "../src/voice/browser-client";
import type { VoiceRequest } from "../src/voice/contract";

function transport() {
	const sent: VoiceRequest[] = [];
	let receive: (message: unknown) => void = () => {};
	const channel: VoiceTransport = {
		send: message => {
			sent.push(message);
		},
		onMessage: callback => {
			receive = callback;
			return () => {};
		},
	};
	return {
		sent,
		channel,
		receive: (message: unknown) => receive(message),
		capabilities: () =>
			receive({
				type: "voice_event",
				chatId: "fixture-chat",
				method: "xcsh/voice/capabilities",
				params: { model: "gpt-live-1", transport: "webrtc" },
			}),
	};
}

test("discovery never opens a microphone or creates a provider call", () => {
	const t = transport();
	let captures = 0;
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: async () => {
			captures++;
			throw new Error("capture denied");
		},
		enumerateDevices: async () => [],
	});
	t.capabilities();
	expect(captures).toBe(0);
	expect(t.sent.map(request => request.action)).toEqual(["capabilities"]);
	voice.dispose();
});

test("delayed microphone permission cannot reactivate audio after disposal", async () => {
	const t = transport();
	const permission = Promise.withResolvers<MediaStream>();
	let stops = 0;
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: () => permission.promise,
		enumerateDevices: async () => [],
	});
	t.capabilities();
	const pending = voice.start();
	voice.dispose();
	permission.resolve({
		getTracks: () => [
			{
				stop: () => {
					stops++;
				},
			},
		],
	} as unknown as MediaStream);
	await pending;
	expect(stops).toBe(1);
	expect(voice.snapshot.active).toBe(false);
	expect(t.sent.some(request => request.action === "start")).toBe(false);
});

test("permission rejection does not automatically retry or choose another capture surface", async () => {
	const t = transport();
	let captures = 0;
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: async () => {
			captures++;
			throw new Error("denied");
		},
		enumerateDevices: async () => [],
	});
	t.capabilities();
	await voice.start();
	expect(captures).toBe(1);
	expect(voice.snapshot.state).toBe("Error");
	expect(t.sent.some(request => request.action === "companion")).toBe(false);
	voice.dispose();
});

test("ending voice cancels pending permission without submitting a call", async () => {
	const t = transport();
	const permission = Promise.withResolvers<MediaStream>();
	let stops = 0;
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: () => permission.promise,
		enumerateDevices: async () => [],
	});
	t.capabilities();
	const pending = voice.start();
	voice.stop();
	permission.resolve({ getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream);
	try {
		await pending;
		expect(voice.snapshot.active).toBe(false);
		expect(voice.snapshot.state).toBe("Listening");
		expect(stops).toBe(1);
		expect(t.sent.map(request => request.action)).toEqual(["capabilities"]);
	} finally {
		voice.dispose();
	}
});

test("changing selected chat cancels pending capture and requires fresh activation", async () => {
	const t = transport();
	const permission = Promise.withResolvers<MediaStream>();
	let stops = 0;
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: () => permission.promise,
		enumerateDevices: async () => [],
	});
	t.capabilities();
	const pending = voice.start();
	t.receive({
		type: "voice_event",
		chatId: "next-chat",
		method: "xcsh/voice/capabilities",
		params: { model: "gpt-live-1", transport: "webrtc" },
	});
	permission.resolve({ getTracks: () => [{ stop: () => stops++ }] } as unknown as MediaStream);
	try {
		await pending;
		expect(voice.snapshot.chatId).toBe("next-chat");
		expect(voice.snapshot.active).toBe(false);
		expect(voice.snapshot.state).toBe("Listening");
		expect(stops).toBe(1);
		expect(t.sent.some(request => request.action === "start")).toBe(false);
	} finally {
		voice.dispose();
	}
});

test("another panel's signaling cannot activate or change this audio client", () => {
	const t = transport();
	const voice = new BrowserVoiceClient(t.channel);
	t.receive({
		type: "voice_event",
		clientId: "another-client",
		chatId: "other-chat",
		method: "xcsh/voice/capabilities",
		params: { model: "gpt-live-1", transport: "webrtc" },
	});
	expect(voice.snapshot.available).toBe(false);
	expect(voice.snapshot.chatId).toBeUndefined();
	voice.dispose();
});

test("only a completed caller resume utterance resumes paused speech", () => {
	const t = transport();
	const voice = new BrowserVoiceClient(t.channel);
	t.capabilities();
	voice.pause();
	for (const [method, role] of [
		["thread/realtime/transcript/delta", "user"],
		["thread/realtime/transcript/done", "assistant"],
	]) {
		t.receive({ type: "voice_event", chatId: "fixture-chat", method, params: { role, text: "resume" } });
		expect(voice.snapshot.message).toContain("paused");
	}
	t.receive({
		type: "voice_event",
		chatId: "fixture-chat",
		method: "thread/realtime/transcript/done",
		params: { role: "user", text: " Resume. " },
	});
	expect(voice.snapshot.message).toBeUndefined();
	expect(t.sent.map(request => request.action)).toEqual(["capabilities", "pause"]);
	voice.dispose();
});

test("microphone selection stays inactive until activation and uses an exact device constraint", async () => {
	const t = transport();
	const constraints: (MediaStreamConstraints | undefined)[] = [];
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: async options => {
			constraints.push(options);
			throw new Error("fixture permission denial");
		},
		enumerateDevices: async () => [],
	});
	t.capabilities();
	voice.selectDevices({ microphone: "fixture-microphone" });
	expect(constraints).toEqual([]);
	await voice.start();
	expect(constraints).toEqual([{ audio: { deviceId: { exact: "fixture-microphone" } } }]);
	expect(t.sent.some(request => request.action === "start")).toBe(false);
	voice.dispose();
});
test("connecting audio cannot change its selected capture device", async () => {
	const t = transport();
	const permission = Promise.withResolvers<MediaStream>();
	const voice = new BrowserVoiceClient(t.channel, {
		getUserMedia: () => permission.promise,
		enumerateDevices: async () => [],
	});
	t.capabilities();
	const pending = voice.start();
	expect(() => voice.selectDevices({ microphone: "another-device" })).toThrow("End voice");
	voice.dispose();
	permission.reject(new Error("fixture ended"));
	await pending;
});

test("data channel loss stops capture, while confirmed closure avoids a second stop", async () => {
	const originalPeer = globalThis.RTCPeerConnection;
	const originalAudio = globalThis.Audio;
	const channel = new EventTarget();
	Object.assign(channel, { close: () => channel.dispatchEvent(new Event("close")) });
	class FixturePeer extends EventTarget {
		iceGatheringState = "complete";
		localDescription = { sdp: "v=0\r\nfixture" };
		addTrack() {}
		createDataChannel() {
			return channel;
		}
		async createOffer() {
			return this.localDescription;
		}
		async setLocalDescription() {}
		close() {}
	}
	globalThis.RTCPeerConnection = FixturePeer as unknown as typeof RTCPeerConnection;
	globalThis.Audio = class {} as unknown as typeof Audio;
	try {
		for (const confirmed of [false, true]) {
			const t = transport();
			let stops = 0;
			const track = { stop: () => stops++, enabled: true };
			const voice = new BrowserVoiceClient(t.channel, {
				getUserMedia: async () =>
					({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream,
				enumerateDevices: async () => [],
			});
			t.capabilities();
			try {
				await voice.start();
				expect(t.sent.map(request => request.action)).toEqual(["capabilities", "start"]);
				if (confirmed)
					channel.dispatchEvent(
						new MessageEvent("message", {
							data: JSON.stringify({ type: "session.closed", usage: { seconds: 1 } }),
						}),
					);
				else channel.dispatchEvent(new Event("close"));
				expect(voice.snapshot.active).toBe(false);
				expect(voice.snapshot.state === "Error").toBe(!confirmed);
				expect(voice.snapshot.closureConfirmed).toBe(confirmed ? true : undefined);
				expect(stops).toBe(1);
				expect(t.sent.map(request => request.action)).toEqual(["capabilities", "start", "stop"]);
			} finally {
				voice.dispose();
			}
		}
	} finally {
		globalThis.RTCPeerConnection = originalPeer;
		globalThis.Audio = originalAudio;
	}
});
