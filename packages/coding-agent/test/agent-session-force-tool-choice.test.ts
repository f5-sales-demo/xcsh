import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import type { InteractiveModeContext } from "../src/modes/types";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";
import { executeBuiltinSlashCommand } from "../src/slash-commands/builtin-registry";

class MockAssistantStream extends AssistantMessageEventStream {}

let tempDir: TempDir;
let authStorage: AuthStorage | undefined;
let session: AgentSession;
let modelCalls = 0;
let toolCalls = 0;

beforeEach(async () => {
	tempDir = TempDir.createSync("@pi-agent-session-force-tool-");
	modelCalls = toolCalls = 0;
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected claude-sonnet-4-5 model to exist");

	authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	const settings = Settings.isolated({ "compaction.enabled": false });
	const sessionManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "sessions"));

	const bashTool: AgentTool = {
		name: "bash",
		label: "Bash",
		description: "Mock bash tool",
		parameters: Type.Object({}),
		execute: async () => {
			toolCalls++;
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};
	const writeTool: AgentTool = {
		name: "write",
		label: "Write",
		description: "Mock write tool",
		parameters: Type.Object({}),
		execute: async () => {
			toolCalls++;
			return { content: [{ type: "text" as const, text: "ok" }] };
		},
	};

	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: "Test",
			tools: [bashTool, writeTool],
			messages: [],
		},
		convertToLlm,
		streamFn: () => {
			modelCalls++;
			return new MockAssistantStream();
		},
	});

	session = new AgentSession({
		agent,
		sessionManager,
		settings,
		modelRegistry,
		toolRegistry: new Map([
			[bashTool.name, bashTool],
			[writeTool.name, writeTool],
		]),
	});
});

afterEach(async () => {
	await session.dispose();
	authStorage?.close();
	authStorage = undefined;
	tempDir.removeSync();
});

it("forces specific tool, then transitions to none, then clears", () => {
	session.setForcedToolChoice("write");

	const first = session.nextToolChoice();
	const second = session.nextToolChoice();
	const third = session.nextToolChoice();

	expect(first).toEqual({ type: "tool", name: "write" });
	// After the forced call, "none" prevents the loop from making more tool calls
	expect(second).toBe("none");
	// After "none" is consumed, override clears entirely
	expect(third).toBeUndefined();
});

it("throws when forcing a non-active tool", () => {
	expect(() => session.setForcedToolChoice("read")).toThrow('Tool "read" is not currently active.');
});

it("menu and typed force commands queue real directives without running tools or writing session state", async () => {
	const manager = session.sessionManager;
	const file = Bun.file(manager.getSessionFile()!);
	const before = {
		entries: JSON.stringify(manager.getEntries()),
		file: (await file.exists()) ? await file.text() : null,
	};
	const selector = vi.fn(async () => "Cancel" as string | undefined);
	const ctx = {
		session,
		sessionManager: manager,
		editor: { setText: vi.fn() },
		showHookSelector: selector,
		showStatus: vi.fn(),
		showError: vi.fn(),
	} as unknown as InteractiveModeContext;
	const runtime = { ctx, handleBackgroundCommand() {} };
	await executeBuiltinSlashCommand("/force", runtime);
	expect(session.nextToolChoice()).toBeUndefined();
	selector.mockResolvedValue("Queue forced tool: write");
	for (const command of ["/force", "/force:write", "/force write"]) {
		await executeBuiltinSlashCommand(command, runtime);
		expect(session.nextToolChoice()).toEqual({ type: "tool", name: "write" });
		expect(session.nextToolChoice()).toBe("none");
		expect(session.nextToolChoice()).toBeUndefined();
	}
	await manager.flush();
	expect({
		entries: JSON.stringify(manager.getEntries()),
		file: (await file.exists()) ? await file.text() : null,
	}).toEqual(before);
	expect(modelCalls).toBe(0);
	expect(toolCalls).toBe(0);
	expect(ctx.showError).not.toHaveBeenCalled();
});

it("force preserves earlier queued directives and describes the actual queue order", async () => {
	session.toolChoiceQueue.pushOnce({ type: "tool", name: "bash" });
	const ctx = {
		session,
		editor: { setText: vi.fn() },
		showStatus: vi.fn(),
		showError: vi.fn(),
	} as unknown as InteractiveModeContext;
	await executeBuiltinSlashCommand("/force write", { ctx, handleBackgroundCommand() {} });
	expect(session.nextToolChoice()).toEqual({ type: "tool", name: "bash" });
	expect(session.nextToolChoice()).toEqual({ type: "tool", name: "write" });
	expect(session.nextToolChoice()).toBe("none");
	expect(ctx.showStatus).toHaveBeenCalledWith(
		"Queued write once, then no tools. Earlier queued directives may run first; no tool has run yet.",
	);
});

it("a tool removed while the force chooser is open cannot be queued", async () => {
	const choice = Promise.withResolvers<string | undefined>();
	const ctx = {
		session,
		sessionManager: session.sessionManager,
		editor: { setText: vi.fn() },
		showHookSelector: () => choice.promise,
		showStatus: vi.fn(),
		showError: vi.fn(),
	} as unknown as InteractiveModeContext;
	const pending = executeBuiltinSlashCommand("/force", { ctx, handleBackgroundCommand() {} });
	session.agent.setTools([session.getToolByName("bash")!]);
	choice.resolve("Queue forced tool: write");
	await pending;
	expect(session.nextToolChoice()).toBeUndefined();
	expect(ctx.showError).toHaveBeenCalledWith('Tool "write" is not currently active.');
	expect(modelCalls).toBe(0);
	expect(toolCalls).toBe(0);
});
