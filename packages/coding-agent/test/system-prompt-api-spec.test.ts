import { beforeAll, describe, expect, it } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { buildSystemPrompt } from "../src/system-prompt";

beforeAll(() => {
	registerCodingAgentPromptHelpers();
});

describe("system prompt API spec integration", () => {
	it("includes xcsh://api-spec/ hint", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("xcsh://api-spec/");
	});

	it("renders api-spec hint without dynamic metadata", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		// Old Handlebars variables must not leak into rendered prompt
		expect(rendered).not.toContain("{{apiSpecDomainCount}}");
		expect(rendered).not.toContain("{{apiSpecVersion}}");
		// Static compressed hint must be present
		expect(rendered).toContain("F5 XC API specifications");
	});

	it("contains MUST NOT read proactively directive for api-spec", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("**MUST NOT** read proactively");
		expect(rendered).toContain("Never guess API paths or request schemas");
	});
});
