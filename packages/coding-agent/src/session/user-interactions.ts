import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
	type InteractionQuestion,
	type QuestionAnswers,
	validQuestionAnswers,
	validQuestionGroup,
} from "./question-types";

const toolCalls = new AsyncLocalStorage<string>();

/** Bind only runtime tool UI calls; terminal administration has no tool identity. */
export function withToolInteraction<T>(toolCallId: string, callback: () => T): T {
	return toolCalls.run(toolCallId, callback);
}

export interface UserInteractionSpec {
	kind: "select" | "input" | "questions";
	questions?: readonly InteractionQuestion[];
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
	finish(value: unknown, abortLocal: boolean, failure?: { error: unknown }): void;
};
const copy = (interaction: UserInteraction): UserInteraction => structuredClone(interaction);

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
	requestQuestions(
		spec: Omit<UserInteractionSpec, "kind"> & { questions: readonly InteractionQuestion[] },
		local: (
			signal: AbortSignal,
			complete: (value: QuestionAnswers | undefined) => void,
		) => Promise<QuestionAnswers | undefined>,
		signal?: AbortSignal,
	): Promise<QuestionAnswers | undefined> {
		if (!validQuestionGroup(spec.questions)) return Promise.reject(new Error("Invalid or ambiguous question group"));
		return this.#request({ ...spec, kind: "questions" }, local, signal);
	}
	request(
		spec: UserInteractionSpec & { kind: "select" | "input" },
		local: (signal: AbortSignal, complete: (value: string | undefined) => void) => Promise<string | undefined>,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		return this.#request(spec, local, signal);
	}
	#request<T>(
		spec: UserInteractionSpec,
		local: (signal: AbortSignal, complete: (value: T | undefined) => void) => Promise<T | undefined>,
		signal?: AbortSignal,
	): Promise<T | undefined> {
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
				else resolve(value as T | undefined);
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
		if (!pending) return false;
		if (value !== undefined) {
			if (pending.interaction.kind === "questions") {
				if (!validQuestionAnswers(pending.interaction.questions ?? [], value)) return false;
			} else if (typeof value !== "string") return false;
		}
		if (
			value !== undefined &&
			pending.interaction.kind === "select" &&
			!pending.interaction.options?.includes(value as string)
		)
			return false;
		pending.finish(structuredClone(value), true);
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
