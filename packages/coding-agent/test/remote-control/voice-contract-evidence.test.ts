import { expect, test } from "bun:test";
import { evaluateVoiceContract } from "../../src/remote-control/voice-contract-evidence";

const creation = {
	requestedModel: "gpt-live-1",
	route: "chatgpt-subscription",
	status: 201,
	returnedCallId: "rtc_fixture",
	attachedCallId: "rtc_fixture",
	fallbackApplied: false,
	configurationOverridden: false,
	routeTraced: true,
} as const;

test("supported subscription creation without a model echo establishes contract evidence", () => {
	const result = evaluateVoiceContract({ creation });
	expect(result.checks.requestModel.status).toBe("passed");
	expect(result.modelEcho).toBe("absent");
	expect(result.checks.delegation.status).toBe("untested");
	expect(result.qualified).toBe(false);
});

test("conflicting provider model, fallback, route and call identity cannot pass", () => {
	for (const override of [
		{ providerModel: "gpt-other" },
		{ fallbackApplied: true },
		{ routeTraced: false },
		{ configurationOverridden: true },
		{ attachedCallId: "rtc_different" },
		{ status: 400 },
	])
		expect(evaluateVoiceContract({ creation: { ...creation, ...override } }).checks.requestModel.status).toBe(
			"failed",
		);
});

test("independent verified gates determine qualification; missing captures remain incomplete", () => {
	const checks = Object.fromEntries(
		["configuration", "eventParsing", "media", "delegation", "interruption", "closure", "packaging", "physical"].map(
			name => [name, { status: "passed", evidence: ["fixture-receipt"] }],
		),
	);
	expect(evaluateVoiceContract({ creation, checks: checks as any }).qualified).toBe(true);
	expect(
		evaluateVoiceContract({ creation, checks: { closure: { status: "passed", evidence: [] } } }).checks.closure
			.status,
	).toBe("incomplete");
});
