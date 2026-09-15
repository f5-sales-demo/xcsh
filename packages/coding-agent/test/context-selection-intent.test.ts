import { describe, expect, test } from "bun:test";
import { voiceDelegation } from "../src/remote-control/voice-delegation";
import { requestsContextActivation } from "../src/session/context-selection-intent";

describe("context selection intent", () => {
	test.each([
		"Apply the f5-sales-demo context and list its load balancers.",
		"Load context beta.",
		"Please use the tenant-blue context.",
		"Select the context named staging_2.",
		"Switch the xcsh context to demo.",
		"Switch to the demo context.",
	])("recognizes an explicit activation request: %s", value => {
		expect(requestsContextActivation(value)).toBe(true);
	});

	test("uses only the current delegated input, not earlier transcript text", () => {
		expect(
			requestsContextActivation(
				voiceDelegation(
					"Tell me which load balancers are active.",
					"user: Apply the beta context. assistant: The beta context is active.",
				),
			),
		).toBe(false);
		expect(requestsContextActivation(voiceDelegation("Apply the beta context.", "user: previous request"))).toBe(
			true,
		);
	});

	test.each([
		"What context is active?",
		"Do not apply the beta context.",
		"Please don't load context beta.",
		"Explain how to apply the beta context.",
		"How can I switch the context to beta?",
		"Use the context to answer my question.",
	])("does not turn status, negation, or instructional questions into mutations: %s", value => {
		expect(requestsContextActivation(value)).toBe(false);
	});
});
