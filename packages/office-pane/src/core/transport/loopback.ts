/**
 * LoopbackBridgeTransport — connects to xcsh's local wss bridge.
 *
 * Browser-safe: no node:* imports, no Office.js, no runtime @f5-sales-demo/* deps.
 * Uses the browser-global WebSocket; always constructs a wss:// URL.
 *
 * Security: TLS verification is NEVER disabled. The wss: scheme is asserted
 * at URL construction time to guard against a plain-ws regression. A
 * test-only factory injection exists for host/port override only — cert
 * tolerance cannot be expressed through the factory API.
 */

import type { ClientHost } from "@f5-sales-demo/xcsh/browser/chat-protocol";
import {
	isChatDelta,
	isChatDone,
	isChatError,
	isChatKeepalive,
	isChatToolNotice,
	isConfigureAck,
	isConfigureError,
	isHostToolCall,
	isHostToolCancel,
} from "../protocol";
import { type BridgeInfo, pickBridge, wssPortCandidates } from "./bridge-discovery";
import type { ChatInbound, ChatOutbound, ConfigurableTransport, ProviderConfigure } from "./index";

/**
 * Default target host: the `*.local-ip.sh` SAN name that resolves to 127.0.0.1.
 * The IP literal `127.0.0.1` is NOT covered by the cert SAN and FAILS TLS —
 * only `127-0-0-1.local-ip.sh` matches, letting a WebView open the loopback
 * wss with TLS verification ON and no trust/admin/MDM step.
 */
const DEFAULT_HOST = "127-0-0-1.local-ip.sh";

// ---------------------------------------------------------------------------
// Handshake message shapes (minimal; server owns the full schema)
// ---------------------------------------------------------------------------

interface HelloMsg {
	type: "hello";
	version: string;
	/** The client host (contract 1.10.0) so the engine picks the document-assistant
	 * prompt for this Office app. Omitted for hosts without a profile (Outlook). */
	host?: ClientHost;
}

interface HelloAckMsg {
	type: "hello_ack";
	/** True when this xcsh advertises the `configure` provider-config frame. */
	canConfigureProvider?: boolean;
}

/** Protocol version announced in the hello frame. */
const HELLO_VERSION = "1";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Factory type for WebSocket construction.
 *
 * TEST-ONLY — allows injecting a fake socket so handshake/message/stop
 * logic can be exercised without a real wss server. The production default
 * is `(url) => new WebSocket(url)`, which always uses the wss:// URL built
 * by {@link LoopbackBridgeTransport.buildUrl}; no cert-tolerance parameter
 * exists or is accepted.
 */
export type WebSocketFactory = (url: string) => WebSocket;

/** Options for {@link LoopbackBridgeTransport}. */
export interface LoopbackBridgeOptions {
	/**
	 * Target host. Defaults to '127-0-0-1.local-ip.sh' (the cert SAN name).
	 * Test-only override: never changes TLS behaviour.
	 */
	host?: string;
	/**
	 * Target port. When set, the transport connects to this single port
	 * (no discovery). When omitted, it scans the wss discovery range
	 * (19322–19341) and picks the best live bridge — the production default.
	 */
	port?: number;
	/**
	 * Max time (ms) to wait for candidates to answer during multi-port
	 * discovery before finalizing on whatever answered. Defaults to 4000.
	 * A backstop only: discovery finalizes as soon as every candidate settles.
	 */
	discoveryTimeoutMs?: number;
	/**
	 * The client host announced on the `hello` handshake (contract 1.10.0), so
	 * xcsh injects the document-assistant prompt for this Office app. Omitted for
	 * a host without a profile (Outlook/unknown) → the engine's default profile.
	 */
	clientHost?: ClientHost;
	/**
	 * TEST-ONLY: inject a WebSocket factory to exercise logic without a real
	 * wss server. This must never be used to disable TLS verification — the
	 * factory signature does not accept cert options by design.
	 */
	_webSocketFactory?: WebSocketFactory;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function isHelloAck(v: unknown): v is HelloAckMsg {
	return v !== null && typeof v === "object" && (v as Record<string, unknown>).type === "hello_ack";
}

/**
 * Transport that connects to the xcsh bridge over
 * `wss://127-0-0-1.local-ip.sh:<port>`,
 * performs the hello/hello_ack handshake, and emits inbound chat messages to
 * all registered subscribers.
 *
 * Lifecycle: idle → connecting (during connect()) → open → closed.
 */
export class LoopbackBridgeTransport implements ConfigurableTransport {
	private _state: "idle" | "connecting" | "open" | "closed" = "idle";
	private _ws: WebSocket | null = null;
	private _subscribers: Set<(m: ChatInbound) => void> = new Set();
	/** Whether the adopted bridge advertised the `configure` frame (from hello_ack). */
	private _canConfigure = false;
	/** Resolver for an in-flight configure() (single at a time). */
	private _pendingConfigure: { resolve: (model: string) => void; reject: (e: Error) => void } | null = null;
	/** Sockets opened during an in-flight discovery scan (closed on dispose). */
	private _pending: Set<WebSocket> = new Set();
	/** Cancels an in-flight discovery scan (stops the timer, blocks late finalize). */
	private _abortDiscovery: (() => void) | null = null;
	/** Id of the turn currently in flight (set on chat_request, cleared on its terminal). */
	private _activeTurnId: string | null = null;
	private readonly _host: string;
	private _port: number;
	/** wss ports to scan when no explicit port was given; null = single-port. */
	private readonly _discoveryPorts: number[] | null;
	private readonly _discoveryTimeoutMs: number;
	private readonly _wsFactory: WebSocketFactory;
	/** Client host announced on `hello` (undefined = announce none → default profile). */
	private readonly _clientHost: ClientHost | undefined;

