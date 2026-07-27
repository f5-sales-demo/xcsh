import { describe, expect, it } from "bun:test";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession, AgentSessionEvent } from "@f5-sales-demo/xcsh/session/agent-session";

function makeFakes(deltas: string[] = ["Hi"]) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let listener: ((e: AgentSessionEvent) => void) | null = null;
	const server = {
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: () => {},
	} as unknown as BridgeServer;
	const session = {
		isStreaming: false,
		// The handler reads this to expand a `/name` before composing the prompt; a fake
		// that omits it is lying about AgentSession's shape (the cast hides it from tsc).
		slashCommands: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: (cb: (e: AgentSessionEvent) => void) => {
			listener = cb;
			return () => {};
		},
		prompt: async () => {
			for (const delta of deltas) {
				listener?.({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta },
				} as AgentSessionEvent);
			}
		},
	} as unknown as AgentSession;
	return { sent, server, session, fire: (m: Record<string, unknown>) => onMsg(m) };
}

describe("ChatHandler TTFT spans", () => {
	it("emits provider_ttft + chat_handler span frames tagged with the turn id, once", async () => {
		const { sent, server, session, fire } = makeFakes();
		new ChatHandler(server, session).attach();
		await fire({ type: "chat_request", id: "c-1", text: "hi", context: null, mode: "educational" });
		await new Promise(r => setTimeout(r, 10));

		const spans = sent.filter(f => f.type === "span");
		const stages = spans.map(s => s.stage).sort();
		expect(stages).toEqual(["chat_handler", "provider_ttft"]);
		for (const s of spans) {
			expect(s.id).toBe("c-1");
			expect(typeof s.ms).toBe("number");
			expect(s.ms as number).toBeGreaterThanOrEqual(0);
		}
		expect(spans.length).toBe(2);
	});

	it("emits the chat spans only once even when multiple text_deltas arrive", async () => {
		// Spec §7 once-latch: the first text_delta latches the TTFT/handler spans; every
		// subsequent delta in the same turn must NOT re-emit them. Two deltas → still 2 spans.
		const { sent, server, session, fire } = makeFakes(["A", "B"]);
		new ChatHandler(server, session).attach();
		await fire({ type: "chat_request", id: "c-2", text: "hi", context: null, mode: "educational" });
		await new Promise(r => setTimeout(r, 10));

		expect(sent.filter(f => f.type === "span").length).toBe(2);
	});
});

describe("ChatHandler onTurnStart hook", () => {
	it("fires the registered callback once when a turn is accepted (drives the manager keepalive)", async () => {
		const { server, session, fire } = makeFakes();
		let starts = 0;
		const handler = new ChatHandler(server, session);
		handler.onTurnStart(() => {
			starts += 1;
		});
		handler.attach();
		await fire({ type: "chat_request", id: "c-1", text: "hi", context: null, mode: "educational" });
		await new Promise(r => setTimeout(r, 10));
		expect(starts).toBe(1);
	});

	it("does not fire for a rejected (session-busy) turn", async () => {
		const { server, session, fire } = makeFakes();
		(session as unknown as { isStreaming: boolean }).isStreaming = true; // already streaming → busy
		let starts = 0;
		const handler = new ChatHandler(server, session);
		handler.onTurnStart(() => {
			starts += 1;
		});
		handler.attach();
		await fire({ type: "chat_request", id: "c-2", text: "hi", context: null, mode: "educational" });
		await new Promise(r => setTimeout(r, 10));
		expect(starts).toBe(0);
	});
});
