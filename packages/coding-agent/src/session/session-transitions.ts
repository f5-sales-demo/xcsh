export type SessionTransitionScope = symbol;
export type SessionTransitionPhase = "before" | "after";
export type SessionTransitionListener = (phase: SessionTransitionPhase) => void | Promise<void>;

/** Await session-bound consumers before changing storage, and restore them on success or failure. */
export class SessionTransitions {
	#listeners = new Set<SessionTransitionListener>();
	#scope?: SessionTransitionScope;
	subscribe(listener: SessionTransitionListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	get changing(): boolean {
		return this.#scope !== undefined;
	}

	assertAvailable(scope?: SessionTransitionScope): void {
		if (scope !== undefined) {
			if (scope !== this.#scope) throw new Error("Session transition scope is no longer active");
		} else if (this.changing) throw new Error("A session transition is already in progress");
	}

	async run<T>(change: (scope: SessionTransitionScope) => Promise<T>, scope?: SessionTransitionScope): Promise<T> {
		this.assertAvailable(scope);
		if (scope !== undefined) return change(scope);
		const owner = Symbol("session transition");
		this.#scope = owner;
		const listeners = [...this.#listeners];
		let result: T | undefined;
		let failure: { error: unknown } | undefined;
		try {
			for (const listener of listeners) await listener("before");
			result = await change(owner);
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
		this.#scope = undefined;
		if (failure) throw failure.error;
		return result as T;
	}
}
