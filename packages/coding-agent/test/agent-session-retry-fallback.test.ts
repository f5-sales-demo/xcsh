import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent, type AgentTool } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, Effort, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
import { streamOpenAICodexResponses } from "@f5-sales-demo/pi-ai/providers/openai-codex-responses";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { TempDir } from "@f5-sales-demo/pi-utils";
import { Type } from "@sinclair/typebox";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { AgentSession, type AgentSessionEvent } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

class MockAssistantStream extends AssistantMessageEventStream {}

function createAssistantMessage(
	model: Model,
	options: { text?: string; stopReason: "stop" | "error"; errorMessage?: string },
): AssistantMessage {
	return {
		role: "assistant",
		content: options.text ? [{ type: "text", text: options.text }] : [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: options.stopReason,
		errorMessage: options.errorMessage,
		timestamp: Date.now(),
	};
}

async function _waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(10);
	}
	throw new Error("Timed out waiting for condition");
}

type AutoRetryStartEvent = Extract<AgentSessionEvent, { type: "auto_retry_start" }>;
type AutoRetryEndEvent = Extract<AgentSessionEvent, { type: "auto_retry_end" }>;

function trackRetryEvents(session: AgentSession): {
	retryStartEvents: AutoRetryStartEvent[];
	retryEndEvents: AutoRetryEndEvent[];
} {
	const retryStartEvents: AutoRetryStartEvent[] = [];
	const retryEndEvents: AutoRetryEndEvent[] = [];
	session.subscribe(event => {
		if (event.type === "auto_retry_start") {
			retryStartEvents.push(event);
		}
		if (event.type === "auto_retry_end") {
			retryEndEvents.push(event);
		}
	});
	return { retryStartEvents, retryEndEvents };
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage {
	const lastMessage = session.messages.at(-1);
	if (lastMessage?.role !== "assistant") {
		throw new Error("Expected final assistant message");
	}
	return lastMessage;
}

describe("AgentSession retry fallback", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-retry-fallback-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "anthropic-test-key");
		authStorage.setRuntimeApiKey("litellm", "litellm-test-key");
		authStorage.setRuntimeApiKey("openai", "openai-test-key");
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
			session = undefined;
		}
		authStorage.close();
		tempDir.removeSync();
	});

	it("recovers Codex transport inside a session with auto-retry disabled", async () => {
		const model = getBundledModel("openai-codex", "gpt-6.1-sol");
		if (!model) throw new Error("Expected Sol model");
		const originalFetch = global.fetch;
		const token = `test.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic" } })).toBase64()}.test`;
		authStorage.setRuntimeApiKey("openai-codex", token);
		let attempts = 0;
		const bodies: string[] = [];
		const failure =
			"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
		const agent = new Agent({
			getApiKey: () => token,
			initialState: { model, systemPrompt: "Synthetic", tools: [], messages: [] },
			streamFn: (requestedModel, context, options) =>
				streamOpenAICodexResponses(requestedModel as Model<"openai-codex-responses">, context, {
					...options,
					apiKey: token,
					preferWebsockets: false,
				}),
		});
		const settings = Settings.isolated({ "compaction.enabled": false, "retry.enabled": false });
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
		const retryEvents = trackRetryEvents(session);
		global.fetch = (async (_url: unknown, init?: RequestInit) => {
			attempts += 1;
			bodies.push(String(init?.body));
			if (attempts === 1)
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error(failure));
						},
					}),
				);
			return new Response(
				`data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "message", id: "answer", role: "assistant", content: [] } })}\n\ndata: ${JSON.stringify({ type: "response.output_item.done", item: { type: "message", id: "answer", role: "assistant", content: [{ type: "output_text", text: "Recovered" }] } })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
			);
		}) as typeof fetch;
		try {
			await session.prompt("Synthetic request");
			await session.waitForIdle();
			expect(attempts).toBe(2);
			expect(bodies[1]).toBe(bodies[0]);
			expect(getLastAssistantMessage(session)).toMatchObject({ model: "gpt-6.1-sol", stopReason: "stop" });
			expect(session.messages.filter(message => message.role === "assistant")).toHaveLength(1);
			expect(retryEvents.retryStartEvents).toHaveLength(0);
			expect(settings.get("retry.enabled")).toBe(false);
		} finally {
			global.fetch = originalFetch;
		}
	});

	it("advances through a role-keyed fallback chain across retries", async () => {
		const primaryModel = getBundledModel("anthropic", "claude-sonnet-4-5");
		const firstFallback = getBundledModel("openai", "gpt-4o-mini");
		const secondFallback = getBundledModel("openai", "gpt-4o");
		if (!primaryModel || !firstFallback || !secondFallback) {
			throw new Error("Expected bundled test models to exist");
		}

		const requestedModels: string[] = [];
		const retryStartEvents: Array<Extract<AgentSessionEvent, { type: "auto_retry_start" }>> = [];
		const retryEndEvents: Array<Extract<AgentSessionEvent, { type: "auto_retry_end" }>> = [];
		const fallbackAppliedEvents: Array<Extract<AgentSessionEvent, { type: "retry_fallback_applied" }>> = [];
		const fallbackSucceededEvents: Array<Extract<AgentSessionEvent, { type: "retry_fallback_succeeded" }>> = [];

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model: primaryModel,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: model => {
				requestedModels.push(`${model.provider}/${model.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (model.provider === primaryModel.provider && model.id === primaryModel.id) {
						const message = createAssistantMessage(model, {
							stopReason: "error",
							errorMessage: "overloaded_error: provider returned error 503",
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					if (model.provider === firstFallback.provider && model.id === firstFallback.id) {
						const message = createAssistantMessage(model, {
							stopReason: "error",
							errorMessage: "service unavailable: 503 overloaded",
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					if (model.provider === secondFallback.provider && model.id === secondFallback.id) {
						const message = createAssistantMessage(model, {
							text: "Recovered on second fallback",
							stopReason: "stop",
						});
						stream.push({
							type: "start",
							partial: createAssistantMessage(model, { text: "", stopReason: "stop" }),
						});
						stream.push({ type: "done", reason: "stop", message });
						return;
					}
					throw new Error(`Unexpected model requested during retry fallback test: ${model.provider}/${model.id}`);
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.fallbackChains": {
				default: [
					`${firstFallback.provider}/${firstFallback.id}`,
					`${secondFallback.provider}/${secondFallback.id}`,
				],
			},
		});
		settings.setModelRole("default", `${primaryModel.provider}/${primaryModel.id}`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});

		session.subscribe(event => {
			if (event.type === "auto_retry_start") {
				retryStartEvents.push(event);
			}
			if (event.type === "auto_retry_end") {
				retryEndEvents.push(event);
			}
			if (event.type === "retry_fallback_applied") {
				fallbackAppliedEvents.push(event);
			}
			if (event.type === "retry_fallback_succeeded") {
				fallbackSucceededEvents.push(event);
			}
		});

		await session.prompt("Recover from rate limits");
		await session.waitForIdle();

		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${firstFallback.provider}/${firstFallback.id}`,
			`${secondFallback.provider}/${secondFallback.id}`,
		]);
		expect(session.model?.provider).toBe(secondFallback.provider);
		expect(session.model?.id).toBe(secondFallback.id);
		expect(retryStartEvents.map(event => event.delayMs)).toEqual([0, 0]);
		expect(fallbackAppliedEvents).toEqual([
			{
				type: "retry_fallback_applied",
				from: `${primaryModel.provider}/${primaryModel.id}`,
				to: `${firstFallback.provider}/${firstFallback.id}`,
				role: "default",
			},
			{
				type: "retry_fallback_applied",
				from: `${firstFallback.provider}/${firstFallback.id}`,
				to: `${secondFallback.provider}/${secondFallback.id}`,
				role: "default",
			},
		]);
		expect(retryEndEvents).toHaveLength(1);
		expect(retryEndEvents[0]).toMatchObject({ success: true, attempt: 2 });
		expect(fallbackSucceededEvents).toEqual([
			{
				type: "retry_fallback_succeeded",
				model: `${secondFallback.provider}/${secondFallback.id}`,
				role: "default",
			},
		]);
	});

	it.each([false, true])(
		"unclassified voice failure preserves selected model without automatic replay when call closed=%s",
		async closeDuringTurn => {
			const primary = getBundledModel("openai", "gpt-4o-mini")!;
			const fallback = getBundledModel("openai", "gpt-4o")!;
			const requested: string[] = [];
			let attempts = 0;
			let activeSession: AgentSession;
			const agent = new Agent({
				getApiKey: provider => `${provider}-test-key`,
				initialState: { model: primary, systemPrompt: "Synthetic", tools: [], messages: [] },
				streamFn: model => {
					requested.push(`${model.provider}/${model.id}`);
					const out = new MockAssistantStream();
					queueMicrotask(() => {
						attempts++;
						if (attempts === 1) {
							if (closeDuringTurn) activeSession.setRealtimeMode(false, {});
							const error = createAssistantMessage(model, {
								stopReason: "error",
								errorMessage: "overloaded_error: provider returned error 503",
							});
							out.push({ type: "start", partial: error });
							out.push({ type: "error", reason: "error", error });
						} else {
							const message = createAssistantMessage(model, {
								text: "Recovered on selected model",
								stopReason: "stop",
							});
							out.push({ type: "done", reason: "stop", message });
						}
					});
					return out;
				},
			});
			const settings = Settings.isolated({
				"compaction.enabled": false,
				"retry.baseDelayMs": 1,
				"retry.fallbackChains": { default: [`${fallback.provider}/${fallback.id}`] },
			});
			settings.setModelRole("default", `${primary.provider}/${primary.id}`);
			session = activeSession = new AgentSession({
				agent,
				sessionManager: SessionManager.inMemory(),
				settings,
				modelRegistry,
			});
			session.setRealtimeMode(true, {});
			await session.prompt("Synthetic voice request");
			await session.waitForIdle();
			expect(requested).toEqual([`${primary.provider}/${primary.id}`]);
			expect(session.model?.id).toBe(primary.id);
		},
	);

	it("voice retries one exact classified read and preserves completed mutation effects", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		let writes = 0;
		let reads = 0;
		let requests = 0;
		const allowances: (number | undefined)[] = [];
		const write: AgentTool = {
			name: "synthetic_write",
			label: "Write",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "mutation",
			async execute() {
				writes++;
				return { content: [{ type: "text", text: "written" }] };
			},
		};
		const read: AgentTool = {
			name: "synthetic_read",
			label: "Read",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "readOnly",
			async execute() {
				reads++;
				if (reads === 1) throw Object.assign(new Error("Synthetic failed read"), { code: "EIO" });
				return { content: [{ type: "text", text: "read" }] };
			},
		};
		const agent = new Agent({
			getApiKey: () => "synthetic-key",
			initialState: { model, systemPrompt: "Synthetic", tools: [write, read], messages: [] },
			streamFn: (m, _context, options) => {
				allowances.push(options?.maxRetries);
				const out = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(m, {
						text: requests++ ? "verified" : undefined,
						stopReason: "stop",
					});
					if (requests === 1) {
						message.content = [
							{ type: "toolCall", id: "write-op", name: write.name, arguments: {} },
							{ type: "toolCall", id: "read-op", name: read.name, arguments: {} },
						];
						message.stopReason = "toolUse";
					}
					out.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
				});
				return out;
			},
		});
		session = new AgentSession({
			agent,
			settings: Settings.isolated({ "compaction.enabled": false }),
			sessionManager: SessionManager.inMemory(),
			modelRegistry,
		});
		session.setRealtimeMode(true, {});
		await session.prompt("Synthetic voice operation");
		await session.waitForIdle();
		expect(writes).toBe(1);
		expect(reads).toBe(2);
		expect(allowances).toEqual([0, 0]);
		const operations = session.sessionManager
			.getEntries()
			.filter(e => e.type === "custom" && e.customType === "voice-operation")
			.map(e => (e as any).data);
		expect(operations.filter(e => e.effect === "readOnly" && e.outcome === "completed")).toHaveLength(1);
		expect(operations.filter(e => e.effect === "mutation" && e.outcome === "completed")).toHaveLength(1);
	});

	it("voice context change after a failed read prevents retry on a new target", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		let writes = 0;
		let reads = 0;
		let requests = 0;
		const admittedContexts: unknown[] = [];
		const allowances: (number | undefined)[] = [];
		const write: AgentTool = {
			name: "synthetic_write",
			label: "Write",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "mutation",
			async execute() {
				writes++;
				return { content: [{ type: "text", text: "written" }] };
			},
		};
		const read: AgentTool = {
			name: "synthetic_read",
			label: "Read",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "readOnly",
			async execute() {
				reads++;
				admittedContexts.push(session!.settings.get("bash.environment").XCSH_CONTEXT_NAME);
				if (reads === 1) {
					session!.settings.override("bash.environment", { XCSH_CONTEXT_NAME: "example-partners" });
					throw Object.assign(new Error("Synthetic failed read"), { code: "EIO" });
				}
				return { content: [{ type: "text", text: "read" }] };
			},
		};
		const agent = new Agent({
			getApiKey: () => "synthetic-key",
			initialState: { model, systemPrompt: "Synthetic", tools: [write, read], messages: [] },
			streamFn: (m, _context, options) => {
				allowances.push(options?.maxRetries);
				const out = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(m, {
						text: requests++ ? "verified" : undefined,
						stopReason: "stop",
					});
					if (requests === 1) {
						message.content = [
							{ type: "toolCall", id: "write-op", name: write.name, arguments: {} },
							{ type: "toolCall", id: "read-op", name: read.name, arguments: {} },
						];
						message.stopReason = "toolUse";
					}
					out.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
				});
				return out;
			},
		});
		session = new AgentSession({
			agent,
			settings: Settings.isolated({
				"compaction.enabled": false,
				"bash.environment": { XCSH_CONTEXT_NAME: "original-context" },
			}),
			sessionManager: SessionManager.inMemory(),
			modelRegistry,
		});
		session.setRealtimeMode(true, {});
		await session.prompt("Synthetic voice operation");
		await session.waitForIdle();
		expect(writes).toBe(1);
		expect(reads).toBe(1);
		expect(admittedContexts).toEqual(["original-context"]);
		expect(session.settings.get("bash.environment").XCSH_CONTEXT_NAME).toBe("example-partners");
		expect(allowances).toEqual([0, 0]);
		const operations = session.sessionManager
			.getEntries()
			.filter(e => e.type === "custom" && e.customType === "voice-operation")
			.map(e => (e as any).data);
		expect(operations.filter(e => e.effect === "readOnly" && e.outcome === "failed")).toHaveLength(1);
		expect(operations.filter(e => e.effect === "mutation" && e.outcome === "completed")).toHaveLength(1);
	});

	it("voice task restores a persisted spent retry without repeating the failed read", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		let writes = 0;
		let reads = 0;
		let requests = 0;
		const allowances: (number | undefined)[] = [];
		const write: AgentTool = {
			name: "synthetic_write",
			label: "Write",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "mutation",
			async execute() {
				writes++;
				return { content: [{ type: "text", text: "written" }] };
			},
		};
		const read: AgentTool = {
			name: "synthetic_read",
			label: "Read",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "readOnly",
			async execute() {
				reads++;
				if (reads === 1) throw Object.assign(new Error("Synthetic failed read"), { code: "EIO" });
				return { content: [{ type: "text", text: "read" }] };
			},
		};
		const agent = new Agent({
			getApiKey: () => "synthetic-key",
			initialState: { model, systemPrompt: "Synthetic", tools: [write, read], messages: [] },
			streamFn: (m, _context, options) => {
				allowances.push(options?.maxRetries);
				const out = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(m, {
						text: requests++ ? "verified" : undefined,
						stopReason: "stop",
					});
					if (requests === 1) {
						message.content = [
							{ type: "toolCall", id: "write-op", name: write.name, arguments: {} },
							{ type: "toolCall", id: "read-op", name: read.name, arguments: {} },
						];
						message.stopReason = "toolUse";
					}
					out.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
				});
				return out;
			},
		});
		session = new AgentSession({
			agent,
			settings: Settings.isolated({ "compaction.enabled": false }),
			sessionManager: SessionManager.inMemory(),
			modelRegistry,
		});
		session.sessionManager.appendCustomEntry("voice-operation", {
			kind: "voiceRetryReserved",
			taskId: "synthetic-task",
		});
		session.setVoiceTaskIdentity("synthetic-task", "synthetic-delegation");
		session.setRealtimeMode(true, {});
		await session.prompt("Synthetic voice operation");
		await session.waitForIdle();
		expect(writes).toBe(1);
		expect(reads).toBe(1);
		expect(allowances).toEqual([0, 0]);
		const operations = session.sessionManager
			.getEntries()
			.filter(e => e.type === "custom" && e.customType === "voice-operation")
			.map(e => (e as any).data);
		expect(operations.filter(e => e.effect === "readOnly" && e.outcome === "failed")).toHaveLength(1);
		expect(operations.filter(e => e.effect === "mutation" && e.outcome === "completed")).toHaveLength(1);
	});

	it("voice task corrections persist increasing revisions on the same task", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		const agent = new Agent({ initialState: { model, tools: [], messages: [] } });
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry,
		});
		session.setVoiceTaskIdentity("task-fixture", "delegation-one");
		session.setVoiceTaskIdentity("task-fixture", "delegation-two");
		session.setVoiceTaskIdentity("task-fixture", "delegation-two");
		const records = session.sessionManager
			.getEntries()
			.filter(e => e.type === "custom" && e.customType === "voice-operation")
			.map(e => (e as any).data)
			.filter(e => e.kind === "voiceTaskDelegation");
		expect(records).toMatchObject([
			{ taskId: "task-fixture", delegationId: "delegation-one", revision: 1 },
			{ taskId: "task-fixture", delegationId: "delegation-two", revision: 2, supersedes: "delegation-one" },
		]);
	});

	it("reordered mutation arguments retain one operation identity", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		const tool: AgentTool = {
			name: "synthetic_mutation",
			label: "Write",
			description: "Synthetic",
			parameters: Type.Object({}),
			getOperationEffect: () => "mutation",
			execute: async () => ({ content: [] }),
		};
		const agent = new Agent({
			initialState: { model, tools: [], messages: [] },
			getApiKey: () => "synthetic-key",
			streamFn: m => {
				const out = new MockAssistantStream();
				queueMicrotask(() =>
					out.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage(m, { text: "synthetic result", stopReason: "stop" }),
					}),
				);
				return out;
			},
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry,
		});
		session.setRealtimeMode(true, {});
		await session.prompt("Synthetic").catch(() => {});
		const invoke = (args: any) => agent.executeTool!(tool, "operation", args, undefined, undefined, undefined);
		await invoke({ a: 1, b: { x: 2, y: 3 } });
		await expect(invoke({ b: { y: 3, x: 2 }, a: 1 })).rejects.toThrow("already admitted");
	});

	it("active voice does not invoke automatic executor routing", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		let evaluated = 0;
		const agent = new Agent({
			getApiKey: () => "synthetic-key",
			initialState: { model, systemPrompt: "Synthetic", tools: [], messages: [] },
			streamFn: m => {
				const out = new MockAssistantStream();
				queueMicrotask(() =>
					out.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage(m, { text: "selected model result", stopReason: "stop" }),
					}),
				);
				return out;
			},
		});
		const settings = Settings.isolated({ "compaction.enabled": false, "routing.mode": "auto" });
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, settings, sessionManager: SessionManager.inMemory(), modelRegistry });
		session.routingCoordinator.evaluateTurn = async () => {
			evaluated++;
			throw new Error("Automatic routing must not run in voice");
		};
		session.setRealtimeMode(true, {});
		await session.prompt("Synthetic voice request");
		await session.waitForIdle();
		expect(evaluated).toBe(0);
		expect(session.model?.id).toBe(model.id);
	});

	it("typed turn after voice closure resumes automatic executor routing", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini")!;
		let evaluated = 0;
		const agent = new Agent({
			getApiKey: () => "synthetic-key",
			initialState: { model, systemPrompt: "Synthetic", tools: [], messages: [] },
			streamFn: m => {
				const out = new MockAssistantStream();
				queueMicrotask(() =>
					out.push({
						type: "done",
						reason: "stop",
						message: createAssistantMessage(m, { text: "done", stopReason: "stop" }),
					}),
				);
				return out;
			},
		});
		const settings = Settings.isolated({ "compaction.enabled": false, "routing.mode": "auto" });
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, settings, sessionManager: SessionManager.inMemory(), modelRegistry });
		session.routingCoordinator.evaluateTurn = async () => {
			evaluated++;
			throw new Error("Synthetic routing boundary");
		};
		session.setRealtimeMode(true, {});
		await session.prompt("Synthetic voice request");
		await session.waitForIdle();
		expect(evaluated).toBe(0);
		session.setRealtimeMode(false, {});
		await expect(session.prompt("Synthetic typed request")).rejects.toThrow("Synthetic routing boundary");
		expect(evaluated).toBe(1);
	});

	it("auto-retries preserved OpenAI first-event timeout errors", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) {
			throw new Error("Expected bundled OpenAI test model to exist");
		}

		const timeoutMessage = "OpenAI responses stream timed out while waiting for the first event";
		const requestedModels: string[] = [];
		let attemptCount = 0;

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					attemptCount += 1;
					if (attemptCount === 1) {
						const message = createAssistantMessage(requestedModel, {
							stopReason: "error",
							errorMessage: timeoutMessage,
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					if (attemptCount === 2) {
						const message = createAssistantMessage(requestedModel, {
							text: "Recovered after OpenAI timeout",
							stopReason: "stop",
						});
						stream.push({
							type: "start",
							partial: createAssistantMessage(requestedModel, { text: "", stopReason: "stop" }),
						});
						stream.push({ type: "done", reason: "stop", message });
						return;
					}
					throw new Error(`Unexpected retry attempt in timeout test: ${attemptCount}`);
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Retry preserved OpenAI timeout");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`, `${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryStartEvents[0]).toMatchObject({
			attempt: 1,
			maxAttempts: 1,
			errorMessage: timeoutMessage,
		});
		expect(retryEndEvents).toHaveLength(1);
		expect(retryEndEvents[0]).toMatchObject({ success: true, attempt: 1 });
		const lastAssistant = getLastAssistantMessage(session);
		expect(lastAssistant.stopReason).toBe("stop");
		expect(lastAssistant.content).toContainEqual({ type: "text", text: "Recovered after OpenAI timeout" });
	});

	it("auto-retries LiteLLM mid-stream fallback errors", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) {
			throw new Error("Expected bundled OpenAI test model to exist");
		}

		const midStreamFallbackError = "BadRequestError: litellm.MidStreamFallbackError: Server had an error. (HTTP 400)";
		const requestedModels: string[] = [];
		let attemptCount = 0;

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					attemptCount += 1;
					if (attemptCount === 1) {
						const message = createAssistantMessage(requestedModel, {
							stopReason: "error",
							errorMessage: midStreamFallbackError,
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					const message = createAssistantMessage(requestedModel, {
						text: "Recovered after LiteLLM mid-stream fallback",
						stopReason: "stop",
					});
					stream.push({ type: "start", partial: createAssistantMessage(requestedModel, { stopReason: "stop" }) });
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Retry LiteLLM mid-stream fallback");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`, `${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryStartEvents[0]).toMatchObject({
			attempt: 1,
			maxAttempts: 1,
			errorMessage: midStreamFallbackError,
		});
		expect(retryEndEvents).toHaveLength(1);
		expect(retryEndEvents[0]).toMatchObject({ success: true, attempt: 1 });
		expect(getLastAssistantMessage(session).content).toContainEqual({
			type: "text",
			text: "Recovered after LiteLLM mid-stream fallback",
		});
	});

	it("auto-retries the exact Bun socket-close transport error", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) {
			throw new Error("Expected bundled OpenAI test model to exist");
		}

		const midStreamFallbackError =
			"The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()";
		const requestedModels: string[] = [];
		let attemptCount = 0;

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					attemptCount += 1;
					if (attemptCount === 1) {
						const message = createAssistantMessage(requestedModel, {
							stopReason: "error",
							errorMessage: midStreamFallbackError,
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					const message = createAssistantMessage(requestedModel, {
						text: "Recovered after Bun socket close",
						stopReason: "stop",
					});
					stream.push({ type: "start", partial: createAssistantMessage(requestedModel, { stopReason: "stop" }) });
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Retry Bun socket close");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`, `${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryStartEvents[0]).toMatchObject({
			attempt: 1,
			maxAttempts: 1,
			errorMessage: midStreamFallbackError,
		});
		expect(retryEndEvents).toHaveLength(1);
		expect(retryEndEvents[0]).toMatchObject({ success: true, attempt: 1 });
		expect(getLastAssistantMessage(session).content).toContainEqual({
			type: "text",
			text: "Recovered after Bun socket close",
		});
	});

	it("does not retry ordinary LiteLLM HTTP 400 validation errors", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) {
			throw new Error("Expected bundled OpenAI test model to exist");
		}

		const validationError =
			"BadRequestError: HTTP 400 - {'error': {'message': 'messages[0].content is required', 'type': 'invalid_request_error'}}";
		let requestCount = 0;
		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
			streamFn: requestedModel => {
				requestCount += 1;
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(requestedModel, {
						stopReason: "error",
						errorMessage: validationError,
					});
					stream.push({ type: "start", partial: message });
					stream.push({ type: "error", reason: "error", error: message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Do not retry LiteLLM validation failure");
		await session.waitForIdle();

		expect(requestCount).toBe(1);
		expect(retryStartEvents).toHaveLength(0);
		expect(retryEndEvents).toHaveLength(0);
		expect(getLastAssistantMessage(session).errorMessage).toBe(validationError);
	});

	it("auto-retries Anthropic stream-envelope failures before message_start", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected bundled Anthropic test model to exist");
		}

		const envelopeError = "Anthropic stream envelope error: received content_block_start before message_start";
		const requestedModels: string[] = [];
		let attemptCount = 0;

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					attemptCount += 1;
					if (attemptCount === 1) {
						const message = createAssistantMessage(requestedModel, {
							stopReason: "error",
							errorMessage: envelopeError,
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					if (attemptCount === 2) {
						const message = createAssistantMessage(requestedModel, {
							text: "Recovered after Anthropic envelope retry",
							stopReason: "stop",
						});
						stream.push({
							type: "start",
							partial: createAssistantMessage(requestedModel, { text: "", stopReason: "stop" }),
						});
						stream.push({ type: "done", reason: "stop", message });
						return;
					}
					throw new Error(`Unexpected retry attempt in Anthropic envelope test: ${attemptCount}`);
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Retry Anthropic envelope failure before message_start");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`, `${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryStartEvents[0]).toMatchObject({
			attempt: 1,
			maxAttempts: 1,
			errorMessage: envelopeError,
		});
		expect(retryEndEvents).toHaveLength(1);
		expect(retryEndEvents[0]).toMatchObject({ success: true, attempt: 1 });
		const lastAssistant = getLastAssistantMessage(session);
		expect(lastAssistant.stopReason).toBe("stop");
		expect(lastAssistant.content).toContainEqual({ type: "text", text: "Recovered after Anthropic envelope retry" });
	});

	it("retries Anthropic stream-envelope failures before terminal stop signal", async () => {
		const primaryModel = getBundledModel("anthropic", "claude-sonnet-4-5");
		const fallbackModel = getBundledModel("openai", "gpt-4o-mini");
		if (!primaryModel || !fallbackModel) {
			throw new Error("Expected bundled test models to exist");
		}

		const envelopeError = "Anthropic stream envelope error: received content_block_delta before terminal stop signal";
		const requestedModels: string[] = [];
		const fallbackAppliedEvents: Array<Extract<AgentSessionEvent, { type: "retry_fallback_applied" }>> = [];
		const fallbackSucceededEvents: Array<Extract<AgentSessionEvent, { type: "retry_fallback_succeeded" }>> = [];

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model: primaryModel,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (requestedModel.provider === fallbackModel.provider && requestedModel.id === fallbackModel.id) {
						const message = createAssistantMessage(requestedModel, {
							text: "Recovered after discarded Anthropic stream",
							stopReason: "stop",
						});
						stream.push({
							type: "start",
							partial: createAssistantMessage(requestedModel, { stopReason: "stop" }),
						});
						stream.push({ type: "done", reason: "stop", message });
						return;
					}
					const message = createAssistantMessage(requestedModel, {
						text: "partial assistant content that must not persist",
						stopReason: "error",
						errorMessage: envelopeError,
					});
					stream.push({ type: "start", partial: message });
					stream.push({ type: "error", reason: "error", error: message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
			"retry.fallbackChains": {
				default: [`${fallbackModel.provider}/${fallbackModel.id}`],
			},
		});
		settings.setModelRole("default", `${primaryModel.provider}/${primaryModel.id}`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);
		session.subscribe(event => {
			if (event.type === "retry_fallback_applied") {
				fallbackAppliedEvents.push(event);
			}
			if (event.type === "retry_fallback_succeeded") {
				fallbackSucceededEvents.push(event);
			}
		});

		await session.prompt("Retry Anthropic envelope failure before terminal stop signal");
		await session.waitForIdle();

		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
		]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryEndEvents).toHaveLength(1);
		expect(fallbackAppliedEvents).toHaveLength(1);
		expect(fallbackSucceededEvents).toHaveLength(1);
		const lastAssistant = getLastAssistantMessage(session);
		expect(lastAssistant.stopReason).toBe("stop");
		expect(lastAssistant.content).toContainEqual({
			type: "text",
			text: "Recovered after discarded Anthropic stream",
		});
		expect(session.messages.filter(message => message.role === "assistant")).toHaveLength(1);
		expect(JSON.stringify(session.messages)).not.toContain("partial assistant content that must not persist");
	});

	it("retries a discarded LiteLLM tool envelope without exposing its placeholder", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) {
			throw new Error("Expected bundled OpenAI test model to exist");
		}

		const envelopeError = "BadRequestError: litellm.MidStreamFallbackError: Server had an error. (HTTP 400)";
		const requestedModels: string[] = [];
		const modelCallContexts: string[] = [];
		let attemptCount = 0;
		let toolExecutions = 0;
		const toolStartEvents: Array<Extract<AgentSessionEvent, { type: "tool_execution_start" }>> = [];
		const partialTool: AgentTool = {
			name: "partial_lookup",
			label: "Partial lookup",
			description: "Must never execute from a discarded stream.",
			parameters: Type.Object({}),
			execute: async () => {
				toolExecutions += 1;
				return { content: [{ type: "text", text: "unexpected execution" }] };
			},
		};

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [partialTool],
				messages: [],
			},
			streamFn: (requestedModel, context) => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				modelCallContexts.push(JSON.stringify(context.messages));
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					attemptCount += 1;
					if (attemptCount === 1) {
						const message: AssistantMessage = {
							...createAssistantMessage(requestedModel, { stopReason: "error", errorMessage: envelopeError }),
							content: [{ type: "toolCall", id: "tool_partial", name: "partial_lookup", arguments: {} }],
						};
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					const message = createAssistantMessage(requestedModel, {
						text: "Recovered without running the partial tool",
						stopReason: "stop",
					});
					stream.push({ type: "start", partial: createAssistantMessage(requestedModel, { stopReason: "stop" }) });
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		const sessionManager = SessionManager.inMemory();
		session = new AgentSession({ agent, sessionManager, settings, modelRegistry });
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);
		session.subscribe(event => {
			if (event.type === "tool_execution_start") {
				toolStartEvents.push(event);
			}
		});

		await session.prompt("Retry a discarded post-content tool envelope");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`, `${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryEndEvents).toHaveLength(1);
		expect(toolStartEvents).toHaveLength(0);
		expect(toolExecutions).toBe(0);
		expect(JSON.stringify(session.messages)).not.toContain("tool_partial");
		expect(modelCallContexts).toHaveLength(2);
		expect(modelCallContexts[1]).not.toContain("tool_partial");
		expect(
			sessionManager
				.getEntries()
				.some(
					entry =>
						entry.type === "message" &&
						entry.message.role === "toolResult" &&
						entry.message.toolCallId === "tool_partial",
				),
		).toBe(false);
		expect(getLastAssistantMessage(session).content).toContainEqual({
			type: "text",
			text: "Recovered without running the partial tool",
		});
	});

	it("surfaces terminal-envelope diagnostics after retry exhaustion", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected bundled Anthropic test model to exist");
		}

		const envelopeError =
			"Anthropic stream envelope error: stream ended before terminal stop signal (provider=anthropic, model=claude-sonnet-4-5, api=anthropic-messages, responseId=msg_retry_exhausted, lastEvent=content_block_delta)";
		const requestedModels: string[] = [];
		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(requestedModel, {
						text: "discarded partial assistant text",
						stopReason: "error",
						errorMessage: envelopeError,
					});
					stream.push({ type: "start", partial: message });
					stream.push({ type: "error", reason: "error", error: message });
				});
				return stream;
			},
		});
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Retry then surface stream-envelope diagnostics");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`, `${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(1);
		expect(retryEndEvents).toContainEqual({
			type: "auto_retry_end",
			success: false,
			attempt: 1,
			finalError: envelopeError,
		});
		const lastAssistant = getLastAssistantMessage(session);
		expect(lastAssistant.stopReason).toBe("error");
		expect(lastAssistant.errorMessage).toBe(envelopeError);
		expect(lastAssistant.errorMessage).toContain("responseId=msg_retry_exhausted");
		expect(lastAssistant.errorMessage).toContain("lastEvent=content_block_delta");
		expect(session.messages.filter(message => message.role === "assistant")).toHaveLength(1);
		expect(JSON.stringify(session.messages)).not.toContain("discarded partial assistant text");
	});

	it("does not auto-retry generic Request was aborted. errors", async () => {
		const model = getBundledModel("openai", "gpt-4o-mini");
		if (!model) {
			throw new Error("Expected bundled OpenAI test model to exist");
		}

		const requestedModels: string[] = [];
		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: requestedModel => {
				requestedModels.push(`${requestedModel.provider}/${requestedModel.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					const message = createAssistantMessage(requestedModel, {
						stopReason: "error",
						errorMessage: "Request was aborted.",
					});
					stream.push({ type: "start", partial: message });
					stream.push({ type: "error", reason: "error", error: message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.maxRetries": 1,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		const { retryStartEvents, retryEndEvents } = trackRetryEvents(session);

		await session.prompt("Do not retry generic abort text");
		await session.waitForIdle();

		expect(requestedModels).toEqual([`${model.provider}/${model.id}`]);
		expect(retryStartEvents).toHaveLength(0);
		expect(retryEndEvents).toHaveLength(0);
		const lastAssistant = getLastAssistantMessage(session);
		expect(lastAssistant.stopReason).toBe("error");
		expect(lastAssistant.errorMessage).toBe("Request was aborted.");
	});

	it.each(["provider returned error 429: credits_required", "provider returned error 403: obsolete_client"])(
		"does not auto-retry permanent Anthropic failure: %s",
		async errorMessage => {
			const model = getBundledModel("anthropic", "claude-fable-5-1");
			if (!model) throw new Error("Expected bundled Fable model to exist");
			let requestCount = 0;
			const agent = new Agent({
				getApiKey: () => "anthropic-test-key",
				initialState: { model, systemPrompt: "Test", tools: [], messages: [] },
				streamFn: requestedModel => {
					requestCount++;
					const stream = new MockAssistantStream();
					queueMicrotask(() => {
						const message = createAssistantMessage(requestedModel, { stopReason: "error", errorMessage });
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
					});
					return stream;
				},
			});
			const settings = Settings.isolated({
				"compaction.enabled": false,
				"retry.baseDelayMs": 5,
				"retry.maxRetries": 2,
			});
			settings.setModelRole("default", `${model.provider}/${model.id}`);
			session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
			const { retryStartEvents } = trackRetryEvents(session);

			await session.prompt("Do not retry permanent Anthropic errors");
			await session.waitForIdle();

			expect(requestCount).toBe(1);
			expect(retryStartEvents).toHaveLength(0);
		},
	);

	it("suppresses cooled selectors and lazily reverts to the role primary after cooldown expiry", async () => {
		const primaryModel = getBundledModel("anthropic", "claude-sonnet-5");
		const fallbackModel = getBundledModel("openai", "gpt-4o-mini");
		if (!primaryModel || !fallbackModel) {
			throw new Error("Expected bundled test models to exist");
		}

		const requestedModels: string[] = [];
		let primaryAttempts = 0;

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model: primaryModel,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: model => {
				requestedModels.push(`${model.provider}/${model.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (model.provider === primaryModel.provider && model.id === primaryModel.id && primaryAttempts === 0) {
						primaryAttempts += 1;
						const message = createAssistantMessage(model, {
							stopReason: "error",
							errorMessage: "rate limit exceeded retry-after-ms=200",
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					const message = createAssistantMessage(model, {
						text: `ok:${model.provider}/${model.id}`,
						stopReason: "stop",
					});
					stream.push({ type: "start", partial: createAssistantMessage(model, { text: "", stopReason: "stop" }) });
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.fallbackChains": {
				default: [`${fallbackModel.provider}/${fallbackModel.id}`],
			},
			"retry.fallbackRevertPolicy": "cooldown-expiry",
		});
		settings.setModelRole("default", `${primaryModel.provider}/${primaryModel.id}`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});

		await session.prompt("First prompt triggers fallback");
		await session.waitForIdle();
		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
		]);
		expect(session.model?.provider).toBe(fallbackModel.provider);
		expect(session.model?.id).toBe(fallbackModel.id);

		await session.prompt("Immediate second prompt should stay on fallback");
		await session.waitForIdle();
		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
		]);
		expect(session.model?.provider).toBe(fallbackModel.provider);
		expect(session.model?.id).toBe(fallbackModel.id);

		await Bun.sleep(240);
		await session.prompt("Third prompt should lazily revert to primary");
		await session.waitForIdle();
		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
			`${primaryModel.provider}/${primaryModel.id}`,
		]);
		expect(session.model?.provider).toBe(primaryModel.provider);
		expect(session.model?.id).toBe(primaryModel.id);
	});

	it("preserves thinking on bare fallback selectors and does not overwrite user thinking on restore", async () => {
		const primaryModel = getBundledModel("anthropic", "claude-sonnet-5");
		const fallbackModel = getBundledModel("openai", "gpt-4o-mini");
		if (!primaryModel || !fallbackModel) {
			throw new Error("Expected bundled test models to exist");
		}

		const requestedModels: string[] = [];
		let primaryAttempts = 0;

		const agent = new Agent({
			getApiKey: provider => `${provider}-test-key`,
			initialState: {
				model: primaryModel,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
			streamFn: model => {
				requestedModels.push(`${model.provider}/${model.id}`);
				const stream = new MockAssistantStream();
				queueMicrotask(() => {
					if (model.provider === primaryModel.provider && model.id === primaryModel.id && primaryAttempts === 0) {
						primaryAttempts += 1;
						const message = createAssistantMessage(model, {
							stopReason: "error",
							errorMessage: "rate limit exceeded retry-after-ms=200",
						});
						stream.push({ type: "start", partial: message });
						stream.push({ type: "error", reason: "error", error: message });
						return;
					}
					const message = createAssistantMessage(model, {
						text: `ok:${model.provider}/${model.id}`,
						stopReason: "stop",
					});
					stream.push({ type: "start", partial: createAssistantMessage(model, { text: "", stopReason: "stop" }) });
					stream.push({ type: "done", reason: "stop", message });
				});
				return stream;
			},
		});

		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.baseDelayMs": 5,
			"retry.fallbackChains": {
				default: [`${fallbackModel.provider}/${fallbackModel.id}`],
			},
			"retry.fallbackRevertPolicy": "cooldown-expiry",
		});
		settings.setModelRole("default", `${primaryModel.provider}/${primaryModel.id}:high`);

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
			thinkingLevel: Effort.High,
		});

		await session.prompt("First prompt triggers bare-selector fallback");
		await session.waitForIdle();
		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
		]);
		expect(session.model?.provider).toBe(fallbackModel.provider);
		expect(session.model?.id).toBe(fallbackModel.id);
		expect(session.thinkingLevel).toBeUndefined();

		session.setThinkingLevel(Effort.Low);
		await Bun.sleep(240);
		await session.prompt("Second prompt should restore model but preserve user thinking change");
		await session.waitForIdle();
		expect(requestedModels).toEqual([
			`${primaryModel.provider}/${primaryModel.id}`,
			`${fallbackModel.provider}/${fallbackModel.id}`,
			`${primaryModel.provider}/${primaryModel.id}`,
		]);
		expect(session.model?.provider).toBe(primaryModel.provider);
		expect(session.model?.id).toBe(primaryModel.id);
		expect(session.thinkingLevel).toBeUndefined();
	});

	it("normalizes suppression by base selector and clears it on model refresh", async () => {
		const future = Date.now() + 60_000;
		modelRegistry.suppressSelector("openai/gpt-4o:high", future);
		expect(modelRegistry.isSelectorSuppressed("openai/gpt-4o")).toBe(true);
		expect(modelRegistry.isSelectorSuppressed("openai/gpt-4o:low")).toBe(true);

		await modelRegistry.refresh("offline");
		expect(modelRegistry.isSelectorSuppressed("openai/gpt-4o")).toBe(false);
	});
});
