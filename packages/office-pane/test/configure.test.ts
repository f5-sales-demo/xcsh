/**
 * LoopbackBridgeTransport.configure() tests — the single-engine provider-config
 * path. Uses the same injected fake-WebSocket approach as loopback.test.ts.
 */
import { describe, expect, it } from "bun:test";
import type { ConfigureMsg } from "../src/core/protocol";
import { isConfigureAck, isConfigureError } from "../src/core/protocol";
import { LoopbackBridgeTransport } from "../src/core/transport/loopback";

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
	close(): void {}
	triggerOpen(): void {
		this.onopen?.({ type: "open" } as Event);
	}
	receive(data: string): void {
		this.onmessage?.({ data, type: "message" } as unknown as MessageEvent);
	}
	triggerClose(): void {
		this.onclose?.({ type: "close" } as unknown as CloseEvent);
	}
}

function makeFactory(): { factory: (url: string) => WebSocket; capture: () => FakeWebSocket } {
	let last: FakeWebSocket | null = null;
	return {
		factory: (url: string) => {
			last = new FakeWebSocket(url);
			return last as unknown as WebSocket;
		},
		capture: () => {
			if (!last) throw new Error("no socket");
			return last;
		},
	};
}

/** Connect (single-port) with an optional canConfigureProvider hello_ack flag. */
async function connected(canConfigure = true): Promise<{ transport: LoopbackBridgeTransport; ws: FakeWebSocket }> {
	const { factory, capture } = makeFactory();
	const transport = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
	const p = transport.connect();
	const ws = capture();
	ws.triggerOpen();
	ws.receive(JSON.stringify({ type: "hello_ack", canConfigureProvider: canConfigure }));
	await p;
	return { transport, ws };
}

function lastConfigureFrame(ws: FakeWebSocket): ConfigureMsg | undefined {
	for (let i = ws.sent.length - 1; i >= 0; i--) {
		const m = JSON.parse(ws.sent[i]);
		if (m.type === "configure") return m as ConfigureMsg;
	}
	return undefined;
}

describe("configure protocol guards", () => {
	it("isConfigureAck / isConfigureError narrow correctly", () => {
		expect(isConfigureAck({ type: "configure_ack", model: "claude-opus-4-8" })).toBe(true);
		expect(isConfigureAck({ type: "configure_ack" })).toBe(false);
		expect(isConfigureError({ type: "configure_error", reason: "configuration-rejected" })).toBe(true);
		expect(isConfigureError({ type: "configure_error" })).toBe(false);
		expect(isConfigureError({ type: "configure_error", reason: "unknown" })).toBe(false);
		expect(isConfigureAck({ type: "chat_done", id: "c-1" })).toBe(false);
	});
});

describe("LoopbackBridgeTransport.configure", () => {
	it("captures canConfigureProvider from hello_ack", async () => {
		const { transport } = await connected(true);
		expect(transport.canConfigureProvider).toBe(true);
		transport.dispose();
		const off = await connected(false);
		expect(off.transport.canConfigureProvider).toBe(false);
		off.transport.dispose();
	});

	it("sends a configure frame with baseUrl/token/model and resolves on configure_ack", async () => {
		const { transport, ws } = await connected();
		const p = transport.configure({
			baseUrl: "https://gw.example/anthropic",
			token: "<XC_API_TOKEN>",
			model: "claude-opus-4-8",
		});
		const frame = lastConfigureFrame(ws);
		expect(frame).toEqual({
			type: "configure",
			token: "<XC_API_TOKEN>",
			baseUrl: "https://gw.example/anthropic",
			model: "claude-opus-4-8",
		});
		ws.receive(JSON.stringify({ type: "configure_ack", model: "claude-opus-4-8" }));
		await expect(p).resolves.toBe("claude-opus-4-8");
		transport.dispose();
	});

	it("omits baseUrl/model when not provided (key-only)", async () => {
		const { transport, ws } = await connected();
		const p = transport.configure({ token: "<XC_API_TOKEN>" });
		const frame = lastConfigureFrame(ws);
		expect(frame).toEqual({ type: "configure", token: "<XC_API_TOKEN>" });
		ws.receive(JSON.stringify({ type: "configure_ack", model: "claude-opus-4-8" }));
		await p;
		transport.dispose();
	});

	it("rejects on configure_error", async () => {
		const { transport, ws } = await connected();
		const p = transport.configure({ baseUrl: "https://gw.example", token: "<XC_API_TOKEN>" });
		ws.receive(JSON.stringify({ type: "configure_error", reason: "configuration-rejected" }));
		await expect(p).rejects.toThrow("Provider configuration was rejected.");
		transport.dispose();
	});

	it("does not emit configure replies to chat subscribers", async () => {
		const { transport, ws } = await connected();
		const seen: string[] = [];
		transport.onMessage(m => seen.push(m.type));
		const p = transport.configure({ token: "t" });
		ws.receive(JSON.stringify({ type: "configure_ack", model: "m" }));
		await p;
		expect(seen).not.toContain("configure_ack");
		transport.dispose();
	});

	it("rejects an empty token without sending a frame", async () => {
		const { transport, ws } = await connected();
		await expect(transport.configure({ token: "   " })).rejects.toThrow(/token/);
		expect(lastConfigureFrame(ws)).toBeUndefined();
		transport.dispose();
	});

	it("rejects a second concurrent configure", async () => {
		const { transport, ws } = await connected();
		const p1 = transport.configure({ token: "a" });
		await expect(transport.configure({ token: "b" })).rejects.toThrow(/already in flight/);
		ws.receive(JSON.stringify({ type: "configure_ack", model: "m" }));
		await p1;
		transport.dispose();
	});

	it("rejects configure when not open", async () => {
		const { factory } = makeFactory();
		const transport = new LoopbackBridgeTransport({ port: 19222, _webSocketFactory: factory });
		await expect(transport.configure({ token: "t" })).rejects.toThrow(/Cannot configure in state 'idle'/);
	});

	it("rejects an in-flight configure when the bridge drops", async () => {
		const { transport, ws } = await connected();
		const p = transport.configure({ token: "t" });
		ws.triggerClose();
		await expect(p).rejects.toThrow(/lost/);
		transport.dispose();
	});

	it("rejects an in-flight configure on dispose", async () => {
		const { transport } = await connected();
		const p = transport.configure({ token: "t" });
		transport.dispose();
		await expect(p).rejects.toThrow(/disposed/);
	});
});
