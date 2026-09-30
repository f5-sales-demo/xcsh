import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { planSteeredRequest } from "@f5-sales-demo/pi-ai/providers/openai-codex/live-steering";
import { streamOpenAICodexResponses } from "@f5-sales-demo/pi-ai/providers/openai-codex-responses";
import type {
	AssistantMessage,
	Context,
	LiveSteerClaim,
	LiveSteering,
	Model,
	ProviderSessionState,
	ToolResultMessage,
	UserMessage,
} from "@f5-sales-demo/pi-ai/types";
import * as piUtils from "@f5-sales-demo/pi-utils";
import { applyCodexInteractionMetadata } from "../src/codex-model-interaction";

const { getAgentDir, setAgentDir, TempDir } = piUtils;
const originalAgentDir = getAgentDir();
const originalWebSocket = global.WebSocket;
const USAGE = { input_tokens: 5, output_tokens: 3, total_tokens: 8, input_tokens_details: { cached_tokens: 0 } };

beforeEach(() => {
	setAgentDir(TempDir.createSync("@pi-codex-steer-").path());
});

afterEach(() => {
	global.WebSocket = originalWebSocket;
	setAgentDir(originalAgentDir);
	vi.restoreAllMocks();
});

type Frame = Record<string, unknown>;

/** Scripted Responses WebSocket: `onFrame` answers each client frame via `emit`. */
class ScriptedWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: ScriptedWebSocket[] = [];
	static onFrame: (frame: Frame, socket: ScriptedWebSocket) => void = () => {};
	static sent: Frame[] = [];

	readyState = ScriptedWebSocket.CONNECTING;
	binaryType = "nodebuffer";
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onclose: ((event: Event) => void) | null = null;

	addEventListener(name: string, callback: (event: any) => void): void {
		if (name === "open") this.onopen = callback;
		if (name === "message") this.onmessage = callback;
		if (name === "error") this.onerror = callback;
		if (name === "close") this.onclose = callback;
	}
	constructor() {
		ScriptedWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = ScriptedWebSocket.OPEN;
			this.onopen?.(new Event("open"));
		});
	}

	send(data: string): void {
		const frame = JSON.parse(data) as Frame;
		ScriptedWebSocket.sent.push(frame);
		ScriptedWebSocket.onFrame(frame, this);
	}

	close(): void {
		this.readyState = ScriptedWebSocket.CLOSED;
	}

	/** Deliver server frames asynchronously, in order. */
	emit(...frames: Frame[]): void {
		queueMicrotask(() => {
			for (const frame of frames) this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
		});
	}
}

function installSocket(onFrame: (frame: Frame, socket: ScriptedWebSocket) => void): void {
	ScriptedWebSocket.instances = [];
	ScriptedWebSocket.sent = [];
	ScriptedWebSocket.onFrame = onFrame;
	global.WebSocket = ScriptedWebSocket as unknown as typeof WebSocket;
}

function createGpt6Model(): Model<"openai-codex-responses"> {
	return applyCodexInteractionMetadata({
		id: "gpt-6.1-sol",
		name: "GPT-6 Sol",
		api: "openai-codex-responses",
		provider: "openai-codex",
		baseUrl: "https://chatgpt.com/backend-api",
		reasoning: true,
		preferWebsockets: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 128000,
	});
}

function createToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		"utf8",
	).toBase64();
	return `aaa.${payload}.bbb`;
}

function messageFrames(itemId: string, text: string): Frame[] {
	const item = { type: "message", id: itemId, role: "assistant", content: [{ type: "output_text", text }] };
	return [
		{ type: "response.output_item.added", item: { ...item, status: "in_progress", content: [] } },
		{ type: "response.output_text.delta", item_id: itemId, delta: text },
		{ type: "response.output_item.done", item: { ...item, status: "completed" } },
	];
}

