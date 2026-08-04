import { describe, expect, it } from "bun:test";
import { ChatHandler, classifyChatErrorReason } from "../src/browser/chat-handler";
import type { BridgeServer } from "../src/browser/extension-bridge";
import type { AgentSession, AgentSessionEvent } from "../src/session/agent-session";

/** Harness exposing the bridge onMessage/onDisconnected hooks and captured sends,
 * with a prompt() that can be made to reject. */
function makeFakes(opts: { isStreaming?: boolean; promptRejects?: string } = {}) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let onDisc: () => void = () => {};
	const server = {
		serveKind: "browser",
		clientHost: null,
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: (cb: () => void) => {
			onDisc = cb;
		},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: opts.isStreaming ?? false,
		// The handler reads this to expand a `/name` before composing the prompt; a fake
		// that omits it is lying about AgentSession's shape (the cast hides it from tsc).
		slashCommands: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: (_cb: (e: AgentSessionEvent) => void) => () => {},
		prompt: async () => {
			if (opts.promptRejects) throw new Error(opts.promptRejects);
		},
	} as unknown as AgentSession;
	return { sent, server, session, fire: (m: Record<string, unknown>) => onMsg(m), disconnect: () => onDisc() };
}

const errorsOf = (sent: Record<string, unknown>[]) => sent.filter(f => f.type === "chat_error");

describe("classifyChatErrorReason", () => {
	it("maps token-expiry phrasing to token-expired", () => {
		expect(classifyChatErrorReason("Token is expired. Run aws sso login")).toBe("token-expired");
		expect(classifyChatErrorReason("F5 XC API token expired — run /context create")).toBe("token-expired");
	});
	it("maps 5xx / network failures to provider-5xx (retryable)", () => {
		expect(classifyChatErrorReason("HTTP 503 Service Unavailable")).toBe("provider-5xx");
		expect(classifyChatErrorReason("socket hang up")).toBe("provider-5xx");
	});
	it("maps 4xx / bad-model to provider-4xx", () => {
		expect(classifyChatErrorReason("HTTP 400 Invalid model name")).toBe("provider-4xx");
	});
	it("maps authentication rejections separately from ordinary provider 4xx errors", () => {
		expect(classifyChatErrorReason("401 unauthorized")).toBe("provider-auth");
		expect(classifyChatErrorReason("403 forbidden")).toBe("provider-auth");
		expect(classifyChatErrorReason("Invalid API key")).toBe("provider-auth");
	});
	it("fails closed to provider-5xx for an unclassified error", () => {
		expect(classifyChatErrorReason("something weird happened")).toBe("provider-5xx");
	});
});

describe("ChatHandler emits a machine-readable reason on every terminal chat_error", () => {
	it("session-busy → queues the request (tool_notice, no rejection) instead of rejecting", async () => {
		const { sent, server, session, fire } = makeFakes({ isStreaming: true });
		new ChatHandler(server, session).attach();
		await fire({
			type: "chat_request",
			id: "c-1",
			text: "hi",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		});
		await Bun.sleep(5);
		// Queued, not rejected: a tool_notice tells the panel the prompt is waiting.
		const notices = sent.filter(f => f.type === "chat_tool_notice" && f.tool === "queue");
		expect(notices.length).toBe(1);
		expect(notices[0].detail as string).toContain("queued");
		expect(errorsOf(sent)).toEqual([]); // no session-busy error — queued instead
	});

	it("bridge disconnect mid-turn → reason 'bridge-disconnected'", async () => {
		const { sent, server, session, fire, disconnect } = makeFakes({ promptRejects: undefined });
		new ChatHandler(server, session).attach();
		// Start a turn but keep it pending by never resolving deltas; then disconnect.
		void fire({
			type: "chat_request",
			id: "c-2",
			text: "hi",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		});
		disconnect();
		const err = errorsOf(sent).find(e => e.reason === "bridge-disconnected");
		expect(err).toEqual({
			type: "chat_error",
			id: "c-2",
			reason: "bridge-disconnected",
		});
	});

	it("prompt rejection → classified reason (provider-4xx)", async () => {
		const { sent, server, session, fire } = makeFakes({ promptRejects: "HTTP 400 Invalid model name" });
		new ChatHandler(server, session).attach();
		await fire({
			type: "chat_request",
			id: "c-3",
			text: "hi",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		});
		await Bun.sleep(5);
		const err = errorsOf(sent).find(e => e.id === "c-3" && e.type === "chat_error");
		expect(err?.reason).toBe("provider-4xx");
	});

	it("a queued request replays automatically when the current turn finishes", async () => {
		const { sent, server, session, fire } = makeFakes();
		const handler = new ChatHandler(server, session);
		handler.attach();
		// Start a turn that completes immediately (prompt resolves).
		void fire({
			type: "chat_request",
			id: "c-A",
			text: "first",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		});
		// Before c-A finishes (it's mid-await), queue a second request.
		void fire({
			type: "chat_request",
			id: "c-B",
			text: "second",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		});
		// Wait for both to settle (c-A finishes → c-B replays automatically).
		await Bun.sleep(50);
		// c-B should have produced a chat_done (it ran, not rejected).
		const doneIds = sent.filter(f => f.type === "chat_done").map(f => f.id);
		expect(doneIds).toContain("c-A"); // first turn completed
		expect(doneIds).toContain("c-B"); // queued turn replayed + completed
		expect(errorsOf(sent)).toEqual([]); // no errors — both succeeded
	});

	it("dispose with an in-flight turn → reason 'session-disposed'", async () => {
		const { sent, server, session, fire } = makeFakes();
		const handler = new ChatHandler(server, session);
		handler.attach();
		void fire({
			type: "chat_request",
			id: "c-4",
			text: "hi",
			context: null,
			mode: "educational",
			tabId: 7,
			sessionKey: "example-corp|production",
		});
		handler.dispose();
		const err = errorsOf(sent).find(e => e.reason === "session-disposed");
		expect(err).toEqual({ type: "chat_error", id: "c-4", reason: "session-disposed" });
	});
});
