import { randomUUID } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";

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

/** Default loopback port for the extension WebSocket bridge. */
export const DEFAULT_PORT = 19222;

/** Resolve the bridge port from an explicit value, then `XCSH_BRIDGE_PORT`, then the default. */
export function resolvePort(port?: number): number {
	if (typeof port === "number" && Number.isFinite(port) && port > 0) return port;
	const env = Number(process.env.XCSH_BRIDGE_PORT);
	if (Number.isFinite(env) && env > 0) return env;
	return DEFAULT_PORT;
}

/**
 * Loopback WebSocket server bridging xcsh to the Chrome extension. Speaks JSON
 * over WS frames: requests `{type:"tool_request",...}`, replies
 * `{type:"tool_result",...}`, plus `{type:"ping"|"pong"}`. Tracks a single
 * connected client (a new connection replaces the prior one) and correlates
 * replies via {@link PendingRequests}.
 */
export class BridgeServer {
	#pending = new PendingRequests();
	#server: Server<undefined> | null = null;
	#client: ServerWebSocket<undefined> | null = null;
	#onConnected: Array<() => void> = [];
	#onDisconnected: Array<() => void> = [];

	/** The port the WebSocket server is listening on (0 = not bound). */
	get port(): number {
		return this.#server?.port ?? 0;
	}

	get connected(): boolean {
		return this.#client !== null;
	}

	onConnected(cb: () => void): void {
		this.#onConnected.push(cb);
	}

	onDisconnected(cb: () => void): void {
		this.#onDisconnected.push(cb);
	}

	/** Bind the WebSocket server to a loopback port. Called by {@link startBridgeServer}. */
	listen(port: number): void {
		this.#server = Bun.serve({
			port,
			hostname: "127.0.0.1",
			fetch: (req, server) => {
				// Validate the Origin header: only the xcsh Chrome extension may connect.
				// This restores the access-control guarantee that the Unix socket's 0o600
				// permissions previously provided.
				const origin = req.headers.get("origin") ?? "";
				const { EXTENSION_ID } = require("../cli/chrome-cli");
				if (origin !== `chrome-extension://${EXTENSION_ID}`) {
					return new Response("Forbidden", { status: 403 });
				}
				if (server.upgrade(req)) return undefined;
				return new Response("xcsh bridge: WebSocket only", { status: 426 });
			},
			websocket: {
				open: ws => {
					// One client at a time: close any prior connection on a new connect.
					if (this.#client && this.#client !== ws) this.#client.close();
					this.#client = ws;
					for (const cb of this.#onConnected) cb();
				},
				message: (ws, message) => {
					this.#handleMessage(ws, message);
				},
				close: ws => {
					this.#onClose(ws);
				},
			},
		});
	}

	#handleMessage(ws: ServerWebSocket<undefined>, message: string | Buffer): void {
		const text = typeof message === "string" ? message : message.toString("utf8");
		let msg: { type?: string; id?: string; content?: unknown; is_error?: boolean };
		try {
			msg = JSON.parse(text);
		} catch {
			return;
		}
		if (msg.type === "tool_result" && typeof msg.id === "string") {
			this.#pending.resolve(msg.id, {
				content: msg.content,
				is_error: msg.is_error === true,
			});
		} else if (msg.type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
		}
	}

	#onClose(ws: ServerWebSocket<undefined>): void {
		if (this.#client !== ws) return;
		this.#client = null;
		this.#pending.rejectAll(new Error("bridge client disconnected"));
		for (const cb of this.#onDisconnected) cb();
	}

	/** Send a `tool_request` to the connected client and await its `tool_result`. */
	request(tool: string, params: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ToolResult> {
		const client = this.#client;
		if (!client) return Promise.reject(new Error("bridge: no client connected"));
		const { id, promise } = this.#pending.create(timeoutMs);
		client.send(JSON.stringify({ type: "tool_request", id, tool, params }));
		return promise;
	}

	async close(): Promise<void> {
		this.#pending.rejectAll(new Error("bridge server closed"));
		this.#client?.close();
		this.#client = null;
		this.#server?.stop(true);
		this.#server = null;
	}
}

/**
 * Start the {@link BridgeServer} on the resolved loopback port (explicit arg,
 * then `XCSH_BRIDGE_PORT`, then {@link DEFAULT_PORT}). The WebSocket transport
 * needs no filesystem setup — Chrome connects directly to `ws://127.0.0.1:<port>`.
 */
export async function startBridgeServer(port?: number): Promise<BridgeServer> {
	const server = new BridgeServer();
	server.listen(resolvePort(port));
	return server;
}
