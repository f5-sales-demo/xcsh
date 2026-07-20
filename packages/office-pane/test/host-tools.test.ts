/**
 * Host-tool frame guards + result-shape contract.
 *
 * Source of truth (native): xcsh's
 *   packages/coding-agent/src/browser/chat-protocol.ts (host-tool frames)
 *   packages/coding-agent/src/host-tools/types.ts       (AgentToolResult content[])
 *
 * Load-bearing invariant: a host-tool result is an `AgentToolResult` whose
 * payload is a `content[]` array — NEVER `{ data }`.
 */
import { describe, expect, it } from "bun:test";
import type { AgentToolResult, HostToolResult } from "../src/core/protocol";
import { isHostToolCall, isHostToolCancel } from "../src/core/protocol";

describe("isHostToolCall", () => {
	it("accepts a valid host_tool_call frame", () => {
		expect(
			isHostToolCall({
				type: "host_tool_call",
				id: "ht-1",
				toolCallId: "tc-1",
				toolName: "read_range",
				arguments: { sheet: "Sheet1" },
			}),
		).toBe(true);
	});

	it("rejects the wrong type discriminant", () => {
		expect(
			isHostToolCall({ type: "host_tool_cancel", id: "ht-1", toolName: "x", toolCallId: "a", arguments: {} }),
		).toBe(false);
	});

	it("rejects a non-string id", () => {
		expect(isHostToolCall({ type: "host_tool_call", id: 1, toolCallId: "tc", toolName: "x", arguments: {} })).toBe(
			false,
		);
	});

	it("rejects a non-string toolName", () => {
		expect(
			isHostToolCall({ type: "host_tool_call", id: "ht-1", toolCallId: "tc", toolName: 42, arguments: {} }),
		).toBe(false);
	});

	it("rejects non-objects", () => {
		expect(isHostToolCall(null)).toBe(false);
		expect(isHostToolCall("host_tool_call")).toBe(false);
	});
});

describe("isHostToolCancel", () => {
	it("accepts a valid host_tool_cancel frame", () => {
		expect(isHostToolCancel({ type: "host_tool_cancel", id: "ht-1", targetId: "tc-1" })).toBe(true);
	});

	it("rejects the wrong type discriminant", () => {
		expect(isHostToolCancel({ type: "host_tool_call", id: "ht-1", targetId: "tc-1" })).toBe(false);
	});

	it("rejects a non-string id", () => {
		expect(isHostToolCancel({ type: "host_tool_cancel", id: 7, targetId: "tc-1" })).toBe(false);
	});

	it("rejects a non-string targetId", () => {
		expect(isHostToolCancel({ type: "host_tool_cancel", id: "ht-1", targetId: 9 })).toBe(false);
	});

	it("rejects non-objects", () => {
		expect(isHostToolCancel(undefined)).toBe(false);
	});
});

describe("AgentToolResult shape (content[], never {data})", () => {
	it("a HostToolResult typechecks with a content[] result", () => {
		const result: AgentToolResult = {
			content: [{ type: "text", text: "A1: 42" }],
			details: { rows: 1 },
		};
		const frame: HostToolResult = { type: "host_tool_result", id: "ht-1", result };
		// Runtime shape assertion: the load-bearing field is `content` (an array).
		expect(Array.isArray(frame.result.content)).toBe(true);
		expect(frame.result.content[0]?.type).toBe("text");
		// `data` is NOT part of the contract.
		expect("data" in frame.result).toBe(false);
	});

	it("rejects a {data} result shape at compile time", () => {
		// @ts-expect-error — host-tool results are content[], NEVER { data }.
		const bad: AgentToolResult = { data: { value: 42 } };
		// Reference `bad` so it is not elided; the compile-time error above is the assertion.
		expect(bad).toBeDefined();
	});
});
