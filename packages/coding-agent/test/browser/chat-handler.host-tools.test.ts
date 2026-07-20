import { describe, expect, it } from "bun:test";
import type { AgentTool, AgentToolResult } from "@f5-sales-demo/pi-agent-core";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession } from "@f5-sales-demo/xcsh/session/agent-session";

/**
 * A2/A3 host-tool wiring tests for `ChatHandler`.
 *
 * A fake `BridgeServer` captures every `send()` frame and lets the test drive the
 * inbound `onMessage`/`onDisconnected` paths, while a stub `AgentSession` captures
 * the `AgentTool[]` handed to `refreshRpcHostTools` so the test can invoke the
 * produced tool's `execute()` directly (that is how the agent loop drives a host
 * tool in production — the adapter's `execute` funnels into the bridge).
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
	disconnect(): void {
		for (const cb of this.#onDisconnected) cb();
	}
	ofType(type: string): Array<Record<string, unknown>> {
		return this.sent.filter(frame => frame.type === type);
	}
}

class FakeAgentSession {
	refreshedTools: AgentTool[] | null = null;
	isStreaming = false;
	agent = {
		abort(): void {},
		replaceMessages(): void {},
	};
	subscribe(): () => void {
		return () => {};
	}
	async prompt(): Promise<void> {}
	async refreshRpcHostTools(tools: AgentTool[]): Promise<void> {
		this.refreshedTools = tools;
	}
}

function makeHandler(): { handler: ChatHandler; server: FakeBridgeServer; session: FakeAgentSession } {
	const server = new FakeBridgeServer();
	const session = new FakeAgentSession();
	const handler = new ChatHandler(server as unknown as BridgeServer, session as unknown as AgentSession);
	handler.attach();
	return { handler, server, session };
}

const ECHO_DEF = {
	name: "echo",
	description: "Echo back the provided message",
	parameters: { type: "object", properties: { message: { type: "string" } } },
};

function setHostTools(server: FakeBridgeServer): void {
	server.emit({ type: "set_host_tools", tools: [ECHO_DEF] });
}

const okResult: AgentToolResult<unknown> = { content: [{ type: "text", text: "pong" }] };

describe("ChatHandler host-tool wiring (#2046 A3)", () => {
	it("(1) set_host_tools → registers mapped tools and sends an ack", async () => {
		const { server, session } = makeHandler();
		setHostTools(server);
		// refreshRpcHostTools runs on the microtask queue (async handler); flush it.
		await Promise.resolve();

		expect(session.refreshedTools).not.toBeNull();
		expect(session.refreshedTools?.map(t => t.name)).toEqual(["echo"]);

		const acks = server.ofType("set_host_tools_ack");
		expect(acks).toHaveLength(1);
		expect(acks[0].toolNames).toEqual(["echo"]);
	});

	it("(2) invoking the registered AgentTool emits a host_tool_call frame", async () => {
		const { server, session } = makeHandler();
		setHostTools(server);
		await Promise.resolve();

		const tool = session.refreshedTools?.[0];
		expect(tool).toBeDefined();
		// Drive the tool exactly as the agent loop would.
		void tool?.execute("tc-1", { message: "hi" });

		const calls = server.ofType("host_tool_call");
		expect(calls).toHaveLength(1);
		expect(calls[0].toolName).toBe("echo");
		expect(calls[0].toolCallId).toBe("tc-1");
		expect(calls[0].arguments).toEqual({ message: "hi" });
		expect(typeof calls[0].id).toBe("string");
	});

	it("(3) a matching host_tool_result resolves the tool's execute promise", async () => {
		const { server, session } = makeHandler();
		setHostTools(server);
		await Promise.resolve();

		const tool = session.refreshedTools?.[0];
		const execution = tool?.execute("tc-1", { message: "hi" });

		const callId = server.ofType("host_tool_call")[0].id as string;
		server.emit({ type: "host_tool_result", id: callId, result: okResult });

		await expect(execution).resolves.toEqual(okResult);
	});

	it("(4) aborting mid-flight emits a host_tool_cancel frame and rejects", async () => {
		const { server, session } = makeHandler();
		setHostTools(server);
		await Promise.resolve();

		const tool = session.refreshedTools?.[0];
		const controller = new AbortController();
		const execution = tool?.execute("tc-1", { message: "hi" }, controller.signal);

		const callId = server.ofType("host_tool_call")[0].id as string;
		controller.abort();

		const cancels = server.ofType("host_tool_cancel");
		expect(cancels).toHaveLength(1);
		expect(cancels[0].targetId).toBe(callId);

		await expect(execution).rejects.toThrow(/aborted/i);
	});

	it("(5a) onDisconnected rejects pending host-tool calls", async () => {
		const { server, session } = makeHandler();
		setHostTools(server);
		await Promise.resolve();

		const tool = session.refreshedTools?.[0];
		const execution = tool?.execute("tc-1", { message: "hi" });
		expect(server.ofType("host_tool_call")).toHaveLength(1);

		server.disconnect();

		await expect(execution).rejects.toThrow(/bridge disconnected/i);
	});

	it("(5b) dispose() rejects pending host-tool calls", async () => {
		const { handler, server, session } = makeHandler();
		setHostTools(server);
		await Promise.resolve();

		const tool = session.refreshedTools?.[0];
		const execution = tool?.execute("tc-1", { message: "hi" });
		expect(server.ofType("host_tool_call")).toHaveLength(1);

		handler.dispose();

		await expect(execution).rejects.toThrow(/bridge disconnected/i);
	});

	it("(6) malformed set_host_tools emits set_host_tools_error (nack), never an ack", async () => {
		const { server, session } = makeHandler();
		// A tool with no description → normalizeHostToolDefinitions throws. Without a
		// nack, a client awaiting set_host_tools_ack would hang forever.
		server.emit({ type: "set_host_tools", tools: [{ name: "bad", parameters: {} }] });
		await Promise.resolve();
		await Promise.resolve();

		expect(server.ofType("set_host_tools_ack")).toHaveLength(0);
		const errs = server.ofType("set_host_tools_error");
		expect(errs).toHaveLength(1);
		expect(typeof errs[0].error).toBe("string");
		expect(errs[0].error).toMatch(/description/i);
		// Registration never happened, so the prior tool set is untouched.
		expect(session.refreshedTools).toBeNull();
	});
});
