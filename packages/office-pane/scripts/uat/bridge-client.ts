import type { ChatInbound, ChatOutbound, ConfigurableTransport, ProviderConfigure } from "../../src/core";

/** Dedicated plain-WebSocket range used by `xcsh office serve`. */
export const OFFICE_WS_RANGE_START = 19242;
export const OFFICE_WS_RANGE_END = 19261;

/** The pane origin accepted by the loopback bridge's browser-origin gate. */
const PANE_ORIGIN = "https://127-0-0-1.local-ip.sh:8444";
const DEFAULT_PROBE_TIMEOUT_MS = 700;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONFIGURE_TIMEOUT_MS = 10_000;
const DEFAULT_TURN_TIMEOUT_MS = 300_000;

export interface UatFrame {
	type?: string;
	[key: string]: unknown;
}

export interface OfficeHelloAck extends UatFrame {
	type: "hello_ack";
	serveKind?: string;
	canConfigureProvider?: boolean;
	contractVersion?: string;
}

export interface UatToolNotice {
	tool: string;
	ok: boolean;
	detail?: string;
}

export interface UatHostToolCall {
	id?: string;
	toolCallId?: string;
	toolName: string;
	arguments: Record<string, unknown>;
}

export interface UatTurnResult {
	id: string;
	reply: string;
	ended: "chat_done" | "chat_error";
	reason?: string;
	durationMs: number;
	toolNotices: UatToolNotice[];
	hostToolCalls: UatHostToolCall[];
}

/** The exact Office handshake required by the native bridge contract. */
export function officeHelloFrame(): { type: "hello"; version: "1"; host: "excel" } {
	return { type: "hello", version: "1", host: "excel" };
}

interface ProbedBridge {
	port: number;
	ws: WebSocket;
	ack: OfficeHelloAck;
}

/** Open a port and complete the hello handshake, or return null when it is not an Office bridge. */
function probeOfficeBridge(port: number, timeoutMs: number): Promise<ProbedBridge | null> {
	return new Promise(resolve => {
		let ws: WebSocket;
		try {
			ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Origin: PANE_ORIGIN } } as never);
		} catch {
			resolve(null);
			return;
		}

		let settled = false;
		const settle = (value: ProbedBridge | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			ws.removeEventListener("message", onMessage);
			ws.removeEventListener("error", onFailure);
			ws.removeEventListener("close", onFailure);
			if (!value) {
				try {
					ws.close();
				} catch {
					// The failed probe may already be closed.
				}
			}
			resolve(value);
		};
		const onFailure = (): void => settle(null);
		const onMessage = (event: MessageEvent): void => {
			let frame: UatFrame;
			try {
				frame = JSON.parse(String(event.data)) as UatFrame;
			} catch {
				return;
			}
			if (frame.type !== "hello_ack") return;
			const ack = frame as OfficeHelloAck;
			settle(ack.serveKind === "office" ? { port, ws, ack } : null);
		};
		const timer = setTimeout(onFailure, timeoutMs);
		ws.addEventListener("open", () => ws.send(JSON.stringify(officeHelloFrame())), { once: true });
		ws.addEventListener("message", onMessage);
		ws.addEventListener("error", onFailure);
		ws.addEventListener("close", onFailure);
	});
}

export interface DiscoverOfficeBridgeOptions {
	probeTimeoutMs?: number;
	/** Number of complete range scans before giving up. */
	attempts?: number;
	/** Delay between scans, used while a freshly spawned binary starts. */
	retryDelayMs?: number;
}

export interface WaitForOfficeApplicationReadyOptions {
	timeoutMs?: number;
	attemptTimeoutMs?: number;
	retryDelayMs?: number;
}

/**
 * Stateful UAT client for the real Office bridge. It also implements the pane's
 * transport interface so the production host-tool dispatcher can run unchanged.
 */
export class UatBridgeClient implements ConfigurableTransport {
	readonly port: number;
	readonly ack: OfficeHelloAck;
	readonly canConfigureProvider: boolean;
	readonly state = "open" as const;
	private readonly listeners = new Set<(message: ChatInbound) => void>();
	private disposed = false;

	constructor(
		private readonly ws: WebSocket,
		bridge: { port: number; ack: OfficeHelloAck },
	) {
		this.port = bridge.port;
		this.ack = bridge.ack;
		this.canConfigureProvider = bridge.ack.canConfigureProvider === true;
		this.ws.addEventListener("message", event => {
			let frame: UatFrame;
			try {
				frame = JSON.parse(String(event.data)) as UatFrame;
			} catch {
				return;
			}
			for (const listener of this.listeners) listener(frame as ChatInbound);
		});
	}

	connect(): Promise<void> {
		return Promise.resolve();
	}

	send(message: ChatOutbound): void {
		if (this.disposed || this.ws.readyState !== WebSocket.OPEN) throw new Error("Office UAT bridge is closed");
		this.ws.send(JSON.stringify(message));
	}

