/**
 * Photo/image attachments on a chat turn (Office `+` menu → "Add files or photos").
 *
 * Two contracts:
 *  1. `isChatRequest` accepts a well-formed `images` array and rejects malformed ones.
 *  2. `ChatHandler` forwards `chat_request.images` to `session.prompt` as
 *     `ImageContent[]` (base64 vision blocks) — the engine already renders those.
 */
import { expect, test } from "bun:test";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import { isChatRequest } from "@f5-sales-demo/xcsh/browser/chat-protocol";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession, AgentSessionEvent } from "@f5-sales-demo/xcsh/session/agent-session";

// Harness that captures the options passed to session.prompt so we can assert on
// the forwarded images.
function harness() {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let onDisc: () => void = () => {};
	const promptCalls: Array<{ text: string; options?: Record<string, unknown> }> = [];
	const server = {
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: (cb: () => void) => {
			onDisc = cb;
		},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		agent: { replaceMessages() {}, abort() {} },
		subscribe: (_cb: (e: AgentSessionEvent) => void) => () => {},
		prompt: async (text: string, options?: Record<string, unknown>) => {
			promptCalls.push({ text, options });
		},
	} as unknown as AgentSession;
	return {
		sent,
		server,
		session,
		promptCalls,
		fire: (m: Record<string, unknown>) => onMsg(m),
		disconnect: () => onDisc(),
	};
}

const flush = (ms = 20) => new Promise(r => setTimeout(r, ms));

test("isChatRequest accepts a valid images array", () => {
	expect(
		isChatRequest({
			type: "chat_request",
			id: "c-1",
			text: "describe",
			mode: "educational",
			images: [{ data: "AAAA", mimeType: "image/png" }],
		}),
	).toBe(true);
});

test("isChatRequest accepts a request with no images (optional field)", () => {
	expect(isChatRequest({ type: "chat_request", id: "c-1", text: "hi", mode: "educational" })).toBe(true);
});

test("isChatRequest rejects malformed images", () => {
	// Not an array.
	expect(isChatRequest({ type: "chat_request", id: "c-1", text: "x", mode: "educational", images: "nope" })).toBe(
		false,
	);
	// Missing mimeType.
	expect(
		isChatRequest({ type: "chat_request", id: "c-1", text: "x", mode: "educational", images: [{ data: "AAAA" }] }),
	).toBe(false);
	// Non-string data.
	expect(
		isChatRequest({
			type: "chat_request",
			id: "c-1",
			text: "x",
			mode: "educational",
			images: [{ data: 123, mimeType: "image/png" }],
		}),
	).toBe(false);
});

test("ChatHandler forwards chat_request.images to session.prompt as ImageContent[]", async () => {
	const h = harness();
	new ChatHandler(h.server, h.session).attach();
	h.fire({
		type: "chat_request",
		id: "c-1",
		text: "describe this image",
		context: null,
		mode: "educational",
		images: [{ data: "BASE64DATA", mimeType: "image/png" }],
	});
	await flush();
	expect(h.promptCalls).toHaveLength(1);
	const opts = h.promptCalls[0].options ?? {};
	expect(opts.images).toEqual([{ type: "image", data: "BASE64DATA", mimeType: "image/png" }]);
});

test("ChatHandler omits images (undefined) when the request carries none", async () => {
	const h = harness();
	new ChatHandler(h.server, h.session).attach();
	h.fire({ type: "chat_request", id: "c-1", text: "hi", context: null, mode: "educational" });
	await flush();
	expect(h.promptCalls).toHaveLength(1);
	expect(h.promptCalls[0].options?.images).toBeUndefined();
});
