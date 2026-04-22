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
		// Phase: single-stroke match only (pending/chord logic arrives in Task 5).
		// #timeoutMs and #callbacks are used in Task 5.
		for (const b of this.#bindings) {
			if (b.sequence.length === 1 && b.sequence[0] === key) {
				return { kind: "dispatched", action: b.action };
			}
		}
		return { kind: "passthrough" };
	}

	dispose(): void {
		if (this.#pending) {
			clearTimeout(this.#pending.timer);
			this.#pending = null;
		}
	}
}
