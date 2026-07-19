import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Agent } from "@f5-sales-demo/pi-agent-core";
import { type AssistantMessage, type Context, getBundledModel, type ToolCall } from "@f5-sales-demo/pi-ai";
import { AssistantMessageEventStream } from "@f5-sales-demo/pi-ai/utils/event-stream";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import { ModelRegistry } from "@f5-sales-demo/xcsh/config/model-registry";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import { AgentSession } from "@f5-sales-demo/xcsh/session/agent-session";
import { AuthStorage } from "@f5-sales-demo/xcsh/session/auth-storage";
import { SessionManager } from "@f5-sales-demo/xcsh/session/session-manager";

/**
 * A4 — the acceptance gate for #2046: an END-TO-END proof that a WS-registered host
 * tool is actually exposed to the agent and driven through the FULL loop.
 *
 * Drive path used: the PREFERRED **real-model** path. A deterministic stub model
 * (`Agent.streamFn`, following the `agent-session-concurrent.test.ts` pattern) emits
 * a genuine `toolCall` for `echo` on its first turn, then — once the tool result has
 * flowed back into the context — completes on its second turn. Everything else is the
 * real machinery:
 *   - a real `ChatHandler` + a real `AgentSession` + a fake `BridgeServer` capturing send();
 *   - registration goes through the ChatHandler `onMessage` `set_host_tools` path
 *     (→ bridge.setTools → session.refreshRpcHostTools), exactly as the WS client would;
 *   - the agent turn invokes the registered `echo` tool → the RpcHostToolAdapter routes
 *     through the ChatHandler-owned `RpcHostToolBridge` → a real `host_tool_call` frame is
 *     emitted through `send()`;
 *   - the matching `host_tool_result` (a proper `AgentToolResult` with `content[]`) is
 *     injected back through `onMessage`, resolving the pending call;
 *   - the tool output then flows back into the turn: the model is called a SECOND time
 *     with the echo result in context, and the turn completes.
 *
 * No production code is added — A1–A3 built the module, frames, guards, and ChatHandler
 * wiring; this test only exercises them end-to-end.
 */

class FakeBridgeServer {
	sent: Array<Record<string, unknown>> = [];
	#onMessage: Array<(m: Record<string, unknown>) => void> = [];
	#onDisconnected: Array<() => void> = [];

	send(payload: unknown): void {
		this.sent.push(payload as Record<string, unknown>);
	}
	onMessage(cb: (m: Record<string, unknown>) => void): void {
		this.#onMessage.push(cb);
	}
	onDisconnected(cb: () => void): void {
		this.#onDisconnected.push(cb);
	}

	// ---- test drivers ----
	emit(msg: Record<string, unknown>): void {
		for (const cb of this.#onMessage) cb(msg);
	}
	ofType(type: string): Array<Record<string, unknown>> {
		return this.sent.filter(frame => frame.type === type);
	}
}

const ECHO_DEF = {
	name: "echo",
	description: "Echo back the provided text",
	parameters: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
	},
};

const ECHO_CALL_ID = "call_echo_1";
const ECHO_INPUT = "hello host tool";
const ECHO_OUTPUT = `echoed: ${ECHO_INPUT}`;

function baseAssistant(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
	return {
		role: "assistant",
		content,
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
		stopReason,
		timestamp: Date.now(),
	};
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error("Timed out waiting for condition");
}

describe("#2046 A4 — echo host tool end-to-end over the WS channel", () => {
	let session: AgentSession;
	let handler: ChatHandler;
	let server: FakeBridgeServer;
	let tempDir: string;
	const authStorages: AuthStorage[] = [];
	// Captured per model call so the test can prove the tool result flowed back in.
	const callContexts: Context[] = [];

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-a4-host-tool-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
		callContexts.length = 0;
	});

	afterEach(async () => {
		handler?.dispose();
		if (session) await session.dispose();
		for (const authStorage of authStorages.splice(0)) authStorage.close();
		if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
	});

	async function makeSession(): Promise<AgentSession> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;

		const toolCall: ToolCall = {
			type: "toolCall",
			id: ECHO_CALL_ID,
			name: "echo",
			arguments: { text: ECHO_INPUT },
		};

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
			streamFn: (_model, context) => {
				callContexts.push({ ...context, messages: [...context.messages] });
				const stream = new AssistantMessageEventStream();
				const isFirstCall = callContexts.length === 1;
				queueMicrotask(() => {
					if (isFirstCall) {
						// Turn 1: the model decides to call the registered host tool.
						const msg = baseAssistant([toolCall], "toolUse");
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "toolUse", message: msg });
					} else {
						// Turn 2: the echo result is now in context — the model finishes.
						const msg = baseAssistant([{ type: "text", text: "done" }], "stop");
						stream.push({ type: "start", partial: msg });
						stream.push({ type: "done", reason: "stop", message: msg });
					}
				});
				return stream;
			},
		});

		const authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
		authStorages.push(authStorage);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));

		return new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry,
		});
	}

	it("registers echo via set_host_tools, the agent calls it, the injected result completes the turn", async () => {
		session = await makeSession();
		server = new FakeBridgeServer();
		handler = new ChatHandler(server as unknown as BridgeServer, session);
		handler.attach();

		// 1. Register the host tool through the real ChatHandler onMessage path (as a WS
		//    client would), and wait for the ack that proves refreshRpcHostTools finished.
		server.emit({ type: "set_host_tools", tools: [ECHO_DEF] });
		await waitFor(() => server.ofType("set_host_tools_ack").length === 1);
		expect(server.ofType("set_host_tools_ack")[0].toolNames).toEqual(["echo"]);
		// The tool is now exposed to the agent.
		expect(session.getActiveToolNames()).toContain("echo");

		// 2. Drive a real agent turn. The stub model emits a genuine toolCall for `echo`;
		//    the agent executes the registered adapter, which round-trips a host_tool_call.
		const turn = session.prompt("please echo something");

		// 3. The agent's tool execution emits a real host_tool_call frame through send().
		await waitFor(() => server.ofType("host_tool_call").length === 1);
		const call = server.ofType("host_tool_call")[0];
		expect(call.toolName).toBe("echo");
		expect(call.toolCallId).toBe(ECHO_CALL_ID);
		expect(call.arguments).toEqual({ text: ECHO_INPUT });
		expect(typeof call.id).toBe("string");

		// 4. Inject the matching host_tool_result (a proper AgentToolResult) via onMessage.
		server.emit({
			type: "host_tool_result",
			id: call.id as string,
			result: { content: [{ type: "text", text: ECHO_OUTPUT }] },
		});

		// 5. The turn COMPLETES using that result: prompt() resolves, the model was called a
		//    second time, and the echo output is present in that second call's context —
		//    proving the host tool's output flowed back into the agent loop.
		await turn;
		expect(session.isStreaming).toBe(false);
		expect(callContexts).toHaveLength(2);
		const secondContext = JSON.stringify(callContexts[1].messages);
		expect(secondContext).toContain(ECHO_OUTPUT);
		expect(secondContext).toContain(ECHO_CALL_ID);
	});
});
