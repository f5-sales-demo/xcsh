import { describe, expect, it } from "bun:test";
import { solUatLaunch, solUatStartupReady } from "../scripts/sol-uat-launch";

describe("terminal acceptance executable identity", () => {
	it("recognizes the quiet terminal prompt and rejects an incomplete boot", () => {
		expect(solUatStartupReady("xcsh v22.4.10\n╭─ 0%  workspace\n╰─ ▏ ─╯")).toBe(true);
		expect(solUatStartupReady("xcsh v22.4.10\nCompiling native addon")).toBe(false);
	});
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
