export interface MCPRuntimeLifecycle<Runtime> {
	start(): Promise<Runtime>;
	activate(runtime: Runtime): Promise<void>;
	deactivate(runtime: Runtime): Promise<void>;
	stop(runtime: Runtime): Promise<void>;
}

/** Serializes ownership of a session's MCP runtime and coalesces duplicate requests. */
export class MCPRuntimeController<Runtime> {
	#current?: Runtime;
	#desired = false;
	#disposed = false;
	#transition?: Promise<void>;
	#nextStart?: () => Promise<Runtime>;

	constructor(private readonly lifecycle: MCPRuntimeLifecycle<Runtime>) {}

	get current(): Runtime | undefined {
		return this.#current;
	}

	get enabled(): boolean {
		return this.#current !== undefined;
	}

	setEnabled(enabled: boolean): Promise<void> {
		if (this.#disposed) return Promise.reject(new Error("MCP runtime controller is disposed"));
		this.#desired = enabled;
		if (!this.#transition) {
			this.#transition = this.#runTransitions().finally(() => {
				this.#transition = undefined;
			});
		}
		return this.#transition;
	}

	async #runTransitions(): Promise<void> {
		while (!this.#disposed && this.enabled !== this.#desired) {
			if (this.#desired) {
				const start = this.#nextStart ?? this.lifecycle.start;
				this.#nextStart = undefined;
				const runtime = await start();
				try {
					await this.lifecycle.activate(runtime);
					this.#current = runtime;
				} catch (error) {
					try {
						await this.lifecycle.deactivate(runtime);
					} finally {
						await this.lifecycle.stop(runtime);
					}
					throw error;
				}
				continue;
			}

			const runtime = this.#current;
			if (!runtime) continue;
			this.#current = undefined;
			try {
				await this.lifecycle.deactivate(runtime);
			} finally {
				await this.lifecycle.stop(runtime);
			}
		}
	}

	async replace(start: () => Promise<Runtime> = this.lifecycle.start): Promise<void> {
		await this.setEnabled(false);
		this.#nextStart = start;
		await this.setEnabled(true);
	}

	dispose(): Promise<void> {
		if (this.#disposed) return this.#transition ?? Promise.resolve();
		this.#desired = false;
		const pending = this.#transition ?? Promise.resolve();
		this.#transition = pending
			.then(async () => {
				const runtime = this.#current;
				if (!runtime) return;
				this.#current = undefined;
				try {
					await this.lifecycle.deactivate(runtime);
				} finally {
					await this.lifecycle.stop(runtime);
				}
			})
			.finally(() => {
				this.#disposed = true;
				this.#transition = undefined;
			});
		return this.#transition;
	}
}
