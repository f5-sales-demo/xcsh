import { describe, expect, it } from "bun:test";
import {
	ANTHROPIC_DEFAULT_MODEL,
	ANTHROPIC_HAIKU_MODEL,
	ANTHROPIC_OPUS_MODEL,
	redactAnthropicUatOutput,
} from "../scripts/anthropic-subscription-uat";

describe("Anthropic subscription UAT harness", () => {
	it("targets the requested Claude tiers", () => {
		expect(ANTHROPIC_HAIKU_MODEL).toBe("anthropic/claude-haiku-4-5");
		expect(ANTHROPIC_DEFAULT_MODEL).toBe("anthropic/claude-sonnet-5");
		expect(ANTHROPIC_OPUS_MODEL).toBe("anthropic/claude-opus-5");
	});

	it("redacts authorization URLs, OAuth artifacts, and bearer credentials", () => {
		const redacted = redactAnthropicUatOutput(
			"https://claude.com/cai/oauth/authorize?state=secret state=secret Authorization: Bearer token-value",
		);
		expect(redacted).not.toContain("secret");
		expect(redacted).not.toContain("token-value");
		expect(redacted).toContain("[REDACTED]");
	});
});