/** A source holding one steering message; records how the provider settled it. */
function oneShotSteering(text: string): { source: LiveSteering; settled: () => "accepted" | "rejected" | undefined } {
	let claimed = false;
	let outcome: "accepted" | "rejected" | undefined;
	const idle = (signal: AbortSignal) => {
		const { promise, resolve } = Promise.withResolvers<void>();
		if (signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
		return promise;
	};
	const source: LiveSteering = {
		wait: async signal => (claimed ? idle(signal) : undefined),
		claim: async (): Promise<LiveSteerClaim | undefined> => {
			if (claimed) return undefined;
			claimed = true;
			return {
				messages: [{ role: "user", content: text, timestamp: Date.now() }],
				accept: () => {
					outcome = "accepted";
				},
				reject: () => {
					outcome = "rejected";
				},
			};
		},
	};
	return { source, settled: () => outcome };
}

function options(providerSessionState: Map<string, ProviderSessionState>, liveSteering?: LiveSteering) {
	return {
		apiKey: createToken(),
		sessionId: "ws-steer-session",
		providerSessionState,
		liveSteering,
		fetch: vi.fn(async () => {
			throw new Error("SSE fallback should not run");
		}) as unknown as typeof fetch,
	};
}

const SYSTEM = "You are a helpful assistant.";
const creates = () => ScriptedWebSocket.sent.filter(frame => frame.type === "response.create");
const steers = () => ScriptedWebSocket.sent.filter(frame => frame.type === "response.steer");

describe("codex live steering", () => {
	it("keeps subscription reasoning changes anchored in the cached transcript", async () => {
		installSocket((_frame, socket) =>
			socket.emit({
				type: "response.completed",
				response: { id: `resp_${creates().length}`, status: "completed", usage: USAGE },
			}),
		);
		const model = { ...createGpt6Model(), compat: { supportsCachedReasoningUpdates: true } };
		const state = new Map<string, ProviderSessionState>();
		const messages: UserMessage[] = [];
		for (const effort of ["medium", "high", "max"] as const) {
			messages.push({ role: "user", content: `synthetic-${effort}`, timestamp: messages.length });
			await streamOpenAICodexResponses(
				model,
				{ messages: [...messages] },
				{ ...options(state), reasoning: effort },
			).result();
		}
		expect((creates()[2]!.reasoning as { effort: string }).effort).toBe("medium");
		const inputs = creates().flatMap(frame => frame.input as any[]);
		expect(inputs.filter(item => item.type === "configuration_update").map(item => item.reasoning.effort)).toEqual([
			"high",
			"max",
		]);
	});
	it("preserves custom tool input and namespace through subscription replay", async () => {
		installSocket((_frame, socket) => {
			if (creates().length === 1) {
				const item = {
					type: "custom_tool_call",
					id: "ct_synthetic",
					call_id: "call_custom",
					name: "patch",
					namespace: "demo-app",
					input: "synthetic patch",
				};
				socket.emit(
					{ type: "response.created", response: { id: "resp_custom" } },
					{ type: "response.output_item.added", output_index: 0, item: { ...item, input: "" } },
					{ type: "response.custom_tool_call_input.delta", output_index: 0, delta: "synthetic patch" },
					{ type: "response.output_item.done", output_index: 0, item },
					{ type: "response.completed", response: { id: "resp_custom", status: "completed", usage: USAGE } },
				);
			} else
				socket.emit({
					type: "response.completed",
					response: { id: "resp_followup", status: "completed", usage: USAGE },
				});
		});
		const model = { ...createGpt6Model(), compat: { supportsOpenAIGrammarTools: true } };
		const state = new Map<string, ProviderSessionState>();
		const user: UserMessage = { role: "user", content: "synthetic", timestamp: 0 };
		const tools = [
			{
				name: "patch",
				description: "Patch",
				parameters: { type: "object", required: ["source"], properties: { source: { type: "string" } } } as any,
				constrainedSampling: { type: "grammar" as const, variants: { openai_regex: ".*" } },
			},
		];
		const first = await streamOpenAICodexResponses(model, { messages: [user], tools }, options(state)).result();
		expect(first.stopReason).toBe("toolUse");
		expect(first.content).toMatchObject([
			{
				type: "toolCall",
				namespace: "demo-app",
				customInputProperty: "source",
				arguments: { source: "synthetic patch" },
			},
		]);
		await streamOpenAICodexResponses(
			model,
			{
				messages: [
					user,
					first,
					{
						role: "toolResult",
						toolCallId: "call_custom|ct_synthetic",
						toolName: "patch",
						customTool: true,
						content: [{ type: "text", text: "applied" }],
						isError: false,
						timestamp: 1,
					},
				],
				tools,
			},
			options(state),
		).result();
		expect(creates()[1]?.input).toMatchObject([
			{ type: "custom_tool_call_output", call_id: "call_custom", output: "applied" },
		]);
		expect((creates()[0]!.tools as any[])[0]).toMatchObject({
			type: "custom",
			format: { syntax: "regex", definition: ".*" },
		});
	});
	it("steers the streaming response and reads the server's automatic continuation without sending a request", async () => {
		installSocket((frame, socket) => {
			if (frame.type === "response.create") {
				// Stream part of an answer, then wait for the steer.
				socket.emit({ type: "response.created", response: { id: "resp_1" } }, ...messageFrames("msg_1", "Plan"));
				return;
			}
			socket.emit(
				{ type: "response.steer.accepted", steer: { id: "steer_1", previous_response_id: "resp_1" } },
				{
					type: "response.incomplete",
					response: {
						id: "resp_1",
						status: "incomplete",
						incomplete_details: { reason: "steered" },
						usage: USAGE,
					},
				},
				// The successor the server creates on its own from the queued input.
				{ type: "response.created", response: { id: "resp_2" } },
				...messageFrames("msg_2", "Tabs it is"),
				{ type: "response.completed", response: { id: "resp_2", status: "completed", usage: USAGE } },
			);
		});
		const model = createGpt6Model();
		const state = new Map<string, ProviderSessionState>();
		const steering = oneShotSteering("use tabs");
		const user: UserMessage = { role: "user", content: "Draft a plan", timestamp: Date.now() };

		const first = await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user] },
			options(state, steering.source),
		).result();

		expect(steering.settled()).toBe("accepted");
		expect(first.stopReason).toBe("stop");
		expect(steers()).toEqual([
			{
				type: "response.steer",
				previous_response_id: "resp_1",
				input: [{ role: "user", content: [{ type: "input_text", text: "use tabs" }] }],
			},
		]);

		const steerMessage: UserMessage = { role: "user", content: "use tabs", timestamp: Date.now() };
		const second = await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user, first, steerMessage] },
			options(state),
		).result();

		expect(second.responseId).toBe("resp_2");
		expect(second.content).toEqual([expect.objectContaining({ type: "text", text: "Tabs it is" })]);
		expect(creates()).toHaveLength(1);
		expect(ScriptedWebSocket.instances).toHaveLength(1);
	});

	it("discards accepted steering and late successor frames when its socket closes", async () => {
		installSocket((frame, socket) => {
			if (frame.type === "response.create") {
				socket.emit({ type: "response.created", response: { id: "resp_seed" } });
				return;
			}
			socket.emit(
				{ type: "response.steer.accepted", steer: { id: "steer_test", previous_response_id: "resp_seed" } },
				{
					type: "response.incomplete",
					response: {
						id: "resp_seed",
						status: "incomplete",
						incomplete_details: { reason: "steered" },
						usage: USAGE,
					},
				},
			);
		});
		const model = createGpt6Model();
		const state = new Map<string, ProviderSessionState>();
		const steering = oneShotSteering("use tabs");
		const user: UserMessage = { role: "user", content: "Draft a plan", timestamp: 1 };
		const first = await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user] },
			options(state, steering.source),
		).result();
		expect(steering.settled()).toBe("accepted");
		const old = ScriptedWebSocket.instances[0];
		old.close();
		old.onclose?.({ code: 1006 } as unknown as Event);
		old.emit({ type: "response.created", response: { id: "resp_late" } });
		ScriptedWebSocket.onFrame = (_frame, socket) =>
			socket.emit({ type: "response.completed", response: { id: "resp_new", status: "completed", usage: USAGE } });
		const second = await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user, first, { role: "user", content: "use tabs", timestamp: 2 }] },
			options(state),
		).result();
		expect(second.stopReason).toBe("stop");
		expect(second.responseId).toBe("resp_new");
		expect(ScriptedWebSocket.instances).toHaveLength(2);
		expect(creates()[1].previous_response_id).toBeUndefined();
		expect(JSON.stringify(creates()[1].input)).toContain("use tabs");
		for (const value of state.values()) value.close?.();
	});

	it("returns pending tool output without repeating steering the server already queued", async () => {
		installSocket((frame, socket) => {
			if (frame.type === "response.create" && creates().length === 1) {
				const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "status", arguments: "{}" };
				socket.emit(
					{ type: "response.created", response: { id: "resp_1" } },
					{ type: "response.output_item.added", output_index: 0, item: { ...call, arguments: "" } },
				);
				return;
			}
			if (frame.type === "response.steer") {
				const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "status", arguments: "{}" };
				socket.emit(
					{ type: "response.steer.accepted", steer: { id: "steer_1", previous_response_id: "resp_1" } },
					{ type: "response.output_item.done", output_index: 0, item: { ...call, status: "completed" } },
					{ type: "response.completed", response: { id: "resp_1", status: "completed", usage: USAGE } },
					{
						type: "response.steer.pending",
						steer: { id: "steer_1", previous_response_id: "resp_1" },
						reason: "waiting_for_required_input",
						required_input: [{ type: "function_call_output", call_id: "call_1", name: "status" }],
					},
				);
				return;
			}
			socket.emit(
				{ type: "response.created", response: { id: "resp_2" } },
				...messageFrames("msg_2", "Scoped down"),
				{ type: "response.completed", response: { id: "resp_2", status: "completed", usage: USAGE } },
			);
		});
		const model = createGpt6Model();
		const state = new Map<string, ProviderSessionState>();
		const steering = oneShotSteering("keep it small");
		const user: UserMessage = { role: "user", content: "Plan the project", timestamp: Date.now() };

		const first = await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user] },
			options(state, steering.source),
		).result();
		expect(steering.settled()).toBe("accepted");
		expect(first.stopReason).toBe("toolUse");
		const toolCall = first.content.find(block => block.type === "toolCall");
		if (toolCall?.type !== "toolCall") throw new Error("expected a tool call");
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			content: [{ type: "text", text: "design done" }],
			isError: false,
			timestamp: Date.now(),
		};
		const steerMessage: UserMessage = { role: "user", content: "keep it small", timestamp: Date.now() };

		await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user, first, toolResult, steerMessage] },
			options(state),
		).result();

		const continuation = creates()[1];
		expect(continuation?.previous_response_id).toBe("resp_1");
		expect(continuation?.input).toEqual([
			expect.objectContaining({ type: "function_call_output", call_id: "call_1", output: "design done" }),
		]);
	});

	it("hands rejected steering back and sends it as ordinary input next time", async () => {
		installSocket((frame, socket) => {
			if (frame.type === "response.create" && creates().length === 1) {
				socket.emit({ type: "response.created", response: { id: "resp_1" } }, ...messageFrames("msg_1", "Hi"));
				return;
			}
			if (frame.type === "response.steer") {
				socket.emit(
					{
						type: "response.steer.failed",
						steer: { previous_response_id: "resp_1", input: frame.input },
						error: { type: "invalid_request_error", code: "response_already_completed", message: "done" },
					},
					{ type: "response.completed", response: { id: "resp_1", status: "completed", usage: USAGE } },
				);
				return;
			}
			socket.emit({ type: "response.created", response: { id: "resp_2" } }, ...messageFrames("msg_2", "Sure"), {
				type: "response.completed",
				response: { id: "resp_2", status: "completed", usage: USAGE },
			});
		});
		const model = createGpt6Model();
		const state = new Map<string, ProviderSessionState>();
		const steering = oneShotSteering("one more thing");
		const user: UserMessage = { role: "user", content: "Hello", timestamp: Date.now() };

		const first: AssistantMessage = await streamOpenAICodexResponses(
			model,
			{ systemPrompt: SYSTEM, messages: [user] },
			options(state, steering.source),
		).result();
		expect(steering.settled()).toBe("rejected");

		const steerMessage: UserMessage = { role: "user", content: "one more thing", timestamp: Date.now() };
		const context: Context = { systemPrompt: SYSTEM, messages: [user, first, steerMessage] };
		await streamOpenAICodexResponses(model, context, options(state)).result();

		expect(creates()[1]?.previous_response_id).toBe("resp_1");
		expect(creates()[1]?.input).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "one more thing" }] },
		]);
	});
});

