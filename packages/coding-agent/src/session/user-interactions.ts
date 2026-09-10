import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

const toolCalls = new AsyncLocalStorage<string>();

/** Bind only runtime tool UI calls; terminal administration has no tool identity. */
export function withToolInteraction<T>(toolCallId: string, callback: () => T): T {
	return toolCalls.run(toolCallId, callback);
}

export interface UserInteractionSpec {
	kind: "select" | "input";
	title: string;
	options?: readonly string[];
	toolCallId?: string;
	isSecret?: boolean;
}
export interface UserInteraction extends UserInteractionSpec {
	id: string;
}
export interface UserInteractionEvent {
	type: "opened" | "resolved";
	interaction: UserInteraction;
}
type Pending = {
	interaction: UserInteraction;
	startLocal(): void;
	finish(value: string | undefined, abortLocal: boolean, failure?: { error: unknown }): void;
};
const copy = (interaction: UserInteraction): UserInteraction => ({
	...interaction,
	...(interaction.options ? { options: [...interaction.options] } : {}),
});

/** One completion owner shared by terminal presentation and remote answers. */
export class UserInteractions {
	#pending = new Map<string, Pending>();
	#listeners = new Set<(event: UserInteractionEvent) => void>();
	#closed = false;
	#cancelling = false;
	#localActive?: string;
	pending(): UserInteraction[] {
		return [...this.#pending.values()].map(value => copy(value.interaction));
	}
	subscribe(listener: (event: UserInteractionEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#emit(type: UserInteractionEvent["type"], interaction: UserInteraction): void {
		for (const listener of this.#listeners) {
			try {
				listener({ type, interaction: copy(interaction) });
			} catch {
				/* A consumer cannot block terminal input. */
			}
		}
	}
	request(
		spec: UserInteractionSpec,
		local: (signal: AbortSignal, complete: (value: string | undefined) => void) => Promise<string | undefined>,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		if (this.#closed || this.#cancelling || signal?.aborted) return Promise.resolve(undefined);
		if (this.#pending.size >= 32) return Promise.reject(new Error("Too many pending user interactions"));
		const interaction = copy({ toolCallId: toolCalls.getStore(), ...spec, id: randomUUID() });
		const abort = new AbortController();
		return new Promise((resolve, reject) => {
			const onAbort = () => finish(undefined, true);
			const finish: Pending["finish"] = (value, abortLocal, failure) => {
				if (!this.#pending.delete(interaction.id)) return;
				if (this.#localActive === interaction.id) this.#localActive = undefined;
				signal?.removeEventListener("abort", onAbort);
				if (abortLocal) abort.abort();
				this.#emit("resolved", interaction);
				if (failure) reject(failure.error);
				else resolve(value);
				this.#presentNext();
			};
			const startLocal = () => {
				try {
					void local(abort.signal, value => finish(value, false)).then(
						value => finish(value, false),
						error => finish(undefined, false, { error }),
					);
				} catch (error) {
					finish(undefined, false, { error });
				}
			};
			this.#pending.set(interaction.id, { interaction, finish, startLocal });
			signal?.addEventListener("abort", onAbort, { once: true });
			this.#emit("opened", interaction);
			this.#presentNext();
		});
	}
	#presentNext(): void {
		if (this.#localActive || this.#closed || this.#cancelling) return;
		const next = this.#pending.values().next().value;
		if (!next) return;
		this.#localActive = next.interaction.id;
		next.startLocal();
	}
	respond(id: string, value: unknown): boolean {
		const pending = this.#pending.get(id);
		if (!pending || (value !== undefined && typeof value !== "string")) return false;
		if (value !== undefined && pending.interaction.kind === "select" && !pending.interaction.options?.includes(value))
			return false;
		pending.finish(value, true);
		return true;
	}
	cancelAll(): void {
		this.#cancelling = true;
		try {
			for (const pending of [...this.#pending.values()]) pending.finish(undefined, true);
		} finally {
			this.#cancelling = false;
		}
	}
	close(): void {
		this.#closed = true;
		this.cancelAll();
		this.#listeners.clear();
	}
}
