/**
 * LoopbackBridgeTransport tests — TLS-test path: injected-fake + wss-assert.
 *
 * Rationale: Bun's global WebSocket (browser-compat) does not honour
 * NODE_EXTRA_CA_CERTS, so we cannot make a real wss echo trust a fixture CA
 * without disabling verification — which is forbidden.  Instead we inject a
 * minimal fake WebSocket factory that exercises the full handshake/message/stop
 * LOGIC in-memory, and assert separately that the production default always
 * constructs a wss:// URL (regression guard against a plain ws:// slip).
 */
import { describe, expect, it } from "bun:test";
import type { ChatInbound, ChatOutbound } from "../src/core/transport/index";
import { LoopbackBridgeTransport } from "../src/core/transport/loopback";

// ---------------------------------------------------------------------------
// Minimal fake WebSocket
// ---------------------------------------------------------------------------

class FakeWebSocket {
	onopen: ((e: Event) => void) | null = null;
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: Event) => void) | null = null;
	onclose: ((e: CloseEvent) => void) | null = null;
	readonly url: string;
	readonly sent: string[] = [];

	constructor(url: string) {
		this.url = url;
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		// Intentionally no-op in fake — transport calls close() on dispose().
	}

	// --- Test helpers ---

	triggerOpen(): void {
		this.onopen?.({ type: "open" } as Event);
	}

	receive(data: string): void {
		this.onmessage?.({ data, type: "message" } as unknown as MessageEvent);
	}

	triggerError(): void {
		this.onerror?.({ type: "error" } as Event);
	}

	triggerClose(): void {
		this.onclose?.({ type: "close" } as unknown as CloseEvent);
	}
}

// Creates a factory + a capture helper for the last created FakeWebSocket.
function makeFactory(): { factory: (url: string) => WebSocket; capture: () => FakeWebSocket } {
	let last: FakeWebSocket | null = null;
	const factory = (url: string): WebSocket => {
		last = new FakeWebSocket(url);
		return last as unknown as WebSocket;
	};
	const capture = (): FakeWebSocket => {
		if (!last) throw new Error("No FakeWebSocket created yet");
		return last;
	};
	return { factory, capture };
}

// Helper: create transport, complete handshake, return both.
async function connected(port = 19222): Promise<{ transport: LoopbackBridgeTransport; ws: FakeWebSocket }> {
	const { factory, capture } = makeFactory();
	const transport = new LoopbackBridgeTransport({ port, _webSocketFactory: factory });
	const p = transport.connect();
	const ws = capture();
	ws.triggerOpen();
	ws.receive(JSON.stringify({ type: "hello_ack" }));
	await p;
	return { transport, ws };
}

// ---------------------------------------------------------------------------
// wss: scheme regression guard — MUST pass even without a factory override.
// ---------------------------------------------------------------------------

