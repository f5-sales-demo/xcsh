import { expect, test } from "bun:test";
import { Agent, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type ToolChoice } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { parseArgs } from "../../src/cli/args";
import { runPrintMode } from "../../src/modes/print-mode";
import type { AgentSession } from "../../src/session/agent-session";
import { ToolChoiceQueue } from "../../src/session/tool-choice-queue";

test("required print prompts execute a tool once and allow the final model turn", async () => {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Fixture model unavailable");
	const queue = new ToolChoiceQueue();
	const choices: (ToolChoice | undefined)[] = [];
	let executions = 0;
	const tool: AgentTool = {
		name: "fixture",
		label: "Fixture",
		description: "Return a fixture result",
		parameters: Type.Object({}),
		execute: async () => {
			executions++;
			return { content: [{ type: "text", text: "42" }] };
		},
	};
	const agent = new Agent({
		initialState: { model, systemPrompt: "Fixture", tools: [tool], messages: [] },
		getApiKey: () => "fixture-key",
		getToolChoice: () => queue.nextToolChoice(),
		streamFn: (_model, _context, options) => {
			choices.push(options?.toolChoice);
			const latest = _context.messages.at(-1);
			const corrective =
				latest?.role === "user" && JSON.stringify(latest.content).includes("previous reply did not execute");
			const forced = options?.toolChoice === "required" || corrective;
			const message: AssistantMessage = {
				role: "assistant",
				api: model.api,
				provider: model.provider,
				model: model.id,
				content: forced
					? [{ type: "toolCall", id: `call-${choices.length}`, name: "fixture", arguments: {} }]
					: [{ type: "text", text: "OK" }],
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: forced ? "toolUse" : "stop",
				timestamp: Date.now(),
			};
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "done", reason: message.stopReason as "toolUse" | "stop", message });
			stream.end(message);
			return stream;
		},
	});
	agent.subscribe(event => {
		if (event.type === "turn_end") queue.resolve();
	});
	const session = {
		sessionManager: { getHeader: () => null, ensureOnDisk: async () => {} },
		model,
		thinkingLevel: undefined,
		extensionRunner: undefined,
		state: agent.state,
		toolChoiceQueue: queue,
		getActiveToolNames: () => [tool.name],
		subscribe: (callback: Parameters<typeof agent.subscribe>[0]) => agent.subscribe(callback),
		prompt: (text: string) => agent.prompt(text),
	} as unknown as AgentSession;
	const parsed = parseArgs(["--mode", "json", "--require-tool-call", "fixture"]);
	expect(parsed.requireToolCall).toBe(true);
	expect(
		await runPrintMode(session, {
			mode: "json",
			requireToolCall: parsed.requireToolCall,
			initialMessage: "first",
			messages: ["second"],
		}),
	).toBe(0);
	expect(executions).toBe(2);
	expect(choices).toEqual(["required", undefined, "required", undefined]);
	expect(queue.inspect()).toHaveLength(0);
	expect(await runPrintMode(session, { mode: "json", initialMessage: "ordinary text request" })).toBe(0);
	expect(executions).toBe(2);
	expect(choices.at(-1)).toBeUndefined();
	const automaticOnly = { ...model, compat: { ...model.compat, supportsToolChoice: false } };
	(session as unknown as { model: typeof model }).model = automaticOnly;
	agent.setModel(automaticOnly);
	const start = choices.length;
	expect(
		await runPrintMode(session, { mode: "json", requireToolCall: true, initialMessage: "automatic-only provider" }),
	).toBe(0);
	expect(executions).toBe(3);
	expect(choices.slice(start)).toEqual([undefined, undefined, undefined]);
});

test("required print mode rejects a provider that answers without executing tools", async () => {
	let invoked = 0;
	const session = {
		sessionManager: { getHeader: () => null, ensureOnDisk: async () => {} },
		model: undefined,
		thinkingLevel: undefined,
		extensionRunner: undefined,
		getActiveToolNames: () => ["fixture"],
		toolChoiceQueue: new ToolChoiceQueue(),
		subscribe: () => () => {},
		prompt: async () => {
			invoked++;
		},
		state: { messages: [] },
	} as unknown as AgentSession;
	expect(await runPrintMode(session, { mode: "json", requireToolCall: true, initialMessage: "fixture" })).toBe(1);
	expect(invoked).toBe(3);
});
