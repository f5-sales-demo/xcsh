import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EXTENSION_CONTRACT_VERSION } from "../../src/browser/capabilities.generated";
import { BridgeServer } from "../../src/browser/extension-bridge";
import { EXTENSION_ID } from "../../src/browser/extension-identity";
import {
	BROWSER_HELLO,
	browserBridgeOptions,
	OFFICE_HELLO,
	officeBridgeOptions,
} from "../helpers/extension-bridge-fixture";

function openSocket(port: number): Promise<WebSocket> {
	const { promise, resolve, reject } = Promise.withResolvers<WebSocket>();
	const ws = new WebSocket(`ws://127.0.0.1:${port}`);
	ws.addEventListener("open", () => resolve(ws), { once: true });
	ws.addEventListener("error", () => reject(new Error("websocket connection failed")), { once: true });
	return promise;
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
	const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
	ws.addEventListener(
		"message",
		event => {
			try {
				resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
			} catch {
				reject(new Error("bridge returned malformed JSON"));
			}
		},
		{ once: true },
	);
	return promise;
}

function nextClose(ws: WebSocket): Promise<CloseEvent> {
	const { promise, resolve } = Promise.withResolvers<CloseEvent>();
	ws.addEventListener("close", resolve, { once: true });
	return promise;
}

async function authenticate(ws: WebSocket): Promise<Record<string, unknown>> {
	const ack = nextMessage(ws);
	ws.send(JSON.stringify(BROWSER_HELLO));
	return ack;
}

describe("BridgeServer authenticated single client", () => {
	let server: BridgeServer;
	let sockets: WebSocket[];

	beforeEach(() => {
		server = new BridgeServer(browserBridgeOptions());
		expect(server.listen(0, { skipOriginCheck: true })).toBe(true);
		sockets = [];
	});

	afterEach(async () => {
		for (const socket of sockets) socket.close();
		await server.close();
	});

	it("rejects requests when no authenticated client is connected", async () => {
		expect(server.connected).toBe(false);
		await expect(server.request("ping", {})).rejects.toThrow("no authenticated client connected");
	});

	it("rejects a pre-handshake application frame", async () => {
		const socket = await openSocket(server.port);
		sockets.push(socket);
		const closed = nextClose(socket);
		socket.send(JSON.stringify({ type: "chat_request", id: "request-1" }));

		expect((await closed).code).toBe(1008);
		expect(server.connected).toBe(false);
	});

	it("rejects a 1.x browser hello", async () => {
		const socket = await openSocket(server.port);
		sockets.push(socket);
		const closed = nextClose(socket);
		socket.send(JSON.stringify({ ...BROWSER_HELLO, contractVersion: "1.9.0" }));

		expect((await closed).code).toBe(1008);
		expect(server.connected).toBe(false);
	});

	it.each([
		["missing", { type: "hello", contractVersion: EXTENSION_CONTRACT_VERSION }],
		["wrong", { ...BROWSER_HELLO, extensionId: "not-the-registered-extension" }],
	])("rejects a %s extension ID", async (_case, hello) => {
		const socket = await openSocket(server.port);
		sockets.push(socket);
		const closed = nextClose(socket);
		socket.send(JSON.stringify(hello));

		expect((await closed).code).toBe(1008);
		expect(server.connected).toBe(false);
	});

	it("accepts the exact registered extension contract-2 hello", async () => {
		const socket = await openSocket(server.port);
		sockets.push(socket);
		const ack = await authenticate(socket);

		expect(ack).toMatchObject({
			type: "hello_ack",
			contractVersion: EXTENSION_CONTRACT_VERSION,
			sessionId: "tab-7",
		});
		expect(ack).not.toHaveProperty("serveKind");
		expect(EXTENSION_ID).toBe(BROWSER_HELLO.extensionId);
		expect(server.connected).toBe(true);
	});

	it("rejects a malformed Office host before authenticating the transport", async () => {
		await server.close();
		server = new BridgeServer(officeBridgeOptions());
		expect(server.listen(0, { skipOriginCheck: true })).toBe(true);
		const socket = await openSocket(server.port);
		sockets.push(socket);
		const closed = nextClose(socket);
		socket.send(JSON.stringify({ ...OFFICE_HELLO, host: "invalid-host" }));

		expect((await closed).code).toBe(1008);
		expect(server.connected).toBe(false);
		expect(server.clientHost).toBeNull();
	});

	it("rejects an incomplete asymmetric server identity", async () => {
		await server.close();
		server = new BridgeServer({
			serveKind: "browser",
			sessionInfo: () => ({
				tenant: "example-corp",
				env: null,
				contextBound: false,
				sessionId: "tab-7",
			}),
		});
		expect(server.listen(0, { skipOriginCheck: true })).toBe(true);
		const socket = await openSocket(server.port);
		sockets.push(socket);
		const closed = nextClose(socket);
		socket.send(JSON.stringify(BROWSER_HELLO));

		expect((await closed).code).toBe(1008);
		expect(server.connected).toBe(false);
	});

	it("keeps the authenticated client until a replacement also authenticates", async () => {
		const first = await openSocket(server.port);
		sockets.push(first);
		await authenticate(first);

		const candidate = await openSocket(server.port);
		sockets.push(candidate);
		expect(server.connected).toBe(true);
		const pong = nextMessage(first);
		first.send(JSON.stringify({ type: "ping" }));
		expect(await pong).toEqual({ type: "pong" });

		const firstClosed = nextClose(first);
		await authenticate(candidate);
		expect((await firstClosed).code).toBe(1000);
		expect(server.connected).toBe(true);
	});
});