describe("planSteeredRequest", () => {
	const steer = { role: "user", content: [{ type: "input_text", text: "use tabs" }] };
	const output = { type: "function_call_output", call_id: "call_1", output: "ok" };
	const other = { role: "user", content: [{ type: "input_text", text: "also lint" }] };

	it("attaches when the request is exactly the accepted steering", () => {
		// Responses Lite strips the image `detail` hint from request bodies only.
		const imageSteer = { role: "user", content: [{ type: "input_image", image_url: "u", detail: "auto" }] };
		expect(
			planSteeredRequest([{ role: "user", content: [{ type: "input_image", image_url: "u" }] }], [imageSteer]),
		).toEqual({ kind: "attach" });
	});

	it("sends only the tool output the server awaits", () => {
		expect(planSteeredRequest([output, steer], [steer])).toEqual({ kind: "create", input: [output] });
	});

	it("discards when the request cannot line up with the server queue", () => {
		// Extra input would run alongside the automatic successor.
		expect(planSteeredRequest([steer, other], [steer])).toEqual({ kind: "discard" });
		// The accepted steering is missing from the transcript.
		expect(planSteeredRequest([output], [steer])).toEqual({ kind: "discard" });
		// The chain broke, so the server's continuation point is unusable.
		expect(planSteeredRequest(undefined, [steer])).toEqual({ kind: "discard" });
	});
});
