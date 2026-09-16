import { describe, expect, it } from "bun:test";
import {
	FABLE_5_MODEL,
	FABLE_MODEL,
	OPUS_CONTROL_MODEL,
	parseFableUatArgs,
	redactFableUatOutput,
} from "../scripts/fable-uat";

describe("Fable UAT runner", () => {
	it("supports source and installed targets with both auth and outcome modes", () => {
		expect(parseFableUatArgs(["--source", "--auth", "oauth", "--expect", "success"])).toMatchObject({
			auth: "oauth",
			expected: "success",
			targets: [{ label: "source" }],
		});
		expect(
			parseFableUatArgs(["--installed", "/opt/xcsh", "--auth", "api-key", "--expect", "entitlement-failure"]),
		).toMatchObject({
			auth: "api-key",
			expected: "entitlement-failure",
			targets: [{ label: "installed:/opt/xcsh" }],
		});
		expect([FABLE_MODEL, FABLE_5_MODEL, OPUS_CONTROL_MODEL]).toEqual([
			"anthropic/claude-fable-5-1",
			"anthropic/claude-fable-5",
			"anthropic/claude-opus-5",
		]);
	});

	it("redacts OAuth and API-key artifacts", () => {
		const redacted = redactFableUatOutput(
			"https://claude.com/oauth?state=secret Authorization: Bearer token-value x-api-key: api-secret",
		);
		expect(redacted).not.toContain("secret");
		expect(redacted).not.toContain("token-value");
		expect(redacted).toContain("[REDACTED]");
	});
});
