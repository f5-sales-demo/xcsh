import { beforeAll, describe, expect, test } from "bun:test";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";
import { createFleetResolver } from "../src/internal-urls/fleet-resolve";
import { buildSystemPrompt } from "../src/system-prompt";

beforeAll(() => {
	registerCodingAgentPromptHelpers();
});

describe("Git SOPs & Content Creator Repository Progressive Hints", () => {
	test("xcsh://fleet incorporates 5-phase Git SOPs for author/content repositories", async () => {
		const mockGovernance = JSON.stringify({
			source_repo: "f5-sales-demo/docs-control",
			repo_classes: {
				classes: {
					content: {
						authority: "author",
						description: "Demo and product content",
					},
				},
				repos: {
					"demo-resources": "content",
				},
			},
		});

		const resolver = createFleetResolver({
			cwd: () => "/fake/demo-resources",
			repoRoot: async () => "/fake/demo-resources",
			repoOrigin: async () => "https://github.com/f5-sales-demo/demo-resources.git",
			readGovernance: async () => mockGovernance,
			runGh: async () => ({ ok: false, stdout: "", stderr: "" }),
		});

		const resource = await resolver.resolve({ href: "xcsh://fleet", host: "fleet", path: "" } as any);

		expect(resource.content).toContain("Git SOPs");
		expect(resource.content).toContain("Comprehensive Issue First");
		expect(resource.content).toContain("Feature Branch / Worktree");
		expect(resource.content).toContain("PR & Linking");
		expect(resource.content).toContain("CI & Merge");
		expect(resource.content).toContain("Post-Merge Hygiene");
	});

	test("buildSystemPrompt contains Git SOPs and DevOps Engineer GitHub Mastery instructions", async () => {
		const promptText = await buildSystemPrompt({
			tools: new Map(),
			cwd: "/fake/demo-resources",
			startFolder: { kind: "github", slug: "f5-sales-demo/demo-resources" },
		});

		expect(promptText).toContain("governed path (Git SOPs)");
		expect(promptText).toContain("Comprehensive Issue First");
		expect(promptText).toContain("Feature Branch / Worktree");
		expect(promptText).toContain("PR with Issue Link");
		expect(promptText).toContain("Post-Merge Hygiene & Teardown");
		expect(promptText).toContain("skilled DevOps engineer");
	});

	test("buildSystemPrompt respects non-git workstation separation when startFolder is plain", async () => {
		const promptText = await buildSystemPrompt({
			tools: new Map(),
			cwd: "/fake/plain-folder",
			startFolder: { kind: "plain" },
		});

		// Plain non-git workstation should not mandate git init or git operations
		expect(promptText).toContain("The start folder is not a git repository");
		expect(promptText).toMatch(/MUST NOT.*offer to run `git init`/);
	});
});
