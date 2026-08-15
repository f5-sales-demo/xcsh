import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PromptRequest, SessionNotification } from "@agentclientprotocol/sdk";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type { Model } from "@f5-sales-demo/pi-ai";
import { getConfigRootDir, setAgentDir } from "@f5-sales-demo/pi-utils";
import { AcpAgent } from "../src/modes/acp/acp-agent";
import type { AgentSession, AgentSessionEvent } from "../src/session/agent-session";
import { SessionManager } from "../src/session/session-manager";

const TEST_MODELS: Model[] = [
	{
		id: "claude-sonnet-4-20250514",
		name: "Claude Sonnet",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		api: "openai-responses",
		provider: "openai",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	},
];

function makeAssistantMessage(text: string, thinking?: string) {
	const content: Array<{ type: "text"; text: string } | { type: "thinking"; thinking: string }> = [
		{ type: "text", text },
	];
	if (thinking) {
		content.push({ type: "thinking" as const, thinking });
	}
	return {
		role: "assistant" as const,
		content,
		api: "anthropic-messages" as const,
		provider: "anthropic" as const,
		model: TEST_MODELS[0].id,
		usage: {
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			totalTokens: 18,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

class FakeAgentSession {
	sessionManager: SessionManager;
	sessionId: string;
	agent: { sessionId: string; waitForIdle: () => Promise<void> };
	model: Model | undefined;
	thinkingLevel: string | undefined;
	customCommands: [] = [];
	extensionRunner = undefined;
	isStreaming = false;
	queuedMessageCount = 0;
	systemPrompt = "system";
	disposed = false;
	#listeners = new Set<(event: AgentSessionEvent) => void>();

	constructor(
		cwd: string,
		private readonly models: Model[] = TEST_MODELS,
	) {
		this.sessionManager = SessionManager.create(cwd);
		this.sessionId = this.sessionManager.getSessionId();
		this.agent = {
			sessionId: this.sessionId,
			waitForIdle: async () => {},
		};
		this.model = models[0];
	}

	get sessionName(): string {
		return this.sessionManager.getHeader()?.title ?? `Session ${this.sessionId}`;
	}

	get modelRegistry(): { getApiKey: (model: Model) => Promise<string> } {
		return {
			getApiKey: async (_model: Model) => "test-key",
		};
	}

	getAvailableModels(): Model[] {
		return this.models;
	}

	getAvailableThinkingLevels(): ReadonlyArray<string> {
		return ["low", "medium", "high"];
	}

	setThinkingLevel(level: string | undefined): void {
		this.thinkingLevel = level;
	}

	async setModel(model: Model): Promise<void> {
		this.model = model;
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	async prompt(text: string): Promise<void> {
		this.isStreaming = true;
		this.sessionManager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
		const assistantMessage = makeAssistantMessage("pong");
		for (const listener of this.#listeners) {
			listener({
				type: "message_update",
				message: assistantMessage,
				assistantMessageEvent: { type: "text_delta", delta: "pong" },
			} as AgentSessionEvent);
		}
		this.sessionManager.appendMessage(assistantMessage);
		for (const listener of this.#listeners) {
			listener({
				type: "agent_end",
				messages: [assistantMessage],
			} as AgentSessionEvent);
		}
		this.isStreaming = false;
	}

	async abort(): Promise<void> {
		this.isStreaming = false;
	}

	async refreshMCPTools(_tools: unknown[]): Promise<void> {}

	getContextUsage(): undefined {
		return undefined;
	}

	async switchSession(sessionPath: string): Promise<boolean> {
		await this.sessionManager.setSessionFile(sessionPath);
		this.sessionId = this.sessionManager.getSessionId();
		this.agent.sessionId = this.sessionId;
		return true;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.sessionManager.close();
	}

	async reload(): Promise<void> {}

	async newSession(): Promise<boolean> {
		await this.sessionManager.newSession();
		this.sessionId = this.sessionManager.getSessionId();
		this.agent.sessionId = this.sessionId;
		return true;
	}

	async branch(_entryId: string): Promise<{ cancelled: boolean }> {
		return { cancelled: false };
	}

	async navigateTree(_targetId: string): Promise<{ cancelled: boolean }> {
		return { cancelled: false };
	}

	getActiveToolNames(): string[] {
		return [];
	}

	getAllToolNames(): string[] {
		return [];
	}

	setActiveToolsByName(_toolNames: string[]): void {}

	async sendCustomMessage(_message: string, _options?: unknown): Promise<void> {}

	async sendUserMessage(_content: string, _options?: unknown): Promise<void> {}

	async compact(_instructions?: string, _options?: unknown): Promise<void> {}

	async fork(): Promise<boolean> {
		await this.sessionManager.flush();
		const forked = await this.sessionManager.fork();
		if (!forked) {
			return false;
		}
		this.sessionId = this.sessionManager.getSessionId();
		this.agent.sessionId = this.sessionId;
		return true;
	}
}

interface AgentHarness {
	agent: AcpAgent;
	updates: SessionNotification[];
	abortController: AbortController;
	sessions: FakeAgentSession[];
	cwdA: string;
	cwdB: string;
	findSession(sessionId: string): FakeAgentSession | undefined;
}

function getChunkMessageId(notification: SessionNotification): string | undefined {
	const update = notification.update as { messageId?: string | null };
	return typeof update.messageId === "string" ? update.messageId : undefined;
}

const cleanupRoots: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

afterEach(async () => {
	if (originalAgentDir) {
		setAgentDir(originalAgentDir);
	} else {
		setAgentDir(fallbackAgentDir);
		delete process.env.PI_CODING_AGENT_DIR;
	}

	for (const root of cleanupRoots.splice(0)) {
		await fs.promises.rm(root, { recursive: true, force: true });
	}
});

async function createHarness(): Promise<AgentHarness> {
	const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "xcsh-acp-test-"));
	cleanupRoots.push(root);
	const agentDir = path.join(root, "agent");
	const cwdA = path.join(root, "cwd-a");
	const cwdB = path.join(root, "cwd-b");
	await fs.promises.mkdir(agentDir, { recursive: true });
	await fs.promises.mkdir(cwdA, { recursive: true });
	await fs.promises.mkdir(cwdB, { recursive: true });
	setAgentDir(agentDir);

	const updates: SessionNotification[] = [];
	const abortController = new AbortController();
	const sessions: FakeAgentSession[] = [];
	const connection = {
		sessionUpdate: async (notification: SessionNotification) => {
			updates.push(notification);
		},
		signal: abortController.signal,
		closed: Promise.withResolvers<void>().promise,
	} as unknown as AgentSideConnection;

	const initialSession = new FakeAgentSession(cwdA);
	sessions.push(initialSession);
	const factory = async (cwd: string): Promise<AgentSession> => {
		const session = new FakeAgentSession(cwd);
		sessions.push(session);
		return session as unknown as AgentSession;
	};

	return {
		agent: new AcpAgent(connection, initialSession as unknown as AgentSession, factory),
		updates,
		abortController,
		sessions,
		cwdA,
		cwdB,
		findSession: (sessionId: string) => sessions.find(session => session.sessionId === sessionId),
	};
}

describe("ACP agent", () => {
	it("supports multiple live ACP sessions with model and lifecycle handlers", async () => {
		const harness = await createHarness();
		const first = await harness.agent.newSession({ cwd: harness.cwdA, mcpServers: [] });
		const second = await harness.agent.newSession({ cwd: harness.cwdB, mcpServers: [] });

		// ACP 1.x removed SessionModelState and the session/set_model method; model
		// choice is now advertised and changed through the `model` config option.
		const modelOption = first.configOptions?.find(option => option.category === "model");
		expect(modelOption?.type).toBe("select");
		// 1.x also widened select options to `Option[] | Group[]`; we emit flat options.
		const modelChoices = modelOption?.type === "select" ? modelOption.options : [];
		expect(modelChoices.flatMap(choice => ("value" in choice ? [choice.value] : []))).toEqual(
			TEST_MODELS.map(model => `${model.provider}/${model.id}`),
		);

		await harness.agent.setSessionConfigOption({
			sessionId: first.sessionId,
			configId: "model",
			value: `${TEST_MODELS[1]!.provider}/${TEST_MODELS[1]!.id}`,
		});
		await harness.agent.setSessionConfigOption({
			sessionId: first.sessionId,
			configId: "thinking",
			value: "high",
		});

		const firstSession = harness.findSession(first.sessionId);
		const secondSession = harness.findSession(second.sessionId);
		expect(firstSession?.model?.id).toBe(TEST_MODELS[1]!.id);
		expect(firstSession?.thinkingLevel).toBe("high");
		expect(secondSession?.model?.id).toBe(TEST_MODELS[0]!.id);
		expect(secondSession?.thinkingLevel).toBeUndefined();

		firstSession?.sessionManager.appendMessage({ role: "user", content: "fork me", timestamp: Date.now() });
		await firstSession?.sessionManager.flush();

		const forked = await harness.agent.unstable_forkSession({
			sessionId: first.sessionId,
			cwd: harness.cwdA,
			mcpServers: [],
		});
		const forkedSession = harness.findSession(forked.sessionId);
		const forkedMessages = forkedSession?.sessionManager.buildSessionContext().messages ?? [];
		expect(forked.sessionId).not.toBe(first.sessionId);
		expect(forkedMessages.some(message => message.role === "user" && message.content === "fork me")).toBe(true);

		await harness.agent.closeSession({ sessionId: forked.sessionId });
		await expect(harness.agent.setSessionMode({ sessionId: forked.sessionId, modeId: "default" })).rejects.toThrow(
			"Unsupported ACP session",
		);

		harness.abortController.abort();
		await Bun.sleep(0);
	});

	it("replays messageIds and returns turn usage for prompts", async () => {
		const harness = await createHarness();
		const stored = new FakeAgentSession(harness.cwdA);
		harness.sessions.push(stored);
		stored.sessionManager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		stored.sessionManager.appendMessage(makeAssistantMessage("reply", "reasoning"));
		await stored.sessionManager.ensureOnDisk();
		await stored.sessionManager.flush();

		await harness.agent.loadSession({ sessionId: stored.sessionId, cwd: harness.cwdA, mcpServers: [] });
		const replayChunks = harness.updates.filter(
			update =>
				update.sessionId === stored.sessionId &&
				(update.update.sessionUpdate === "user_message_chunk" ||
					update.update.sessionUpdate === "agent_message_chunk" ||
					update.update.sessionUpdate === "agent_thought_chunk"),
		);
		const replayAssistantChunks = replayChunks.filter(
			update =>
				update.update.sessionUpdate === "agent_message_chunk" ||
				update.update.sessionUpdate === "agent_thought_chunk",
		);

		expect(
			replayChunks.every(
				update => typeof getChunkMessageId(update) === "string" && getChunkMessageId(update)!.length > 0,
			),
		).toBe(true);
		expect(new Set(replayAssistantChunks.map(update => getChunkMessageId(update))).size).toBe(1);

		const live = await harness.agent.newSession({ cwd: harness.cwdB, mcpServers: [] });
		const response = await harness.agent.prompt({
			sessionId: live.sessionId,
			prompt: [{ type: "text", text: "ping" }],
		} as PromptRequest);

		const liveChunks = harness.updates.filter(
			update => update.sessionId === live.sessionId && update.update.sessionUpdate === "agent_message_chunk",
		);
		// ACP 1.x removed PromptRequest.messageId and PromptResponse.userMessageId,
		// so the turn ID is agent-generated and no longer echoed. ContentChunk
		// .messageId survives, so assert the invariant that still matters: every
		// chunk in the turn carries one and the same generated ID.
		expect(response.usage).toEqual({
			inputTokens: 10,
			outputTokens: 5,
			cachedReadTokens: 2,
			cachedWriteTokens: 1,
			totalTokens: 18,
		});
		expect(
			liveChunks.some(
				update => typeof getChunkMessageId(update) === "string" && getChunkMessageId(update)!.length > 0,
			),
		).toBe(true);
		expect(new Set(liveChunks.map(update => getChunkMessageId(update))).size).toBe(1);

		harness.abortController.abort();
		await Bun.sleep(0);
	});
});

/**
 * The tests above invoke `AcpAgent` members directly on the class. That cannot
 * catch a whole class of breakage: the SDK dispatches JSON-RPC by looking up
 * *specific* member names, and most session-lifecycle members are declared
 * **optional** on `Agent`. If one is renamed upstream, our class still
 * typechecks and its direct-call tests still pass, while the wire method
 * quietly starts returning "method not found" — even though `initialize` keeps
 * advertising the capability.
 *
 * These tests speak real newline-delimited JSON-RPC over a real
 * `AgentSideConnection`, so an advertised-but-undispatchable capability fails.
 */
const METHOD_NOT_FOUND = -32601;

interface JsonRpcResponse {
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
}

async function* readNdJsonLines(readable: ReadableStream<Uint8Array>): AsyncGenerator<string> {
	const reader = readable.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			return;
		}
		buffered += decoder.decode(value, { stream: true });
		let newline = buffered.indexOf("\n");
		while (newline !== -1) {
			const line = buffered.slice(0, newline).trim();
			buffered = buffered.slice(newline + 1);
			if (line) {
				yield line;
			}
			newline = buffered.indexOf("\n");
		}
	}
}

