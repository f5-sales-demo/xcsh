import { randomUUID } from "node:crypto";
import type { Server, ServerWebSocket } from "bun";
import { LOCALIP_HOST } from "./bridge-cert";
import { EXTENSION_CONTRACT_VERSION } from "./capabilities.generated";
import { EXTENSION_ID } from "./extension-identity";
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
			timer: NodeJS.Timeout;
		}
	>();

	create(timeoutMs: number): { id: string; promise: Promise<ToolResult> } {
		const id = randomUUID();
		const { promise, resolve, reject } = Promise.withResolvers<ToolResult>();
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

/**
 * The historical base of the whole bridge port layout.
 *
 * Every range below is derived from a base rather than written out, so a caller can move the entire
 * layout coherently. That matters because the layout is otherwise global to the machine: every
 * clone, worktree and live session competes for the same window, and an integration test that reaps
 * "whatever holds my ports" can reach a developer's own bridge (#2495).
 */
export const BRIDGE_PORT_BASE_DEFAULT = 19222;

/** Ports occupied by one bridge layout. */
export interface BridgePortLayout {
	defaultPort: number;
	chrome: PortRange;
	office: PortRange;
	/** Paired wss listeners for the chrome ws range. */
	wss: PortRange;
}

/**
 * Fixed offset from a bound ws port to its paired `wss` port. The wss listener is
 * ADDITIVE: when the bridge binds ws port P (in {@link PORT_RANGE_START}–{@link
 * PORT_RANGE_END}), it also binds wss on P + {@link WSS_PORT_OFFSET}, so discovery
 * stays trivial (ws 19222 ↔ wss 19322 at the default base) and the pair can never desync.
 */
export const WSS_PORT_OFFSET = 100;

/** Width of each auto-select range. */
const RANGE_WIDTH = 20;

/**
 * Resolve the layout base from the environment.
 *
 * Anything that is not a usable port number falls back to the default rather than shifting the
 * fleet somewhere unexpected.
 */
export function resolveBridgePortBase(env: Record<string, string | undefined> = process.env): number {
	const raw = Number(env.XCSH_BRIDGE_PORT_START);
	if (!Number.isInteger(raw) || raw <= 0 || raw > 65_535 - 200) return BRIDGE_PORT_BASE_DEFAULT;
	return raw;
}

/** Every range for a given base, preserving the office-above-chrome and wss=ws+100 invariants. */
export function deriveBridgePorts(base: number): BridgePortLayout {
	return {
		defaultPort: base,
		chrome: { start: base, end: base + RANGE_WIDTH - 1 },
		office: { start: base + RANGE_WIDTH, end: base + 2 * RANGE_WIDTH - 1 },
		wss: { start: base + WSS_PORT_OFFSET, end: base + WSS_PORT_OFFSET + RANGE_WIDTH - 1 },
	};
}

const LAYOUT = deriveBridgePorts(resolveBridgePortBase());

/** Default loopback port for the extension WebSocket bridge. */
export const DEFAULT_PORT = LAYOUT.defaultPort;

/** Resolve the bridge port from an explicit value, then `XCSH_BRIDGE_PORT`, then the default. */
export function resolvePort(port?: number): number {
	if (typeof port === "number" && Number.isFinite(port) && port > 0) return port;
	const env = Number(process.env.XCSH_BRIDGE_PORT);
	if (Number.isFinite(env) && env > 0) return env;
	return DEFAULT_PORT;
}

/** Inclusive loopback discovery range for auto-selected bridge ports (Chrome worker). */
export const PORT_RANGE_START = LAYOUT.chrome.start;
export const PORT_RANGE_END = LAYOUT.chrome.end;

/**
 * Dedicated loopback ws range for `xcsh office serve` bridges — DISJOINT from the
 * Chrome worker range above. Its paired wss listeners land at +{@link WSS_PORT_OFFSET}
 * (19342–19361). Giving office-serve its own range means a Chrome worker and an
 * office bridge can never contend for a port, so the office pane (which scans only
 * the office wss range) can never adopt a Chrome worker. The Chrome fleet's range
 * is UNCHANGED — zero blast radius on browser automation.
 */
export const OFFICE_PORT_RANGE_START = LAYOUT.office.start;
export const OFFICE_PORT_RANGE_END = LAYOUT.office.end;

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

export interface BridgeSessionInfo {
	tenant: string | null;
	env: string | null;
	contextBound: boolean;
	sessionId: string | null;
}

export interface BridgeServerConfig {
	serveKind: ServeKind;
	sessionInfo: () => BridgeSessionInfo;
}

/** Inclusive discovery range for the paired `wss` listeners (ws range + offset). */
export const WSS_RANGE_START = LAYOUT.wss.start;
export const WSS_RANGE_END = LAYOUT.wss.end;

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

export type StartBridgeOptions = BridgeListenOpts & BridgeServerConfig;

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
	/** One worker process owns one authenticated extension transport. */
	#client: ServerWebSocket<undefined> | null = null;
	/** A newly opened socket that has not yet passed the transport handshake. */
	#candidate: ServerWebSocket<undefined> | null = null;
	#onConnected: Array<() => void> = [];
	#onDisconnected: Array<() => void> = [];
	/** Consumers of non-RPC frames (chat_delta, tool_result, unhandled) — e.g. the chat handler. */
	#onMessage: Array<(msg: Record<string, unknown>) => void> = [];
	/** Heartbeat interval that sends pings to keep the MV3 service worker alive (sweep + chat). */
	#heartbeat: NodeJS.Timeout | null = null;
	/** The client host learned from an authenticated Office `hello`. */
	#clientHost: ClientHost | null = null;
	readonly #serveKind: ServeKind;
	readonly #sessionInfo: () => BridgeSessionInfo;

	constructor(config: BridgeServerConfig) {
		this.#serveKind = config.serveKind;
		this.#sessionInfo = config.sessionInfo;
	}

	/** The port the WebSocket server is listening on (0 = not bound). */
	get port(): number {
		return this.#server?.port ?? 0;
	}

	/** The port the additive `wss` server is listening on (0 = ws-only / not bound). */
	get wssPort(): number {
		return this.#wssServer?.port ?? 0;
	}

	/** True only after the client completes the transport-specific handshake. */
	get connected(): boolean {
		return this.#client !== null;
	}

	/** The client host announced by the connected client's `hello` (null until a
	 * client announces one). Read by the ChatHandler to pick the host-aware prompt. */
	get clientHost(): ClientHost | null {
		return this.#clientHost;
	}

	/** How this bridge was started. Fixed before the listener binds. */
	get serveKind(): ServeKind {
		return this.#serveKind;
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

	#readIdentity(): BridgeSessionInfo | null {
		const info = this.#sessionInfo();
		if (
			(info.tenant !== null && (typeof info.tenant !== "string" || info.tenant.length === 0)) ||
			(info.env !== null && info.env !== "production" && info.env !== "staging") ||
			typeof info.contextBound !== "boolean" ||
			(info.sessionId !== null && (typeof info.sessionId !== "string" || info.sessionId.length === 0)) ||
			(info.tenant === null) !== (info.env === null) ||
			(info.contextBound && info.tenant === null) ||
			(this.#serveKind === "browser" && info.sessionId === null)
		) {
			return null;
		}
		return info;
	}

	#identityFrame(
		type: "hello_ack" | "tenant_changed",
		info: BridgeSessionInfo,
		clientHost: ClientHost | null = this.#clientHost,
	): Record<string, unknown> {
		const common = {
			type,
			sessionId: info.sessionId,
			tenant: info.tenant,
			env: info.env,
			contextBound: info.contextBound,
		};
		if (this.#serveKind === "browser") {
			return { ...common, contractVersion: EXTENSION_CONTRACT_VERSION };
		}
		return {
			...common,
			version: "1",
			host: clientHost,
			serveKind: this.#serveKind,
			canConfigureProvider: true,
		};
	}

	#dropClient(ws: ServerWebSocket<undefined>, closeCode?: number): void {
		if (this.#client !== ws) return;
		this.#client = null;
		this.#clientHost = null;
		if (this.#heartbeat) {
			clearInterval(this.#heartbeat);
			this.#heartbeat = null;
		}
		this.#pending.rejectAll(new Error("bridge client disconnected"));
		if (closeCode !== undefined) ws.close(closeCode, "bridge protocol rejected");
		for (const cb of this.#onDisconnected) cb();
	}

	#dropCandidate(ws: ServerWebSocket<undefined>, closeCode?: number): void {
		if (this.#candidate !== ws) return;
		this.#candidate = null;
		if (closeCode !== undefined) ws.close(closeCode, "bridge protocol rejected");
	}

	/** Push a complete, versioned tenant change to the authenticated client. */
	broadcastTenantChanged(): void {
		const client = this.#client;
		if (!client) return;
		const info = this.#readIdentity();
		if (!info) {
			this.#dropClient(client, 1008);
			return;
		}
		try {
			client.send(JSON.stringify(this.#identityFrame("tenant_changed", info)));
		} catch {
			this.#dropClient(client);
		}
	}

	/** Send a fire-and-forget JSON frame to the authenticated client. */
	send(payload: unknown): void {
		this.#client?.send(JSON.stringify(payload));
	}

	#onOpen(ws: ServerWebSocket<undefined>): void {
		if (this.#candidate) {
			const previous = this.#candidate;
			this.#candidate = null;
			previous.close(1000, "bridge handshake replaced");
		}
		this.#candidate = ws;
	}

	/** Try to bind the loopback WS server to `port`. When `opts.tls` is supplied an
	 * ADDITIVE `wss` listener is also bound on `port + WSS_PORT_OFFSET`, sharing ONE
	 * fetch/websocket implementation with the ws listener. Returns false on EADDRINUSE
	 * on EITHER listener (so the caller can try the next candidate); rethrows any other
	 * error. The ws listener + origin gate are byte-for-byte identical to the ws-only path. */
	listen(port: number, opts?: BridgeListenOpts): boolean {
		// Extract the fetch + websocket handlers to locals so BOTH the ws and the wss
		// listeners share ONE implementation (DRY). Behavior is unchanged from before.
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
		if (this.#candidate !== ws && this.#client !== ws) return;
		const text = typeof message === "string" ? message : message.toString("utf8");
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(text);
		} catch {
			if (this.#candidate === ws) this.#dropCandidate(ws, 1008);
			else this.#dropClient(ws, 1008);
			return;
		}
		if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
			if (this.#candidate === ws) this.#dropCandidate(ws, 1008);
			else this.#dropClient(ws, 1008);
			return;
		}

		if (this.#candidate === ws) {
			const keys = Object.keys(msg);
			const browserHello =
				this.#serveKind === "browser" &&
				keys.length === 3 &&
				keys.every(key => key === "type" || key === "contractVersion" || key === "extensionId") &&
				msg.type === "hello" &&
				typeof msg.contractVersion === "string" &&
				msg.contractVersion.split(".")[0] === EXTENSION_CONTRACT_VERSION.split(".")[0] &&
				msg.extensionId === EXTENSION_ID;
			const officeHello =
				this.#serveKind === "office" &&
				keys.every(key => key === "type" || key === "version" || key === "host") &&
				msg.type === "hello" &&
				msg.version === "1" &&
				(msg.host === undefined || isClientHost(msg.host));
			if (!browserHello && !officeHello) {
				this.#dropCandidate(ws, 1008);
				return;
			}
			const info = this.#readIdentity();
			if (!info) {
				this.#dropCandidate(ws, 1008);
				return;
			}
			const candidateHost = officeHello && isClientHost(msg.host) ? msg.host : null;
			try {
				ws.send(JSON.stringify(this.#identityFrame("hello_ack", info, candidateHost)));
			} catch {
				this.#dropCandidate(ws);
				return;
			}
			const previous = this.#client;
			if (previous) {
				this.#dropClient(previous);
				previous.close(1000, "bridge transport replaced");
			}
			this.#candidate = null;
			this.#client = ws;
			this.#clientHost = candidateHost;
			this.#heartbeat = setInterval(() => {
				try {
					if (this.#client === ws) ws.send(JSON.stringify({ type: "ping" }));
				} catch {
					this.#dropClient(ws);
				}
			}, 15_000);
			for (const cb of this.#onConnected) cb();
			return;
		}

		if (msg.type === "hello") {
			this.#dropClient(ws, 1008);
			return;
		}
		if (msg.type === "tool_result" && typeof msg.id === "string") {
			this.#pending.resolve(msg.id, {
				content: msg.content,
				is_error: msg.is_error === true,
			});
		} else if (msg.type === "ping") {
			ws.send(JSON.stringify({ type: "pong" }));
		} else {
			for (const cb of this.#onMessage) cb(msg);
		}
	}

	#onClose(ws: ServerWebSocket<undefined>): void {
		if (this.#candidate === ws) this.#dropCandidate(ws);
		else this.#dropClient(ws);
	}

	/**
	 * Send a `tool_request` and await its `tool_result` on the authenticated transport.
	 */
	request(tool: string, params: unknown, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ToolResult> {
		const client = this.connected ? this.#client : null;
		if (!client) {
			return Promise.reject(new Error("bridge: no authenticated client connected"));
		}
		const { id, promise } = this.#pending.create(timeoutMs);
		client.send(JSON.stringify({ type: "tool_request", id, tool, params }));
		return promise;
	}

	async close(): Promise<void> {
		if (this.#heartbeat) {
			clearInterval(this.#heartbeat);
			this.#heartbeat = null;
		}
		this.#pending.rejectAll(new Error("bridge server closed"));
		this.#candidate?.close();
		this.#candidate = null;
		this.#client?.close();
		this.#client = null;
		this.#clientHost = null;
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
export async function startBridgeServer(port: number | undefined, opts: StartBridgeOptions): Promise<BridgeServer> {
	const server = new BridgeServer(opts);
	const forced = resolveForcedPort(port);
	if (forced !== null) {
		if (!server.listen(forced, opts)) {
			throw new Error(`XCSH_BRIDGE_PORT ${forced} is already in use — free it or pick another port`);
		}
		return server;
	}
	const range = opts.range ?? CHROME_PORT_RANGE;
	for (const candidate of portCandidates(range)) {
		if (server.listen(candidate, opts)) return server;
	}
	throw new Error(`no free xcsh bridge port in ${range.start}-${range.end} — is another app on the range?`);
}
