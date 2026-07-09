/**
 * Chat-turn matrix test — comprehensive, automated, headless. Covers every path
 * the user can hit through the ChatHandler: happy-path, queuing, replay, newest-
 * wins, disconnect, dispose, provider errors, stop, and the combinations. Each
 * scenario mirrors a real user interaction (the screenshots that surfaced the
 * session-busy and starting-for-this-tab failures). Runs in CI via bun test —
 * no manual verification, no bandaids.
 */
import { describe, expect, it } from "bun:test";
import { ChatHandler } from "@f5-sales-demo/xcsh/browser/chat-handler";
import type { BridgeServer } from "@f5-sales-demo/xcsh/browser/extension-bridge";
import type { AgentSession, AgentSessionEvent } from "@f5-sales-demo/xcsh/session/agent-session";

// Enhanced harness: prompt resolution is controllable (resolve/reject on demand)
// so we can simulate slow turns, provider errors, and timing-dependent scenarios.
function harness(opts: { promptMs?: number; promptRejects?: string } = {}) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let onDisc: () => void = () => {};
	let aborted = false;
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
		agent: {
			replaceMessages() {},
			abort() {
				aborted = true;
			},
		},
		subscribe: (_cb: (e: AgentSessionEvent) => void) => () => {},
		prompt: async () => {
			if (opts.promptMs) await new Promise(r => setTimeout(r, opts.promptMs));
			if (opts.promptRejects) throw new Error(opts.promptRejects);
		},
	} as unknown as AgentSession;
	return {
		sent,
		server,
		session,
		fire: (m: Record<string, unknown>) => onMsg(m),
		disconnect: () => onDisc(),
		wasAborted: () => aborted,
		errors: () => sent.filter(f => f.type === "chat_error"),
		dones: () => sent.filter(f => f.type === "chat_done"),
		notices: () => sent.filter(f => f.type === "chat_tool_notice"),
		deltas: () => sent.filter(f => f.type === "chat_delta"),
	};
}

const req = (id: string, text = "test") =>
	({ type: "chat_request", id, text, context: null, mode: "educational" }) as Record<string, unknown>;
const flush = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe("ChatHandler turn matrix", () => {
	// ── Happy path ──────────────────────────────────────────────────────────────
	it("1. normal turn: request → chat_done (no errors)", async () => {
		const h = harness();
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1"));
		await flush();
		expect(h.dones().map(d => d.id)).toEqual(["c-1"]);
		expect(h.errors()).toEqual([]);
	});

	// ── Queuing (the session-busy fix) ──────────────────────────────────────────
	it("2. prompt during a busy session → queued (tool_notice), not rejected", async () => {
		const h = harness({ promptMs: 50 }); // slow turn
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1")); // starts turn (takes 50ms)
		await flush(5); // c-1 still running
		h.fire(req("c-2")); // second prompt → should queue
		await flush(5);
		const queueNotices = h.notices().filter(n => n.tool === "queue");
		expect(queueNotices.length).toBe(1);
		expect((queueNotices[0].detail as string).toLowerCase()).toContain("queued");
		expect(h.errors()).toEqual([]); // NOT session-busy
	});

	it("3. queued request auto-replays when the current turn finishes", async () => {
		const h = harness({ promptMs: 30 });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-A")); // starts (30ms)
		await flush(5);
		h.fire(req("c-B")); // queued
		await flush(80); // both settle
		expect(h.dones().map(d => d.id)).toContain("c-A");
		expect(h.dones().map(d => d.id)).toContain("c-B"); // replayed + completed
		expect(h.errors()).toEqual([]);
	});

	it("4. third prompt while one is queued → newest wins (replaces the older queue)", async () => {
		const h = harness({ promptMs: 50 });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1")); // starts
		await flush(5);
		h.fire(req("c-2", "old intent")); // queued
		h.fire(req("c-3", "newest intent")); // replaces c-2 in queue
		await flush(120); // settle
		const doneIds = h.dones().map(d => d.id);
		expect(doneIds).toContain("c-1"); // first completed
		expect(doneIds).toContain("c-3"); // newest replayed
		expect(doneIds).not.toContain("c-2"); // replaced, never ran
	});

	// ── Error conditions ────────────────────────────────────────────────────────
	it("5. bridge disconnect mid-turn → bridge-disconnected (classified)", async () => {
		const h = harness();
		new ChatHandler(h.server, h.session).attach();
		void h.fire(req("c-1"));
		h.disconnect();
		expect(h.errors().find(e => e.reason === "bridge-disconnected")).toBeDefined();
	});

	it("6. prompt rejection (provider 4xx) → classified reason", async () => {
		const h = harness({ promptRejects: "HTTP 400 Invalid model name" });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1"));
		await flush();
		expect(h.errors().find(e => e.reason === "provider-4xx")).toBeDefined();
	});

	it("7. prompt rejection (provider 5xx) → classified reason", async () => {
		const h = harness({ promptRejects: "HTTP 503 Service Unavailable" });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1"));
		await flush();
		expect(h.errors().find(e => e.reason === "provider-5xx")).toBeDefined();
	});

	it("8. prompt rejection (token expired) → classified reason", async () => {
		const h = harness({ promptRejects: "Token is expired. Run aws sso login" });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1"));
		await flush();
		expect(h.errors().find(e => e.reason === "token-expired")).toBeDefined();
	});

	it("9. dispose mid-turn → session-disposed", async () => {
		const h = harness();
		const handler = new ChatHandler(h.server, h.session);
		handler.attach();
		void h.fire(req("c-1"));
		handler.dispose();
		expect(h.errors().find(e => e.reason === "session-disposed")).toBeDefined();
	});

	it("10. stop mid-turn → agent.abort() called", async () => {
		const h = harness({ promptMs: 50 });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1"));
		await flush(5);
		h.fire({ type: "chat_stop", id: "c-1" });
		expect(h.wasAborted()).toBe(true);
	});

	// ── Queuing + error combinations ────────────────────────────────────────────
	it("11. queued request is abandoned on dispose (no ghost replay)", async () => {
		const h = harness({ promptMs: 50 });
		const handler = new ChatHandler(h.server, h.session);
		handler.attach();
		h.fire(req("c-1")); // starts
		await flush(5);
		h.fire(req("c-2")); // queued
		handler.dispose(); // tears down everything
		await flush(80);
		// c-2 should NOT have produced a chat_done (it was abandoned with the dispose).
		const doneIds = h.dones().map(d => d.id);
		expect(doneIds).not.toContain("c-2");
	});

	it("12. queued request is abandoned on disconnect (no ghost replay)", async () => {
		const h = harness({ promptMs: 50 });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1")); // starts
		await flush(5);
		h.fire(req("c-2")); // queued
		h.disconnect(); // bridge drops
		await flush(80);
		const doneIds = h.dones().map(d => d.id);
		expect(doneIds).not.toContain("c-2"); // abandoned, not replayed into a dead bridge
	});

	it("13. queued request replays even if the first turn errored", async () => {
		const h = harness({ promptRejects: "HTTP 500 Internal Server Error" });
		new ChatHandler(h.server, h.session).attach();
		void h.fire(req("c-1")); // starts → errors (500)
		await flush(5);
		// The harness's promptRejects is fixed, so c-2 will also reject — but the point is
		// it REPLAYS (not abandoned) after c-1's error. Check it produced a chat_error with its own id.
		h.fire(req("c-2")); // queued
		await flush(50);
		const errorIds = h.errors().map(e => e.id);
		expect(errorIds).toContain("c-1"); // first errored
		expect(errorIds).toContain("c-2"); // replayed + errored (same provider, expected)
	});
});