async function createWireHarness(): Promise<{
	request: (method: string, params: unknown) => Promise<JsonRpcResponse>;
	cwd: string;
}> {
	const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "xcsh-acp-wire-"));
	cleanupRoots.push(root);
	const agentDir = path.join(root, "agent");
	const cwd = path.join(root, "cwd");
	await fs.promises.mkdir(agentDir, { recursive: true });
	await fs.promises.mkdir(cwd, { recursive: true });
	setAgentDir(agentDir);

	const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
	const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
	// `ndJsonStream(output, input)`: first arg is what the agent WRITES to, second
	// is what it READS from — matching runAcpMode's wiring.
	const transport = ndJsonStream(agentToClient.writable, clientToAgent.readable);
	const initial = new FakeAgentSession(cwd);
	new AgentSideConnection(
		conn =>
			new AcpAgent(conn, initial as unknown as AgentSession, async next => {
				return new FakeAgentSession(next) as unknown as AgentSession;
			}),
		transport,
	);

	const writer = clientToAgent.writable.getWriter();
	const lines = readNdJsonLines(agentToClient.readable);
	let nextId = 1;

	return {
		cwd,
		request: async (method, params) => {
			const id = nextId++;
			await writer.write(new TextEncoder().encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`));
			for (;;) {
				const next = await lines.next();
				if (next.done) {
					throw new Error(`connection closed before a response to ${method}`);
				}
				const message = JSON.parse(next.value) as Partial<JsonRpcResponse>;
				// Skip notifications (no `id`) and responses to earlier requests.
				if (message.id === id) {
					return message as JsonRpcResponse;
				}
			}
		},
	};
}

describe("ACP dispatch over a real AgentSideConnection", () => {
	it("dispatches every session capability advertised by initialize", async () => {
		const wire = await createWireHarness();

		const init = await wire.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
		expect(init.error).toBeUndefined();
		const advertised = (init.result as { agentCapabilities?: { sessionCapabilities?: Record<string, unknown> } })
			.agentCapabilities?.sessionCapabilities;
		// Guard the premise: if we stop advertising these, this test is moot.
		expect(Object.keys(advertised ?? {}).sort()).toEqual(["close", "fork", "list", "resume"]);

		const created = await wire.request("session/new", { cwd: wire.cwd, mcpServers: [] });
		expect(created.error).toBeUndefined();
		const sessionId = (created.result as { sessionId: string }).sessionId;

		// A capability we advertise but cannot dispatch is exactly what a
		// renamed-but-optional `Agent` member produces.
		const calls: Array<[string, unknown]> = [
			["session/list", {}],
			["session/resume", { sessionId, cwd: wire.cwd, mcpServers: [] }],
			["session/fork", { sessionId, cwd: wire.cwd, mcpServers: [] }],
			["session/close", { sessionId }],
		];
		for (const [method, params] of calls) {
			const response = await wire.request(method, params);
			expect(response.error?.code, `${method} must be dispatchable`).not.toBe(METHOD_NOT_FOUND);
		}
	});

	it("does not silently succeed for a method outside AGENT_METHODS (control)", async () => {
		const wire = await createWireHarness();
		await wire.request("initialize", { protocolVersion: 1, clientCapabilities: {} });

		const response = await wire.request("session/definitely_not_a_method", {});
		// Unknown methods fall through to `extMethod`, which returns the protocol's
		// standard unsupported-method response rather than an internal error.
		expect(response.error?.code).toBe(METHOD_NOT_FOUND);
		expect(response.result).toBeUndefined();
	});
});

describe("ACP media extension", () => {
	it("serves bounded chunks only for media persisted in the requested session", async () => {
		const harness = await createHarness();
		const created = await harness.agent.newSession({ cwd: harness.cwdA, mcpServers: [] });
		const session = harness.findSession(created.sessionId)!;
		const blob = await session.sessionManager.putBlob(Buffer.from("media"));
		session.sessionManager.appendMessage({
			role: "media",
			timestamp: 1,
			media: {
				version: 1,
				id: `media_${blob.hash.slice(0, 24)}`,
				kind: "image",
				original: { ref: blob.ref, mimeType: "image/png", bytes: 5 },
				provenance: { sourceType: "tool", source: "display_media" },
				playback: { autoplay: false, loop: false, muted: true, fpsCap: 12 },
			},
		});
		const chunk = await harness.agent.extMethod("xcsh/media/read", {
			sessionId: created.sessionId,
			ref: blob.ref,
			length: 3,
		});
		expect(chunk.data).toBe(Buffer.from("med").toString("base64"));
		expect(chunk.eof).toBe(false);
		await expect(
			harness.agent.extMethod("xcsh/media/read", {
				sessionId: created.sessionId,
				ref: `blob:sha256:${"f".repeat(64)}`,
			}),
		).rejects.toThrow("unknown media asset");
		harness.abortController.abort();
	});
});
