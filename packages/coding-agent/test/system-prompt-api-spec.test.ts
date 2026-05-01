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

	it("renders api-spec hint without dynamic metadata", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).not.toContain("{{apiSpecDomainCount}}");
		expect(rendered).not.toContain("{{apiSpecVersion}}");
		expect(rendered).toContain("F5 XC API specifications");
	});

	it("contains MUST NOT read proactively directive for api-spec", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("**MUST NOT** read proactively");
		expect(rendered).toContain("Never guess API paths or request schemas");
	});

	it("includes xcsh://api-catalog/ hint", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("xcsh://api-catalog/");
	});

	it("includes workflow hint", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("xcsh://api-spec/workflows/");
	});

	it("includes error resolution hint", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("xcsh://api-spec/errors/");
	});

	it("includes glossary hint", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		expect(rendered).toContain("xcsh://api-spec/glossary/");
	});

	it("contains MUST NOT read proactively for api-catalog", async () => {
		const rendered = await buildSystemPrompt({ tools: new Map() });
		const catalogIdx = rendered.indexOf("xcsh://api-catalog/");
		expect(catalogIdx).toBeGreaterThan(-1);
		const afterCatalog = rendered.slice(catalogIdx);
		expect(afterCatalog).toContain("MUST NOT");
	});
});
