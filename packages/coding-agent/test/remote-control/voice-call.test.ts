import { expect, test } from "bun:test";
import { createVoiceCall, voiceCallConfig } from "../../src/remote-control/voice-call";

const params = {
	version: "v3",
	transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	outputModality: "audio",
	includeStartupContext: false,
	model: "gpt-live-1",
	voice: "cove",
	prompt: "fixture instructions",
	initialItems: [{ role: "assistant", text: "fixture context" }],
};
const auth = { accessToken: "fixture-secret", accountId: "example-voice-account" };
const persona = { tools: [], history: "" };

test("native WebRTC v3 uses the pinned subscription call route, session shape and Location identity", async () => {
	const config = voiceCallConfig(params, persona);
	let request: { url: string; init: RequestInit } | undefined;
	const result = await createVoiceCall(config, auth, {}, (async (url: string, init: RequestInit) => {
		request = { url, init };
		return new Response("v=0\r\nfixture-answer", { status: 201, headers: { Location: "/v1/live/rtc_example" } });
	}) as unknown as typeof fetch);
	expect(request!.url).toBe(
		"https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas",
	);
	expect(new Headers(request!.init.headers).get("authorization")).toBe("Bearer fixture-secret");
	expect(request!.init.redirect).toBe("error");
	const body = JSON.parse(String(request!.init.body));
	expect(body).toMatchObject({
		sdp: params.transport.sdp,
		session: {
			model: "gpt-live-1",
			delegation: { type: "client" },
			initial_items: [
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "fixture context" }] },
			],
		},
	});
	expect(body.session.instructions).not.toContain("fixture instructions");
	expect(body.session.instructions).toContain("The caller speaks first");
	expect(result).toEqual({ sdp: "v=0\r\nfixture-answer", callId: "rtc_example" });
});
test("call configuration preserves startup context and rejects malformed or excessive initial history", () => {
	expect(
		voiceCallConfig({ ...params, includeStartupContext: true }, { ...persona, history: "session-specific context" })
			.session.instructions,
	).not.toContain("session-specific context");
	for (const override of [
		{ version: "v2" },
		{ initialItems: [{ role: "tool", text: "private" }] },
		{ initialItems: Array(129).fill({ role: "user", text: "x" }) },
		{ transport: { type: "webrtc", sdp: "invalid" } },
	])
		expect(() => voiceCallConfig({ ...params, ...override }, persona)).toThrow();
});
test.each([401, 403, 429, 500])(
	"call rejection HTTP %i preserves safe evidence without bodies or credentials",
	async status => {
		await expect(
			createVoiceCall(
				voiceCallConfig(params, persona),
				auth,
				{},
				(async () => new Response("fixture-secret private server body", { status })) as unknown as typeof fetch,
			),
		).rejects.toThrow(`HTTP ${status}`);
	},
);
test("call answers require SDP and a pinned call identifier", async () => {
	for (const response of [
		new Response("v=0\r\n"),
		new Response("private non-SDP", { headers: { Location: "/v1/live/rtc_example" } }),
		new Response("v=0\r\n", { headers: { Location: "/v1/live" } }),
	])
		await expect(
			createVoiceCall(voiceCallConfig(params, persona), auth, {}, (async () => response) as unknown as typeof fetch),
		).rejects.toThrow();
});

test("captured Codex creation-field rejection exposes only its known field without replaying", async () => {
	let requests = 0;
	await expect(
		createVoiceCall(voiceCallConfig(params, persona), auth, {}, (async () => {
			requests++;
			return Response.json(
				{ detail: "Field `session.model` is not allowed for this Codex realtime session" },
				{ status: 400 },
			);
		}) as unknown as typeof fetch),
	).rejects.toThrow("HTTP 400; rejected field session.model");
	expect(requests).toBe(1);
});

test("unrecognized and excessive creation errors never expose response content", async () => {
	for (const detail of [
		"fixture-secret",
		"Field `session.fixture-secret` is not allowed for this Codex realtime session",
		`${"x".repeat(5000)}fixture-secret`,
	]) {
		let message = "";
		try {
			await createVoiceCall(voiceCallConfig(params, persona), auth, {}, (async () =>
				Response.json({ detail }, { status: 400 })) as unknown as typeof fetch);
		} catch (error) {
			message = String(error);
		}
		expect(message).toContain("HTTP 400");
		expect(message).not.toContain("fixture-secret");
		expect(message).not.toContain("rejected field");
	}
});

test("NativeVoice preserves the safe creation-field diagnostic at the notification boundary", async () => {
	const { NativeVoice } = await import("../../src/remote-control/voice");
	const emitted: string[] = [];
	let requests = 0;
	const voice = new NativeVoice({
		closureTimeoutMs: 20,
		authenticate: async () => auth,
		persona: async () => persona,
		createCall: async (config, subscription, headers) =>
			createVoiceCall(config, subscription, headers, (async () => {
				requests++;
				return Response.json(
					{ detail: "Field `session.model` is not allowed for this Codex realtime session" },
					{ status: 400 },
				);
			}) as unknown as typeof fetch),
		record: async () => {},
		records: () => [],
		emit: (method, params) => {
			if (method === "thread/realtime/error") emitted.push((params as { message: string }).message);
		},
		delegate: async () => {
			throw new Error("No backend work permitted");
		},
	});
	try {
		await expect(voice.start(params)).rejects.toThrow("rejected field session.model");
		expect(emitted.some(message => message.includes("rejected field session.model"))).toBe(true);
		expect(requests).toBe(1);
	} finally {
		await voice.stop();
	}
});

