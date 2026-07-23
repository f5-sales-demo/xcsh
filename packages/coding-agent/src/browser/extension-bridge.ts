import { randomUUID } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import { LOCALIP_HOST } from "./bridge-cert";
import { type ClientHost, isClientHost } from "./host-profiles";

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

/** Inclusive loopback discovery range for auto-selected bridge ports (Chrome worker). */
export const PORT_RANGE_START = 19222;
export const PORT_RANGE_END = 19241;

/**
 * Dedicated loopback ws range for `xcsh office serve` bridges — DISJOINT from the
 * Chrome worker range above. Its paired wss listeners land at +{@link WSS_PORT_OFFSET}
 * (19342–19361). Giving office-serve its own range means a Chrome worker and an
 * office bridge can never contend for a port, so the office pane (which scans only
 * the office wss range) can never adopt a Chrome worker. The Chrome fleet's range
 * is UNCHANGED — zero blast radius on browser automation.
 */
export const OFFICE_PORT_RANGE_START = 19242;
export const OFFICE_PORT_RANGE_END = 19261;

/** An inclusive port range for auto-select. */
export interface PortRange {
	start: number;
	end: number;
}

/** The Chrome-worker auto-select range (the default). */
export const CHROME_PORT_RANGE: PortRange = { start: PORT_RANGE_START, end: PORT_RANGE_END };

/** The office-serve auto-select range. */
export const OFFICE_PORT_RANGE: PortRange = { start: OFFICE_PORT_RANGE_START, end: OFFICE_PORT_RANGE_END };

/** How a bridge was STARTED — its intrinsic scope (distinct from the connecting
 * client's announced host). Echoed in hello_ack so the office pane can filter. */
export type ServeKind = "office" | "browser";

/**
 * Fixed offset from a bound ws port to its paired `wss` port. The wss listener is
 * ADDITIVE: when the bridge binds ws port P (in {@link PORT_RANGE_START}–{@link
 * PORT_RANGE_END}), it also binds wss on P + {@link WSS_PORT_OFFSET}, so discovery
 * stays trivial (ws 19222 ↔ wss 19322) and the ws/wss pair can never desync.
 */
export const WSS_PORT_OFFSET = 100;
/** Inclusive discovery range for the paired `wss` listeners (ws range + offset). */
export const WSS_RANGE_START = 19322;
export const WSS_RANGE_END = 19341;

/**
 * Add-in origin allowlist suffixes for the bridge gate. An `https:` origin whose
 * host is EXACTLY one of these, OR ends with the dot-prefixed suffix `.<suffix>`
 * (so `evil-local-ip.sh` is NOT matched by `local-ip.sh`), is treated as a
 * trusted Office add-in / bridge host.
 *
 * Seeded with `local-ip.sh` — the validated add-in/bridge host proven by the UAT
 * (the `*.local-ip.sh` Let's Encrypt cert host that WebKit + Chromium open with
 * TLS verification ON and zero trust/MDM steps).
 *
 * TODO(#2045)(office-xcsh): enumerate the production Office task-pane host and
 * the SharePoint SPFx host origins here once the Phase 4 add-in host origin is
 * fixed. Do NOT hardcode guessed Office origins — add each only when validated.
 * This MUST stay an allowlist — never `*`.
 */
export const ADDIN_ALLOWED_ORIGIN_SUFFIXES = ["local-ip.sh"] as const;

/**
 * Pure origin-gate predicate for the bridge (shared by the ws + wss listeners).
 * Returns true ONLY for:
 *   (a) the Chrome extension origin `chrome-extension://${EXTENSION_ID}`
 *       (unchanged behavior for the Chrome ext), OR
 *   (b) an `https:` Office add-in origin whose host is exactly, or a dot-prefixed
 *       subdomain of, an entry in {@link ADDIN_ALLOWED_ORIGIN_SUFFIXES}.
 *
 * It is a strict ALLOWLIST — never `*`. The dot-prefixed suffix guard means
 * `https://evil-local-ip.sh` is REJECTED while `https://x.local-ip.sh` passes,
 * and the `https:`-only requirement rejects `http://x.local-ip.sh`.
 */
export function isAllowedBridgeOrigin(origin: string | null | undefined): boolean {
	if (!origin) return false;
	// Lazy require avoids a top-level import cycle (chrome-cli imports this module).
	const { EXTENSION_ID } = require("../cli/chrome-cli") as { EXTENSION_ID: string };
	if (origin === `chrome-extension://${EXTENSION_ID}`) return true;
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return false;
	}
	if (url.protocol !== "https:") return false;
	const host = url.hostname;
	return ADDIN_ALLOWED_ORIGIN_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

/** TLS material (PEM strings) for the additive `wss` listener. */
export interface BridgeTls {
	cert: string;
	key: string;
}

/** Options shared by {@link BridgeServer.listen} and {@link startBridgeServer}. */
export interface BridgeListenOpts {
	skipOriginCheck?: boolean;
	/** When present, an additive `wss` listener is started on port + {@link WSS_PORT_OFFSET}. */
	tls?: BridgeTls;
	/** Auto-select range for {@link startBridgeServer}; defaults to {@link CHROME_PORT_RANGE}. */
	range?: PortRange;
}

