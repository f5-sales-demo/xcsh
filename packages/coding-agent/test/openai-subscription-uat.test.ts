import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { OPENAI_CODEX_TERRA_MODEL, redactSensitiveOutput } from "../scripts/openai-subscription-uat";

describe("OpenAI subscription source UAT", () => {
	it("targets xcsh native GPT-5.6 Terra and contains no official-Codex sentinel", async () => {
		expect(OPENAI_CODEX_TERRA_MODEL).toBe("openai-codex/gpt-5.6-terra");
		const source = await fs.readFile(new URL("../scripts/openai-subscription-uat.ts", import.meta.url), "utf8");
		expect(source).not.toContain('"codex", ["login", "status"]');
		expect(source).not.toContain('"codex", [');
		expect(source).not.toContain('"openai/gpt-5-mini"');
	});

	it("redacts OAuth query strings, tokens, and sensitive headers from diagnostics", () => {
		const redacted = redactSensitiveOutput(
			"GET https://auth.openai.com/oauth/authorize?code=secret&state=secret Authorization: Bearer bearer-secret access_token=token-secret",
		);
		expect(redacted).toContain("https://auth.openai.com/oauth/authorize?[REDACTED]");
		expect(redacted).toContain("Authorization: [REDACTED]");
		expect(redacted).toContain("access_token=[REDACTED]");
		expect(redacted).not.toContain("bearer-secret");
		expect(redacted).not.toContain("token-secret");
	});

	it("redacts an OAuth authorization query after terminal line wrapping", () => {
		const redacted = redactSensitiveOutput(
			"https://auth.openai.com/oauth/authorize?client_id=public-client&redirect_uri=http%3A%2F%2Flocalhost%3A14\n" +
				" 55%2Fauth%2Fcallback&scope=openid+profile&code_challenge=wrapped-secret\n" +
				" &state=state-secret&originator=pi\n\n Click here to login",
		);

		expect(redacted).toContain("https://auth.openai.com/oauth/authorize?[REDACTED]");
		expect(redacted).toContain("Click here to login");
		expect(redacted).not.toContain("wrapped-secret");
		expect(redacted).not.toContain("55%2Fauth");
		expect(redacted).not.toContain("originator=pi");
	});
});
