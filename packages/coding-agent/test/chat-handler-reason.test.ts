import { describe, expect, it } from "bun:test";
import { ChatHandler, classifyChatErrorReason } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession, AgentSessionEvent } from "@f5-sales-demo/xcsh/session/agent-session";

/** Harness exposing the bridge onMessage/onDisconnected hooks and captured sends,
 * with a prompt() that can be made to reject. */
function makeFakes(opts: { isStreaming?: boolean; promptRejects?: string } = {}) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let onDisc: () => void = () => {};
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
		isStreaming: opts.isStreaming ?? false,
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
		expect(classifyChatErrorReason("403 forbidden")).toBe("provider-4xx");
	});
	it("returns undefined for an unclassified error (panel shows raw text)", () => {
		expect(classifyChatErrorReason("something weird happened")).toBeUndefined();
	});
});

describe("ChatHandler emits a machine-readable reason on every terminal chat_error", () => {
	it("session-busy → reason 'session-busy'", async () => {
		const { sent, server, session, fire } = makeFakes({ isStreaming: true });
		new ChatHandler(server, session).attach();
		await fire({ type: "chat_request", id: "c-1", text: "hi", context: null, mode: "educational" });
		await new Promise(r => setTimeout(r, 5));
		expect(errorsOf(sent)).toEqual([
			{ type: "chat_error", id: "c-1", error: "session busy", reason: "session-busy" },
		]);
	});

	it("bridge disconnect mid-turn → reason 'bridge-disconnected'", async () => {
		const { sent, server, session, fire, disconnect } = makeFakes({ promptRejects: undefined });
		new ChatHandler(server, session).attach();
		// Start a turn but keep it pending by never resolving deltas; then disconnect.
		void fire({ type: "chat_request", id: "c-2", text: "hi", context: null, mode: "educational" });
		disconnect();
		const err = errorsOf(sent).find(e => e.reason === "bridge-disconnected");
		expect(err).toEqual({
			type: "chat_error",
			id: "c-2",
			error: "bridge disconnected",
			reason: "bridge-disconnected",
		});
	});

	it("prompt rejection → classified reason (provider-4xx)", async () => {
		const { sent, server, session, fire } = makeFakes({ promptRejects: "HTTP 400 Invalid model name" });
		new ChatHandler(server, session).attach();
		await fire({ type: "chat_request", id: "c-3", text: "hi", context: null, mode: "educational" });
		await new Promise(r => setTimeout(r, 5));
		const err = errorsOf(sent).find(e => e.id === "c-3" && e.type === "chat_error");
		expect(err?.reason).toBe("provider-4xx");
	});

	it("dispose with an in-flight turn → reason 'session-disposed'", async () => {
		const { sent, server, session, fire } = makeFakes();
		const handler = new ChatHandler(server, session);
		handler.attach();
		void fire({ type: "chat_request", id: "c-4", text: "hi", context: null, mode: "educational" });
		handler.dispose();
		const err = errorsOf(sent).find(e => e.reason === "session-disposed");
		expect(err).toEqual({ type: "chat_error", id: "c-4", error: "session disposed", reason: "session-disposed" });
	});
});
