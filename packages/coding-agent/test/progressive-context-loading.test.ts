import { afterEach, describe, expect, it, spyOn } from "bun:test";
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
import { buildSystemPrompt, prepareSystemPromptInputs, renderSystemPrompt } from "../src/system-prompt";

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

	it("uses progressive loading by default", () => {
		expect(Settings.isolated().get("context.loadingMode")).toBe("progressive");
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
			model: {
				...getBundledModel("openai", "gpt-4o-mini"),
				experimentalSupportedTools: ["request_user_input_async"],
			},
			disableExtensionDiscovery: true,
			extensions: [extension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
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
			settings: Settings.isolated({ "context.loadingMode": "eager" }),
			model,
			disableExtensionDiscovery: true,
			extensions: [extension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
			toolNames,
		});
	}

	it("starts progressive sessions with the core set and defers optional tools", async () => {
		const { session } = await create("progressive");
		try {
			const active = session.getActiveToolNames();
			expect(active).toEqual(
				expect.arrayContaining([
					"read",
					"grep",
					"find",
					"bash",
					"edit",
					"write",
					"search_tool_bm25",
					"request_user_input_async",
				]),
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
			expect(session.getActiveToolNames()).toContain("request_user_input_async");
			await session.refreshExtensionTools();
			expect(session.getActiveToolNames()).toContain("request_user_input_async");
		} finally {
			await session.dispose();
		}
	});

	it("renders environment fields and a compact navigable plugin catalog", async () => {
		const options = {
			cwd: os.tmpdir(),
			contextFiles: [],
			tools: new Map(),
			toolNames: [],
			skills: [],
			startFolder: { kind: "plain" as const },
		};
		const prepared = await prepareSystemPromptInputs(options, {
			loadPluginSummaries: async () => ({
				summaries: [{ id: "synthetic", name: "Synthetic plugin", description: "Deferred plugin description" }],
				cacheStatus: "completed",
			}),
		});
		const rendered = renderSystemPrompt(prepared, options);
		expect(rendered).not.toContain("[object Object]");
		expect(rendered).toContain("xcsh://plugin/");
	});

	it("uses the progressive prompt when the builder loading mode is omitted", async () => {
		const options = {
			cwd: os.tmpdir(),
			contextFiles: [],
			tools: new Map(),
			toolNames: [],
			skills: [],
			startFolder: { kind: "plain" as const },
		};
		expect(await buildSystemPrompt(options)).toBe(
			await buildSystemPrompt({ ...options, loadingMode: "progressive" }),
		);
	});

	it("does not activate dormant extension tools on refresh", async () => {
		const { session } = await create("progressive");
		try {
			await session.refreshExtensionTools();
			expect(session.getActiveToolNames()).not.toContain("deferred_weather");
			expect(session.searchDiscoverableTools("weather", 1)[0]?.tool.name).toBe("deferred_weather");
		} finally {
			await session.dispose();
		}
	});

	it("refreshes RPC discovery while preserving activation and removing disappeared selections", async () => {
		const { session } = await create("progressive");
		const tool = {
			name: "host_weather",
			label: "Weather",
			description: "RPC weather forecast",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		};
		try {
			session.getDiscoverableToolSearchIndex();
			await session.refreshRpcHostTools([tool]);
			expect(session.getActiveToolNames()).not.toContain(tool.name);
			expect(session.searchDiscoverableTools("RPC weather", 1)[0]?.tool.name).toBe(tool.name);
			await session.activateDiscoveredTools([tool.name]);
			await session.refreshRpcHostTools([{ ...tool, description: "RPC snow forecast" }]);
			expect(session.getActiveToolNames()).toContain(tool.name);
			await session.refreshRpcHostTools([]);
			expect(session.getActiveToolNames()).not.toContain(tool.name);
			expect(session.getDiscoverableTools().map(t => t.name)).not.toContain(tool.name);
			expect(session.sessionManager.buildSessionContext().selectedToolNames).not.toContain(tool.name);
		} finally {
			await session.dispose();
		}
	});

	it("keeps restricted and no-tools sessions restricted after registration refresh", async () => {
		for (const scope of [[], ["read"]]) {
			const { session } = await create("progressive", SessionManager.inMemory(), scope);
			try {
				await session.refreshExtensionTools();
				await session.refreshRpcHostTools([
					{
						name: "host_extra",
						label: "Extra",
						description: "Extra RPC tool",
						parameters: Type.Object({}),
						execute: async () => ({ content: [] }),
					},
				]);
				expect(session.getActiveToolNames()).toEqual(scope);
				expect(session.getDiscoverableTools().map(t => t.name)).not.toContain("deferred_weather");
				expect(session.getDiscoverableTools().map(t => t.name)).not.toContain("host_extra");
			} finally {
				await session.dispose();
			}
		}
	});

	it("honors disabled tools through refresh, discovery and activation", async () => {
		const tempDir = path.join(os.tmpdir(), `xcsh-excluded-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-4o-mini"),
			disableExtensionDiscovery: true,
			extensions: [extension],
			excludedToolNames: ["xcsh_blindfold", "deferred_weather"],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
		});
		try {
			await session.refreshExtensionTools();
			expect(session.searchDiscoverableTools("xcsh_blindfold", 1)).toHaveLength(0);
			expect(await session.activateDiscoveredTools(["xcsh_blindfold", "deferred_weather"])).toEqual([]);
			expect(session.getActiveToolNames()).not.toContain("deferred_weather");
		} finally {
			await session.dispose();
		}
	});

	it("activates the discovered native schema before the next model call and retains it on model changes", async () => {
		const { session } = await create("progressive");
		try {
			const search = session.getToolByName("search_tool_bm25")!;
			await search.execute("discovery", { query: "xcsh_blindfold", limit: 1 });
			expect(session.agent.state.tools.find(tool => tool.name === "xcsh_blindfold")?.parameters).toBeDefined();
			session.modelRegistry.authStorage.setRuntimeApiKey("openai", "synthetic-key");
			await session.setModel(getBundledModel("openai", "gpt-4o"));
			expect(session.getActiveToolNames()).toContain("xcsh_blindfold");
			expect(session.getActiveToolNames()).not.toContain("deferred_weather");
		} finally {
			await session.dispose();
		}
	});

	it("ranks native Blindfold for custom certificate terminology without loading it", async () => {
		const { session } = await create("progressive");
		try {
			for (const query of [
				"xcsh_blindfold",
				"BYOC",
				"bring your own certificate",
				"custom certificate",
				"protected PEM",
				"PKCS#12",
				"certificate key pair",
				"private-key encryption",
				"certificate rotation",
			]) {
				expect(session.searchDiscoverableTools(query, 1)[0]?.tool.name).toBe("xcsh_blindfold");
			}
			expect(session.getActiveToolNames()).not.toContain("xcsh_blindfold");
			expect(session.systemPrompt).not.toContain("Blindfold");
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

	it("honors explicit eager mode for OAuth and preserves the mode on model changes", async () => {
		const anthropic = getBundledModel("anthropic", "claude-haiku-4-5");
		const openai = getBundledModel("openai", "gpt-4o-mini");
		const { session } = await createOAuthSession(anthropic);
		try {
			for (const model of [anthropic, openai, anthropic]) {
				await session.setModel(model);
				expect(session.getActiveToolNames()).toContain("task");
				expect(session.getActiveToolNames()).toContain("deferred_weather");
				expect(session.getActiveToolNames()).not.toContain("search_tool_bm25");
			}
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

	it("treats missing model-registry auth storage as unavailable provider policy", async () => {
		const tempDir = path.join(os.tmpdir(), `xcsh-missing-registry-auth-${Snowflake.next()}`);
		tempDirs.push(tempDir);
		fs.mkdirSync(tempDir, { recursive: true });
		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		authStorages.push(authStorage);
		const model = getBundledModel("openai", "gpt-4o-mini");
		const modelRegistry = {
			getAvailable: () => [model],
			getApiKey: async () => "openai-api-key",
			getApiKeyForProvider: async () => "openai-api-key",
			syncExtensionSources: () => {},
			clearSourceRegistrations: () => {},
		};

		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			authStorage,
			modelRegistry: modelRegistry as never,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "context.loadingMode": "eager" }),
			model,
			disableExtensionDiscovery: true,
			extensions: [extension],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
		});

		try {
			expect(session.getActiveToolNames()).toContain("task");
			expect(session.getActiveToolNames()).not.toContain("request_user_input_async");
			expect(session.getActiveToolNames()).toContain("deferred_weather");
		} finally {
			await session.dispose();
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
			expect(resumed.session.getActiveToolNames()).toContain("request_user_input_async");
			expect(resumed.session.sessionManager.buildSessionContext().hasPersistedToolSelection).toBe(true);
		} finally {
			await resumed.session.dispose();
		}
	});

	it("delivers a real SDK async tool reply to the same session", async () => {
		const { session } = await create("progressive");
		try {
			const delivered = spyOn(session, "deliverAsyncAnswer").mockResolvedValue(undefined);
			const tool = session.agent.state.tools.find(tool => tool.name === "request_user_input_async")!;
			await tool.execute("call", { questions: [{ title: "Which?", options: ["A", "B"] }] });
			const request = session.userInteractions.pending()[0];
			expect(session.userInteractions.respond(request.id, "B")).toBe(true);
			await Bun.sleep(0);
			expect(delivered).toHaveBeenCalledWith("call", '["request_user_input_async","call",0]', "B");
		} finally {
			await session.dispose();
		}
	});

	it("renders a progressive neutral prompt within the static budget", async () => {
		const { session } = await create("progressive");
		try {
			expect(session.systemPrompt).toContain("xcsh://user");
			// Preserve the original neutral-context budget; differential UAT also rejects growth.
			expect(session.systemPrompt.length).toBeLessThanOrEqual(26_000);
			const toolJson = JSON.stringify(
				session.agent.state.tools.map(tool => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				})),
			);
			expect(toolJson.length).toBeLessThanOrEqual(47_000);
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
