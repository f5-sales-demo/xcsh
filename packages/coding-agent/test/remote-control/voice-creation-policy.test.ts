import { expect, test } from "bun:test";
import { configResponse } from "../../src/remote-control/metadata";
import { voicePersonaInstructions } from "../../src/remote-control/voice-persona";

test("phone configuration exposes compiled policy for call creation before sideband attachment", () => {
	const view = configResponse({ model: "gpt-6-astra", modelProvider: "openai-codex", reasoningEffort: "high" }, true);
	expect(view.config.experimental_realtime_ws_backend_prompt).toBe(
		voicePersonaInstructions({}, { tools: [], history: "" }).instructions,
	);
	expect(view.config.model).toBe("gpt-6-astra");
	expect(view.config.model_reasoning_effort).toBe("high");
	expect(view.config.experimental_realtime_ws_backend_prompt).toContain("technical coworker");
});

test("subscription-owned creation serializes the same shared policy exposed to the phone", async () => {
	const { voiceCallConfig, createVoiceCall } = await import("../../src/remote-control/voice-call");
	const config = voiceCallConfig(
		{ version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp: "v=0\r\n" } },
		{ tools: [], history: "" },
	);
	let body: any;
	await createVoiceCall(config, { accessToken: "fixture", accountId: "<ACCOUNT_ID>" }, {}, (async (
		_url: any,
		init: any,
	) => {
		body = JSON.parse(init.body);
		return new Response("v=0\r\n", { status: 201, headers: { location: "/v1/live/rtc_fixture" } });
	}) as typeof fetch);
	expect(body.session.instructions).toBe(
		configResponse(undefined, false).config.experimental_realtime_ws_backend_prompt,
	);
	expect(body.session.instructions).toContain("I’m xcsh, your technical coworker");
});
