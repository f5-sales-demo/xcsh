import { describe, expect, it } from "bun:test";
import { isChatRequest, isChatStop } from "../../src/browser/chat-protocol";

describe("isChatRequest", () => {
	it("accepts a valid browser chat_request with explicit tab and session routing", () => {
		expect(
			isChatRequest(
				{
					type: "chat_request",
					id: "c-abc123",
					text: "hello",
					context: null,
					mode: "educational",
					tabId: 7,
					sessionKey: "example-corp|production",
					history_hint: "conv-1",
				},
				"browser",
			),
		).toBe(true);
	});

	it("rejects browser chat_request frames missing either routing field", () => {
		const request = {
			type: "chat_request",
			id: "c-abc123",
			text: "hello",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		};
		expect(isChatRequest({ ...request, tabId: undefined }, "browser")).toBe(false);
		expect(isChatRequest({ ...request, sessionKey: undefined }, "browser")).toBe(false);
	});

	it("rejects missing c- prefix", () => {
		expect(
			isChatRequest(
				{
					type: "chat_request",
					id: "abc123",
					text: "hello",
					context: null,
					mode: "educational",
					history_hint: "conv-1",
				},
				"transport",
			),
		).toBe(false);
	});

	it("rejects non-string id", () => {
		expect(
			isChatRequest(
				{
					type: "chat_request",
					id: 123,
					text: "hello",
					mode: "educational",
				},
				"transport",
			),
		).toBe(false);
	});

	it("rejects invalid mode", () => {
		expect(
			isChatRequest(
				{
					type: "chat_request",
					id: "c-abc",
					text: "hello",
					mode: "invalid_mode",
				},
				"transport",
			),
		).toBe(false);
	});

	it("rejects wrong type", () => {
		expect(
			isChatRequest(
				{
					type: "tool_result",
					id: "c-abc",
					text: "hello",
					mode: "educational",
				},
				"transport",
			),
		).toBe(false);
	});

	it("accepts all valid modes", () => {
		for (const mode of ["educational", "presentation", "configuration", "screenshot", "annotation"]) {
			expect(
				isChatRequest(
					{
						type: "chat_request",
						id: "c-x",
						text: "hi",
						mode,
					},
					"transport",
				),
			).toBe(true);
		}
	});

	it("accepts chat_request without history_hint (optional field)", () => {
		expect(
			isChatRequest(
				{
					type: "chat_request",
					id: "c-abc",
					text: "hello",
					mode: "educational",
				},
				"transport",
			),
		).toBe(true);
	});
});

describe("isChatStop", () => {
	it("accepts a valid chat_stop with c- prefix", () => {
		expect(isChatStop({ type: "chat_stop", id: "c-abc123" })).toBe(true);
	});

	it("rejects missing c- prefix", () => {
		expect(isChatStop({ type: "chat_stop", id: "abc123" })).toBe(false);
	});

	it("rejects wrong type", () => {
		expect(isChatStop({ type: "chat_request", id: "c-abc" })).toBe(false);
	});
});
