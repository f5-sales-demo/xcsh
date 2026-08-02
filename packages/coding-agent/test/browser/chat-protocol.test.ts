import { describe, expect, it } from "bun:test";
import { isBrowserChatRequest, isChatStop, isTransportChatRequest } from "../../src/browser/chat-protocol";

describe("chat request routing contracts", () => {
	it("accepts a valid browser chat_request with explicit tab and session routing", () => {
		expect(
			isBrowserChatRequest({
				type: "chat_request",
				id: "c-abc123",
				text: "hello",
				context: null,
				mode: "educational",
				tabId: 7,
				sessionKey: "example-corp|production",
				history_hint: "conv-1",
			}),
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
		expect(isBrowserChatRequest({ ...request, tabId: undefined })).toBe(false);
		expect(isBrowserChatRequest({ ...request, sessionKey: undefined })).toBe(false);
	});

	it("rejects browser routing fields on a transport-bound Office request", () => {
		expect(
			isTransportChatRequest({
				type: "chat_request",
				id: "c-abc123",
				text: "hello",
				context: null,
				mode: "educational",
				tabId: 7,
				sessionKey: "example-corp|production",
			}),
		).toBe(false);
	});

	it("rejects missing c- prefix", () => {
		expect(
			isTransportChatRequest({
				type: "chat_request",
				id: "abc123",
				text: "hello",
				context: null,
				mode: "educational",
				history_hint: "conv-1",
			}),
		).toBe(false);
	});

	it("rejects non-string id", () => {
		expect(
			isTransportChatRequest({
				type: "chat_request",
				id: 123,
				text: "hello",
				mode: "educational",
			}),
		).toBe(false);
	});

	it("rejects invalid mode", () => {
		expect(
			isTransportChatRequest({
				type: "chat_request",
				id: "c-abc",
				text: "hello",
				mode: "invalid_mode",
			}),
		).toBe(false);
	});

	it("rejects wrong type", () => {
		expect(
			isTransportChatRequest({
				type: "tool_result",
				id: "c-abc",
				text: "hello",
				mode: "educational",
			}),
		).toBe(false);
	});

	it("accepts all valid modes", () => {
		for (const mode of ["educational", "presentation", "configuration", "screenshot", "annotation"]) {
			expect(
				isTransportChatRequest({
					type: "chat_request",
					id: "c-x",
					text: "hi",
					mode,
				}),
			).toBe(true);
		}
	});

	it("accepts chat_request without history_hint (optional field)", () => {
		expect(
			isTransportChatRequest({
				type: "chat_request",
				id: "c-abc",
				text: "hello",
				mode: "educational",
			}),
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
