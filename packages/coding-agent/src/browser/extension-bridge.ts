import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Socket, UnixSocketListener } from "bun";

export interface ToolResult {
	content: unknown;
	is_error: boolean;
}

/**
 * Id-correlated pending-request registry. Pure (no socket I/O) so it can be
 * unit-tested directly. Each {@link create} returns a fresh id and a promise
 * that is settled by a later {@link resolve} (matching id) or {@link rejectAll}.
 */
export class PendingRequests {
	#m = new Map<
		string,
		{
			resolve: (r: ToolResult) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();

	create(timeoutMs: number): { id: string; promise: Promise<ToolResult> } {
		const id = randomUUID();
		let resolve!: (r: ToolResult) => void;
		let reject!: (e: Error) => void;
		const promise = new Promise<ToolResult>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const timer = setTimeout(() => {
			if (this.#m.delete(id)) reject(new Error(`bridge request ${id} timed out`));
		}, timeoutMs);
		this.#m.set(id, { resolve, reject, timer });
		return { id, promise };
	}

	resolve(id: string, result: ToolResult): boolean {
		const e = this.#m.get(id);
		if (!e) return false;
		clearTimeout(e.timer);
		this.#m.delete(id);
		e.resolve(result);
		return true;
	}

	rejectAll(err: Error): void {
		for (const e of this.#m.values()) {
			clearTimeout(e.timer);
			e.reject(err);
		}
		this.#m.clear();
	}
}

const DEFAULT_TIMEOUT_MS = 30_000;

type BridgeData = { buf: string };

/**
 * Unix-socket server bridging xcsh to the Chrome extension's native-messaging
 * host. Speaks newline-delimited JSON: requests `{type:"tool_request",...}`,
 * replies `{type:"tool_result",...}`, plus `{type:"ping"|"pong"}`. Tracks a
 * single connected client and correlates replies via {@link PendingRequests}.
 */
export class BridgeServer {
	#pending = new PendingRequests();
	#listener: UnixSocketListener<BridgeData> | null = null;
	#client: Socket<BridgeData> | null = null;
	#onConnected: Array<() => void> = [];
	#onDisconnected: Array<() => void> = [];

	get connected(): boolean {
		return this.#client !== null;
	}

	onConnected(cb: () => void): void {
		this.#onConnected.push(cb);
	}

	onDisconnected(cb: () => void): void {
		this.#onDisconnected.push(cb);
	}

	/** Bind the server to a Unix socket path. Called by {@link startBridgeServer}. */
	listen(socketPath: string): void {
		this.#listener = Bun.listen<BridgeData>({
			unix: socketPath,
			socket: {
				open: socket => {
					socket.data = { buf: "" };
					this.#client = socket;
					for (const cb of this.#onConnected) cb();
				},
				data: (socket, chunk) => {
					this.#onData(socket, chunk);
				},
				close: socket => {
					this.#onClose(socket);
				},
				error: socket => {
					this.#onClose(socket);
				},
			},
		});
	}

	#onData(socket: Socket<BridgeData>, chunk: Buffer): void {
		socket.data.buf += chunk.toString("utf8");
		let idx = socket.data.buf.indexOf("\n");
		while (idx !== -1) {
			const line = socket.data.buf.slice(0, idx);
			socket.data.buf = socket.data.buf.slice(idx + 1);
			if (line.length > 0) this.#handleLine(socket, line);
			idx = socket.data.buf.indexOf("\n");
		}
	}

	#handleLine(socket: Socket<BridgeData>, line: string): void {
		let msg: { type?: string; id?: string; content?: unknown; is_error?: boolean };
		try {
			msg = JSON.parse(line);
		} catch {
			return;
		}
		if (msg.type === "tool_result" && typeof msg.id === "string") {
			this.#pending.resolve(msg.id, {
				content: msg.content,
				is_error: msg.is_error === true,
			});
		} else if (msg.type === "ping") {
			this.#write(socket, { type: "pong" });
		}
	}

	#onClose(socket: Socket<BridgeData>): void {
		if (this.#client !== socket) return;
		this.#client = null;
		this.#pending.rejectAll(new Error("bridge client disconnected"));
		for (const cb of this.#onDisconnected) cb();
	}

	#write(socket: Socket<BridgeData>, msg: unknown): void {
		socket.write(`${JSON.stringify(msg)}\n`);
	}

	/** Send a `tool_request` to the connected client and await its `tool_result`. */
	request(tool: string, params: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ToolResult> {
		const client = this.#client;
		if (!client) return Promise.reject(new Error("bridge: no client connected"));
		const { id, promise } = this.#pending.create(timeoutMs);
		this.#write(client, { type: "tool_request", id, tool, params });
		return promise;
	}

	async close(): Promise<void> {
		this.#pending.rejectAll(new Error("bridge server closed"));
		this.#client?.end();
		this.#client = null;
		this.#listener?.stop(true);
		this.#listener = null;
	}
}

/**
 * Resolve the default socket path (`~/.xcsh/chrome-bridge.sock`), ensure the
 * directory exists, remove any stale socket, start the {@link BridgeServer},
 * and tighten the socket permissions to owner-only (0600).
 */
export async function startBridgeServer(socketPath?: string): Promise<BridgeServer> {
	const resolved = socketPath ?? path.join(os.homedir(), ".xcsh", "chrome-bridge.sock");
	fs.mkdirSync(path.dirname(resolved), { recursive: true });
	fs.rmSync(resolved, { force: true });
	const server = new BridgeServer();
	server.listen(resolved);
	fs.chmodSync(resolved, 0o600);
	return server;
}