describe("LoopbackBridgeTransport — wss: scheme guard", () => {
	it("buildUrl() returns wss://127-0-0-1.local-ip.sh:<port> — never plain ws://", () => {
		const t = new LoopbackBridgeTransport({ port: 19322 });
		const url = t.buildUrl();
		expect(url.startsWith("wss://")).toBe(true);
		expect(url).toBe("wss://127-0-0-1.local-ip.sh:19322");
	});

	it("defaults to the local-ip.sh host on the first wss-range port", () => {
		const t = new LoopbackBridgeTransport();
		// Default host must be the *.local-ip.sh SAN name (the IP literal fails TLS);
		// default port is the first wss-range candidate (19322).
		expect(t.buildUrl()).toBe("wss://127-0-0-1.local-ip.sh:19322");
	});

	it("custom host + port are reflected in URL but scheme stays wss://", () => {
		const t = new LoopbackBridgeTransport({ host: "127.0.0.1", port: 19230 });
		expect(t.buildUrl()).toBe("wss://127.0.0.1:19230");
	});
});

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe("LoopbackBridgeTransport — connection lifecycle", () => {
	it("(1) starts in idle state", () => {
		const { factory } = makeFactory();
		const t = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		expect(t.state).toBe("idle");
	});

	it("(2) transitions idle → connecting → open; hello sent on open, resolved on hello_ack", async () => {
		const { factory, capture } = makeFactory();
		const t = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		const p = t.connect();
		expect(t.state).toBe("connecting");
		const ws = capture();
		expect(ws.sent).toHaveLength(0); // nothing sent before open
		ws.triggerOpen();
		expect(ws.sent).toHaveLength(1); // hello sent synchronously on open
		const hello = JSON.parse(ws.sent[0] ?? "{}");
		expect(hello.type).toBe("hello");
		ws.receive(JSON.stringify({ type: "hello_ack" }));
		await p;
		expect(t.state).toBe("open");
	});

	it("(3) hello has a non-empty version field", async () => {
		const { factory, capture } = makeFactory();
		const t = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		const p = t.connect();
		const ws = capture();
		ws.triggerOpen();
		const hello = JSON.parse(ws.sent[0] ?? "{}");
		expect(typeof hello.version).toBe("string");
		expect((hello.version as string).length).toBeGreaterThan(0);
		ws.receive(JSON.stringify({ type: "hello_ack" }));
		await p;
	});

	it("(4) connect() rejects on WebSocket error before hello_ack", async () => {
		const { factory, capture } = makeFactory();
		const t = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		const p = t.connect();
		const ws = capture();
		ws.triggerError();
		await expect(p).rejects.toBeInstanceOf(Error);
		expect(t.state).toBe("closed");
	});

	it("(5) dispose() sets state closed and clears subscribers", async () => {
		const { transport } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		transport.dispose();
		expect(transport.state).toBe("closed");
	});
});

// ---------------------------------------------------------------------------
// send() / stop()
// ---------------------------------------------------------------------------

describe("LoopbackBridgeTransport — send / stop", () => {
	it("(6) send() serialises the message and writes it to the socket", async () => {
		const { transport, ws } = await connected();
		transport.send({ type: "chat_request", id: "r1", text: "hi", context: null, mode: "educational" });
		const last = ws.sent.at(-1);
		expect(JSON.parse(last ?? "{}")).toMatchObject({ type: "chat_request", id: "r1" });
	});

	it("(7) stop(id) sends a chat_stop frame", async () => {
		const { transport, ws } = await connected();
		transport.stop("t1");
		const last = ws.sent.at(-1);
		expect(JSON.parse(last ?? "{}")).toEqual({ type: "chat_stop", id: "t1" });
	});

	it("(7a) send() of set_host_tools reaches the socket unchanged", async () => {
		const { transport, ws } = await connected();
		const frame = {
			type: "set_host_tools" as const,
			tools: [
				{
					name: "read_range",
					description: "Read a spreadsheet range",
					parameters: { type: "object", properties: {} },
				},
			],
		};
		transport.send(frame);
		const last = ws.sent.at(-1);
		expect(JSON.parse(last ?? "{}")).toEqual(frame);
	});

	it("(7b) send() of host_tool_result (content[] AgentToolResult) reaches the socket unchanged", async () => {
		const { transport, ws } = await connected();
		const frame = {
			type: "host_tool_result" as const,
			id: "call-1",
			result: {
				content: [{ type: "text" as const, text: "A1:B2 = [[1,2],[3,4]]" }],
				details: { rows: 2 },
			},
		};
		transport.send(frame);
		const last = ws.sent.at(-1);
		expect(JSON.parse(last ?? "{}")).toEqual(frame);
	});
});

// ---------------------------------------------------------------------------
// Inbound message routing
// ---------------------------------------------------------------------------