/** Every port in the given range (default {@link CHROME_PORT_RANGE}), lowest first. */
export function portCandidates(range: PortRange = CHROME_PORT_RANGE): number[] {
	const out: number[] = [];
	for (let p = range.start; p <= range.end; p++) out.push(p);
	return out;
}

/** The explicitly forced port (arg → XCSH_BRIDGE_PORT), or null to auto-select. */
export function resolveForcedPort(port?: number): number | null {
	if (typeof port === "number" && Number.isFinite(port) && port > 0) return port;
	const env = Number(process.env.XCSH_BRIDGE_PORT);
	if (Number.isFinite(env) && env > 0) return env;
	return null;
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
	/** Additive TLS listener on port + {@link WSS_PORT_OFFSET} (null when ws-only). */
	#wssServer: Server<undefined> | null = null;
	/** Multi-client: keyed by channelId (default channel = "default"). */
	#clients = new Map<string, ServerWebSocket<undefined>>();
	#nextChannelIndex = 0;
	#onConnected: Array<() => void> = [];
	#onDisconnected: Array<() => void> = [];
	/** Consumers of non-RPC frames (chat_delta, tool_result, unhandled) — e.g. the chat handler. */
	#onMessage: Array<(msg: Record<string, unknown>) => void> = [];
	/** Heartbeat interval that sends pings to keep the MV3 service worker alive (sweep + chat). */
	#heartbeat: ReturnType<typeof setInterval> | null = null;
	/** The client host learned from the `hello` handshake (null until a client
	 * announces one; the Chrome extension omits it → stays null → chrome profile). */
	#clientHost: ClientHost | null = null;
	/** How THIS bridge was started (its intrinsic scope). Defaults to "browser" (the
	 * Chrome worker); office-serve calls {@link setServeKind}("office"). Echoed in
	 * hello_ack so the office pane's discovery filter never adopts a Chrome worker. */
	#serveKind: ServeKind = "browser";
	/** Provider of this process's tenant identity, answering the `hello` handshake. */
	#sessionInfo:
		| (() => {
				tenant: string | null;
				env: string | null;
				apiUrl: string | null;
				contextBound: boolean;
				sessionId: string | null;
		  })
		| null = null;

	/** The port the WebSocket server is listening on (0 = not bound). */
	get port(): number {
		return this.#server?.port ?? 0;
	}

	/** The port the additive `wss` server is listening on (0 = ws-only / not bound). */
	get wssPort(): number {
		return this.#wssServer?.port ?? 0;
	}

	/** True when at least one client is connected (backwards compat). */
	get connected(): boolean {
		return this.#clients.size > 0;
	}

	/** The client host announced by the connected client's `hello` (null until a
	 * client announces one). Read by the ChatHandler to pick the host-aware prompt. */
	get clientHost(): ClientHost | null {
		return this.#clientHost;
	}

	/** How this bridge was started ("browser" by default; "office" for office-serve). */
	get serveKind(): ServeKind {
		return this.#serveKind;
	}

	/** Declare this bridge's intrinsic scope. Called once at startup by the host
	 * bootstrap (office-serve → "office"; the Chrome worker → "browser"). */
	setServeKind(kind: ServeKind): void {
		this.#serveKind = kind;
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

	/** Set the tenant-identity provider that answers the extension's `hello`
	 * handshake with `{ tenant, env, apiUrl }` for THIS xcsh process/context. */
	setSessionInfo(
		cb: () => {
			tenant: string | null;
			env: string | null;
			apiUrl: string | null;
			contextBound: boolean;
			sessionId: string | null;
		},
	): void {
		this.#sessionInfo = cb;
	}

	/** Push a tenant change to all connected panels (e.g. after `/context activate`). */
	broadcastTenantChanged(): void {
		const info = this.#sessionInfo?.() ?? {
			tenant: null,
			env: null,
			apiUrl: null,
			contextBound: false,
			sessionId: null,
		};
		for (const c of this.#clients.values()) {
			try {
				// `sessionId` (the tab-correlation key) comes from `info`, matching hello_ack.
				c.send(JSON.stringify({ type: "tenant_changed", ...info }));
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

	#onOpen(ws: ServerWebSocket<undefined>): void {
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
	}

	/** Try to bind the loopback WS server to `port`. When `opts.tls` is supplied an
	 * ADDITIVE `wss` listener is also bound on `port + WSS_PORT_OFFSET`, sharing ONE
	 * fetch/websocket implementation with the ws listener. Returns false on EADDRINUSE
	 * on EITHER listener (so the caller can try the next candidate); rethrows any other
	 * error. The ws listener + origin gate are byte-for-byte identical to the ws-only path. */
	listen(port: number, opts?: BridgeListenOpts): boolean {
		// Extract the fetch + websocket handlers to locals so BOTH the ws and the wss
		// listeners share ONE implementation (DRY). Behavior is unchanged from before.
		const { EXTENSION_ID } = require("../cli/chrome-cli") as { EXTENSION_ID: string };
		const fetch = (req: Request, server: Server<undefined>): Response | undefined => {
			const origin = req.headers.get("origin");
			// SUPERSET gate: the Chrome ext origin stays allowed (Chrome path preserved);
			// add-in `.local-ip.sh` origins are ADDITIONALLY allowed. Allowlist, never `*`.
			if (!opts?.skipOriginCheck && !isAllowedBridgeOrigin(origin)) {
				return new Response("Forbidden", { status: 403 });
			}
			// For an ALLOWED cross-origin (non-ext) add-in origin, opt into Private Network
			// Access + reflect the origin (scoped, never `*`) so a public `https:` add-in
			// origin may open the loopback socket. The chrome-extension origin path is
			// unchanged (no extra headers).
			if (origin && origin !== `chrome-extension://${EXTENSION_ID}` && isAllowedBridgeOrigin(origin)) {
				if (
					server.upgrade(req, {
						headers: {
							"Access-Control-Allow-Private-Network": "true",
							"Access-Control-Allow-Origin": origin,
						},
					})
				)
					return undefined;
			} else if (server.upgrade(req)) {
				return undefined;
			}
			return new Response("xcsh bridge: WebSocket only", { status: 426 });
		};
		const websocket = {
			open: (ws: ServerWebSocket<undefined>) => this.#onOpen(ws),
			message: (ws: ServerWebSocket<undefined>, message: string | Buffer) => this.#handleMessage(ws, message),
			close: (ws: ServerWebSocket<undefined>) => this.#onClose(ws),
		};
		try {
			this.#server = Bun.serve({ port, hostname: "127.0.0.1", fetch, websocket });
			// Additive wss listener: only when cert material is available. Absent TLS
			// leaves the bridge ws-only (no crash). EADDRINUSE here → false (same try).
			if (opts?.tls?.cert && opts.tls.key) {
				this.#wssServer = Bun.serve({
					port: port + WSS_PORT_OFFSET,
					hostname: "127.0.0.1",
					tls: { cert: opts.tls.cert, key: opts.tls.key, serverName: LOCALIP_HOST },
					fetch,
					websocket,
				});
			}
			return true;
		} catch (e) {
			if (e instanceof Error && /EADDRINUSE|address already in use|in use/i.test(e.message)) {
				// Roll back any partially-bound listener so a retry on the next candidate
				// starts clean (no leaked ws server when only the wss bind collided).
				this.#server?.stop(true);
				this.#server = null;
				this.#wssServer?.stop(true);
				this.#wssServer = null;
				return false;
			}
			throw e;
		}
	}

	#handleMessage(ws: ServerWebSocket<undefined>, message: string | Buffer): void {
		const text = typeof message === "string" ? message : message.toString("utf8");
		let msg: { type?: string; id?: string; content?: unknown; is_error?: boolean; host?: unknown };
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
			// Record the announced client host (contract 1.10.0): Office sends its
			// lowercased Office.context.host ("excel"|"powerpoint"|"word"); the Chrome
			// extension omits it → clientHost stays null → the browser profile. Invalid
			// values are ignored (null retained). Echoed back so the client can confirm.
			if (isClientHost(msg.host)) this.#clientHost = msg.host;
			const info = this.#sessionInfo?.() ?? {
				tenant: null,
				env: null,
				apiUrl: null,
				contextBound: false,
				sessionId: null,
			};
			const { EXTENSION_CONTRACT_VERSION } = require("./capabilities.generated");
			ws.send(
				JSON.stringify({
					type: "hello_ack",
					sessionId: info.sessionId,
					contractVersion: EXTENSION_CONTRACT_VERSION,
					tenant: info.tenant,
					env: info.env,
					apiUrl: info.apiUrl,
					contextBound: info.contextBound,
					host: this.#clientHost,
					serveKind: this.#serveKind,
					pid: process.pid,
					wssPort: this.wssPort,
					canConfigureProvider: true,
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
		this.#wssServer?.stop(true);
		this.#wssServer = null;
	}
}

/**
 * Start the {@link BridgeServer} on the resolved loopback port. If a port is
 * forced (explicit arg or `XCSH_BRIDGE_PORT`) it must be free — throws loudly
 * if taken. Otherwise, auto-selects the lowest free port in the discovery range
 * ({@link PORT_RANGE_START}–{@link PORT_RANGE_END}). The WebSocket transport
 * needs no filesystem setup — Chrome connects directly to `ws://127.0.0.1:<port>`.
 */
export async function startBridgeServer(port?: number, opts?: BridgeListenOpts): Promise<BridgeServer> {
	const server = new BridgeServer();
	const forced = resolveForcedPort(port);
	if (forced !== null) {
		if (!server.listen(forced, opts)) {
			throw new Error(`XCSH_BRIDGE_PORT ${forced} is already in use — free it or pick another port`);
		}
		return server;
	}
	const range = opts?.range ?? CHROME_PORT_RANGE;
	for (const candidate of portCandidates(range)) {
		if (server.listen(candidate, opts)) return server;
	}
	throw new Error(`no free xcsh bridge port in ${range.start}-${range.end} — is another app on the range?`);
}
