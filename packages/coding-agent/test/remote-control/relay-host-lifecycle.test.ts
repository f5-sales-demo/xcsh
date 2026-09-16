import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { startLocalHost } from "../../src/remote-control/host";

const enrollment = {
	server_id: "fixture-server",
	environment_id: "fixture-environment",
	remote_control_token: "fixture-token",
	expires_at: "2999-01-01T00:00:00.000Z",
};
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
	const sockets: Socket[] = [];
	class Socket {
		readyState = 0;
		sent: string[] = [];
		onopen?: () => void;
		onmessage?: (event: { data: string }) => void;
		onerror?: () => void;
		onclose?: () => void;
		onpong?: () => void;
		constructor() {
			sockets.push(this);
			queueMicrotask(() => {
				this.readyState = 1;
				this.onopen?.();
			});
		}
		send(frame: string) {
			this.sent.push(frame);
		}
		ping() {}
		close() {
			if (this.readyState === 3) return;
			this.readyState = 3;
			queueMicrotask(() => this.onclose?.());
		}
	}
	const websocket = spyOn(globalThis as any, "WebSocket").mockImplementation((() => new Socket()) as any);
	Object.assign(globalThis.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
	const dir = await mkdtemp("/tmp/xcsh-relay-host-lifecycle-");
	const host = await startLocalHost(join(dir, "host.sock"), "fixture");
	host.connectRelay({ ...enrollment }, "fixture-installation", "fixture host");
	await Bun.sleep(0);
	cleanups.push(async () => {
		await host.close();
		websocket.mockRestore();
		await rm(dir, { recursive: true, force: true });
	});
	const send = (clientId: string, streamId: string, seq: number, message: unknown) =>
		sockets[0]!.onmessage?.({
			data: JSON.stringify({
				type: "client_message",
				client_id: clientId,
				stream_id: streamId,
				seq_id: seq,
				message,
			}),
		});
	const closeClient = (clientId: string, streamId: string) =>
		sockets[0]!.onmessage?.({
			data: JSON.stringify({ type: "client_closed", client_id: clientId, stream_id: streamId }),
		});
	const messages = () => sockets[0]!.sent.map(frame => JSON.parse(frame).message).filter(Boolean);
	return { host, send, closeClient, messages };
}

test("relay host replaces a same-stream initialize, keeps sibling streams, and drops unknown traffic", async () => {
	const { host, send, closeClient, messages } = await fixture();
	const initialize = (id: number) => ({
		id,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	const one = JSON.stringify(["phone", "one"]);
	const two = JSON.stringify(["phone", "two"]);
	send("phone", "one", 1, initialize(1));
	await Bun.sleep(0);
	expect(host.router.isInitialized(one)).toBe(true);
	send("phone", "one", 1, initialize(2));
	send("phone", "two", 1, initialize(3));
	await Bun.sleep(0);
	expect(host.router.isInitialized(one)).toBe(true);
	expect(host.router.isInitialized(two)).toBe(true);
	expect(messages().filter(message => message.result?.userAgent === "xcsh/fixture")).toHaveLength(3);

	const before = messages().length;
	send("unknown", "stream", 1, { id: 4, method: "thread/list", params: {} });
	await Bun.sleep(0);
	expect(messages()).toHaveLength(before);
	expect(host.router.isInitialized(JSON.stringify(["unknown", "stream"]))).toBe(false);
	closeClient("phone", "one");
	expect(host.router.isInitialized(one)).toBe(false);
	expect(host.router.isInitialized(two)).toBe(true);
});

test("unknown traffic cannot exhaust codec state or disconnect a healthy initializing stream", async () => {
	const { host, send, messages } = await fixture();
	for (let index = 0; index < 300; index++)
		send(`unknown-${index}`, "stream", 1, { id: index, method: "thread/list", params: {} });
	send("phone", "healthy", 1, {
		id: 999,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	for (let attempt = 0; attempt < 100 && !messages().some(message => message.id === 999); attempt++)
		await Bun.sleep(1);
	expect(messages().find(message => message.id === 999)?.result?.userAgent).toBe("xcsh/fixture");
	expect(host.router.isInitialized(JSON.stringify(["phone", "healthy"]))).toBe(true);
});

test("relay host isolates an overloaded stream while another stream remains responsive", async () => {
	const { host, send, messages } = await fixture();
	const release = Promise.withResolvers<void>();
	const original = host.router.handle.bind(host.router);
	host.router.handle = async (client, input) => {
		if ((input as { method?: string })?.method === "thread/list" && client.endsWith('"busy"]')) await release.promise;
		return original(client, input);
	};
	const initialize = (id: number) => ({
		id,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	send("phone", "busy", 1, initialize(1));
	send("phone", "healthy", 1, initialize(2));
	await Bun.sleep(0);
	for (let index = 0; index < 129; index++)
		send("phone", "busy", index + 2, { id: 100 + index, method: "thread/list", params: {} });
	send("phone", "healthy", 2, { id: 999, method: "thread/list", params: {} });
	for (let attempt = 0; attempt < 100 && !messages().some(message => message.id === 999); attempt++)
		await Bun.sleep(1);
	expect(messages()).toContainEqual({ id: 228, error: { code: -32001, message: "Server overloaded; retry later." } });
	expect(messages().find(message => message.id === 999)?.error).toBeUndefined();
	release.resolve();
});

test("a same-stream replacement cannot receive the prior connection's late response", async () => {
	const { host, send, messages } = await fixture();
	const release = Promise.withResolvers<void>();
	const original = host.router.handle.bind(host.router);
	host.router.handle = async (client, input) => {
		if ((input as { id?: number }).id === 2) await release.promise;
		return original(client, input);
	};
	const initialize = (id: number) => ({
		id,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	send("phone", "voice", 1, initialize(1));
	await Bun.sleep(0);
	send("phone", "voice", 2, { id: 2, method: "thread/list", params: {} });
	await Bun.sleep(0);
	const beforeReplacement = messages().length;
	send("phone", "voice", 3, initialize(3));
	await Bun.sleep(0);
	release.resolve();
	await Bun.sleep(0);
	const replacementMessages = messages().slice(beforeReplacement);
	expect(replacementMessages.some(message => message.id === 3 && message.result)).toBe(true);
	expect(replacementMessages.some(message => message.id === 2)).toBe(false);
});