describe("LoopbackBridgeTransport — inbound messages", () => {
	it("(8) subscriber receives chat_delta then chat_done in order", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "chat_delta", id: "x", seq: 0, delta: "hello" }));
		ws.receive(JSON.stringify({ type: "chat_done", id: "x" }));
		expect(received).toHaveLength(2);
		expect(received[0]).toMatchObject({ type: "chat_delta", delta: "hello" });
		expect(received[1]).toMatchObject({ type: "chat_done" });
	});

	it("(9) subscriber receives chat_error", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "chat_error", id: "x", error: "fail" }));
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ type: "chat_error", error: "fail" });
	});

	it("(10) subscriber receives chat_keepalive", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "chat_keepalive", id: "x" }));
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ type: "chat_keepalive" });
	});

	it("(11) onMessage unsubscribe stops delivery", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		const unsub = transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "chat_delta", id: "y", seq: 0, delta: "a" }));
		unsub();
		ws.receive(JSON.stringify({ type: "chat_delta", id: "y", seq: 1, delta: "b" }));
		expect(received).toHaveLength(1);
	});

	it("(12) unknown message types are silently dropped", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "unknown_thing", id: "x" }));
		expect(received).toHaveLength(0);
	});

	it("(13) two subscribers both receive an inbound message", async () => {
		const { transport, ws } = await connected();
		const a: ChatInbound[] = [];
		const b: ChatInbound[] = [];
		transport.onMessage(m => a.push(m));
		transport.onMessage(m => b.push(m));
		ws.receive(JSON.stringify({ type: "chat_done", id: "z" }));
		expect(a).toHaveLength(1);
		expect(b).toHaveLength(1);
	});

	it("(14) subscriber receives chat_tool_notice", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "chat_tool_notice", id: "x", tool: "bash", ok: true }));
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ type: "chat_tool_notice", tool: "bash", ok: true });
	});

	it("(14a) subscriber receives host_tool_call (not dropped)", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(
			JSON.stringify({
				type: "host_tool_call",
				id: "call-1",
				toolCallId: "tc-1",
				toolName: "read_range",
				arguments: { range: "A1:B2" },
			}),
		);
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ type: "host_tool_call", toolName: "read_range" });
	});

	it("(14b) subscriber receives host_tool_cancel (not dropped)", async () => {
		const { transport, ws } = await connected();
		const received: ChatInbound[] = [];
		transport.onMessage(m => received.push(m));
		ws.receive(JSON.stringify({ type: "host_tool_cancel", id: "call-1", targetId: "tc-1" }));
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({ type: "host_tool_cancel", targetId: "tc-1" });
	});
});

// ---------------------------------------------------------------------------
// Additional branch coverage
// ---------------------------------------------------------------------------

describe("LoopbackBridgeTransport — close-before-hello_ack", () => {
	it('(15) socket close while connecting rejects with "closed before hello_ack" and state is closed', async () => {
		const { factory, capture } = makeFactory();
		const t = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		const p = t.connect();
		const ws = capture();
		ws.triggerOpen(); // hello sent; still in 'connecting'
		ws.triggerClose(); // close before hello_ack
		await expect(p).rejects.toThrow("closed before hello_ack");
		expect(t.state).toBe("closed");
	});
});

describe("LoopbackBridgeTransport — double-connect guard", () => {
	it("(16) second connect() call while connecting rejects with state guard error", async () => {
		const { factory, capture } = makeFactory();
		const t = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		const _first = t.connect(); // leaves state as 'connecting'
		capture(); // consume the fake socket so capture() succeeds
		await expect(t.connect()).rejects.toThrow("Cannot connect in state 'connecting'");
		// Clean up the dangling first promise by completing the handshake.
		const ws = capture();
		ws.triggerOpen();
		ws.receive(JSON.stringify({ type: "hello_ack" }));
		await _first;
	});

	it("(17) second connect() call while open rejects with state guard error", async () => {
		const { transport } = await connected();
		await expect(transport.connect()).rejects.toThrow("Cannot connect in state 'open'");
	});
});

// ---------------------------------------------------------------------------
// Multi-port wss discovery (issue #19) — no explicit port → scan the range
// ---------------------------------------------------------------------------

