export const RELAY_QUEUE_CAPACITY = 128;
export const RELAY_IDLE_MS = 10 * 60_000;
export const RELAY_SWEEP_MS = 30_000;
export const RELAY_PING_MS = 10_000;
export const RELAY_PONG_TIMEOUT_MS = 60_000;

export type RelayCloseReason = "replaced" | "client_closed" | "expired" | "outbound_terminated" | "shutdown";
interface ClientState {
	generation: number;
	lastSeen: number;
	pending: number;
}
type AcceptedRelayClient = { kind: "accepted"; key: string; generation: number; replaced: boolean };
type RelayAdmission = AcceptedRelayClient | { kind: "dropped" };

export class RelayClientTracker {
	#clients = new Map<string, ClientState>();
	#nextGeneration = 0;
	readonly capacity: number;
	readonly idleMs: number;
	readonly now: () => number;
	readonly onClose: (key: string, reason: RelayCloseReason) => void;
	constructor(
		options: {
			capacity?: number;
			idleMs?: number;
			now?: () => number;
			onClose?: (key: string, reason: RelayCloseReason) => void;
		} = {},
	) {
		this.capacity = options.capacity ?? RELAY_QUEUE_CAPACITY;
		this.idleMs = options.idleMs ?? RELAY_IDLE_MS;
		this.now = options.now ?? Date.now;
		this.onClose = options.onClose ?? (() => {});
	}
	static key(clientId: string, streamId: string): string {
		return JSON.stringify([clientId, streamId]);
	}
	get size(): number {
		return this.#clients.size;
	}
	admit(clientId: string, streamId: string, method: "initialize", requestId?: string | number): AcceptedRelayClient;
	admit(clientId: string, streamId: string, method: string | undefined, requestId?: string | number): RelayAdmission;
	admit(clientId: string, streamId: string, method: string | undefined, _requestId?: string | number): RelayAdmission {
		const key = RelayClientTracker.key(clientId, streamId);
		const current = this.#clients.get(key);
		if (method !== "initialize" && !current) return { kind: "dropped" };
		if (method === "initialize") {
			if (current) this.close(key, "replaced");
			const state = { generation: ++this.#nextGeneration, lastSeen: this.now(), pending: 0 };
			this.#clients.set(key, state);
			return { kind: "accepted", key, generation: state.generation, replaced: current !== undefined };
		}
		current!.lastSeen = this.now();
		return { kind: "accepted", key, generation: current!.generation, replaced: false };
	}
	begin(key: string, generation: number): boolean {
		const state = this.#clients.get(key);
		if (!state || state.generation !== generation || state.pending >= this.capacity) return false;
		state.pending++;
		state.lastSeen = this.now();
		return true;
	}
	complete(key: string, generation: number): void {
		const state = this.#clients.get(key);
		if (!state || state.generation !== generation) return;
		state.pending = Math.max(0, state.pending - 1);
		state.lastSeen = this.now();
	}
	pending(key: string): number {
		return this.#clients.get(key)?.pending ?? 0;
	}
	isCurrent(key: string, generation: number): boolean {
		return this.#clients.get(key)?.generation === generation;
	}
	touch(key: string, generation?: number): void {
		const state = this.#clients.get(key);
		if (state && (generation === undefined || state.generation === generation)) state.lastSeen = this.now();
	}
	close(key: string, reason: RelayCloseReason): void {
		if (!this.#clients.delete(key)) return;
		this.onClose(key, reason);
	}
	closeAll(reason: RelayCloseReason = "shutdown"): void {
		for (const key of [...this.#clients.keys()]) this.close(key, reason);
	}
	sweep(): void {
		const current = this.now();
		for (const [key, state] of this.#clients) if (current - state.lastSeen > this.idleMs) this.close(key, "expired");
	}
	overload(id: string | number | null): { id: string | number | null; error: { code: -32001; message: string } } {
		return { id, error: { code: -32001, message: "Server overloaded; retry later." } };
	}
}

export class RelayHeartbeat {
	#lastPong = 0;
	#lastPing = 0;
	constructor(
		private readonly now: () => number = Date.now,
		readonly pingMs = RELAY_PING_MS,
		readonly timeoutMs = RELAY_PONG_TIMEOUT_MS,
	) {}
	opened(): void {
		this.#lastPong = this.now();
		this.#lastPing = this.#lastPong;
	}
	sentPing(): void {
		this.#lastPing = this.now();
	}
	pong(): void {
		this.#lastPong = this.now();
	}
	poll(): "ping" | "timeout" | null {
		const current = this.now();
		if (current - this.#lastPong > this.timeoutMs) return "timeout";
		if (current - this.#lastPing >= this.pingMs) return "ping";
		return null;
	}
}

export class ReconnectBackoff {
	#attempt = 0;
	constructor(
		private readonly random: () => number = Math.random,
		readonly baseMs = 500,
		readonly capMs = 30_000,
	) {}
	nextDelay(): number {
		const ceiling = Math.min(this.capMs, this.baseMs * 2 ** Math.min(this.#attempt++, 30));
		return Math.floor(Math.max(0, Math.min(0.999999999, this.random())) * ceiling);
	}
	reset(): void {
		this.#attempt = 0;
	}
}
