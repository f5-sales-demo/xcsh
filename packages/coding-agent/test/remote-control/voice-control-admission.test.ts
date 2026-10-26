import { expect, test } from "bun:test";
import { NativeVoice } from "../../src/remote-control/voice";

for (const fixture of [
	{ name: "matching Resume control", observed: "Resume", delegated: "Resume", consumed: 1, submitted: 0 },
	{ name: "unfinished approval answer", observed: "Yes", delegated: "Yes", consumed: 0, submitted: 1 },
	{ name: "mismatched caller text", observed: "Keep waiting", delegated: "Resume", consumed: 0, submitted: 1 },
])
	test(`committed delegation handles ${fixture.name} without invoking completed speech`, async () => {
		let receive: (value: string) => void = () => {};
		let submitted = 0,
			consumed = 0;
		const sent: Record<string, unknown>[] = [];
		const voice = new NativeVoice({
			authenticate: async () => ({ accessToken: "fixture-secret", accountId: "selected-fixture" }),
			createCall: async () => ({ sdp: "v=0\r\nfixture-answer", callId: "rtc_control_fixture" }),
			closureTimeoutMs: 30,
			records: () => [],
			record: async () => {},
			emit: () => {},
			completedTranscript: () => {
				throw new Error("Delegation cannot complete an utterance or authorize approval");
			},
			committedCallerControl: text => {
				if (/^resume[.!]?$/i.test(text.trim())) {
					consumed++;
					return true;
				}
				return false;
			},
			delegate: async () => {
				submitted++;
				return "No work should be submitted";
			},
			open: async (_url, _headers, handlers) => {
				receive = handlers.message;
				queueMicrotask(() =>
					handlers.message(JSON.stringify({ type: "session.started", session: { id: "rtc_control_fixture" } })),
				);
				return {
					bufferedAmount: 0,
					close: () => {},
					send: data => {
						const value = JSON.parse(data);
						sent.push(value);
						if (value.type === "session.close") handlers.message(JSON.stringify({ type: "session.closed" }));
					},
				};
			},
		});
		try {
			await voice.start({
				version: "v3",
				transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
				outputModality: "audio",
				model: "gpt-live-1",
			});
			receive(
				JSON.stringify({ type: "input_transcript.added", item: { id: "caller-fixture", text: fixture.observed } }),
			);
			receive(
				JSON.stringify({
					type: "delegation.created",
					item: {
						id: "delegation-resume",
						type: "delegation",
						target: "client",
						content: [{ type: "input_text", text: fixture.delegated }],
					},
				}),
			);
			await Bun.sleep(0);
			expect(submitted).toBe(fixture.submitted);
			expect(consumed).toBe(fixture.consumed);
			expect(
				sent.some(
					value => value.type === "delegation.context.append" && value.delegation_item_id === "delegation-resume",
				),
			).toBe(true);
		} finally {
			await voice.stop();
		}
	});
