import { describe, expect, it } from "bun:test";
import { isHostToolResult, isHostToolUpdate, isSetHostTools } from "../../src/browser/chat-protocol";

// A well-formed AgentToolResult carries a `content[]` array (NOT a `{ data }`
// object). The host-tool guards must lock this shape so a malformed client
// reply is rejected at the door rather than hanging a pending call.
const validResult = {
	content: [{ type: "text", text: "ok" }],
	details: {},
};

describe("isSetHostTools", () => {
	it("accepts a set_host_tools with a tools array", () => {
		expect(
			isSetHostTools({
				type: "set_host_tools",
				tools: [
					{
						name: "read_range",
						description: "Read a range",
						parameters: { type: "object" },
					},
				],
			}),
		).toBe(true);
	});

	it("accepts a set_host_tools with an empty tools array", () => {
		expect(isSetHostTools({ type: "set_host_tools", tools: [] })).toBe(true);
	});

	it("rejects set_host_tools missing tools", () => {
		expect(isSetHostTools({ type: "set_host_tools" })).toBe(false);
	});

	it("rejects set_host_tools whose tools is not an array", () => {
		expect(isSetHostTools({ type: "set_host_tools", tools: { name: "x" } })).toBe(false);
	});

	it("rejects wrong type", () => {
		expect(isSetHostTools({ type: "chat_request", tools: [] })).toBe(false);
	});
});

describe("isHostToolResult", () => {
	it("accepts a host_tool_result whose result.content is an array", () => {
		expect(
			isHostToolResult({
				type: "host_tool_result",
				id: "h-1",
				result: validResult,
			}),
		).toBe(true);
	});

	it("accepts a host_tool_result with isError", () => {
		expect(
			isHostToolResult({
				type: "host_tool_result",
				id: "h-1",
				result: validResult,
				isError: true,
			}),
		).toBe(true);
	});

	it("rejects a host_tool_result whose result has no content array (the {data} shape)", () => {
		expect(
			isHostToolResult({
				type: "host_tool_result",
				id: "h-1",
				result: { data: "ok" },
			}),
		).toBe(false);
	});

	it("rejects a host_tool_result whose result.content is not an array", () => {
		expect(
			isHostToolResult({
				type: "host_tool_result",
				id: "h-1",
				result: { content: "ok" },
			}),
		).toBe(false);
	});

	it("rejects a non-string id", () => {
		expect(
			isHostToolResult({
				type: "host_tool_result",
				id: 123,
				result: validResult,
			}),
		).toBe(false);
	});

	it("rejects wrong type", () => {
		expect(
			isHostToolResult({
				type: "host_tool_update",
				id: "h-1",
				result: validResult,
			}),
		).toBe(false);
	});
});

describe("isHostToolUpdate", () => {
	it("accepts a host_tool_update whose partialResult.content is an array", () => {
		expect(
			isHostToolUpdate({
				type: "host_tool_update",
				id: "h-1",
				partialResult: validResult,
			}),
		).toBe(true);
	});

	it("rejects a host_tool_update whose partialResult has no content array", () => {
		expect(
			isHostToolUpdate({
				type: "host_tool_update",
				id: "h-1",
				partialResult: { data: "ok" },
			}),
		).toBe(false);
	});

	it("rejects a host_tool_update whose partialResult.content is not an array", () => {
		expect(
			isHostToolUpdate({
				type: "host_tool_update",
				id: "h-1",
				partialResult: { content: {} },
			}),
		).toBe(false);
	});

	it("rejects a non-string id", () => {
		expect(
			isHostToolUpdate({
				type: "host_tool_update",
				id: 123,
				partialResult: validResult,
			}),
		).toBe(false);
	});

	it("rejects wrong type", () => {
		expect(
			isHostToolUpdate({
				type: "host_tool_result",
				id: "h-1",
				partialResult: validResult,
			}),
		).toBe(false);
	});
});
