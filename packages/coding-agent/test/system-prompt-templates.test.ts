import { beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { prompt } from "@f5-sales-demo/pi-utils";
import { buildSystemPrompt } from "@f5-sales-demo/xcsh/system-prompt";
import Handlebars from "handlebars";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";

const baseGitContext = {
	isRepo: true,
	currentBranch: "feature/tests",
	mainBranch: "main",
	status: "M packages/coding-agent/src/prompts/system/custom-system-prompt.md",
	commits: "abc123 Fix tests",
};

const systemPromptsDir = path.resolve(import.meta.dir, "../src/prompts/system");

const baseRenderContext: prompt.TemplateContext = {
	TASK_TOOL_NAME: "task",
	ARGUMENTS: "alpha beta",
	agent: "You are a delegated worker",
	agentsMdSearch: { files: [] },
	appendPrompt: "Appendix instructions",
	arguments: "alpha beta",
	base: "Base system prompt",
	content: "Rule content",
	context: "Background context",
	contextFile: "/tmp/context.md",
	contextFiles: [{ path: "/tmp/context/a.md", content: "Alpha context" }],
	customPrompt: "Custom prompt body",
	cwd: "/tmp/pi-issue-147",
	date: "2026-02-24",
	dateTime: "2026-02-24T12:00:00Z",
	editToolName: "edit",
	environment: [{ label: "OS", value: "Darwin" }],
	finalPlanFilePath: "local://PLAN_FINAL.md",
	git: baseGitContext,
	intentField: "_i",
	intentTracing: true,
	iterative: true,
	maxRetries: 3,
	modifiedFiles: ["packages/coding-agent/src/config/prompt-templates.ts"],
	name: "rs-no-unwrap",
	path: "packages/coding-agent/src/config/prompt-templates.ts",
	planContent: "1. Read code\n2. Add tests",
	planExists: true,
	planFilePath: "local://PLAN.md",
	readFiles: ["packages/coding-agent/src/prompts/system/custom-system-prompt.md"],
	repeatToolDescriptions: true,
	reentry: false,
	request: "Create an agent to review prompt templates",
	retryCount: 1,
	rules: [{ name: "rs-no-unwrap", description: "Avoid unwrap", globs: ["**/*.rs"] }],
	skills: [{ name: "system-prompts", description: "Prompt design skill" }],
	systemPromptCustomization: "System customization",
	toolInfo: [{ name: "read", label: "Read", description: "Reads files" }],
	tools: ["read", "grep", "find", "edit", "task", "web_search", "todo_write"],
	worktree: "/tmp/pi-issue-147",
	writeToolName: "write",
};

async function loadSystemPromptTemplates(): Promise<Map<string, string>> {
	const templates = new Map<string, string>();
	const glob = new Bun.Glob("*.md");

	for await (const fileName of glob.scan({ cwd: systemPromptsDir, onlyFiles: true })) {
		const templatePath = path.join(systemPromptsDir, fileName);
		templates.set(fileName, await Bun.file(templatePath).text());
	}

	return templates;
}

function countOccurrences(text: string, needle: string): number {
	if (!needle) return 0;
	return text.split(needle).length - 1;
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-system-prompt-"));
	try {
		await run(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

describe("system Handlebars prompt templates", () => {
	beforeAll(() => {
		registerCodingAgentPromptHelpers();
	});

	test("custom-system-prompt renders without depending on coding-agent helpers", async () => {
		const templatePath = path.join(systemPromptsDir, "custom-system-prompt.md");
		const template = await Bun.file(templatePath).text();
		const rendered = prompt.render(template, { ...baseRenderContext });
		expect(rendered.length).toBeGreaterThan(0);
	});

	test("parses and compiles every system template", async () => {
		const templates = await loadSystemPromptTemplates();
		expect(templates.size).toBeGreaterThan(0);

		for (const [fileName, template] of templates) {
			expect(() => Handlebars.parse(template), `Failed parsing ${fileName}`).not.toThrow();
			expect(() => Handlebars.compile(template), `Failed compiling ${fileName}`).not.toThrow();
		}
	});

	test("custom-system-prompt renders project section for context and git combinations", async () => {
		const templatePath = path.join(systemPromptsDir, "custom-system-prompt.md");
		const template = await Bun.file(templatePath).text();

		const both = prompt.render(template, {
			...baseRenderContext,
			contextFiles: [{ path: "a.txt", content: "A" }],
			git: { ...baseGitContext, isRepo: true },
		});
		expect(both).toContain("<project>");
		expect(both).toContain("## Context");
		expect(both).toContain("## Version Control");

		const contextOnly = prompt.render(template, {
			...baseRenderContext,
			contextFiles: [{ path: "a.txt", content: "A" }],
			git: { isRepo: false },
		});
		expect(contextOnly).toContain("<project>");
		expect(contextOnly).toContain("## Context");
		expect(contextOnly).not.toContain("## Version Control");

		const gitOnly = prompt.render(template, {
			...baseRenderContext,
			contextFiles: [],
			git: {
				isRepo: true,
				currentBranch: "feature/tests",
				mainBranch: "main",
				status: "clean",
				commits: "abc123 test commit",
			},
		});
		expect(gitOnly).toContain("<project>");
		expect(gitOnly).not.toContain("## Context");
		expect(gitOnly).toContain("## Version Control");

		const neither = prompt.render(template, {
			...baseRenderContext,
			contextFiles: [],
			git: { isRepo: false },
		});
		expect(neither).not.toContain("<project>");
		expect(neither).not.toContain("## Context");
		expect(neither).not.toContain("## Version Control");
	});

	test("system-prompt conditionally renders inspect_image guidance", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();

		const baseTools = baseRenderContext.tools as string[];
		const withInspectImage = prompt.render(template, {
			...baseRenderContext,
			tools: [...baseTools, "inspect_image"],
		});
		expect(withInspectImage).toContain("### Image inspection");
		expect(withInspectImage).toContain("**MUST** use `inspect_image` over `read`");
		expect(withInspectImage).toContain("Write a specific `question` for `inspect_image`");

		const withoutInspectImage = prompt.render(template, {
			...baseRenderContext,
			tools: baseTools.filter((tool: string) => tool !== "inspect_image"),
		});
		expect(withoutInspectImage).not.toContain("### Image inspection");
	});

	test("system-prompt strengthens xcsh://about trigger for identity questions", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).toContain("Internal xcsh documentation");
		expect(template).toContain("**MUST NOT** read unless the user asks about xcsh itself");
		expect(template).toContain("Identity, version, build fingerprint, architecture, self-improvement");
		expect(template).toContain("**MUST** read for any question about xcsh before exploring `~/.xcsh/`");
		expect(template).toContain("`~/.xcsh/`");
	});

	test("system-prompt routes F5 XC product questions to the llms.txt index", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).toContain("# Product knowledge");
		expect(template).toContain("https://f5xc-salesdemos.github.io/docs/llms.txt");
		expect(template).toContain("F5 Distributed Cloud product questions");
		expect(template).toContain("live knowledge index");
		expect(template).toContain("## Routing discipline");
		expect(template).toContain("MUST NOT** web-search for F5 XC product information");
		expect(template).toContain("strip the trailing `/`, append `.md`");
		expect(template).toContain("Stop at the lowest tier that answers the question");
		expect(template).toContain("Multi-product questions");
		expect(template).toContain("If 404, try appending `/index.md`");
		expect(template).toContain("Web search re-entry");
	});

	test("system-prompt carries epistemic-integrity clause against sycophantic reversal", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).toContain("<epistemic-integrity>");
		expect(template).toContain("optimized for truth-seeking, not agreement");
		expect(template).toContain("Position reversal requires new information");
		expect(template).toContain("The operator is not the arbiter of facts");
		expect(template).toContain(
			"reverse a correct claim because the user restated their disagreement without new evidence",
		);
	});

	test("system-prompt carries epistemic-integrity voice stance and anti-repetition meta-line", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).toContain("diplomatically honest rather than dishonestly diplomatic");
		expect(template).toContain("Epistemic cowardice");
		expect(template).toContain("fails the operator twice");
		expect(template).toContain("let the specific evidence shape the opening");
	});

	test("system-prompt renders MCP discovery hint when enabled", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();

		const rendered = prompt.render(template, {
			...baseRenderContext,
			mcpDiscoveryMode: true,
			hasMCPDiscoveryServers: true,
			mcpDiscoveryServerSummaries: ["github (2 tools)", "slack (1 tool)"],
		});

		expect(rendered).toContain("## MCP tool discovery");
		expect(rendered).toContain("Discoverable MCP servers in this session: github (2 tools), slack (1 tool).");
		expect(rendered).not.toContain("Example discoverable MCP tools:");
		expect(rendered).toContain("call `search_tool_bm25` before concluding no such tool exists");
	});

	test("buildSystemPrompt deduplicates always-apply rules already present in SYSTEM.md", async () => {
		const duplicateRule = ["Use static imports.", "", "Do not use dynamic loading."].join("\n");
		const distinctRule = "Validate inputs at boundaries.";

		await withTempDir(async dir => {
			const configDir = path.join(dir, ".agent");
			await fs.mkdir(configDir, { recursive: true });
			await fs.writeFile(
				path.join(configDir, "SYSTEM.md"),
				["Project instructions", "", duplicateRule, "", "Trailing note"].join("\n"),
			);

			const prompt = await buildSystemPrompt({
				cwd: dir,
				contextFiles: [],
				skills: [],
				rules: [],
				toolNames: ["read"],
				customPrompt: "Custom prompt body",
				alwaysApplyRules: [
					{ name: "no-dynamic-loading", content: duplicateRule, path: "/tmp/no-dynamic-loading.md" },
					{ name: "validate-boundaries", content: distinctRule, path: "/tmp/validate-boundaries.md" },
				],
			});

			expect(countOccurrences(prompt, "Use static imports.")).toBe(1);
			expect(countOccurrences(prompt, "Do not use dynamic loading.")).toBe(1);
			expect(countOccurrences(prompt, distinctRule)).toBe(1);
		});
	});

	test("buildSystemPrompt deduplicates always-apply rules already present in customPrompt", async () => {
		const duplicateRule = ["Keep functions small.", "", "Extract shared helpers on the second use."].join("\n");
		const distinctRule = "Surface failures explicitly to callers.";

		const prompt = await buildSystemPrompt({
			cwd: os.tmpdir(),
			contextFiles: [],
			skills: [],
			rules: [],
			toolNames: ["read"],
			customPrompt: ["Custom guidance", "", duplicateRule, "", "More custom guidance"].join("\n"),
			alwaysApplyRules: [
				{ name: "small-functions", content: duplicateRule, path: "/tmp/small-functions.md" },
				{ name: "truthful-failures", content: distinctRule, path: "/tmp/truthful-failures.md" },
			],
		});

		expect(countOccurrences(prompt, "Keep functions small.")).toBe(1);
		expect(countOccurrences(prompt, "Extract shared helpers on the second use.")).toBe(1);
		expect(countOccurrences(prompt, distinctRule)).toBe(1);
	});

	test("config-integrity rule file exists with correct frontmatter and body", async () => {
		const rulePath = path.resolve(import.meta.dir, "../../../.xcsh/rules/config-integrity.md");
		const raw = await Bun.file(rulePath).text();
		expect(raw.length).toBeGreaterThan(0);
		// Frontmatter block at the top, delimited by ---.
		const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		expect(match).not.toBeNull();
		const [, frontmatter, body] = match!;
		expect(frontmatter).toContain(`condition: "."`);
		expect(frontmatter).toContain("tool:edit(");
		expect(frontmatter).toContain("**/*.tf");
		expect(frontmatter).toContain("**/*.yaml");
		expect(frontmatter).toContain("**/Makefile");
		expect(frontmatter).toContain("**/Dockerfile");
		expect(body).toContain("dependency-first");
	});

	test("system prompt no longer contains the <config-integrity> block", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).not.toContain("<config-integrity>");
		expect(template).not.toContain("</config-integrity>");
	});

	test("system prompt reframes role around SE primary mission (P2)", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).toContain("technical coworker for F5 Distributed Cloud sales engineers");
		expect(template).toContain("MEDDPICC qualification");
		expect(template).toContain("customer meeting preparation");
		expect(template).toContain("These are not separate roles");
	});

	test("system prompt reframes behavior and stakes for SE risk (P4)", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		expect(template).toContain("presentation reflex");
		expect(template).toContain("Demos well ≠ Fits the requirement");
		expect(template).toContain("lost deal, damaged credibility");
		expect(template).toContain("You **MUST NOT** yield unverified product claims");
		// Infrastructure clause survives as secondary
		expect(template).toContain("deployment reflex");
		expect(template).toContain("misconfigurations → outages");
	});

	test("custom-system-prompt renders the F5 XC context block when context is present", async () => {
		const templatePath = path.join(systemPromptsDir, "custom-system-prompt.md");
		const template = await Bun.file(templatePath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			context: {
				tenant: "acme-corp",
				namespace: "production",
				credentialSource: "context",
				authStatus: "connected",
				apiUrl: "https://acme-corp.console.ves.volterra.io",
			},
		});
		expect(rendered).toContain("## F5 XC Platform Context");
		expect(rendered).toContain("You are currently connected to F5 XC tenant: acme-corp, namespace: production.");
		expect(rendered).toContain("Credential source: context.");
		expect(rendered).toContain("Auth status: connected.");
		expect(rendered).toContain(
			"All F5 XC operations should target this tenant and namespace unless explicitly told otherwise.",
		);
		expect(rendered).toContain("Console URL: https://acme-corp.console.ves.volterra.io.");
		expect(rendered).toContain("**MUST** use this URL as the base");
	});

	test("custom-system-prompt omits the F5 XC context block when context is absent", async () => {
		const templatePath = path.join(systemPromptsDir, "custom-system-prompt.md");
		const template = await Bun.file(templatePath).text();
		const rendered = prompt.render(template, { ...baseRenderContext, context: undefined });
		expect(rendered).not.toContain("## F5 XC Platform Context");
		expect(rendered).not.toContain("All F5 XC operations should target");
	});

	test("system-prompt renders the F5 XC context block when context is present", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			context: {
				tenant: "acme-corp",
				namespace: "production",
				credentialSource: "context",
				authStatus: "connected",
				apiUrl: "https://acme-corp.console.ves.volterra.io",
			},
		});
		expect(rendered).toContain("## F5 XC Platform Context");
		expect(rendered).toContain("You are currently connected to F5 XC tenant: acme-corp, namespace: production.");
		expect(rendered).toContain("Credential source: context.");
		expect(rendered).toContain("Auth status: connected.");
		expect(rendered).toContain(
			"All F5 XC operations should target this tenant and namespace unless explicitly told otherwise.",
		);
		expect(rendered).toContain("Console URL: https://acme-corp.console.ves.volterra.io.");
		expect(rendered).toContain("**MUST** use this URL as the base");
	});

	test("system-prompt omits the F5 XC context block when context is absent", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		const rendered = prompt.render(template, { ...baseRenderContext, context: undefined });
		expect(rendered).not.toContain("## F5 XC Platform Context");
		expect(rendered).not.toContain("All F5 XC operations should target");
	});

	test("system-prompt omits console URL line when apiUrl is absent", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		const rendered = prompt.render(template, {
			...baseRenderContext,
			context: {
				tenant: "acme-corp",
				namespace: "production",
				credentialSource: "context",
				authStatus: "connected",
			},
		});
		expect(rendered).toContain("## F5 XC Platform Context");
		expect(rendered).not.toContain("Console URL:");
	});

	test("context block renders for env-backed sessions (credentialSource='environment', no context name)", async () => {
		// Regression test for the overlooked env-only path. xcsh launched with XCSH_API_URL /
		// XCSH_API_TOKEN has isConfigured=true and a real tenant but activeContextName=null.
		// The Handlebars context doesn't carry activeContextName directly — only tenant/namespace/
		// credentialSource/authStatus — so rendering the template with credentialSource:"environment"
		// should still produce the anchor block. Verified for both templates.
		for (const fileName of ["system-prompt.md", "custom-system-prompt.md"]) {
			const templatePath = path.join(systemPromptsDir, fileName);
			const template = await Bun.file(templatePath).text();
			const rendered = prompt.render(template, {
				...baseRenderContext,
				context: {
					tenant: "acme-corp",
					namespace: "production",
					credentialSource: "environment",
					authStatus: "connected",
				},
			});
			expect(rendered).toContain("## F5 XC Platform Context");
			expect(rendered).toContain("You are currently connected to F5 XC tenant: acme-corp, namespace: production.");
			expect(rendered).toContain("Credential source: environment.");
			expect(rendered).toContain(
				"All F5 XC operations should target this tenant and namespace unless explicitly told otherwise.",
			);
		}
	});

	test("epistemic-integrity swaps sea-color example for SE-domain bot-defense example (P5)", async () => {
		const templatePath = path.join(systemPromptsDir, "system-prompt.md");
		const template = await Bun.file(templatePath).text();
		// New example content
		expect(template).toContain("bot defense is a separate SKU above the base WAAP tier");
		expect(template).toContain("that's a contract question — not a product question");
		// Old sea-color example removed
		expect(template).not.toContain("why is the sea green");
		expect(template).not.toContain("the sea is definitely green");
		// Other two examples preserved
		expect(template).toContain("pool's health check is probing the wrong layer");
		expect(template).toContain("race condition between two writers");
	});
});
