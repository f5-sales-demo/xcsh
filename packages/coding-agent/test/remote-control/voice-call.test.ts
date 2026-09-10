import { expect, test } from "bun:test";
import { createVoiceCall, voiceCallConfig } from "../../src/remote-control/voice-call";

const params = {
	version: "v3",
	transport: { type: "webrtc", sdp: "v=0\r\nfixture-offer" },
	outputModality: "audio",
	includeStartupContext: false,
	model: "gpt-live-1-codex",
	voice: "cove",
	prompt: "fixture instructions",
	initialItems: [{ role: "assistant", text: "fixture context" }],
};
const auth = { accessToken: "fixture-secret", accountId: "example-voice-account" };

test("native WebRTC v3 uses the pinned subscription call route, session shape and Location identity", async () => {
	const config = voiceCallConfig(params, "");
	const result = await createVoiceCall(config, auth, {}, (async (url: string, init: RequestInit) => {
		expect(url).toBe("https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas");
		expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-secret");
		expect(init.redirect).toBe("error");
		expect(JSON.parse(String(init.body))).toMatchObject({
			sdp: params.transport.sdp,
			session: {
				model: "gpt-live-1-codex",
				instructions: "fixture instructions",
				delegation: { type: "client" },
				initial_items: [
					{ type: "message", role: "assistant", content: [{ type: "output_text", text: "fixture context" }] },
				],
			},
		});
		return new Response("v=0\r\nfixture-answer", { status: 201, headers: { Location: "/v1/live/rtc_example" } });
	}) as unknown as typeof fetch);
	expect(result).toEqual({ sdp: "v=0\r\nfixture-answer", callId: "rtc_example" });
});
test("call configuration preserves startup context and rejects malformed or excessive initial history", () => {
	expect(
		voiceCallConfig({ ...params, includeStartupContext: true }, "session-specific context").session.instructions,
	).toContain("session-specific context");
	for (const override of [
		{ version: "v2" },
		{ initialItems: [{ role: "tool", text: "private" }] },
		{ initialItems: Array(129).fill({ role: "user", text: "x" }) },
		{ transport: { type: "webrtc", sdp: "invalid" } },
	])
		expect(() => voiceCallConfig({ ...params, ...override }, "")).toThrow();
});
test.each([401, 403, 429, 500])(
	"call rejection HTTP %i preserves safe evidence without bodies or credentials",
	async status => {
		await expect(
			createVoiceCall(
				voiceCallConfig(params, ""),
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
			createVoiceCall(voiceCallConfig(params, ""), auth, {}, (async () => response) as unknown as typeof fetch),
		).rejects.toThrow();
});
