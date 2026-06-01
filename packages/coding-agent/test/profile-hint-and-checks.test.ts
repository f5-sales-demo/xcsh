import { beforeAll, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";

// ---------- system-prompt profile hint ----------

const systemPromptPath = path.resolve(import.meta.dir, "../src/prompts/system/system-prompt.md");

// Minimal render context satisfying the template's conditional branches
const baseRenderContext = {
	agentsMdSearch: { files: [] },
	appendPrompt: "",
	contextFiles: [],
	cwd: "/tmp/test",
	date: "2026-05-06",
	dateTime: "2026-05-06",
	environment: [{ label: "OS", value: "Darwin" }],
	skills: [],
	rules: [],
	alwaysApplyRules: [],
	toolInfo: [],
	tools: [],
	repeatToolDescriptions: false,
	intentTracing: false,
	intentField: "",
	mcpDiscoveryMode: false,
	hasMCPDiscoveryServers: false,
	mcpDiscoveryServerSummaries: [],
	eagerTasks: false,
	secretsEnabled: false,
};

describe("system-prompt userProfile hint", () => {
	beforeAll(() => {
		registerCodingAgentPromptHelpers();
	});

	test("xcsh://user appears in the Internal URLs section of the template source", async () => {
		const template = await Bun.file(systemPromptPath).text();
		expect(template).toContain("xcsh://user");
		expect(template).toContain("xcsh://user?seed=true");
		expect(template).toContain("Primary human user profile");
	});

	test("renders Primary Human section when userProfile is provided", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			userProfile: {
				name: "Ada Lovelace",
				role: "Mathematician",
				org: "Acme",
			},
		});
		expect(rendered).toContain("Primary Human");
		expect(rendered).toContain("Ada Lovelace");
		expect(rendered).toContain("Mathematician");
		expect(rendered).toContain("Acme");
		expect(rendered).toContain("xcsh://user");
	});

	test("omits Primary Human section when userProfile is absent", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			// userProfile deliberately omitted
		});
		expect(rendered).not.toContain("Primary Human");
		// xcsh://user still appears in the Internal URLs section
		expect(rendered).toContain("xcsh://user");
	});

	test("omits Primary Human section when userProfile is undefined", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			userProfile: undefined,
		});
		expect(rendered).not.toContain("Primary Human");
	});

	test("Primary Human section includes trigger taxonomy", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			userProfile: { name: "Ada Lovelace", role: "Mathematician", org: "Acme" },
		});
		expect(rendered).toContain("MUST** read");
		expect(rendered).toContain("PII");
		expect(rendered).toContain("SHOULD NOT");
		expect(rendered).toContain("routine work");
	});
});
