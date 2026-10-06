import { expect, test } from "bun:test";
import { buildSystemPrompt } from "../src/system-prompt";

for (const loadingMode of ["eager", "progressive"] as const) {
	test(`${loadingMode} guides material async choices without an opening interview`, async () => {
		const rendered = await buildSystemPrompt({
			loadingMode,
			tools: new Map([["request_user_input_async", { label: "Question", description: "Ask" }]]),
			contextFiles: [],
			skills: [],
			startFolder: { kind: "plain" },
		});
		const policy = rendered.split("<structured-questions>")[1].split("</structured-questions>")[0];
		expect(policy).toContain("Investigate discoverable facts");
		expect(policy).toContain("`request_user_input_async`");
		expect(policy).toContain("continue independent work");
		expect(policy).toContain("until the user submits an answer");
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
		const policy = rendered.split("<structured-questions>")[1].split("</structured-questions>")[0];
		expect(policy).not.toContain("`request_user_input_async`");
		expect(policy).toContain("ask one concise plain-text question");
	});
}