test("host-created calls disable acknowledgment filler by default", () => {
	expect(voiceCallConfig(params, persona).session.delegation.ack_filler).toBe(false);
	expect(voiceCallConfig({ ...params, delegationAckFiller: true }, persona).session.delegation.ack_filler).toBe(true);
});

test("owned calls use exactly gpt-live-1 and reject alternate model configuration", () => {
	expect(voiceCallConfig({ ...params, model: undefined }, persona).session.model).toBe("gpt-live-1");
	expect(() => voiceCallConfig({ ...params, model: "gpt-live-1-codex" }, persona)).toThrow();
});

test.each(["malformed", "missing", "interrupted", "oversized"])(
	"accepted call identity survives a %s SDP answer without another creation",
	async failure => {
		const { VoiceCallCreationError } = await import("../../src/remote-control/voice-call");
		let requests = 0;
		const body =
			failure === "missing"
				? null
				: failure === "interrupted"
					? new ReadableStream({
							start(controller) {
								controller.error(new Error("fixture read failed"));
							},
						})
					: failure === "oversized"
						? "v=0\r\n" + "x".repeat(262145)
						: "malformed fixture answer";
		let observed: unknown;
		try {
			await createVoiceCall(voiceCallConfig(params, persona), auth, {}, (async () => {
				requests++;
				return new Response(body, { status: 201, headers: { Location: "/v1/live/rtc_uncertain_fixture" } });
			}) as unknown as typeof fetch);
		} catch (error) {
			observed = error;
		}
		expect(observed).toBeInstanceOf(VoiceCallCreationError);
		expect(observed).toMatchObject({ outcome: "uncertain", callId: "rtc_uncertain_fixture" });
		expect(requests).toBe(1);
	},
);

test("NativeVoice retains known failed creation and reconciles only its sideband on explicit stop", async () => {
	const { NativeVoice } = await import("../../src/remote-control/voice");
	let creations = 0,
		opens = 0,
		backend = 0;
	const sent: unknown[] = [];
	const records: Record<string, unknown>[] = [];
	const voice = new NativeVoice({
		closureTimeoutMs: 30,
		authenticate: async () => auth,
		persona: async () => persona,
		createCall: async (config, subscription, headers) =>
			createVoiceCall(config, subscription, headers, (async () => {
				creations++;
				return new Response("malformed fixture answer", {
					status: 201,
					headers: { Location: "/v1/live/rtc_retained_fixture" },
				});
			}) as unknown as typeof fetch),
		open: async (url, _headers, handlers) => {
			opens++;
			expect(url).toBe("wss://api.openai.com/v1/live/rtc_retained_fixture");
			if (opens === 1) throw new Error("fixture upgrade unavailable");
			return {
				bufferedAmount: 0,
				close: () => {},
				send: data => {
					sent.push(JSON.parse(data));
					handlers.message(JSON.stringify({ type: "session.closed" }));
				},
			};
		},
		record: async record => {
			records.push(record);
		},
		records: () => records,
		emit: () => {},
		delegate: async () => {
			backend++;
			return "No work allowed";
		},
	});
	try {
		await expect(voice.start(params)).rejects.toThrow();
		await voice.closing;
		expect(voice.ownedCall).toBe(true);
		expect(voice.canReleaseAudioOwnership).toBe(false);
		expect(opens).toBe(1);
		await Promise.all([voice.stop(), voice.stop()]);
		expect(opens).toBe(2);
		expect(creations).toBe(1);
		expect(sent).toEqual([{ type: "session.close" }]);
		expect(voice.closureConfirmed).toBe(true);
		expect(voice.canReleaseAudioOwnership).toBe(true);
		expect(backend).toBe(0);
	} finally {
		await voice.stop();
	}
});

test("a call identity learned after Stop is still reconciled without activating media", async () => {
	const { NativeVoice } = await import("../../src/remote-control/voice");
	const { VoiceCallCreationError } = await import("../../src/remote-control/voice-call");
	const entered = Promise.withResolvers<void>();
	const creation = Promise.withResolvers<{ sdp: string; callId: string }>();
	const events: string[] = [];
	let closes = 0;
	const voice = new NativeVoice({
		closureTimeoutMs: 30,
		authenticate: async () => auth,
		createCall: async () => {
			entered.resolve();
			return creation.promise;
		},
		persona: async () => persona,
		record: async () => {},
		records: () => [],
		emit: method => {
			events.push(method);
		},
		delegate: async () => {
			throw new Error("No work permitted");
		},
		open: async (_url, _headers, handlers) => ({
			bufferedAmount: 0,
			close: () => {
				closes++;
			},
			send: () => {
				handlers.message(JSON.stringify({ type: "session.closed" }));
			},
		}),
	});
	const starting = voice.start(params);
	const rejected = starting.catch(error => error);
	await entered.promise;
	await voice.stop();
	creation.reject(new VoiceCallCreationError("uncertain", "Invalid realtime call response", "rtc_late_fixture"));
	expect(await rejected).toBeInstanceOf(Error);
	await voice.closing;
	expect(voice.closureConfirmed).toBe(true);
	expect(voice.canReleaseAudioOwnership).toBe(true);
	expect(closes).toBe(1);
	expect(events).not.toContain("thread/realtime/sdp");
});