// A discovery-aware factory: records every FakeWebSocket by the port in its URL
// so a test can drive each candidate independently.
function makeDiscoveryFactory(): {
	factory: (url: string) => WebSocket;
	byPort: Map<number, FakeWebSocket>;
} {
	const byPort = new Map<number, FakeWebSocket>();
	const factory = (url: string): WebSocket => {
		const port = Number(url.split(":").pop());
		const ws = new FakeWebSocket(url);
		byPort.set(port, ws);
		return ws as unknown as WebSocket;
	};
	return { factory, byPort };
}

// Drive a full scan: ack the listed ports (with optional hello_ack fields),
// error every other created socket, so all candidates settle deterministically.
function driveScan(byPort: Map<number, FakeWebSocket>, acks: Record<number, Record<string, unknown>>): void {
	for (const [port, ws] of byPort) {
		ws.triggerOpen();
		const ack = acks[port];
		if (ack) {
			ws.receive(JSON.stringify({ type: "hello_ack", ...ack }));
		} else {
			ws.triggerError();
		}
	}
}

describe("LoopbackBridgeTransport — multi-port discovery", () => {
	it("(18) with no explicit port, scans the wss range and creates a socket per candidate", () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const t = new LoopbackBridgeTransport({ _webSocketFactory: factory, discoveryTimeoutMs: 50 });
		void t.connect();
		// 19322–19341 inclusive = 20 candidates.
		expect(byPort.size).toBe(20);
		expect(byPort.has(19322)).toBe(true);
		expect(byPort.has(19341)).toBe(true);
		t.dispose();
	});

	it("(19) picks the context-bound bridge among several that answer", async () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const t = new LoopbackBridgeTransport({ _webSocketFactory: factory, discoveryTimeoutMs: 50 });
		const p = t.connect();
		driveScan(byPort, {
			19322: { contextBound: false },
			19324: { contextBound: true },
			19326: { contextBound: false },
		});
		await p;
		expect(t.state).toBe("open");
		// A send must go to the chosen (context-bound) socket only.
		t.send({ type: "chat_stop", id: "x" });
		expect(byPort.get(19324)?.sent.some(s => s.includes("chat_stop"))).toBe(true);
		expect(byPort.get(19322)?.sent.some(s => s.includes("chat_stop"))).toBe(false);
		t.dispose();
	});

	it("(20) connects to the single live bridge when all other ports are refused", async () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const t = new LoopbackBridgeTransport({ _webSocketFactory: factory, discoveryTimeoutMs: 50 });
		const p = t.connect();
		driveScan(byPort, { 19330: { contextBound: true } });
		await p;
		expect(t.state).toBe("open");
		t.send({ type: "chat_stop", id: "y" });
		expect(byPort.get(19330)?.sent.some(s => s.includes("chat_stop"))).toBe(true);
		t.dispose();
	});

	it("(21) rejects when no candidate answers with hello_ack", async () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const t = new LoopbackBridgeTransport({ _webSocketFactory: factory, discoveryTimeoutMs: 50 });
		const p = t.connect();
		driveScan(byPort, {}); // every candidate errors
		await expect(p).rejects.toThrow(/no .*bridge/i);
		expect(t.state).toBe("closed");
	});

	it("(22) closes the losing sockets after adopting the winner", async () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const closed = new Set<number>();
		const t = new LoopbackBridgeTransport({ _webSocketFactory: factory, discoveryTimeoutMs: 50 });
		// Patch close() on each fake as it is created via the byPort map after connect().
		const p = t.connect();
		for (const [port, ws] of byPort) {
			const orig = ws.close.bind(ws);
			ws.close = () => {
				closed.add(port);
				orig();
			};
		}
		driveScan(byPort, { 19323: { contextBound: true }, 19325: { contextBound: true } });
		await p;
		// Identify the winner by which socket a post-connect send reaches.
		t.send({ type: "chat_stop", id: "z" });
		const winner = [...byPort].find(([, ws]) => ws.sent.some(s => s.includes("chat_stop")))?.[0];
		expect(winner).toBeDefined();
		// The winner stays open; EXACTLY every other candidate is closed.
		expect(closed.has(winner as number)).toBe(false);
		expect(closed.size).toBe(byPort.size - 1);
		t.dispose();
	});

	it("(23) explicit port keeps single-socket mode (no range scan)", () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const t = new LoopbackBridgeTransport({ port: 19322, _webSocketFactory: factory });
		void t.connect();
		expect(byPort.size).toBe(1);
		t.dispose();
	});
});

