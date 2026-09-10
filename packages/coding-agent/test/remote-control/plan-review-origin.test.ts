import { expect, test } from "bun:test";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import Ajv from "ajv";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import { SessionManager } from "../../src/session/session-manager";
import { UserInteractions, withPlanReviewInteraction } from "../../src/session/user-interactions";
import requestSchema from "./fixtures/ToolRequestUserInputParams.json";

const ajv = new Ajv({ strict: false });
ajv.addFormat("uint64", { type: "number", validate: Number.isSafeInteger });
const validRequest = ajv.compile(requestSchema);

test.each([
	{
		name: "completed plan",
		tool: "exit_plan_mode",
		error: false,
		sourceSession: "review",
		sourceCall: "call",
		allowed: true,
	},
	{ name: "unrelated tool", tool: "bash", error: false, sourceSession: "review", sourceCall: "call", allowed: false },
	{
		name: "failed plan",
		tool: "exit_plan_mode",
		error: true,
		sourceSession: "review",
		sourceCall: "call",
		allowed: false,
	},
	{
		name: "wrong session",
		tool: "exit_plan_mode",
		error: false,
		sourceSession: "departed",
		sourceCall: "call",
		allowed: false,
	},
	{
		name: "wrong call",
		tool: "exit_plan_mode",
		error: false,
		sourceSession: "review",
		sourceCall: "other",
		allowed: false,
	},
])("plan review provenance: $name", async fixture => {
	const manager = SessionManager.inMemory("/tmp/plan-origin");
	manager.appendMessage({ role: "user", content: "Plan fixture", timestamp: 1 });
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "toolCall", id: "call", name: fixture.tool, arguments: {} }],
		api: "openai-responses",
		provider: "openai-codex",
		model: "fixture",
		timestamp: 2,
		stopReason: "toolUse",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	} satisfies AssistantMessage);
	manager.appendMessage({
		role: "toolResult",
		toolCallId: "call",
		toolName: fixture.tool,
		content: [{ type: "text", text: "Fixture result" }],
		isError: fixture.error,
		timestamp: 3,
	});
	const broker = new UserInteractions();
	const remote = new RemoteSession({
		sessionId: "review",
		sessionManager: manager,
		messages: [],
		userInteractions: broker,
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	const ordinary = broker.request(
		{ kind: "select", title: "Ordinary completed tool", toolCallId: "call", options: ["Approve"] },
		() => new Promise(() => {}),
	);
	expect(remote.pendingRequests()).toEqual([]);
	const review = withPlanReviewInteraction(
		{
			sessionId: fixture.sourceSession,
			toolCallId: fixture.sourceCall,
			planFilePath: "local://PLAN.md",
			content: "# Complete plan\n\nUse only fixture.txt.",
		},
		() =>
			broker.request({ kind: "select", title: "Review", options: ["Approve", "Stay"] }, () => new Promise(() => {})),
	);
	try {
		expect(remote.pendingRequests()).toHaveLength(fixture.allowed ? 1 : 0);
		if (fixture.allowed) {
			const request = remote.pendingRequests()[0];
			expect(validRequest(request.params), JSON.stringify(validRequest.errors)).toBe(true);
			expect(request.params.questions).toMatchObject([
				{ question: expect.stringContaining("# Complete plan\n\nUse only fixture.txt.") },
			]);
		}
	} finally {
		broker.cancelAll();
		await Promise.all([ordinary, review]);
		await remote.close();
	}
});
