import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { Settings } from "../src/config/settings";
import type { ExtensionFactory } from "../src/extensibility/extensions";
import { createAgentSession } from "../src/sdk";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { buildSystemPrompt } from "../src/system-prompt";

const extension: ExtensionFactory = pi => {
	pi.registerTool({
		name: "deferred_weather",
		label: "Weather",
		description: "Calculate a weather comfort index",
		deferrable: true,
		parameters: Type.Object({ temperature: Type.Number() }),
		async execute() {
			return { content: [{ type: "text", text: "ok" }] };
		},
	});
};

describe("progressive context loading", () => {
	const tempDirs: string[] = [];
	const authStorages: AuthStorage[] = [];

	it("keeps eager as the default until live token and behavior gates pass", () => {
		expect(Settings.isolated().get("context.loadingMode")).toBe("eager");
	});

	afterEach(() => {
		for (const authStorage of authStorages.splice(0)) authStorage.close();
		for (const tempDir of tempDirs.splice(0)) fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function create(mode: "eager" | "progressive", manager = SessionManager.inMemory(), toolNames?: string[]) {
		const tempDir = path.join(os.tmpdir(), `xcsh-progressive-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		return await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: manager,
			settings: Settings.isolated({ "context.loadingMode": mode }),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [extension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			toolNames,
		});
	}

	async function createOAuthSession(model: Model, toolNames?: string[]) {
		const tempDir = path.join(os.tmpdir(), `xcsh-anthropic-oauth-tools-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		authStorages.push(authStorage);
		await authStorage.set("anthropic", {
			type: "oauth",
			access: "subscription-access-token",
			refresh: "subscription-refresh-token",
			expires: Date.now() + 60_000,
		});
		authStorage.setRuntimeApiKey("openai", "openai-api-key");
		return await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model,
			disableExtensionDiscovery: true,
			extensions: [extension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			toolNames,
		});
	}

	it("starts progressive sessions with the core set and defers optional tools", async () => {
		const { session } = await create("progressive");
		try {
			const active = session.getActiveToolNames();
			expect(active).toEqual(
				expect.arrayContaining(["read", "grep", "find", "bash", "edit", "write", "search_tool_bm25"]),
			);
			expect(active).not.toContain("calc");
			expect(active).not.toContain("task");
			expect(active).not.toContain("debug");
			expect(active).not.toContain("deferred_weather");
			expect(session.getDiscoverableTools().map(tool => tool.name)).toContain("deferred_weather");
		} finally {
			await session.dispose();
		}
	});

	it("discovers and activates deferred built-ins and extensions through one index", async () => {
		const { session } = await create("progressive");
		try {
			const matches = session.searchDiscoverableTools("weather comfort", 3);
			expect(matches[0]?.tool.name).toBe("deferred_weather");
			await session.activateDiscoveredTools(["deferred_weather"]);
			expect(session.getActiveToolNames()).toContain("deferred_weather");
			expect(session.getActiveToolNames()).toContain("resolve");
		} finally {
			await session.dispose();
		}
	});

	it("keeps explicit SDK tool lists authoritative in progressive mode", async () => {
		const { session } = await create("progressive", SessionManager.inMemory(), ["read", "deferred_weather"]);
		try {
			expect(session.getActiveToolNames()).toEqual(["read", "deferred_weather"]);
		} finally {
			await session.dispose();
		}
	});

	it("preserves eager rollback behavior", async () => {
		const { session } = await create("eager");
		try {
			expect(session.getActiveToolNames()).toContain("deferred_weather");
			expect(session.getActiveToolNames()).toContain("task");
		} finally {
			await session.dispose();
		}
	});

	it("bounds implicit tools for Anthropic OAuth and reapplies the policy when models change", async () => {
		const anthropic = getBundledModel("anthropic", "claude-haiku-4-5");
		const openai = getBundledModel("openai", "gpt-4o-mini");
		const { session } = await createOAuthSession(anthropic);

		try {
			expect(session.settings.get("context.loadingMode")).toBe("eager");
			const activeToolNames = session.getActiveToolNames();
			expect(activeToolNames).toEqual(
				expect.arrayContaining(["read", "grep", "find", "bash", "edit", "write", "search_tool_bm25"]),
			);
			expect(
				activeToolNames.every(name =>
					["read", "grep", "find", "bash", "python", "edit", "write", "xcsh_api", "search_tool_bm25"].includes(
						name,
					),
				),
			).toBe(true);
			expect(activeToolNames).not.toContain("task");
			expect(activeToolNames).not.toContain("deferred_weather");
			expect(session.getDiscoverableTools().map(tool => tool.name)).toContain("deferred_weather");

			await session.setModel(openai);
			expect(session.getActiveToolNames()).toContain("task");
			expect(session.getActiveToolNames()).toContain("deferred_weather");
			expect(session.getActiveToolNames()).not.toContain("search_tool_bm25");

			await session.setModel(anthropic);
			expect(session.getActiveToolNames()).not.toContain("task");
			expect(session.getActiveToolNames()).not.toContain("deferred_weather");
			expect(session.getActiveToolNames()).toContain("search_tool_bm25");
		} finally {
			await session.dispose();
		}
	});

	it("keeps non-Anthropic eager sessions and explicit OAuth tool scopes unchanged", async () => {
		const anthropic = getBundledModel("anthropic", "claude-haiku-4-5");
		const openai = getBundledModel("openai", "gpt-4o-mini");
		const eager = await createOAuthSession(openai);
		try {
			expect(eager.session.getActiveToolNames()).toContain("task");
			expect(eager.session.getActiveToolNames()).toContain("deferred_weather");
			expect(eager.session.getActiveToolNames()).not.toContain("search_tool_bm25");
		} finally {
			await eager.session.dispose();
		}

		const explicit = await createOAuthSession(anthropic, ["read", "deferred_weather"]);
		try {
			expect(explicit.session.getActiveToolNames()).toEqual(["read", "deferred_weather"]);
		} finally {
			await explicit.session.dispose();
		}
	});

	it("persists activated deferred tools across resume", async () => {
		const tempDir = path.join(os.tmpdir(), `xcsh-progressive-resume-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		const firstManager = SessionManager.create(tempDir, tempDir);
		const first = await create("progressive", firstManager);
		await first.session.activateDiscoveredTools(["deferred_weather"]);
		expect(first.session.sessionManager.buildSessionContext().selectedToolNames).toContain("deferred_weather");
		await first.session.sessionManager.rewriteEntries();
		const sessionFile = first.session.sessionFile;
		expect(sessionFile).toBeDefined();
		await first.session.dispose();

		const resumedManager = await SessionManager.open(sessionFile!, tempDir);
		expect(resumedManager.buildSessionContext().selectedToolNames).toContain("deferred_weather");
		const resumed = await create("progressive", resumedManager);
		try {
			expect(resumed.session.getActiveToolNames()).toContain("deferred_weather");
			expect(resumed.session.sessionManager.buildSessionContext().hasPersistedToolSelection).toBe(true);
		} finally {
			await resumed.session.dispose();
		}
	});

	it("renders a progressive neutral prompt within the static budget", async () => {
		const { session } = await create("progressive");
		try {
			expect(session.systemPrompt.length).toBeLessThanOrEqual(24_000);
			const toolJson = JSON.stringify(
				session.agent.state.tools.map(tool => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				})),
			);
			expect(toolJson.length).toBeLessThanOrEqual(45_000);
		} finally {
			await session.dispose();
		}
	});

	it("groups plugin skills behind the catalog while retaining user skills with namespaced names", async () => {
		const components: Array<{ category: string; label: string }> = [];
		const rendered = await buildSystemPrompt({
			loadingMode: "progressive",
			cwd: tempDirs[0] ?? os.tmpdir(),
			contextFiles: [{ path: "/private/customer-project/XCSH.md", content: "project instructions" }],
			agentsMdSearch: { scopePath: ".", limit: 10, pattern: "XCSH.md", files: [] },
			startFolder: { kind: "plain" },
			tools: new Map([["read", { label: "Read", description: "Read files and internal resources" }]]),
			toolNames: ["read"],
			skills: [
				{
					name: "plugin-name:plugin-skill",
					description: "individual plugin skill summary",
					filePath: "/plugins/plugin-skill/SKILL.md",
					baseDir: "/plugins/plugin-skill",
					source: "xcsh-plugins:user",
				},
				{
					name: "user:skill",
					description: "namespaced user skill summary",
					filePath: "/user/skill/SKILL.md",
					baseDir: "/user/skill",
					source: "codex:user",
				},
			],
			onProfileComponents: values => components.push(...values),
		});
		expect(rendered).not.toContain("individual plugin skill summary");
		expect(rendered).toContain("namespaced user skill summary");
		expect(components).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ category: "context_file", label: "context_file_1" }),
				expect.objectContaining({ category: "skill", label: "skill_1" }),
			]),
		);
		expect(JSON.stringify(components)).not.toContain("customer-project");
	});
});
