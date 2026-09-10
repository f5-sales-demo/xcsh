export type SessionTransitionPhase = "before" | "after";
export type SessionTransitionListener = (phase: SessionTransitionPhase) => void | Promise<void>;

/** Await session-bound consumers before changing storage, and restore them on success or failure. */
export class SessionTransitions {
	#listeners = new Set<SessionTransitionListener>();
	#changing = false;
	subscribe(listener: SessionTransitionListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	async run<T>(change: () => Promise<T>): Promise<T> {
		if (this.#changing) throw new Error("A session transition is already in progress");
		this.#changing = true;
		const listeners = [...this.#listeners];
		let result: T | undefined;
		let failure: { error: unknown } | undefined;
		try {
			for (const listener of listeners) await listener("before");
			result = await change();
		} catch (error) {
			failure = { error };
		}
		for (const listener of listeners) {
			try {
				await listener("after");
			} catch (error) {
				failure ??= { error };
			}
		}
		this.#changing = false;
		if (failure) throw failure.error;
		return result as T;
	}
}
