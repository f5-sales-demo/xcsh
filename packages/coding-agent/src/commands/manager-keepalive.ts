/**
 * Worker→manager keepalive client.
 *
 * The manager idle-reaps a worker whose `lastSeen` is older than `IDLE_MS`, and
 * `lastSeen` is refreshed ONLY when the manager receives a control frame. Chat
 * traffic flows worker↔bridge↔extension and never reaches the manager, so an
 * actively-used-then-briefly-idle session used to be reaped mid-conversation
 * (the "Turn aborted." after a break). This client emits a `status{sessionId}`
 * keepalive over the manager's UNIX control socket while a turn is in flight and
 * at each turn start, so the manager's sweep leaves an in-use session alive.
 *
 * The socket lifecycle (connect/reconnect) is injected as a `Connector` so the
 * scheduling/emit logic is unit-testable without a real socket; the worker wires
 * a `Bun.connect` transport. Best-effort throughout: if the manager socket is
 * down (e.g. mid-supersede) emits are dropped and the next emit reconnects — so
 * after a manager handoff the keepalive re-targets the successor manager, which
 * has already re-adopted this worker.
 */
import { keepaliveFrame } from "./manager-core";

/** A live connection to the manager control socket. */
export interface KeepaliveTransport {
	write(data: string): void;
	close(): void;
}

/** Opens a transport; `onClose` MUST be invoked when the connection drops so the
 * keepalive knows to reconnect on its next emit. Returns null if it cannot open. */
export type Connector = (onClose: () => void) => Promise<KeepaliveTransport | null>;

export interface ManagerKeepaliveDeps {
	connect: Connector;
	/** Current worker session id (may transition from "spare" to a real id). */
	sessionId: () => string;
	/** True while a chat turn is in flight. */
	busy: () => boolean;
}

export class ManagerKeepalive {
	#deps: ManagerKeepaliveDeps;
	#transport: KeepaliveTransport | null = null;
	#connecting = false;
	#pending = false; // a keepalive is due once a connection is (re)established
	#stopped = false;

	constructor(deps: ManagerKeepaliveDeps) {
		this.#deps = deps;
	}

	/** Periodic tick (driven by the worker's interval): emit iff a turn is busy. */
	tick(): void {
		if (this.#deps.busy()) this.#emit();
	}

	/** One-shot emit at the start of each turn — refreshes lastSeen immediately so
	 * a session with long think-time between turns is never reaped between them. */
	turnStart(): void {
		this.#emit();
	}

	/** Stop emitting and close any open transport. */
	stop(): void {
		this.#stopped = true;
		this.#pending = false;
		this.#transport?.close();
		this.#transport = null;
	}

	#emit(): void {
		if (this.#stopped) return;
		const frame = keepaliveFrame(this.#deps.sessionId());
		if (!frame) return; // spare / unbound → nothing to keep alive (also skips connecting)
		if (this.#transport) {
			try {
				this.#transport.write(frame);
			} catch {
				this.#transport = null; // dead socket → drop and reconnect on next emit
				this.#pending = true;
				void this.#ensureConnected();
			}
			return;
		}
		this.#pending = true;
		void this.#ensureConnected();
	}

	async #ensureConnected(): Promise<void> {
		if (this.#stopped || this.#transport || this.#connecting) return;
		this.#connecting = true;
		let t: KeepaliveTransport | null = null;
		try {
			t = await this.#deps.connect(() => {
				this.#transport = null; // socket dropped → next emit reconnects
			});
		} catch {
			t = null;
		}
		this.#connecting = false;
		if (!t) return; // manager unreachable — best-effort, a later emit retries
		if (this.#stopped) {
			t.close();
			return;
		}
		this.#transport = t;
		if (this.#pending) {
			this.#pending = false;
			const frame = keepaliveFrame(this.#deps.sessionId());
			if (frame) {
				try {
					this.#transport.write(frame);
				} catch {
					this.#transport = null;
				}
			}
		}
	}
}
