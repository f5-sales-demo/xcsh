/**
 * Scriptable Transport test double.
 *
 * Allows tests to:
 * - Inspect outbound messages via `sent`.
 * - Push inbound messages to all subscribers via `emit(msg)`.
 * - Verify unsubscribe and dispose behaviour.
 */
import type { ChatInbound, ChatOutbound, Transport } from "./index";

export class MockTransport implements Transport {
	/** All messages passed to `send()`, in call order. */
	readonly sent: ChatOutbound[] = [];

	private _state: "idle" | "connecting" | "open" | "closed" = "idle";
	private _subscribers: Set<(m: ChatInbound) => void> = new Set();

	get state(): "idle" | "connecting" | "open" | "closed" {
		return this._state;
	}

	async connect(): Promise<void> {
		this._state = "open";
	}

	send(msg: ChatOutbound): void {
		this.sent.push(msg);
	}

	onMessage(cb: (m: ChatInbound) => void): () => void {
		this._subscribers.add(cb);
		return () => {
			this._subscribers.delete(cb);
		};
	}

	stop(id: string): void {
		this.send({ type: "chat_stop", id });
	}

	dispose(): void {
		this._subscribers.clear();
		this._state = "closed";
	}

	/**
	 * Push an inbound message to all current subscribers.
	 * Used by tests to simulate worker → panel messages.
	 */
	emit(msg: ChatInbound): void {
		if (this._state === "closed") return;
		for (const cb of this._subscribers) {
			cb(msg);
		}
	}
}
