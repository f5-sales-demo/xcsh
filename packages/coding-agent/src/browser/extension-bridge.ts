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
	/** Multi-client: keyed by channelId (default channel = "default"). */
	#clients = new Map<string, ServerWebSocket<undefined>>();
	#nextChannelIndex = 0;
	#onConnected: Array<() => void> = [];
	#onDisconnected: Array<() => void> = [];
	/** Consumers of non-RPC frames (chat_delta, tool_result, unhandled) — e.g. the chat handler. */
	#onMessage: Array<(msg: Record<string, unknown>) => void> = [];
	/** Heartbeat interval that sends pings to keep the MV3 service worker alive (sweep + chat). */
	#heartbeat: ReturnType<typeof setInterval> | null = null;
	/** Stable per-process session id, advertised to the extension on `hello`. */
	#sessionId = `sess-${crypto.randomUUID()}`;
	/** Provider of this process's tenant identity, answering the `hello` handshake. */
	#sessionInfo: (() => { tenant: string | null; env: string | null; apiUrl: string | null }) | null = null;

	/** The port the WebSocket server is listening on (0 = not bound). */
	get port(): number {
		return this.#server?.port ?? 0;
	}

	/** True when at least one client is connected (backwards compat). */
	get connected(): boolean {
		return this.#clients.size > 0;
	}

	/** Number of connected extension clients (channels). */
	get connectedCount(): number {
		return this.#clients.size;
	}

	onConnected(cb: () => void): void {
		this.#onConnected.push(cb);
	}

	onDisconnected(cb: () => void): void {
		this.#onDisconnected.push(cb);
	}

	/** Register a listener for messages not handled by the built-in router (tool_result, ping). */
	onMessage(cb: (msg: Record<string, unknown>) => void): void {
		this.#onMessage.push(cb);
	}

	/** This process's stable session id (advertised on the `hello` handshake). */
	get sessionId(): string {
		return this.#sessionId;
	}

	/** Set the tenant-identity provider that answers the extension's `hello`
	 * handshake with `{ tenant, env, apiUrl }` for THIS xcsh process/context. */
	setSessionInfo(cb: () => { tenant: string | null; env: string | null; apiUrl: string | null }): void {
		this.#sessionInfo = cb;
	}

	/** Push a tenant change to all connected panels (e.g. after `/context activate`). */
	broadcastTenantChanged(): void {
		const info = this.#sessionInfo?.() ?? { tenant: null, env: null, apiUrl: null };
		for (const c of this.#clients.values()) {
			try {
				c.send(JSON.stringify({ type: "tenant_changed", sessionId: this.#sessionId, ...info }));
			} catch {
				/* client may have dropped */
			}
		}
	}

	/**
	 * Resolve the target client for a frame. With an explicit channelId, returns
	 * that channel; otherwise the "default" channel, falling back to the first
	 * connected client. The single source of channel resolution (DRY) — used by
	 * both {@link request} and {@link send}.
	 */
	#resolveClient(channelId?: string): ServerWebSocket<undefined> | undefined {
		return channelId
			? this.#clients.get(channelId)
			: (this.#clients.get("default") ?? this.#clients.values().next().value);
	}

	/** Send a fire-and-forget JSON frame to a connected client (default channel if unspecified). */
	send(payload: unknown, channelId?: string): void {
		this.#resolveClient(channelId)?.send(JSON.stringify(payload));
	}

	/** Bind the WebSocket server to a loopback port. Called by {@link startBridgeServer}. */
	listen(port: number, opts?: { skipOriginCheck?: boolean }): void {
		this.#server = Bun.serve({
			port,
			hostname: "127.0.0.1",
			fetch: (req, server) => {
				// Validate the Origin header: only the xcsh Chrome extension may connect.
				// This restores the access-control guarantee that the Unix socket's 0o600
				// permissions previously provided.
				if (!opts?.skipOriginCheck) {
					const origin = req.headers.get("origin") ?? "";
					const { EXTENSION_ID } = require("../cli/chrome-cli");
					if (origin !== `chrome-extension://${EXTENSION_ID}`) {
						return new Response("Forbidden", { status: 403 });
					}
				}
				if (server.upgrade(req)) return undefined;
				return new Response("xcsh bridge: WebSocket only", { status: 426 });
			},
			websocket: {
				open: ws => {
					// Assign a channel ID to each connection. For backwards compat (single
					// extension), the first connection gets "default". Additional connections
					// get "ch-1", "ch-2", etc. — supporting multi-tab parallelism.
					const channelId = this.#clients.size === 0 ? "default" : `ch-${++this.#nextChannelIndex}`;
					(ws as unknown as { channelId: string }).channelId = channelId;
					this.#clients.set(channelId, ws);
					// Start a heartbeat ping to keep the MV3 service worker alive.
					// Chrome suspends idle SWs after ~30s; a ping every 15s prevents that.
					if (!this.#heartbeat) {
						this.#heartbeat = setInterval(() => {
							for (const c of this.#clients.values()) {
								try {
									c.send(JSON.stringify({ type: "ping" }));
								} catch {
									/* client may have dropped */
								}
							}
						}, 15_000);
					}
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
		} else if (msg.type === "hello") {
			// Identity handshake: tell the extension which tenant this process serves.
			const info = this.#sessionInfo?.() ?? { tenant: null, env: null, apiUrl: null };
			ws.send(
				JSON.stringify({
					type: "hello_ack",
					sessionId: this.#sessionId,
					tenant: info.tenant,
					env: info.env,
					apiUrl: info.apiUrl,
					pid: process.pid,
				}),
			);
		} else {
			for (const cb of this.#onMessage) cb(msg as Record<string, unknown>);
		}
	}

	#onClose(ws: ServerWebSocket<undefined>): void {
		const channelId = (ws as unknown as { channelId?: string }).channelId;
		if (channelId && this.#clients.get(channelId) === ws) {
			this.#clients.delete(channelId);
		}
		if (this.#clients.size === 0) {
			this.#pending.rejectAll(new Error("bridge client disconnected"));
		}
		for (const cb of this.#onDisconnected) cb();
	}

	/**
	 * Send a `tool_request` and await its `tool_result`. Routes to a specific channel
	 * when `channelId` is provided; otherwise uses the default (first) client.
	 * This enables multi-tab parallelism: each channel targets a different Chrome tab.
	 */
	request(
		tool: string,
		params: unknown,
		timeoutMs: number = DEFAULT_TIMEOUT_MS,
		channelId?: string,
	): Promise<ToolResult> {
		const client = this.#resolveClient(channelId);
		if (!client) {
			return Promise.reject(
				new Error(channelId ? `bridge: channel "${channelId}" not connected` : "bridge: no client connected"),
			);
		}
		const { id, promise } = this.#pending.create(timeoutMs);
		const frame: Record<string, unknown> = { type: "tool_request", id, tool, params };
		if (channelId) frame.channelId = channelId;
		client.send(JSON.stringify(frame));
		return promise;
	}

	async close(): Promise<void> {
		if (this.#heartbeat) {
			clearInterval(this.#heartbeat);
			this.#heartbeat = null;
		}
		this.#pending.rejectAll(new Error("bridge server closed"));
		for (const ws of this.#clients.values()) ws.close();
		this.#clients.clear();
		this.#server?.stop(true);
		this.#server = null;
	}
}

/**
 * Start the {@link BridgeServer} on the resolved loopback port (explicit arg,
 * then `XCSH_BRIDGE_PORT`, then {@link DEFAULT_PORT}). The WebSocket transport
 * needs no filesystem setup — Chrome connects directly to `ws://127.0.0.1:<port>`.
 */
export async function startBridgeServer(port?: number, opts?: { skipOriginCheck?: boolean }): Promise<BridgeServer> {
	const server = new BridgeServer();
	server.listen(resolvePort(port), opts);
	return server;
}
