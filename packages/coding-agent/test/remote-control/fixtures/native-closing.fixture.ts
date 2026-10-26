import { expect, mock, test } from "bun:test";

const actual = await import("@f5-sales-demo/pi-natives");
let stops = 0,
	muted = false,
	suppressed = false;
const native = {
	offerSdp: "v=0\r\nfixture-offer",
	mute: (value: boolean) => {
		muted = value;
	},
	suppressOutput: (value: boolean) => {
		suppressed = value;
	},
	applyAnswer: async () => {},
	takeError: () => undefined,
	audioState: () => ({
		applied: true,
		microphoneMuted: muted,
		speakerSuppressed: suppressed,
		speakerPeak: 0,
		microphonePeak: 0,
	}),
	stop: () => {
		stops++;
	},
};
mock.module("@f5-sales-demo/pi-natives", () => ({ ...actual, NativeVoiceAudio: { start: async () => native } }));
const { SelectedChatVoice } = await import("../../../src/remote-control/selected-chat-voice");
const { BUILD_INFO } = await import("../../../src/internal-urls/build-info.generated");
Object.assign(BUILD_INFO, { dirty: false });
delete process.env.SSH_CONNECTION;
process.env.XCSH_VOICE_PACKAGE_DIR = "/fixture/package";
process.env.XCSH_VOICE_PACKAGE_SHA256 = "0".repeat(64);
test("accepted native audio is muted but retained until provider finalization", async () => {
	let receive: (event: { method: string; params: Record<string, unknown> }) => void = () => {};
	const finalized = Promise.withResolvers<void>();
	const events: { method: string; params: Record<string, unknown> }[] = [];
	const bridge = new SelectedChatVoice(
		{ sessionId: "native-fixture" } as never,
		frame => {
			events.push(frame);
		},
		() => ({
			subscribe: listener => {
				receive = listener;
				return () => {};
			},
			call: async (_id, method) => {
				if (method === "thread/realtime/start") {
					receive({ method: "xcsh/voice/call", params: { providerCallId: "rtc_native_fixture" } });
					receive({ method: "thread/realtime/sdp", params: { sdp: "v=0\r\nfixture-answer" } });
				}
				if (method === "thread/realtime/stop") {
					receive({ method: "xcsh/voice/closing", params: { timeoutMs: 35000 } });
					await finalized.promise;
					receive({ method: "xcsh/voice/closure", params: { confirmed: true } });
					receive({ method: "thread/realtime/closed", params: { reason: "requested" } });
				}
			},
			close: async () => {},
		}),
	);
	let stopping: Promise<void> | undefined;
	try {
		await bridge.startNative();
		stopping = bridge.handle({
			type: "voice_request",
			action: "stop",
			requestId: "native-stop",
			chatId: "native-fixture",
		});
		await Bun.sleep(60);
		expect(stops).toBe(0);
		expect(muted).toBe(true);
		expect(suppressed).toBe(true);
		expect(events.some(event => event.method === "xcsh/voice/audioState" && event.params.state === "Closing")).toBe(
			true,
		);
		await bridge.handle({
			type: "voice_request",
			action: "unmute",
			requestId: "late-unmute",
			chatId: "native-fixture",
		});
		expect(muted).toBe(true);
		expect(stops).toBe(0);
		finalized.resolve();
		await stopping;
		expect(stops).toBe(1);
	} finally {
		finalized.resolve();
		await stopping;
		await bridge.close();
	}
});
