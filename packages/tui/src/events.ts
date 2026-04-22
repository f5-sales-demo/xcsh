/**
 * Typed publish-subscribe emitter.
 *
 * - Keys of `T` are event names; values are payload shapes.
 * - `on()` returns an unsubscribe closure — the ONLY unsubscribe path.
 *   No public `off()` method; this avoids divergence between two
 *   unsubscribe mechanisms and keeps bookkeeping on the emitter.
 * - `emit()` with zero subscribers is a documented no-op (it does not
 *   throw and invokes no callback).
 */
export class TypedEventEmitter<T extends Record<string, unknown>> {
	readonly #handlers = new Map<keyof T, Set<(payload: unknown) => void>>();

	on<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void {
		let set = this.#handlers.get(event);
		if (!set) {
			set = new Set();
			this.#handlers.set(event, set);
		}
		const wrapped = (p: unknown) => handler(p as T[K]);
		set.add(wrapped);
		return () => {
			set?.delete(wrapped);
		};
	}

	emit<K extends keyof T>(event: K, payload: T[K]): void {
		const set = this.#handlers.get(event);
		if (!set) return;
		for (const handler of set) handler(payload);
	}
}
