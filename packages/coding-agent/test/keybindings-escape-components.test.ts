import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { setKeybindings, type TUI } from "@f5-sales-demo/pi-tui";
import { KeybindingsManager } from "../src/config/keybindings";
import type { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { ContextAddWizard } from "../src/modes/components/context-add-wizard";
import { HistorySearchComponent } from "../src/modes/components/history-search";
import { MCPAddWizard } from "../src/modes/components/mcp-add-wizard";
import { ModelSelectorComponent } from "../src/modes/components/model-selector";
import { SessionSelectorComponent } from "../src/modes/components/session-selector";
import { TreeSelectorComponent } from "../src/modes/components/tree-selector";
import { initTheme } from "../src/modes/theme/theme";
import type { HistoryStorage } from "../src/session/history-storage";
import type { SessionInfo, SessionTreeNode } from "../src/session/session-manager";

beforeAll(() => {
	initTheme();
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
	vi.restoreAllMocks();
});

function createSession(id: string, title: string): SessionInfo {
	return {
		path: `/tmp/${id}.jsonl`,
		id,
		cwd: "/tmp",
		title,
		created: new Date("2024-01-01T00:00:00Z"),
		modified: new Date("2024-01-02T00:00:00Z"),
		messageCount: 1,
		firstMessage: `${title} first message`,
		allMessagesText: `${title} first message`,
	};
}

describe("component escape bindings", () => {
	it("honors the session back binding without treating Ctrl+C as menu exit", () => {
		const keybindings = KeybindingsManager.inMemory({
			"app.interrupt": "ctrl+c",
			"tui.select.cancel": "alt+x",
		});
		setKeybindings(keybindings);

		const onCancel = vi.fn();
		const onExit = vi.fn();
		const selector = new SessionSelectorComponent(
			[createSession("session-a", "Alpha"), createSession("session-b", "Beta")],
			() => {},
			onCancel,
			onExit,
		);

		selector.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();

		selector.handleInput("\x1bx");
		expect(onCancel).toHaveBeenCalledTimes(1);

		selector.handleInput("\x03");
		expect(onExit).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("clears an active session search before closing", () => {
		const onCancel = vi.fn();
		const selector = new SessionSelectorComponent(
			[createSession("session-a", "Alpha"), createSession("session-b", "Beta")],
			() => {},
			onCancel,
			() => {},
		);

		selector.handleInput("A");
		selector.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();
		selector.handleInput("\x1b");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("separates Back from Ctrl+C in context and MCP add wizards", () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"app.interrupt": "ctrl+c",
				"tui.select.cancel": "alt+x",
			}),
		);
		const contextCancel = vi.fn();
		const context = new ContextAddWizard(
			() => {},
			contextCancel,
			() => {},
		);
		const mcpCancel = vi.fn();
		const mcp = new MCPAddWizard(() => {}, mcpCancel);

		for (const component of [context, mcp]) {
			component.handleInput("\x03");
			component.handleInput("\x1b");
		}
		expect(contextCancel).not.toHaveBeenCalled();
		expect(mcpCancel).not.toHaveBeenCalled();

		context.handleInput("\x1bx");
		mcp.handleInput("\x1bx");
		expect(contextCancel).toHaveBeenCalledTimes(1);
		expect(mcpCancel).toHaveBeenCalledTimes(1);
	});

	it("clears history search before Back and never treats Ctrl+C as Back", () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"app.interrupt": "ctrl+c",
				"tui.select.cancel": "alt+x",
			}),
		);
		const onCancel = vi.fn();
		const storage = {
			getRecent: () => [{ id: 1, prompt: "Alpha", created_at: 1 }],
			search: () => [{ id: 1, prompt: "Alpha", created_at: 1 }],
		} as unknown as HistoryStorage;
		const component = new HistorySearchComponent(storage, () => {}, onCancel);

		component.handleInput("A");
		component.handleInput("\x03");
		component.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();
		component.handleInput("\x1bx");
		expect(onCancel).not.toHaveBeenCalled();
		component.handleInput("\x1bx");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("uses selector Back rather than app interruption in the tree", () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"app.interrupt": "ctrl+c",
				"tui.select.cancel": "alt+x",
			}),
		);
		const onCancel = vi.fn();
		const tree = [
			{
				entry: {
					type: "message",
					id: "root",
					parentId: null,
					timestamp: "2026-01-01T00:00:00.000Z",
					message: { role: "user", content: "Root" },
				},
				children: [],
			},
		] as unknown as SessionTreeNode[];
		const component = new TreeSelectorComponent(tree, "root", 24, () => {}, onCancel);

		component.handleInput("\x03");
		component.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();
		component.handleInput("\x1bx");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("uses tui.select.cancel for model selector cancellation", async () => {
		const keybindings = KeybindingsManager.inMemory({
			"tui.select.cancel": "ctrl+g",
		});
		setKeybindings(keybindings);

		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");
		}

		const settings = Settings.isolated({
			modelRoles: {
				default: `${model.provider}/${model.id}`,
			},
		});
		const modelRegistry = {
			getAll: () => [model],
			getDiscoverableProviders: () => [],
			getCanonicalModels: () => [],
			resolveCanonicalModel: () => undefined,
		} as unknown as ModelRegistry;
		const ui = {
			requestRender: vi.fn(),
		} as unknown as TUI;
		const onCancel = vi.fn();

		const selector = new ModelSelectorComponent(
			ui,
			model,
			settings,
			modelRegistry,
			[{ model, thinkingLevel: "off" }],
			() => {},
			onCancel,
		);

		await Bun.sleep(0);

		selector.handleInput("\x1b");
		expect(onCancel).not.toHaveBeenCalled();

		selector.handleInput("\x07");
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
