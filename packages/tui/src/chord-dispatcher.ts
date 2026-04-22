import type { ChordBinding } from "./chord-parser";
import type { KeyId } from "./keys";

export type ChordResult =
	| { kind: "dispatched"; action: string }
	| { kind: "pending"; leader: KeyId }
	| { kind: "passthrough" }
	| { kind: "abandoned" };

export interface ChordDispatcherCallbacks {
	onPending?: (leader: KeyId) => void;
	onCleared?: () => void;
}

interface PendingState {
	leader: KeyId;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Two-key chord state machine. Stateless across keystrokes except for one
 * optional "pending leader" slot + its timeout timer. Consumers feed KeyIds
 * via feedKey() and act on the returned ChordResult.
 */
export class ChordDispatcher {
	readonly #bindings: ChordBinding[];
	readonly #timeoutMs: number;
	readonly #callbacks: ChordDispatcherCallbacks;
	#pending: PendingState | null = null;

	constructor(bindings: ChordBinding[], timeoutMs: number, callbacks: ChordDispatcherCallbacks = {}) {
		this.#bindings = bindings;
		this.#timeoutMs = timeoutMs;
		this.#callbacks = callbacks;
	}

	feedKey(key: KeyId): ChordResult {
		// Phase 1: pending chord is active — interpret this key as the 2nd stroke.
		if (this.#pending) {
			const match = this.#bindings.find(
				b => b.sequence.length === 2 && b.sequence[0] === this.#pending!.leader && b.sequence[1] === key,
			);
			this.#clearPending();
			if (match) return { kind: "dispatched", action: match.action };
			return { kind: "abandoned" };
		}

		// Phase 2: no pending chord.
		// Single-stroke match wins first.
		for (const b of this.#bindings) {
			if (b.sequence.length === 1 && b.sequence[0] === key) {
				return { kind: "dispatched", action: b.action };
			}
		}
		// Chord leader?
		const isLeader = this.#bindings.some(b => b.sequence.length === 2 && b.sequence[0] === key);
		if (isLeader) {
			this.#setPending(key);
			return { kind: "pending", leader: key };
		}
		return { kind: "passthrough" };
	}

	#setPending(leader: KeyId): void {
		const timer = setTimeout(() => this.#timeoutClear(), this.#timeoutMs);
		this.#pending = { leader, timer };
		this.#callbacks.onPending?.(leader);
	}

	#clearPending(): void {
		if (!this.#pending) return;
		clearTimeout(this.#pending.timer);
		this.#pending = null;
		this.#callbacks.onCleared?.();
	}

	#timeoutClear(): void {
		// Timer fired; timer handle consumed by runtime.
		if (!this.#pending) return;
		this.#pending = null;
		this.#callbacks.onCleared?.();
	}

	dispose(): void {
		if (this.#pending) {
			clearTimeout(this.#pending.timer);
			this.#pending = null;
		}
	}
}
