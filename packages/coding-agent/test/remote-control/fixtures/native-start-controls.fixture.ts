import { expect, mock, test } from "bun:test";
import type { SessionTarget } from "../../../src/remote-control/session";

const natives = await import("@f5-sales-demo/pi-natives");
let helper: PromiseWithResolvers<FixtureAudio>;
class FixtureAudio {
	offerSdp = "v=0\r\nfixture";
	muted = false;
	suppressed = false;
	mute(value: boolean) {
		this.muted = value;
	}
	suppressOutput(value: boolean) {
		this.suppressed = value;
	}
	async applyAnswer() {}
	stop() {}
	takeError() {
		return undefined;
	}
	audioState() {
		return { applied: true, microphoneMuted: this.muted, speakerSuppressed: this.suppressed, speakerPeak: 0 };
	}
}
mock.module("@f5-sales-demo/pi-natives", () => ({ ...natives, NativeVoiceAudio: { start: () => helper.promise } }));
const info = await import("../../../src/internal-urls/build-info.generated");
mock.module("../../../src/internal-urls/build-info.generated", () => ({
	...info,
	BUILD_INFO: { ...info.BUILD_INFO, dirty: false },
}));
const { SelectedChatVoice } = await import("../../../src/remote-control/selected-chat-voice");

test.each(["helper", "call"])(
	"native controls chosen during %s initialization remain applied after admission",
	async phase => {
		helper = Promise.withResolvers<FixtureAudio>();
		const entered = Promise.withResolvers<void>();
		const admitted = Promise.withResolvers<void>();
		const audio = new FixtureAudio();
		let notify: (event: { method: string; params: Record<string, unknown> }) => void = () => {};
		const bridge = new SelectedChatVoice(
			{ sessionId: "fixture-chat" } as SessionTarget,
			() => {},
			() => ({
				subscribe: listener => {
					notify = listener;
					return () => {};
				},
				close: async () => {},
				call: async (_id, method, params) => {
					if (method === "thread/realtime/start") {
						expect(params.model).toBe("gpt-live-1");
						notify({ method: "thread/realtime/sdp", params: { sdp: "v=0\r\nfixture-answer" } });
						entered.resolve();
						await admitted.promise;
					}
				},
			}),
		);
		try {
			const pending = bridge.startNative();
			if (phase === "call") {
				helper.resolve(audio);
				await entered.promise;
			}
			for (const action of ["mute", "pause"] as const)
				await bridge.handle({ type: "voice_request", action, chatId: "fixture-chat", requestId: action });
			helper.resolve(audio);
			await entered.promise;
			admitted.resolve();
			await pending;
			expect(audio.muted).toBe(true);
			expect(audio.suppressed).toBe(true);
		} finally {
			helper.resolve(audio);
			admitted.resolve();
			await bridge.close();
		}
	},
);
