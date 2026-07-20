/**
 * Client-side host-tool dispatcher.
 *
 * Mirror-image of the xcsh agent-side bridge: the client RECEIVES
 * `host_tool_call` / `host_tool_cancel` and SENDS `set_host_tools` /
 * `host_tool_result`. The reply is an `AgentToolResult` (a `content[]` array),
 * NEVER `{ data }`.
 */
import { describe, expect, it } from "bun:test";
import { HostToolDispatcher } from "../src/core/host-tools/dispatcher";
import type { AgentToolResult, HostToolResultMsg, SetHostToolsMsg } from "../src/core/protocol";
import { MockTransport } from "../src/core/transport/mock";

function ok(text: string): AgentToolResult {
	return { content: [{ type: "text", text }], details: {} };
}

/** Extract the first content block's text (the native content union is TextContent | ImageContent). */
function firstText(reply?: HostToolResultMsg): string | undefined {
	const c = reply?.result.content[0];
	return c && c.type === "text" ? c.text : undefined;
}

describe("HostToolDispatcher", () => {
	it("(1) register advertises the tools via a set_host_tools frame", () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);

		d.register([
			{
				definition: { name: "read_range", description: "Read a range", parameters: { type: "object" } },
				handler: async () => ok("unused"),
			},
		]);

		const frame = t.sent.find(m => m.type === "set_host_tools") as SetHostToolsMsg | undefined;
		expect(frame).toBeDefined();
		expect(frame?.tools).toHaveLength(1);
		expect(frame?.tools[0]?.name).toBe("read_range");
		d.dispose();
	});

	it("(2) a host_tool_call runs the handler and replies host_tool_result with its content[], correlated by id", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		let seenArgs: Record<string, unknown> | undefined;

		d.register([
			{
				definition: { name: "read_range", description: "Read a range", parameters: {} },
				handler: async args => {
					seenArgs = args;
					return ok("A1: 42");
				},
			},
		]);

		t.emit({
			type: "host_tool_call",
			id: "ht-1",
			toolCallId: "tc-1",
			toolName: "read_range",
			arguments: { sheet: "Sheet1" },
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(seenArgs).toEqual({ sheet: "Sheet1" });
		const reply = t.sent.find(m => m.type === "host_tool_result") as HostToolResultMsg | undefined;
		expect(reply).toBeDefined();
		expect(reply?.id).toBe("ht-1");
		expect(reply?.isError).toBeUndefined();
		expect(Array.isArray(reply?.result.content)).toBe(true);
		expect(reply?.result.content[0]).toEqual({ type: "text", text: "A1: 42" });
		d.dispose();
	});

	it("(3) a throwing handler still answers with host_tool_result isError:true + a content[] error message", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);

		d.register([
			{
				definition: { name: "boom", description: "Throws", parameters: {} },
				handler: async () => {
					throw new Error("kaboom");
				},
			},
		]);

		t.emit({ type: "host_tool_call", id: "ht-2", toolCallId: "tc-2", toolName: "boom", arguments: {} });
		await Promise.resolve();
		await Promise.resolve();

		const reply = t.sent.find(m => m.type === "host_tool_result") as HostToolResultMsg | undefined;
		expect(reply).toBeDefined();
		expect(reply?.id).toBe("ht-2");
		expect(reply?.isError).toBe(true);
		expect(reply?.result.content[0]).toEqual({ type: "text", text: "kaboom" });
		d.dispose();
	});

	it("(4) an unknown tool is answered with an isError result (never left hanging)", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		d.register([]); // no tools

		t.emit({ type: "host_tool_call", id: "ht-3", toolCallId: "tc-3", toolName: "ghost", arguments: {} });
		await Promise.resolve();

		const reply = t.sent.find(m => m.type === "host_tool_result") as HostToolResultMsg | undefined;
		expect(reply).toBeDefined();
		expect(reply?.id).toBe("ht-3");
		expect(reply?.isError).toBe(true);
		expect(Array.isArray(reply?.result.content)).toBe(true);
		expect(firstText(reply)).toContain("ghost");
		d.dispose();
	});

	it("(5) host_tool_cancel mid-flight aborts the handler signal and cleans up the pending controller", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		let seenSignal: AbortSignal | undefined;

		d.register([
			{
				definition: { name: "slow", description: "Never resolves until aborted", parameters: {} },
				handler: (_args, ctx) =>
					new Promise<AgentToolResult>(resolve => {
						seenSignal = ctx.signal;
						ctx.signal.addEventListener("abort", () => resolve(ok("late")));
					}),
			},
		]);

		t.emit({ type: "host_tool_call", id: "ht-4", toolCallId: "tc-4", toolName: "slow", arguments: {} });
		await Promise.resolve();
		expect(seenSignal?.aborted).toBe(false);
		expect(d.pendingCount).toBe(1);

		t.emit({ type: "host_tool_cancel", id: "ht-cancel", targetId: "ht-4" });
		await Promise.resolve();
		await Promise.resolve();

		expect(seenSignal?.aborted).toBe(true);
		expect(d.pendingCount).toBe(0);
		// Aborted call must NOT send a stale host_tool_result.
		expect(t.sent.some(m => m.type === "host_tool_result")).toBe(false);
		d.dispose();
	});

	it("dispose() unsubscribes so later inbound frames are ignored", async () => {
		const t = new MockTransport();
		const d = new HostToolDispatcher(t);
		let ran = false;
		d.register([
			{
				definition: { name: "x", description: "x", parameters: {} },
				handler: async () => {
					ran = true;
					return ok("x");
				},
			},
		]);
		d.dispose();

		t.emit({ type: "host_tool_call", id: "ht-5", toolCallId: "tc-5", toolName: "x", arguments: {} });
		await Promise.resolve();
		expect(ran).toBe(false);
	});
});
