import { expect, test } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { buildSystemPrompt } from "../src/system-prompt";

registerCodingAgentPromptHelpers();

for (const loadingMode of ["eager", "progressive"] as const) {
	test(`${loadingMode} guides material async choices without an opening interview`, async () => {
		const rendered = await buildSystemPrompt({
			loadingMode,
			tools: new Map([["request_user_input_async", { label: "Question", description: "Ask" }]]),
			contextFiles: [],
			skills: [],
			startFolder: { kind: "plain" },
		});
		const policy = rendered
			.split("<structured-questions>")[1]
			.split("</structured-questions>")[0]
			.replace(/\s+/g, " ");
		expect(policy).toContain("Investigate discoverable facts");
		expect(policy).toContain("`request_user_input_async`");
		expect(policy).toContain("Continue independent work");
		expect(policy).toContain("Keep dependent work pending");
		expect(policy).toContain("needs no opening interview");
		expect(policy).not.toContain("use `request_user_input`");
	});
	test(`${loadingMode} respects restricted tool availability in its question policy`, async () => {
		const rendered = await buildSystemPrompt({
			loadingMode,
			tools: new Map(),
			contextFiles: [],
			skills: [],
			startFolder: { kind: "plain" },
		});
		const policy = rendered
			.split("<structured-questions>")[1]
			.split("</structured-questions>")[0]
			.replace(/\s+/g, " ");
		expect(policy).not.toContain("`request_user_input_async`");
		expect(policy).toContain("ask one concise plain-text question");
	});
}