	constructor(opts: LoopbackBridgeOptions = {}) {
		this._host = opts.host ?? DEFAULT_HOST;
		this._port = opts.port ?? wssPortCandidates()[0];
		this._discoveryPorts = opts.port === undefined ? wssPortCandidates() : null;
		this._discoveryTimeoutMs = opts.discoveryTimeoutMs ?? 4000;
		this._wsFactory = opts._webSocketFactory ?? ((url: string) => new WebSocket(url));
		this._clientHost = opts.clientHost;
	}

	/** Build the `hello` frame, announcing the client host when one is configured. */
	private _helloFrame(): HelloMsg {
		return {
			type: "hello",
			version: HELLO_VERSION,
			...(this._clientHost ? { host: this._clientHost } : {}),
		};
	}

	get state(): "idle" | "connecting" | "open" | "closed" {
		return this._state;
	}

	/** Whether the connected bridge advertised the `configure` provider-config frame. */
	get canConfigureProvider(): boolean {
		return this._canConfigure;
	}

	/**
	 * Configure xcsh's LLM provider at runtime (single-engine parity): send a
	 * `configure` frame and resolve with the selected model on `configure_ack`, or
	 * reject on `configure_error`. Rejects if not open, if one is already in
	 * flight, or if the bridge drops before replying.
	 */
	configure(config: ProviderConfigure): Promise<string> {
		if (this._state !== "open" || !this._ws) {
			return Promise.reject(new Error(`Cannot configure in state '${this._state}'`));
		}
		if (this._pendingConfigure) {
			return Promise.reject(new Error("A configure is already in flight"));
		}
		const token = config.token?.trim();
		if (!token) {
			return Promise.reject(new Error("configure requires a non-empty token"));
		}
		return new Promise<string>((resolve, reject) => {
			this._pendingConfigure = { resolve, reject };
			this.send({
				type: "configure",
				token,
				...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
				...(config.model ? { model: config.model } : {}),
			});
		});
	}

	/**
	 * Builds the wss:// URL for this transport.
	 *
	 * Throws synchronously if — by some bug — the URL does not start with
	 * `wss://`, acting as a compile-time + runtime regression guard.
	 */
	buildUrl(): string {
		return this._buildUrlFor(this._port);
	}

	private _buildUrlFor(port: number): string {
		const url = `wss://${this._host}:${port}`;
		if (!url.startsWith("wss://")) {
			throw new Error(`BUG: transport URL must use wss:// — got: ${url}`);
		}
		return url;
	}

	/**
	 * Establish the WebSocket and perform the hello/hello_ack handshake.
	 *
	 * Single-port mode (an explicit `port` was given): connect to just that port.
	 * Discovery mode (no `port`): scan the wss range concurrently and adopt the
	 * best live bridge via {@link pickBridge}.
	 */
	connect(): Promise<void> {
		if (this._state !== "idle") {
			return Promise.reject(new Error(`Cannot connect in state '${this._state}'`));
		}
		this._state = "connecting";
		return this._discoveryPorts ? this._connectDiscovery(this._discoveryPorts) : this._connectSingle(this._port);
	}

