export type SessionTransitionScope = symbol;
export type SessionTransitionPhase = "before" | "after";
export type SessionTransitionListener = (phase: SessionTransitionPhase) => void | Promise<void>;

/** Await session-bound consumers before changing storage, and restore them on success or failure. */
export class SessionTransitions {
	#listeners = new Set<SessionTransitionListener>();
	#scope?: SessionTransitionScope;
	#revision = 0;
	#closed = false;
	#idle?: Promise<void>;
	subscribe(listener: SessionTransitionListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	get changing(): boolean {
		return this.#scope !== undefined;
	}

	get closed(): boolean {
		return this.#closed;
	}

	beginClose(): void {
		this.#closed = true;
	}

	waitForIdle(): Promise<void> {
		return this.#idle ?? Promise.resolve();
	}

	/** Observe the current lifecycle, including configuration owned by an active transition. */
	observe(): () => boolean {
		const revision = this.#revision;
		return () => !this.#closed && revision === this.#revision;
	}

	/** Bind asynchronous preparation to the lifecycle state in which it began. */
	checkpoint(scope?: SessionTransitionScope): () => void {
		this.assertAvailable(scope);
		const revision = this.#revision;
		return () => {
			this.assertAvailable(scope);
			if (revision !== this.#revision) throw new Error("Session transition superseded this operation");
		};
	}

	assertAvailable(scope?: SessionTransitionScope): void {
		if (this.#closed) throw new Error("Session is closing or closed");
		if (scope !== undefined) {
			if (scope !== this.#scope) throw new Error("Session transition scope is no longer active");
		} else if (this.changing) throw new Error("A session transition is already in progress");
	}

	async run<T>(change: (scope: SessionTransitionScope) => Promise<T>, scope?: SessionTransitionScope): Promise<T> {
		this.assertAvailable(scope);
		if (scope !== undefined) return change(scope);
		const owner = Symbol("session transition");
		this.#scope = owner;
		this.#revision++;
		const idle = Promise.withResolvers<void>();
		this.#idle = idle.promise;
		const listeners = [...this.#listeners];
		let result: T | undefined;
		let failure: { error: unknown } | undefined;
		try {
			for (const listener of listeners) await listener("before");
			this.assertAvailable(owner);
			result = await change(owner);
			this.assertAvailable(owner);
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
		try {
			this.assertAvailable(owner);
		} catch (error) {
			failure ??= { error };
		}
		this.#scope = undefined;
		this.#idle = undefined;
		idle.resolve();
		if (failure) throw failure.error;
		return result as T;
	}
}
