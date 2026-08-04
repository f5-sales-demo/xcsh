/**
 * Chat-turn matrix test — comprehensive, automated, headless. Covers every path
 * the user can hit through the ChatHandler: happy-path, queuing, replay, newest-
 * wins, disconnect, dispose, provider errors, stop, and the combinations. Each
 * scenario mirrors a real user interaction (the screenshots that surfaced the
 * session-busy and starting-for-this-tab failures). Runs in CI via bun test —
 * no manual verification, no bandaids.
 */
import { describe, expect, it } from "bun:test";
import { ChatHandler } from "../src/browser/chat-handler";
import type { BridgeServer } from "../src/browser/extension-bridge";
import type { AgentSession, AgentSessionEvent } from "../src/session/agent-session";

// Enhanced harness: prompt resolution is controllable (resolve/reject on demand)
// so we can simulate slow turns, provider errors, and timing-dependent scenarios.
function harness(opts: { promptMs?: number; promptRejects?: string; initialStreamingTailMs?: number } = {}) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let onDisc: () => void = () => {};
	let aborted = false;
	let isStreaming = (opts.initialStreamingTailMs ?? 0) > 0;
	const server = {
		serveKind: "office",
		clientHost: "excel",
		send: (p: unknown) => sent.push(p as Record<string, unknown>),
		onMessage: (cb: (m: Record<string, unknown>) => void) => {
			onMsg = cb;
		},
		onDisconnected: (cb: () => void) => {
			onDisc = cb;
		},
	} as unknown as BridgeServer;
	const session = {
		get isStreaming() {
			return isStreaming;
		},
		waitForIdle: async () => {
			if (opts.initialStreamingTailMs)
				await new Promise(resolve => setTimeout(resolve, opts.initialStreamingTailMs));
			isStreaming = false;
		},
		// The handler reads this to expand a `/name` before composing the prompt; a fake
		// that omits it is lying about AgentSession's shape (the cast hides it from tsc).
		slashCommands: [],
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

// Realistic multi-turn harness: each turn's prompt behavior is a function that can
// emit session events (tool_execution_start/end) via the subscriber during execution,
// simulating the catalog_workflow_runner driving browser automation for seconds while
// the user types the next prompt. Behaviors are consumed in order (one per call).
function multiTurnHarness(behaviors: Array<(emit: (e: AgentSessionEvent) => void) => Promise<void>>) {
	const sent: Record<string, unknown>[] = [];
	let onMsg: (m: Record<string, unknown>) => void = () => {};
	let onDisc: () => void = () => {};
	let subscriber: ((e: AgentSessionEvent) => void) | null = null;
	let callIndex = 0;

	const server = {
		serveKind: "office",
		clientHost: "excel",
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
		// The handler reads this to expand a `/name` before composing the prompt; a fake
		// that omits it is lying about AgentSession's shape (the cast hides it from tsc).
		slashCommands: [],
		agent: { replaceMessages() {}, abort() {} },
		subscribe: (cb: (e: AgentSessionEvent) => void) => {
			subscriber = cb;
			return () => {
				subscriber = null;
			};
		},
		prompt: async () => {
			const fn = behaviors[callIndex] ?? behaviors[behaviors.length - 1];
			callIndex++;
			await fn(e => subscriber?.(e));
		},
	} as unknown as AgentSession;

	return {
		sent,
		server,
		session,
		fire: (m: Record<string, unknown>) => onMsg(m),
		disconnect: () => onDisc(),
		errors: () => sent.filter(f => f.type === "chat_error"),
		dones: () => sent.filter(f => f.type === "chat_done"),
		toolNotices: () => sent.filter(f => f.type === "chat_tool_notice"),
	};
}

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

	it("4a. request queued during the terminal streaming tail self-drains without an active chat", async () => {
		const h = harness({ initialStreamingTailMs: 10 });
		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-tail"));
		await flush(5);
		expect(h.notices().some(notice => notice.type === "chat_tool_notice" && notice.tool === "queue")).toBe(true);
		expect(h.dones().map(done => done.id)).not.toContain("c-tail");

		await flush(40);
		expect(h.dones().map(done => done.id)).toContain("c-tail");
		expect(h.errors()).toEqual([]);
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

// ============================================================================
// Realistic multi-turn scenarios (mirror the actual user screenshots)
// ============================================================================
// These simulate the EXACT scenario from the bug report: the user sends
// "navigate into WAAP tile" → xcsh drives browser automation (tool calls running
// for seconds) → the user immediately types "create an http load balancer with
// an origin pool..." → the second prompt should queue and auto-replay once the
// navigation turn finishes, not reject with session-busy.

describe("realistic multi-turn scenarios (screenshot regressions)", () => {
	it("14. navigate + create LB: second prompt queues during first turn's tool execution → both complete", async () => {
		// Turn 1: "navigate into web app and api protection tile"
		// — the agent responds with text, then runs a browser-automation tool for ~2s.
		// Turn 2: "create an http load balancer..." sent while turn 1's tool is running.
		const h = multiTurnHarness([
			// Turn 1 behavior: emit text delta, then run a slow tool (catalog_workflow_runner).
			async emit => {
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "Taking you into Web App & API Protection now" },
				} as AgentSessionEvent);
				emit({
					type: "tool_execution_start",
					toolName: "catalog_workflow_runner",
				} as unknown as AgentSessionEvent);
				await new Promise(r => setTimeout(r, 200)); // tool running for 200ms (simulated)
				emit({
					type: "tool_execution_end",
					toolName: "catalog_workflow_runner",
				} as unknown as AgentSessionEvent);
			},
			// Turn 2 behavior: straightforward response with text.
			async emit => {
				emit({
					type: "message_update",
					assistantMessageEvent: {
						type: "text_delta",
						delta: "Creating load balancer foobazz-delete — watch the browser.",
					},
				} as AgentSessionEvent);
			},
		]);

		new ChatHandler(h.server, h.session).attach();
		// User sends turn 1 (navigation).
		h.fire(req("c-nav", "navigate into web app and api protection tile"));
		// Wait briefly (the tool is mid-execution), then user sends turn 2.
		await flush(50);
		h.fire(
			req(
				"c-lb",
				"create an http load balancer with an origin pool that points to httpbin with an app firewall on the load balancer",
			),
		);
		// Wait for everything to settle (turn 1 finishes → turn 2 replays).
		await flush(500);

		// BOTH turns must produce chat_done (no session-busy, no error).
		const doneIds = h.dones().map(d => d.id);
		expect(doneIds).toContain("c-nav"); // navigation completed
		expect(doneIds).toContain("c-lb"); // LB creation replayed + completed
		expect(h.errors()).toEqual([]); // no errors — both succeeded

		// Turn 2 was queued (tool_notice), not rejected.
		const queueNotices = h.toolNotices().filter(n => n.tool === "queue");
		expect(queueNotices.length).toBe(1);
		expect(queueNotices[0].id).toBe("c-lb");

		// Turn 1 emitted tool_execution_start/end (the browser automation the user saw).
		const toolNotices = h.toolNotices().filter(n => n.tool === "catalog_workflow_runner");
		expect(toolNotices.length).toBe(2); // start + end
	});

	it("15. three rapid-fire prompts: first runs, second queued, third replaces second → only first + third run", async () => {
		// User rapidly types three commands without waiting for any to finish.
		const h = multiTurnHarness([
			async () => {
				await new Promise(r => setTimeout(r, 100));
			}, // turn 1 slow
			async () => {}, // turn 3 (turn 2 never runs — replaced)
		]);

		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1", "navigate to origin pools")); // starts
		await flush(10);
		h.fire(req("c-2", "create health check called foo")); // queued
		h.fire(req("c-3", "create http load balancer foobazz-delete")); // replaces c-2
		await flush(300);

		const doneIds = h.dones().map(d => d.id);
		expect(doneIds).toContain("c-1"); // first ran
		expect(doneIds).toContain("c-3"); // third (newest) ran
		expect(doneIds).not.toContain("c-2"); // replaced, never ran
		expect(h.errors()).toEqual([]);
	});

	it("16. back-to-back turns with a provider error on the first → queued second still replays", async () => {
		// Turn 1 errors (e.g. model 400 on the navigation), turn 2 succeeds.
		const h = multiTurnHarness([
			async () => {
				throw new Error("HTTP 400 Invalid model name");
			},
			async emit => {
				emit({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "Creating your load balancer…" },
				} as AgentSessionEvent);
			},
		]);

		new ChatHandler(h.server, h.session).attach();
		h.fire(req("c-1", "navigate")); // errors
		await flush(5);
		h.fire(req("c-2", "create load balancer")); // queued
		await flush(100);

		// Turn 1 errored, turn 2 replayed and succeeded — no dead-end.
		expect(h.errors().map(e => e.id)).toContain("c-1");
		expect(h.dones().map(d => d.id)).toContain("c-2");
	});
});
