import { beforeAll, describe, expect, it } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { buildSystemPrompt } from "../src/system-prompt";

beforeAll(() => {
	registerCodingAgentPromptHelpers();
});

describe("system prompt xcsh identity", () => {
	it("includes xcsh repo slug in workstation section", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("f5xc-salesdemos/xcsh");
	});

	it("includes xcsh version in workstation section", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toMatch(/xcsh: v\d+\.\d+\.\d+/);
	});
});

describe("system prompt API spec integration", () => {
	it("includes xcsh://api-spec/ hint", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("xcsh://api-spec/");
	});

	it("includes domain count as a number", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		const match = rendered.match(/\((\d+) domains/);
		expect(match).not.toBeNull();
		const count = Number(match?.[1]);
		expect(count).toBeGreaterThan(0);
	});

	it("includes API spec version", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toMatch(/v\d+\.\d+\.\d+/);
	});

	it("contains MUST NOT read proactively directive", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("MUST NOT");
		expect(rendered).toContain("Never guess API paths");
	});
});