// ---------------------------------------------------------------------------
// Bridge drop mid-turn (issue #21) — surface a terminal error, don't hang
// ---------------------------------------------------------------------------

const REQUEST = (id: string): ChatOutbound => ({
	type: "chat_request",
	id,
	text: "hi",
	context: null,
	mode: "educational",
});

function collect(t: LoopbackBridgeTransport): ChatInbound[] {
	const seen: ChatInbound[] = [];
	t.onMessage(m => seen.push(m));
	return seen;
}

describe("LoopbackBridgeTransport — bridge drop mid-turn", () => {
	it("(24) an unexpected close during a turn emits an id-matched bridge-disconnected error", async () => {
		const { transport, ws } = await connected();
		const seen = collect(transport);
		transport.send(REQUEST("turn-1"));
		ws.triggerClose();

		expect(transport.state).toBe("closed");
		const err = seen.find(m => m.type === "chat_error") as { id: string; reason?: string } | undefined;
		expect(err).toBeDefined();
		expect(err?.id).toBe("turn-1");
		expect(err?.reason).toBe("bridge-disconnected");
	});

	it("(25) an unexpected close while idle (no turn in flight) emits nothing", async () => {
		const { transport, ws } = await connected();
		const seen = collect(transport);
		ws.triggerClose();

		expect(transport.state).toBe("closed");
		expect(seen.length).toBe(0);
	});

	it("(26) after a turn completes, a later close does not emit a stale error", async () => {
		const { transport, ws } = await connected();
		const seen = collect(transport);
		transport.send(REQUEST("turn-2"));
		ws.receive(JSON.stringify({ type: "chat_done", id: "turn-2" }));
		ws.triggerClose();

		expect(seen.filter(m => m.type === "chat_error").length).toBe(0);
	});

	it("(27) dispose() (intentional teardown) emits no synthetic error", async () => {
		const { transport } = await connected();
		const seen = collect(transport);
		transport.send(REQUEST("turn-3"));
		transport.dispose();

		expect(seen.filter(m => m.type === "chat_error").length).toBe(0);
		expect(transport.state).toBe("closed");
	});

	it("(29) error-then-close during a turn emits exactly one bridge-disconnected error", async () => {
		const { transport, ws } = await connected();
		const seen = collect(transport);
		transport.send(REQUEST("turn-5"));
		ws.triggerError(); // no-op while open (single-port onerror only acts when connecting)
		ws.triggerClose(); // the real remote close
		ws.triggerClose(); // idempotent — must not double-emit

		expect(transport.state).toBe("closed");
		expect(seen.filter(m => m.type === "chat_error").length).toBe(1);
	});

	it("(28) discovery-adopted socket also emits on mid-turn drop", async () => {
		const { factory, byPort } = makeDiscoveryFactory();
		const t = new LoopbackBridgeTransport({ _webSocketFactory: factory, discoveryTimeoutMs: 50 });
		const p = t.connect();
		driveScan(byPort, { 19327: { contextBound: true } });
		await p;
		const seen = collect(t);
		t.send(REQUEST("turn-4"));
		byPort.get(19327)?.triggerClose();

		const err = seen.find(m => m.type === "chat_error") as { id: string; reason?: string } | undefined;
		expect(err?.id).toBe("turn-4");
		expect(err?.reason).toBe("bridge-disconnected");
		t.dispose();
	});
});
