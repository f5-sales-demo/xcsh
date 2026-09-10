import { expect, test } from "bun:test";
import { type AssistantMessage, getBundledModel, type Message } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { agentLoop } from "../src/agent-loop";
import { AgentToolError } from "../src/tool-error";
import type { AgentEvent, AgentTool } from "../src/types";

async function execute(error: unknown, executionKind?: "command" | "fileChange") {
	const model = getBundledModel("openai", "gpt-4o-mini")!;
	const tool: AgentTool = {
		name: "fixture",
		label: "Fixture",
		description: "Fixture",
		parameters: Type.Object({}),
		executionKind,
		execute: async () => {
			throw error;
		},
	};
	let requests = 0;
	const events: AgentEvent[] = [];
	const stream = agentLoop(
		[{ role: "user", content: "Fixture", timestamp: 1 }],
		{ systemPrompt: "Fixture", messages: [], tools: [tool] },
		{ model, convertToLlm: messages => messages as Message[] },
		undefined,
		() => {
			const first = requests++ === 0;
			const out = new AssistantMessageEventStream();
			const message: AssistantMessage = {
				role: "assistant",
				api: model.api,
				provider: model.provider,
				model: model.id,
				timestamp: Date.now(),
				content: first
					? [{ type: "toolCall", id: "call-1", name: "fixture", arguments: {} }]
					: [{ type: "text", text: "Done" }],
				stopReason: first ? "toolUse" : "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(() => out.push({ type: "done", reason: first ? "toolUse" : "stop", message }));
			return out;
		},
	);
	for await (const event of stream) events.push(event);
	const messages = await stream.result();
	return { events, result: messages.find(message => message.role === "toolResult")! };
}

test.each(["command", "fileChange"] as const)(
	"structured %s failure keeps details, content and error status through execution and history",
	async kind => {
		const result = {
			content: [{ type: "text" as const, text: "Fixture failed output" }],
			details: { execution: { kind, exitCode: 7, durationMs: 23 }, fixture: "retained" },
		};
		const f = await execute(new AgentToolError("Fixture failure", result), kind);
		expect(f.result).toMatchObject({ ...result, isError: true });
		expect(f.events.find(event => event.type === "tool_execution_start")).toMatchObject({
			executionKind: kind,
			toolName: "fixture",
		});
		expect(f.events.find(event => event.type === "tool_execution_end")).toMatchObject({ result, isError: true });
	},
);

test("ordinary errors keep their established text result and no invented execution kind", async () => {
	const f = await execute(new Error("Ordinary failure"));
	expect(f.result).toMatchObject({
		content: [{ type: "text", text: "Ordinary failure" }],
		details: {},
		isError: true,
	});
	expect(f.events.find(event => event.type === "tool_execution_start")).not.toHaveProperty("executionKind");
});

test("arbitrary objects with a result field are not trusted as structured failures", async () => {
	const f = await execute({ result: { details: { invented: true } } });
	expect(f.result).toMatchObject({ details: {}, isError: true });
});
