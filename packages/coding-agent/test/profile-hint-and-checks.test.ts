import { afterEach, beforeAll, describe, expect, it, test, vi } from "bun:test";
import * as path from "node:path";
import { prompt } from "@f5xc-salesdemos/pi-utils";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { checkProfileStatus } from "../src/modes/components/welcome-checks";

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
		expect(rendered).toContain("MUST** read when");
		expect(rendered).toContain("personal identifiers");
		expect(rendered).toContain("SHOULD NOT");
		expect(rendered).toContain("routine technical work");
	});
});

// ---------- checkProfileStatus ----------

function mockProfile(data: object): void {
	vi.spyOn(Bun, "file").mockReturnValue({
		json: () => Promise.resolve(data),
	} as unknown as ReturnType<typeof Bun.file>);
}

function mockProfileMissing(): void {
	vi.spyOn(Bun, "file").mockReturnValue({
		json: () => Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
	} as unknown as ReturnType<typeof Bun.file>);
}

describe("checkProfileStatus", () => {
	afterEach(() => vi.restoreAllMocks());

	it("returns current when profile is fresh (updatedAt within 24h)", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
		mockProfile({ givenName: "Ada", familyName: "Lovelace", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("current");
		expect(result?.name).toBe("Ada Lovelace");
		expect(result?.updatedAt).toBe(recentTs);
	});

	it("returns stale when updatedAt is older than 24h", async () => {
		const oldTs = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(); // 50h ago
		mockProfile({ givenName: "Ada", familyName: "Lovelace", updatedAt: oldTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("stale");
		expect(result?.name).toBe("Ada Lovelace");
		expect(result?.staleDays).toBe(2);
	});

	it("returns stale when updatedAt is absent", async () => {
		mockProfile({ givenName: "Ada", familyName: "Lovelace" });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("stale");
		expect(result?.name).toBe("Ada Lovelace");
		expect(result?.staleDays).toBeUndefined();
	});

	it("returns missing when profile file does not exist", async () => {
		mockProfileMissing();

		const result = await checkProfileStatus();
		expect(result?.state).toBe("missing");
	});

	it("returns missing when profile has no name fields", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		mockProfile({ jobTitle: "Engineer", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("missing");
	});

	it("builds name from givenName only when familyName is absent", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		mockProfile({ givenName: "Ada", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("current");
		expect(result?.name).toBe("Ada");
	});

	it("builds name from familyName only when givenName is absent", async () => {
		const recentTs = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
		mockProfile({ familyName: "Lovelace", updatedAt: recentTs });

		const result = await checkProfileStatus();
		expect(result?.state).toBe("current");
		expect(result?.name).toBe("Lovelace");
	});
});
