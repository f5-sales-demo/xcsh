import { afterEach, describe, expect, it } from "bun:test";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { ExtensionRuntime, loadExtensionFromFactory } from "../src/extensibility/extensions/loader";
import { ExtensionRunner } from "../src/extensibility/extensions/runner";
import { ExtensionToolWrapper, wrapRegisteredTools } from "../src/extensibility/extensions/wrapper";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";
import { EventBus } from "../src/utils/event-bus";

const cleanup: Array<() => unknown | Promise<unknown>> = [];

afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

async function extension(runtime: ExtensionRuntime, owner: string, tools: Record<string, string>) {
	return loadExtensionFromFactory(
		pi => {
			for (const [name, text] of Object.entries(tools)) {
				pi.registerTool({
					name,
					label: name,
					description: name,
					parameters: Type.Object({}),
					execute: async () => ({ content: [{ type: "text", text }] }),
				});
			}
		},
		process.cwd(),
		new EventBus(),
		runtime,
		owner,
	);
}

describe("live extension tool refresh", () => {
	it("starts replacement extensions with the current session settings before reload completes", async () => {
		const auth = await AuthStorage.create(":memory:");
		cleanup.push(() => auth.close());
		const modelRegistry = new ModelRegistry(auth);
		const settings = Settings.isolated({ "compaction.enabled": false });
		const oldRuntime = new ExtensionRuntime();
		const runner = new ExtensionRunner(
			[],
			oldRuntime,
			process.cwd(),
			SessionManager.inMemory(),
			modelRegistry,
			settings,
		);
		runner.initialize(
			{
				sendMessage: () => {},
				sendUserMessage: () => {},
				appendEntry: () => {},
				setLabel: () => {},
				getActiveTools: () => [],
				getAllTools: () => [],
				setActiveTools: async () => {},
				getCommands: () => [],
				setModel: async () => false,
				getThinkingLevel: () => undefined,
				setThinkingLevel: () => {},
				getSessionName: () => undefined,
				setSessionName: async () => {},
			},
			{
				getModel: () => undefined,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => undefined,
				compact: async () => {},
				getSystemPrompt: () => "",
			},
		);
		let observedSettings: unknown;
		const replacementRuntime = new ExtensionRuntime();
		const replacement = await loadExtensionFromFactory(
			pi => {
				pi.on("session_start", async (_event, ctx) => {
					await Promise.resolve();
					observedSettings = ctx.settings;
				});
			},
			process.cwd(),
			new EventBus(),
			replacementRuntime,
			"plugin:replacement-session-start-fixture",
		);

		await runner.reloadExtensions([replacement], replacementRuntime);

		expect(observedSettings).toBe(settings);
	});

	it("removes missing tools, activates new tools, and replaces same-name implementations", async () => {
		const auth = await AuthStorage.create(":memory:");
		cleanup.push(() => auth.close());
		const modelRegistry = new ModelRegistry(auth);
		const oldRuntime = new ExtensionRuntime();
		const oldExtension = await extension(oldRuntime, "plugin:old-tool-fixture", {
			removed_tool: "removed",
			shared_tool: "old",
		});
		const runner = new ExtensionRunner(
			[oldExtension],
			oldRuntime,
			process.cwd(),
			SessionManager.inMemory(),
			modelRegistry,
		);
		const oldTools = wrapRegisteredTools(runner.getAllRegisteredTools(), runner).map(
			tool => new ExtensionToolWrapper(tool, runner),
		);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const session = new AgentSession({
			agent: new Agent({ initialState: { model, systemPrompt: "fixture", tools: oldTools, messages: [] } }),
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
			extensionRunner: runner,
			toolRegistry: new Map(oldTools.map(tool => [tool.name, tool])),
		});
		cleanup.push(() => session.dispose());

		const newRuntime = new ExtensionRuntime();
		const newExtension = await extension(newRuntime, "plugin:new-tool-fixture", {
			shared_tool: "new",
			added_tool: "added",
		});
		await runner.reloadExtensions([newExtension], newRuntime);
		await session.refreshExtensionTools();

		expect(session.getAllToolNames().sort()).toEqual(["added_tool", "shared_tool"]);
		expect(session.getActiveToolNames().sort()).toEqual(["added_tool", "shared_tool"]);
		const result = await session.getToolByName("shared_tool")!.execute("fixture-call", {});
		expect(result.content).toEqual([{ type: "text", text: "new" }]);
	});
});
