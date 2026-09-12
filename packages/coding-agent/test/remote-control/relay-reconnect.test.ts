import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";

const enrollment = {
	server_id: "fixture-server",
	environment_id: "fixture-environment",
	remote_control_token: "fixture-token",
	expires_at: "2999-01-01T00:00:00.000Z",
};

test("relay transport errors reconnect with the delivery cursor and replay only unacknowledged responses", async () => {
	const sockets: Socket[] = [];
	class Socket {
		readyState = 0;
		sent: string[] = [];
		onopen?: () => void;
		onmessage?: (event: { data: string }) => void;
		onerror?: () => void;
		onclose?: () => void;
		constructor(
			readonly url: string,
			readonly options: { headers: Record<string, string> },
		) {
			sockets.push(this);
			queueMicrotask(() => {
				this.readyState = 1;
				this.onopen?.();
			});
		}
		send(frame: string) {
			this.sent.push(frame);
		}
		close() {
			if (this.readyState === 3) return;
			this.readyState = 3;
			queueMicrotask(() => this.onclose?.());
		}
	}
	const websocket = spyOn(globalThis as any, "WebSocket").mockImplementation(
		((url: string, options: { headers: Record<string, string> }) => new Socket(url, options)) as any,
	);
	Object.assign(globalThis.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
	const dir = await mkdtemp("/tmp/xcsh-relay-reconnect-");
	const host = await startLocalHost(join(dir, "host.sock"), "fixture");
	const owner = await connectPeer(join(dir, "host.sock"));
	let executions = 0;
	let refreshes = 0;
	owner.handle = async (_method, params) => {
		if (params.method === "turn/start") executions++;
		return { turn: { id: "fixture-turn" } };
	};
	try {
		await owner.call("register", { thread: { id: "fixture-thread", name: "Fixture", cwd: dir } });
		host.connectRelay({ ...enrollment }, "fixture-installation", "fixture host", async () => {
			refreshes++;
			return { ...enrollment, remote_control_token: "fixture-refreshed-token" };
		});
		await Bun.sleep(0);
		expect(sockets).toHaveLength(1);
		const first = sockets[0];
		first.onmessage?.({
			data: JSON.stringify({
				type: "client_message",
				client_id: "phone",
				stream_id: "stream",
				seq_id: 1,
				cursor: "cursor-one",
				message: { id: 1, method: "initialize", params: { clientInfo: { name: "fixture", version: "1" } } },
			}),
		});
		for (let attempt = 0; attempt < 100 && first.sent.length === 0; attempt++) await Bun.sleep(1);
		expect(first.sent).toHaveLength(1);
		const pending = first.sent[0];

		first.onerror?.();
		for (let attempt = 0; attempt < 100 && sockets.length < 2; attempt++) await Bun.sleep(10);
		expect(sockets).toHaveLength(2);
		const second = sockets[1];
		expect(refreshes).toBe(1);
		expect(second.options.headers.authorization).toBe("Bearer fixture-refreshed-token");
		expect(second.options.headers["x-codex-subscribe-cursor"]).toBe("cursor-one");
		expect(second.sent).toEqual([pending]);
		first.onerror?.();
		await Bun.sleep(600);
		expect(sockets).toHaveLength(2);
		expect(second.readyState).toBe(1);
		second.onmessage?.({
			data: JSON.stringify({
				type: "ack",
				client_id: "phone",
				stream_id: "stream",
				seq_id: 1,
				cursor: "cursor-two",
			}),
		});
		second.onmessage?.({
			data: JSON.stringify({
				type: "client_message",
				client_id: "phone",
				stream_id: "stream",
				seq_id: 2,
				cursor: "cursor-three",
				message: {
					id: 2,
					method: "turn/start",
					params: { threadId: "fixture-thread", input: [{ type: "text", text: "fixture" }] },
				},
			}),
		});
		for (let attempt = 0; attempt < 100 && second.sent.length < 2; attempt++) await Bun.sleep(1);
		expect(executions).toBe(1);
		const turnResponse = second.sent.at(-1)!;
		second.close();
		for (let attempt = 0; attempt < 100 && sockets.length < 3; attempt++) await Bun.sleep(10);
		expect(sockets).toHaveLength(3);
		expect(sockets[2].options.headers["x-codex-subscribe-cursor"]).toBe("cursor-three");
		expect(sockets[2].sent).toEqual([turnResponse]);
		expect(executions).toBe(1);
	} finally {
		owner.close();
		await host.close();
		websocket.mockRestore();
		await rm(dir, { recursive: true, force: true });
	}
}, 5000);

test("successful credential refresh rotates a relay socket that still appears open", async () => {
	const sockets: Socket[] = [];
	const intervals: Array<{ callback: () => void; delay: number }> = [];
	class Socket {
		readyState = 0;
		onopen?: () => void;
		onerror?: () => void;
		onclose?: () => void;
		constructor(
			readonly _url: string,
			readonly options: { headers: Record<string, string> },
		) {
			sockets.push(this);
			queueMicrotask(() => {
				this.readyState = 1;
				this.onopen?.();
			});
		}
		send() {}
		close() {
			if (this.readyState === 3) return;
			this.readyState = 3;
			queueMicrotask(() => this.onclose?.());
		}
	}
	const setIntervalSpy = spyOn(globalThis as any, "setInterval").mockImplementation(((
		callback: () => void,
		delay: number,
	) => {
		intervals.push({ callback, delay });
		return intervals.length as unknown as ReturnType<typeof setInterval>;
	}) as typeof setInterval);
	const websocket = spyOn(globalThis as any, "WebSocket").mockImplementation(
		((url: string, options: { headers: Record<string, string> }) => new Socket(url, options)) as any,
	);
	Object.assign(globalThis.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
	const dir = await mkdtemp("/tmp/xcsh-relay-credential-rotation-");
	const host = await startLocalHost(join(dir, "host.sock"), "fixture");
	const activeEnrollment = { ...enrollment };
	let refreshes = 0;
	try {
		host.connectRelay(activeEnrollment, "fixture-installation", "fixture host", async () => {
			refreshes++;
			return { ...enrollment, remote_control_token: "fixture-rotated-token" };
		});
		await Bun.sleep(0);
		expect(sockets).toHaveLength(1);
		activeEnrollment.expires_at = new Date(Date.now() + 30_000).toISOString();
		intervals.find(interval => interval.delay === 30_000)?.callback();
		for (let attempt = 0; attempt < 100 && refreshes === 0; attempt++) await Bun.sleep(1);
		expect(refreshes).toBe(1);
		for (let attempt = 0; attempt < 100 && sockets.length < 2; attempt++) await Bun.sleep(10);
		expect(sockets).toHaveLength(2);
		expect(sockets[0].readyState).toBe(3);
		expect(sockets[1].options.headers.authorization).toBe("Bearer fixture-rotated-token");
	} finally {
		await host.close();
		websocket.mockRestore();
		setIntervalSpy.mockRestore();
		await rm(dir, { recursive: true, force: true });
	}
}, 5000);
