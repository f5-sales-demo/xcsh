import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Agent, type AgentMessage, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, getBundledModel, type Message } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import type { ApiCatalogPreflightIntent, ApiCatalogPreflightResult } from "../src/internal-urls/api-catalog-preflight";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";

class MockAssistantStream extends AssistantMessageEventStream {}

function assistant(text: string): AssistantMessage {
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

const result: ApiCatalogPreflightResult = {
	resource: "http_loadbalancer",
	domain: "virtual",
	queries: ["http load balancer"],
	catalogVersion: "6.0.2",
	searchUrls: ["xcsh://api-catalog/?search=http%20load%20balancer"],
	ranked: [
		{
			rank: 1,
			category: "http-loadbalancers",
			resource: "http_loadbalancer",
			domain: "virtual",
			catalogUrl: "xcsh://api-catalog/http-loadbalancers",
			resourceUrl: "xcsh://api-catalog/?resource=http_loadbalancer&compact=true",
			specUrl: "xcsh://api-spec/virtual?resource=http_loadbalancer",
		},
	],
	durationMs: 1.25,
};

describe("AgentSession API catalog preflight", () => {
	let auth: AuthStorage;
	let session: AgentSession | undefined;

	beforeEach(async () => {
		auth = await AuthStorage.create(":memory:");
		auth.setRuntimeApiKey("anthropic", "test-key");
	});

	afterEach(async () => {
		await session?.dispose();
		auth.close();
	});

	function createSession(
		preflight: (
			prompt: string,
			options: { toolsEnabled: boolean; previousResource?: ApiCatalogPreflightIntent },
		) => Promise<ApiCatalogPreflightResult | null>,
		onMessages?: (messages: Message[]) => void,
	) {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("fixture model unavailable");
		const read: AgentTool = {
			name: "read",
			label: "Read",
			description: "Read",
			parameters: Type.Object({ path: Type.String() }),
			execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		};
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [read], messages: [] },
			convertToLlm,
			streamFn: (_model, context) => {
				onMessages?.([...context.messages]);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: assistant("") });
					stream.push({ type: "done", reason: "stop", message: assistant("done") });
				});
				return stream;
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry: new ModelRegistry(auth),
			toolRegistry: new Map([["read", read]]),
			apiCatalogPreflight: async (prompt, options) => preflight(prompt, options),
		});
		return session;
	}

	it("injects api-catalog-preflight before the user prompt and first model inference", async () => {
		let providerMessages: Message[] = [];
		const current = createSession(
			async () => result,
			messages => {
				providerMessages = messages;
			},
		);
		await current.prompt("What is the F5 XC HTTP-LB route limit?");

		const transcript = current.messages as AgentMessage[];
		const preflightIndex = transcript.findIndex(
			message => message.role === "custom" && message.customType === "api-catalog-preflight",
		);
		const userIndex = transcript.findIndex(message => message.role === "user");
		expect(preflightIndex).toBeGreaterThanOrEqual(0);
		expect(preflightIndex).toBeLessThan(userIndex);
		expect(
			providerMessages.some(message => JSON.stringify(message).includes("xcsh://api-catalog/http-loadbalancers")),
		).toBe(true);
	});

	it("does not start model inference when classified preflight fails", async () => {
		let inferenceCalls = 0;
		const current = createSession(
			async () => {
				throw new Error("Local API catalog discovery failed: corrupt index");
			},
			() => {
				inferenceCalls++;
			},
		);
		await expect(current.prompt("What is the F5 XC HTTP-LB route limit?")).rejects.toThrow(
			"Local API catalog discovery failed: corrupt index",
		);
		expect(inferenceCalls).toBe(0);
	});

	it("offers only the immediately preceding recognized resource to the next turn", async () => {
		const observed: Array<string | undefined> = [];
		const current = createSession(async (prompt, options) => {
			observed.push(options.previousResource?.resource);
			return prompt.startsWith("First") ? result : null;
		});

		await current.prompt("First, inspect the F5 XC HTTP load balancer limit.");
		await current.prompt("Now discuss something unrelated.");
		await current.prompt("What is its maximum?");

		expect(observed).toEqual([undefined, "http_loadbalancer", undefined]);
	});

	it("clears the immediately preceding resource when a new session starts", async () => {
		const observed: Array<string | undefined> = [];
		const current = createSession(async (prompt, options) => {
			observed.push(options.previousResource?.resource);
			return prompt.startsWith("First") ? result : null;
		});

		await current.prompt("First, inspect the F5 XC HTTP load balancer limit.");
		expect(await current.newSession()).toBe(true);
		await current.prompt("What is its maximum?");

		expect(observed).toEqual([undefined, undefined]);
	});
});
