import { describe, expect, it } from "bun:test";
import "../../src/tools/submit-result";
import { subprocessToolRegistry } from "../../src/task/subprocess-tool-registry";

describe("submit_result subprocess extraction", () => {
	const handler = subprocessToolRegistry.getHandler("submit_result");

	it("extracts valid submit_result payloads", () => {
		expect(handler?.extractData).toBeDefined();
		const data = handler?.extractData?.({
			toolName: "submit_result",
			toolCallId: "call-1",
			result: {
				content: [{ type: "text", text: "Result submitted." }],
				details: { status: "success", data: { ok: true } },
			},
			isError: false,
		});
		expect(data).toEqual({ status: "success", data: { ok: true }, error: undefined });
	});

	it("ignores malformed submit_result details without status", () => {
		const data = handler?.extractData?.({
			toolName: "submit_result",
			toolCallId: "call-2",
			result: {
				content: [{ type: "text", text: "Tool execution was aborted." }],
				details: {},
			},
			isError: true,
		});
		expect(data).toBeUndefined();
	});

	it("extracts aborted status with error message", () => {
		const data = handler?.extractData?.({
			toolName: "submit_result",
			toolCallId: "call-3",
			result: {
				content: [{ type: "text", text: "Result submitted." }],
				details: { status: "aborted", error: "blocked by permissions" },
			},
			isError: false,
		});
		expect(data).toEqual({ status: "aborted", data: undefined, error: "blocked by permissions" });
	});

	it("returns undefined when result is missing", () => {
		const data = handler?.extractData?.({
			toolName: "submit_result",
			toolCallId: "call-4",
		});
		expect(data).toBeUndefined();
	});

	it("shouldTerminate returns true for non-error events", () => {
		expect(handler?.shouldTerminate).toBeDefined();
		const result = handler?.shouldTerminate?.({
			toolName: "submit_result",
			toolCallId: "call-5",
			isError: false,
		});
		expect(result).toBe(true);
	});

	it("shouldTerminate returns false for error events", () => {
		const result = handler?.shouldTerminate?.({
			toolName: "submit_result",
			toolCallId: "call-6",
			isError: true,
		});
		expect(result).toBe(false);
	});
});