	/** Connect to a single known port (explicit-port mode). */
	private _connectSingle(port: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const ws = this._wsFactory(this._buildUrlFor(port));
			this._ws = ws;

			ws.onopen = () => {
				ws.send(JSON.stringify(this._helloFrame()));
			};

			ws.onmessage = (event: MessageEvent) => {
				let parsed: unknown;
				try {
					parsed = JSON.parse(event.data as string);
				} catch {
					return;
				}

				if (this._state === "connecting") {
					if (isHelloAck(parsed)) {
						this._canConfigure = parsed.canConfigureProvider === true;
						this._state = "open";
						resolve();
					}
					// Ignore any non-hello_ack frames during handshake.
					return;
				}

				this._handleInbound(parsed);
			};

			ws.onerror = () => {
				if (this._state === "connecting") {
					this._state = "closed";
					reject(new Error("WebSocket connection error during handshake"));
				}
			};

			ws.onclose = () => {
				if (this._state === "connecting") {
					this._state = "closed";
					reject(new Error("WebSocket closed before hello_ack"));
				} else if (this._state === "open") {
					this._onRemoteClose();
				}
			};
		});
	}

	/**
	 * Scan every candidate port concurrently: open each, handshake, and record a
	 * {@link BridgeInfo} for each that answers with hello_ack. Once every socket
	 * has settled (or the discovery timeout fires), {@link pickBridge} selects the
	 * best; that socket is adopted and the rest are closed. Rejects if none answer.
	 */
	private _connectDiscovery(ports: number[]): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const sockets = new Map<number, WebSocket>();
			const infos: BridgeInfo[] = [];
			const canConfigByPort = new Map<number, boolean>();
			let settled = 0;
			let finished = false;
			let seq = 0;

			const timer = setTimeout(() => finalize(), this._discoveryTimeoutMs);
			// Let dispose() abort a scan in flight: stop the timer and block any
			// queued finalize so no late resolve/reject touches a disposed transport.
			this._abortDiscovery = () => {
				finished = true;
				clearTimeout(timer);
			};

			const finalize = (): void => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				this._abortDiscovery = null;

				const winner = pickBridge(infos);
				if (!winner) {
					for (const s of sockets.values()) this._closeSocket(s);
					this._pending.clear();
					this._state = "closed";
					reject(new Error(`No xcsh bridge answered on wss ports ${ports[0]}–${ports[ports.length - 1]}`));
					return;
				}

				// Adopt the winner; close every other candidate socket.
				const winSock = sockets.get(winner.port);
				for (const [p, s] of sockets) {
					if (p !== winner.port) this._closeSocket(s);
				}
				this._pending.clear();
				if (!winSock) {
					this._state = "closed";
					reject(new Error("BUG: chosen bridge socket missing"));
					return;
				}
				this._ws = winSock;
				this._port = winner.port;
				this._canConfigure = canConfigByPort.get(winner.port) === true;
				this._state = "open";
				this._bindOpenSocket(winSock);
				resolve();
			};

			for (const port of ports) {
				const ws = this._wsFactory(this._buildUrlFor(port));
				sockets.set(port, ws);
				this._pending.add(ws);
				let done = false;

				const settleOnce = (info?: BridgeInfo): void => {
					if (done) return;
					done = true;
					if (info) infos.push(info);
					settled += 1;
					if (settled === ports.length) finalize();
				};

				ws.onopen = () => {
					ws.send(JSON.stringify(this._helloFrame()));
				};
				ws.onmessage = (event: MessageEvent) => {
					if (done) return;
					let parsed: unknown;
					try {
						parsed = JSON.parse(event.data as string);
					} catch {
						return;
					}
					if (isHelloAck(parsed)) {
						canConfigByPort.set(port, parsed.canConfigureProvider === true);
						settleOnce(this._infoFromAck(port, parsed, seq++));
					}
					// Non-ack frames during the scan are ignored (server sends none pre-ack).
				};
				ws.onerror = () => settleOnce();
				ws.onclose = () => settleOnce();
			}
		});
	}

	/** Extract a BridgeInfo from a hello_ack frame; unknown fields default safely. */
	private _infoFromAck(port: number, ack: unknown, seq: number): BridgeInfo {
		const a = ack as Record<string, unknown>;
		return {
			port,
			tenant: typeof a.tenant === "string" ? a.tenant : null,
			env: typeof a.env === "string" ? a.env : null,
			sessionId: typeof a.sessionId === "string" ? a.sessionId : null,
			contextBound: a.contextBound === true,
			lastSeen: seq, // arrival order; pickBridge prefers the latest among ties
		};
	}

	/** Rebind an already-handshaked socket to normal open-state message routing. */
	private _bindOpenSocket(ws: WebSocket): void {
		ws.onmessage = (event: MessageEvent) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(event.data as string);
			} catch {
				return;
			}
			this._handleInbound(parsed);
		};
		ws.onerror = null;
		ws.onclose = () => {
			if (this._state === "open") this._onRemoteClose();
		};
	}

	/**
	 * Handle an unexpected remote close of the active socket (state was 'open').
	 * If a turn is in flight, emit a synthetic terminal chat_error against that
	 * turn id so the panel surfaces an error + Retry instead of hanging forever.
	 * dispose() detaches handlers, so this never fires on intentional teardown.
	 */
	private _onRemoteClose(): void {
		if (this._state !== "open") return;
		const turnId = this._activeTurnId;
		this._activeTurnId = null;
		this._state = "closed";
		// Fail any in-flight configure so its awaiter doesn't hang on a dropped bridge.
		if (this._pendingConfigure) {
			this._pendingConfigure.reject(new Error("The connection to the local xcsh bridge was lost."));
			this._pendingConfigure = null;
		}
		if (turnId !== null) {
			this._emit({
				type: "chat_error",
				id: turnId,
				error: "The connection to the local xcsh bridge was lost.",
				reason: "bridge-disconnected",
			});
		}
	}

	/** Detach handlers and close a socket (idempotent, error-tolerant). */
	private _closeSocket(ws: WebSocket): void {
		ws.onopen = null;
		ws.onmessage = null;
		ws.onerror = null;
		ws.onclose = null;
		try {
			ws.close();
		} catch {
			// best-effort
		}
	}

	/** Send an outbound message. Throws if the transport is not open. */
	send(msg: ChatOutbound): void {
		if (this._state !== "open" || !this._ws) {
			throw new Error(`Cannot send in state '${this._state}'`);
		}
		// Track the in-flight turn so an unexpected bridge drop can be surfaced as a
		// terminal error against the right turn (see _onRemoteClose).
		if (msg.type === "chat_request") {
			this._activeTurnId = msg.id;
		}
		this._ws.send(JSON.stringify(msg));
	}

	/** Register a subscriber; returns an unsubscribe function. */
	onMessage(cb: (m: ChatInbound) => void): () => void {
		this._subscribers.add(cb);
		return () => {
			this._subscribers.delete(cb);
		};
	}

	/**
	 * Send a chat_stop frame for the given turn id.
	 *
	 * Intentionally does NOT clear `_activeTurnId`: the turn stays in flight until
	 * the worker sends its terminal frame, so a bridge drop between stop and that
	 * terminal still surfaces a bridge-disconnected error (rather than hanging).
	 */
	stop(id: string): void {
		this.send({ type: "chat_stop", id });
	}

	/** Close the WebSocket, clear all subscribers, mark state 'closed'. */
	dispose(): void {
		this._state = "closed";
		this._subscribers.clear();
		if (this._pendingConfigure) {
			this._pendingConfigure.reject(new Error("Transport disposed before configure completed."));
			this._pendingConfigure = null;
		}
		// Abort a discovery scan in flight, then tear down its sockets. Leaving the
		// connect() promise pending (never settled) is intentional — the caller
		// disposed; a late reject would be unobservable and could touch state.
		this._abortDiscovery?.();
		this._abortDiscovery = null;
		for (const ws of this._pending) this._closeSocket(ws);
		this._pending.clear();
		if (this._ws) {
			this._closeSocket(this._ws);
			this._ws = null;
		}
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private _handleInbound(msg: unknown): void {
		// Provider-configure replies settle the pending configure() promise; they are
		// control frames, not chat frames, so they are not emitted to subscribers.
		if (isConfigureAck(msg)) {
			this._pendingConfigure?.resolve(msg.model);
			this._pendingConfigure = null;
			return;
		}
		if (isConfigureError(msg)) {
			this._pendingConfigure?.reject(new Error(msg.error));
			this._pendingConfigure = null;
			return;
		}
		if (
			isChatDelta(msg) ||
			isChatDone(msg) ||
			isChatError(msg) ||
			isChatKeepalive(msg) ||
			isChatToolNotice(msg) ||
			// Host-tool channel: the agent asks the client to run / abort a registered
			// host tool. Surface these to onMessage subscribers (the dispatcher)
			// exactly like chat_delta etc. — never drop them.
			isHostToolCall(msg) ||
			isHostToolCancel(msg)
		) {
			// A terminal frame for the in-flight turn ends it — so a later remote
			// close won't emit a stale bridge-disconnected error against a done turn.
			if ((isChatDone(msg) || isChatError(msg)) && msg.id === this._activeTurnId) {
				this._activeTurnId = null;
			}
			this._emit(msg);
		}
		// Unknown message types are silently dropped.
	}

	private _emit(msg: ChatInbound): void {
		for (const cb of this._subscribers) {
			cb(msg);
		}
	}
}
