import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentMessage, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type TextContent, type ToolCall } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";
import type { ToolSession } from "../src/tools";
import { TodoWriteTool } from "../src/tools";

class MockAssistantStream extends AssistantMessageEventStream {}

type ObservedPromptCall = {
	toolChoice: string | undefined;
	toolNames: string[];
	messageRoles: AgentMessage["role"][];
	messageTexts: string[];
	lastMessageRole: AgentMessage["role"];
	lastMessageText: string;
};

function isTextContentBlock(value: unknown): value is TextContent {
	if (!value || typeof value !== "object") return false;
	return (value as TextContent).type === "text" && typeof (value as TextContent).text === "string";
}

function getToolChoiceName(choice: unknown): string | undefined {
	if (!choice) return undefined;
	if (typeof choice === "string") return choice;
	if (typeof choice !== "object" || !("type" in choice)) return undefined;
	const toolChoice = choice as { type?: string; name?: string; function?: { name?: string } };
	if (toolChoice.type === "tool") return toolChoice.name;
	if (toolChoice.type === "function") return toolChoice.name ?? toolChoice.function?.name;
	return undefined;
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createToolCallAssistantMessage(name: string, args: Record<string, unknown>): AssistantMessage {
	const toolCall: ToolCall = {
		type: "toolCall",
		id: `call_${name}`,
		name,
		arguments: args,
	};
	return {
		role: "assistant",
		content: [toolCall],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function getMessageText(message: AgentMessage): string {
	if (!("content" in message)) {
		return "";
	}
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.filter(isTextContentBlock)
		.map(content => content.text)
		.join("\n");
}

describe("AgentSession natural openings", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let streamCallCount = 0;
	let scriptedResponses: AssistantMessage[] = [];
	let authStorage: AuthStorage | undefined;
	const observedCalls: ObservedPromptCall[] = [];

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-agent-session-eager-todo-");
		streamCallCount = 0;
		scriptedResponses = [];
		observedCalls.length = 0;

		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 model to exist");

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"todo.enabled": true,
			...{ "todo.eager": true, "todo.reminders": true },
		});
		const sessionManager = SessionManager.inMemory(tempDir.path());

		const toolSession: ToolSession = {
			cwd: tempDir.path(),
			hasUI: false,
			getSessionFile: () => sessionManager.getSessionFile() ?? null,
			getSessionSpawns: () => "*",
			settings,
		};
		const todoWriteTool = new TodoWriteTool(toolSession);
		const mockBashTool: AgentTool = {
			name: "bash",
			label: "Bash",
			description: "Mock bash tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		};

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [todoWriteTool, mockBashTool],
				messages: [],
			},
			convertToLlm,
			getToolChoice: () => session?.nextToolChoice(),
			streamFn: (_model, context, options) => {
				streamCallCount++;
				const lastMessage = context.messages.at(-1);
				if (!lastMessage) {
					throw new Error("Expected prompt context to include a message");
				}
				observedCalls.push({
					toolChoice: getToolChoiceName(options?.toolChoice),
					toolNames: (context.tools ?? []).map(tool => tool.name),
					messageRoles: context.messages.map(message => message.role),
					messageTexts: context.messages.map(message => getMessageText(message)),
					lastMessageRole: lastMessage.role,
					lastMessageText: getMessageText(lastMessage),
				});
				const response = scriptedResponses.shift() ?? createAssistantMessage("done");
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: response });
					const reason =
						response.stopReason === "toolUse" || response.stopReason === "length" ? response.stopReason : "stop";
					stream.push({ type: "done", reason, message: response });
				});
				return stream;
			},
		});

		const toolRegistry = new Map<string, AgentTool>([
			[todoWriteTool.name, todoWriteTool as unknown as AgentTool],
			[mockBashTool.name, mockBashTool],
		]);

		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			toolRegistry,
		});
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
		}
		authStorage?.close();
		authStorage = undefined;
		tempDir.removeSync();
	});

	for (const text of [
		"hello",
		"help me",
		"why is the sky blue",
		"list all work trees",
		"list all work trees?",
		"list all work trees!",
		"列出所有工作树",
		"wypisz wszystkie drzewa robocze",
		"refactor the parser and add regression tests",
		"please create a TODO list",
	]) {
		it(`leaves opening tool choice to the model: ${text}`, async () => {
			await session.prompt(text);
			expect(observedCalls).toHaveLength(1);
			expect(observedCalls[0]?.toolChoice).toBeUndefined();
			expect(observedCalls[0]?.messageTexts).toEqual([text]);
			expect(session.getTodoPhases()).toEqual([]);
		});
	}

	it("keeps model-selected TODOs without restarting solely for incomplete tasks", async () => {
		scriptedResponses = [
			createToolCallAssistantMessage("todo_write", {
				ops: [{ op: "replace", phases: [{ name: "Work", tasks: [{ content: "Await a material decision" }] }] }],
			}),
			createAssistantMessage("Which repository should I use?"),
		];
		await session.prompt("help implement the changes");
		await session.waitForIdle();
		expect(streamCallCount).toBe(2);
		expect(observedCalls.every(call => call.toolChoice === undefined)).toBe(true);
		expect(session.getTodoPhases()).toHaveLength(1);
		expect(session.messages.some(message => getMessageText(message).includes("You stopped with"))).toBe(false);
	});
	it("defaults to Default mode, honors explicit Plan Mode, and returns to implementation", async () => {
		expect(session.getPlanModeState()?.enabled ?? false).toBe(false);
		session.setPlanModeState({ enabled: true });
		await session.prompt("plan the parser repair");
		expect(observedCalls[0]?.toolChoice).toBeUndefined();
		expect(session.getPlanModeState()?.enabled).toBe(true);
		session.setPlanModeState(undefined);
		await session.prompt("implement the approved repair");
		expect(observedCalls[1]?.toolChoice).toBeUndefined();
		expect(session.getPlanModeState()).toBeUndefined();
		const execution = observedCalls[1]!;
		expect(execution.messageTexts.some(text => text.includes("# Collaboration Mode: Default"))).toBe(true);
		expect(
			execution.messageRoles[
				execution.messageTexts.findIndex(text => text.includes("# Collaboration Mode: Default"))
			],
		).toBe("developer");
	});
	it("supersedes restored Plan instructions when the persisted mode is Default", async () => {
		session.sessionManager.appendModeChange("plan");
		session.sessionManager.appendCustomMessageEntry("plan-mode-context", "# Collaboration Mode: Plan", false);
		session.sessionManager.appendModeChange("none");
		await session.prompt("execute the agreed task");
		const execution = observedCalls[0]!;
		const index = execution.messageTexts.findIndex(text => text.includes("# Collaboration Mode: Default"));
		expect(index).toBeGreaterThanOrEqual(0);
		expect(execution.messageRoles[index]).toBe("developer");
		expect(execution.lastMessageText).toBe("execute the agreed task");
	});
});

it("converts collaboration-mode context into a developer instruction", () => {
	const result = convertToLlm([
		{
			role: "custom",
			customType: "collaboration-mode",
			content: "# Collaboration Mode: Default",
			display: false,
			timestamp: 1,
		},
	]);
	expect(result[0]?.role).toBe("developer");
});
