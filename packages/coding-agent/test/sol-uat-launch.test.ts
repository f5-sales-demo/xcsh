import { describe, expect, it } from "bun:test";
import { solUatLaunch } from "../scripts/sol-uat-launch";

describe("terminal acceptance executable identity", () => {
	it("runs source acceptance through dev and installed acceptance through the exact executable", () => {
		expect(solUatLaunch("litellm", [])).toEqual({
			argv: ["bun", "run", "dev", "--model", "litellm/gpt-6.1-sol", "--thinking", "medium"],
			modelId: "gpt-6.1-sol",
			modelOverride: true,
		});
		expect(solUatLaunch("openai-codex", ["--executable", "/tmp/Synthetic Install/xcsh", "--saved-role"])).toEqual({
			argv: ["/tmp/Synthetic Install/xcsh"],
			modelId: "gpt-6.1-sol",
			modelOverride: false,
		});
	});
	it("keeps regression model selection explicit and rejects incomplete options", () => {
		expect(solUatLaunch("anthropic", ["--model-id", "claude-synthetic"]).argv).toContain(
			"anthropic/claude-synthetic",
		);
		expect(() => solUatLaunch("litellm", ["--executable"])).toThrow("value");
		expect(() => solUatLaunch("litellm", ["--executable", "relative-path"])).toThrow("absolute");
	});
});