	onMessage(listener: (message: ChatInbound) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	stop(id: string): void {
		this.send({ type: "chat_stop", id });
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.listeners.clear();
		this.ws.close();
	}

	waitForFrame(
		accept: (frame: UatFrame) => boolean,
		timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<UatFrame> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Timed out after ${timeoutMs}ms waiting for an Office bridge frame`));
			}, timeoutMs);
			const unsubscribe = this.onMessage(message => {
				const frame = message as UatFrame;
				if (!accept(frame)) return;
				clearTimeout(timer);
				unsubscribe();
				resolve(frame);
			});
		});
	}

	async request(
		message: ChatOutbound,
		accept: string | ((frame: UatFrame) => boolean),
		timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<UatFrame> {
		const predicate = typeof accept === "string" ? (frame: UatFrame) => frame.type === accept : accept;
		const pending = this.waitForFrame(predicate, timeoutMs);
		this.send(message);
		return pending;
	}

	async configure(config: ProviderConfigure): Promise<string> {
		const frame = await this.request(
			{ type: "configure", ...config },
			message => message.type === "configure_ack" || message.type === "configure_error",
			DEFAULT_CONFIGURE_TIMEOUT_MS,
		);
		if (frame.type !== "configure_ack" || typeof frame.model !== "string") {
			throw new Error("xcsh rejected the Office provider configuration");
		}
		return frame.model;
	}

	turn(text: string, id: string, timeoutMs: number = DEFAULT_TURN_TIMEOUT_MS): Promise<UatTurnResult> {
		return new Promise((resolve, reject) => {
			const startedAt = Date.now();
			let reply = "";
			const toolNotices: UatToolNotice[] = [];
			const hostToolCalls: UatHostToolCall[] = [];
			const timer = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Turn ${id} did not finish within ${timeoutMs}ms`));
			}, timeoutMs);
			const unsubscribe = this.onMessage(message => {
				const frame = message as UatFrame;
				if (frame.type === "chat_delta" && frame.id === id) reply += String(frame.delta ?? "");
				if (frame.type === "chat_tool_notice" && frame.id === id) {
					toolNotices.push({
						tool: String(frame.tool ?? ""),
						ok: frame.ok === true,
						...(typeof frame.detail === "string" ? { detail: frame.detail } : {}),
					});
				}
				if (frame.type === "host_tool_call") {
					hostToolCalls.push({
						...(typeof frame.id === "string" ? { id: frame.id } : {}),
						...(typeof frame.toolCallId === "string" ? { toolCallId: frame.toolCallId } : {}),
						toolName: String(frame.toolName ?? ""),
						arguments:
							typeof frame.arguments === "object" && frame.arguments !== null
								? (frame.arguments as Record<string, unknown>)
								: {},
					});
				}
				if ((frame.type !== "chat_done" && frame.type !== "chat_error") || frame.id !== id) return;
				clearTimeout(timer);
				unsubscribe();
				resolve({
					id,
					reply,
					ended: frame.type,
					...(typeof frame.reason === "string" ? { reason: frame.reason } : {}),
					durationMs: Date.now() - startedAt,
					toolNotices,
					hostToolCalls,
				});
			});
			this.send({ type: "chat_request", id, text, mode: "educational", context: null });
		});
	}
}

/**
 * The socket binds before the headless Office session finishes loading. Probe a
 * ChatHandler-owned frame so callers do not mistake the transport handshake for
 * application readiness and lose their first configure request during startup.
 */
export async function waitForOfficeApplicationReady(
	client: Pick<UatBridgeClient, "request">,
	options: WaitForOfficeApplicationReadyOptions = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 30_000;
	const attemptTimeoutMs = options.attemptTimeoutMs ?? 1_000;
	const retryDelayMs = options.retryDelayMs ?? 100;
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;

	while (Date.now() < deadline) {
		const remainingMs = Math.max(1, deadline - Date.now());
		try {
			await client.request({ type: "list_skills" }, "skills", Math.min(attemptTimeoutMs, remainingMs));
			return;
		} catch (error) {
			lastError = error;
		}
		const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
		if (delayMs > 0) await Bun.sleep(delayMs);
	}

	const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
	throw new Error(`Office application did not become ready within ${timeoutMs}ms${detail}`);
}

/** Discover a real `xcsh office serve` bridge and adopt its already-open socket. */
export async function discoverOfficeBridge(options: DiscoverOfficeBridgeOptions = {}): Promise<UatBridgeClient> {
	const attempts = options.attempts ?? 1;
	const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		for (let port = OFFICE_WS_RANGE_START; port <= OFFICE_WS_RANGE_END; port++) {
			const bridge = await probeOfficeBridge(port, timeoutMs);
			if (bridge) return new UatBridgeClient(bridge.ws, bridge);
		}
		if (attempt < attempts) await Bun.sleep(options.retryDelayMs ?? 500);
	}
	throw new Error(`No xcsh Office bridge answered on ws://127.0.0.1:${OFFICE_WS_RANGE_START}-${OFFICE_WS_RANGE_END}`);
}
