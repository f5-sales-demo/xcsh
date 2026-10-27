import { expect, test } from "bun:test";
import { NativeVoice } from "../../src/remote-control/voice";

test("an accepted call cancels pending sideband setup and reports closed only after reconciliation", async () => {
	const events: { method: string; params: Record<string, unknown> }[] = [];
	let opens = 0,
		firstReleased = false;
	let release: (reason?: Error) => void = () => {};
	const opening = Promise.withResolvers<void>();
	const records: Record<string, unknown>[] = [];
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "fixture-secret", accountId: "<ACCOUNT_ID>" }),
		createCall: async () => ({ callId: "rtc_startup_fixture", sdp: "v=0\r\nfixture-answer" }),
		closureTimeoutMs: 50,
		records: () => records,
		record: async value => {
			records.push(value);
		},
		emit: (method, params) => {
			events.push({ method, params });
		},
		delegate: async () => {
			throw new Error("Startup shutdown cannot admit work");
		},
		open: async (_url, _headers, handlers, signal) => {
			opens++;
			if (opens === 1) {
				opening.resolve();
				return new Promise((_resolve, reject) => {
					release = reason => {
						firstReleased = true;
						reject(reason ?? new Error("Cancelled initial sideband"));
					};
					signal?.addEventListener("abort", () => release(), { once: true });
				});
			}
			if (!firstReleased) throw new Error("Initial sideband is still pending");
			return {
				bufferedAmount: 0,
				close: () => {},
				send: value => {
					expect(JSON.parse(value)).toEqual({ type: "session.close" });
					handlers.message(JSON.stringify({ type: "session.closed", session: { id: "rtc_other_fixture" } }));
					expect(voice.closureConfirmed).toBe(false);
					handlers.message(JSON.stringify({ type: "session.closed", session: { id: "rtc_startup_fixture" } }));
				},
			};
		},
	});
	const started = voice
		.start({
			version: "v3",
			model: "gpt-live-1",
			outputModality: "audio",
			transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		})
		.catch(() => {});
	try {
		await opening.promise;
		await voice.stop();
		expect(firstReleased).toBe(true);
		expect(voice.canReleaseAudioOwnership).toBe(true);
		const confirmed = events.findIndex(
			event => event.method === "xcsh/voice/closure" && event.params.confirmed === true,
		);
		const closed = events.findIndex(event => event.method === "thread/realtime/closed");
		expect(confirmed).toBeGreaterThanOrEqual(0);
		expect(closed).toBeGreaterThan(confirmed);
		expect(events.filter(event => event.method === "thread/realtime/closed")).toHaveLength(1);
	} finally {
		release();
		await started;
		await voice.stop();
	}
}, 10000);

test("owned subscription call cannot release audio for another provider session", async () => {
	let receive = (_data: string) => {};
	let admitted = 0;
	const records: Record<string, unknown>[] = [];
	const voice = new NativeVoice({
		authenticate: async () => ({ accessToken: "fixture-secret", accountId: "<ACCOUNT_ID>" }),
		createCall: async () => ({ callId: "rtc_owned_fixture", sdp: "v=0\r\nfixture-answer" }),
		closureTimeoutMs: 50,
		records: () => records,
		record: async record => {
			records.push(record);
		},
		emit: () => {},
		delegate: async () => {
			admitted++;
			return "unexpected";
		},
		open: async (_url, _headers, handlers) => {
			receive = handlers.message;
			queueMicrotask(() =>
				handlers.message(JSON.stringify({ type: "session.started", session: { id: "rtc_owned_fixture" } })),
			);
			return {
				bufferedAmount: 0,
				close: () => {},
				send: data => {
					if (JSON.parse(data).type === "session.close")
						handlers.message(JSON.stringify({ type: "session.closed", session: { id: "rtc_owned_fixture" } }));
				},
			};
		},
	});
	try {
		await voice.start({
			version: "v3",
			model: "gpt-live-1",
			outputModality: "audio",
			transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
		});
		receive(JSON.stringify({ type: "session.closed", session: { id: "rtc_other_fixture" } }));
		expect(voice.closureConfirmed).toBe(false);
		expect(voice.canReleaseAudioOwnership).toBe(false);
		receive(JSON.stringify({ type: "session.closed", session: { id: "rtc_owned_fixture" } }));
		await voice.stop();
		expect(voice.closureConfirmed).toBe(true);
		expect(voice.canReleaseAudioOwnership).toBe(true);
		expect(admitted).toBe(0);
	} finally {
		await voice.stop();
	}
}, 10000);
