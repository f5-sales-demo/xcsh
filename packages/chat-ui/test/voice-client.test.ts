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
