import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { type InputQuestion, type InputResponse, validInputResponse } from "../../../chat-ui/src/interactions/contract";
import { isInteractionFrame, isInteractionIdentity } from "../../../chat-ui/src/interactions/transport";

const toolCalls = new AsyncLocalStorage<string>();
/** Bind only runtime tool UI calls; terminal administration has no tool identity. */
export function withToolInteraction<T>(toolCallId: string, callback: () => T): T {
	return toolCalls.run(toolCallId, callback);
}

export interface UserInteractionSpec {
	identity?: InteractionIdentity;
	questionId?: string;
	delivery?: "waiting" | "async";
	kind: "select" | "input" | "request_user_input";
	inputQuestions?: readonly InputQuestion[];
	title: string;
	options?: readonly string[];
	toolCallId?: string;
	isSecret?: boolean;
}
export interface UserInteraction extends UserInteractionSpec {
	id: string;
}
export interface UserInteractionEvent {
	contract: "xcsh.interaction.v1";
	revision: number;
	type: "opened" | "resolved";
	interaction: UserInteraction;
	reason?: InteractionResolution;
}
export interface InteractionIdentity {
	sessionId: string;
	threadId: string;
	turnId: string;
	itemId: string;
	generation: number;
}
export type InteractionResolution =
	| "answered"
	| "cancelled"
	| "interrupted"
	| "dismissed"
	| "expired"
	| "superseded"
	| "owner_lost";
type Pending = {
	interaction: UserInteraction;
	hasLocal: boolean;
	presentationRequested?: boolean;
	startLocal(): void;
	finish(value: unknown, abortLocal: boolean, failure?: { error: unknown }, reason?: InteractionResolution): void;
};
const copy = (interaction: UserInteraction): UserInteraction => structuredClone(interaction);

/** One completion owner shared by terminal presentation and remote answers. */
export class UserInteractions {
	#asyncPresenter?: (request: UserInteractionSpec, signal: AbortSignal) => Promise<string | undefined>;
	#receipts = new Map<string, { requestId: string; value: unknown; identity: InteractionIdentity }>();
	#questionPresenter?: (
		questions: readonly InputQuestion[],
		signal: AbortSignal,
	) => Promise<InputResponse | undefined>;
	#revision = 0;
	#notificationQueue: UserInteractionEvent[] = [];
	#batchDepth = 0;
	#emitting = false;
	#events: UserInteractionEvent[] = [];
	#pending = new Map<string, Pending>();
	#listeners = new Set<(event: UserInteractionEvent) => void>();
	#closed = false;
	#cancelling = false;
	#localActive?: string;
	#localPauses = 0;
	setAsyncPresenter(
		presenter: (request: UserInteractionSpec, signal: AbortSignal) => Promise<string | undefined>,
	): void {
		this.#asyncPresenter = presenter;
		for (const pending of this.#pending.values())
			if (pending.interaction.delivery === "async") pending.hasLocal = true;
		this.#presentNext();
	}
	presentAsync(id: string): boolean {
		const pending = this.#pending.get(id);
		if (pending?.interaction.delivery !== "async" || !this.#asyncPresenter) return false;
		pending.presentationRequested = true;
		this.#presentNext();
		return true;
	}
	setQuestionPresenter(
		presenter: (questions: readonly InputQuestion[], signal: AbortSignal) => Promise<InputResponse | undefined>,
	): void {
		this.#questionPresenter = presenter;
		for (const pending of this.#pending.values())
			if (pending.interaction.kind === "request_user_input") pending.hasLocal = true;
		this.#presentNext();
	}
	requestInput(
		spec: Omit<UserInteractionSpec, "kind"> & { inputQuestions: readonly InputQuestion[] },
		signal?: AbortSignal,
	): Promise<InputResponse | undefined> {
		if (
			!spec.inputQuestions.length ||
			new Set(spec.inputQuestions.map(question => question.id)).size !== spec.inputQuestions.length
		)
			return Promise.reject(new Error("Invalid question identities"));
		return this.#request(
			{ ...spec, kind: "request_user_input" },
			async localSignal => this.#questionPresenter?.(spec.inputQuestions, localSignal),
			signal,
		);
	}
	/** An external editor owns the terminal; remote answers may still settle queued requests. */
	pauseLocalPresentation(): () => void {
		this.#localPauses++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#localPauses--;
			this.#presentNext();
		};
	}
	pending(): UserInteraction[] {
		return [...this.#pending.values()].map(value => copy(value.interaction));
	}
	snapshot(): { revision: number; pending: UserInteraction[] } {
		return { revision: this.#revision, pending: this.pending() };
	}
	replay(after: number): {
		reset: boolean;
		events: UserInteractionEvent[];
		snapshot: ReturnType<UserInteractions["snapshot"]>;
	} {
		if (!Number.isSafeInteger(after) || after < 0 || after > this.#revision)
			throw new Error("Invalid interaction revision");
		const reset = after < (this.#events[0]?.revision ?? 1) - 1;
		return {
			reset,
			events: reset ? [] : structuredClone(this.#events.filter(event => event.revision > after)),
			snapshot: this.snapshot(),
		};
	}
	/** Recover observable history; promises owned by a previous process cannot resume. */
	recover(events: readonly UserInteractionEvent[]): void {
		if (this.#pending.size || this.#closed) throw new Error("Cannot restore interactions into an active owner");
		const outstanding = new Map<string, UserInteraction>();
		for (const event of events) {
			if (
				event.contract !== "xcsh.interaction.v1" ||
				!isInteractionFrame({ type: "interaction_event", revision: event.revision, event })
			)
				throw new Error("Invalid persisted interaction event");
			this.#revision = Math.max(this.#revision, event.revision);
			if (event.type === "opened") outstanding.set(event.interaction.id, copy(event.interaction));
			else outstanding.delete(event.interaction.id);
		}
		this.#events = structuredClone(events.slice(-1024)) as UserInteractionEvent[];
		for (const request of outstanding.values()) this.#emit("resolved", request, "owner_lost");
	}
	restore(events: readonly UserInteractionEvent[]): void {
		if (this.#pending.size || this.#closed) throw new Error("Cannot restore interactions into an active owner");
		this.#receipts.clear();
		this.#events = [];
		this.#notificationQueue = [];
		this.#revision = 0;
		this.recover(events);
	}
	get waitingOnUserInput(): boolean {
		return [...this.#pending.values()].some(value => value.interaction.delivery !== "async");
	}
	subscribe(listener: (event: UserInteractionEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#emit(type: UserInteractionEvent["type"], interaction: UserInteraction, reason?: InteractionResolution): void {
		const event: UserInteractionEvent = {
			contract: "xcsh.interaction.v1",
			revision: ++this.#revision,
			type,
			interaction: copy(interaction),
			...(reason ? { reason } : {}),
		};
		this.#events.push(event);
		if (this.#events.length > 1024) this.#events.shift();
		this.#notificationQueue.push(event);
		this.#flushNotifications();
	}
	#flushNotifications(): void {
		if (this.#batchDepth || this.#emitting) return;
		this.#emitting = true;
		try {
			while (this.#notificationQueue.length) {
				const event = this.#notificationQueue.shift()!;
				for (const listener of this.#listeners) {
					try {
						listener(structuredClone(event));
					} catch {
						/* A consumer cannot block local interaction. */
					}
				}
			}
		} finally {
			this.#emitting = false;
		}
	}
	requestAsyncBatch(
		specs: readonly (UserInteractionSpec & { kind: "input"; delivery: "async" })[],
	): Promise<string | undefined>[] {
		if (this.#closed || this.#cancelling) throw new Error("Session interaction owner unavailable");
		if (!specs.length || this.#pending.size + specs.length > 32)
			throw new Error("Too many pending user interactions");
		this.#batchDepth++;
		try {
			return specs.map(spec => this.request(spec));
		} finally {
			this.#batchDepth--;
			this.#flushNotifications();
		}
	}
	request(
		spec: UserInteractionSpec & { kind: "select" | "input" },
		local?: (signal: AbortSignal, complete: (value: string | undefined) => void) => Promise<string | undefined>,
		signal?: AbortSignal,
	): Promise<string | undefined> {
		return this.#request(
			spec,
			spec.delivery === "async" ? abort => this.#asyncPresenter?.(spec, abort) ?? Promise.resolve(undefined) : local,
			signal,
		);
	}
	#request<T>(
		spec: UserInteractionSpec,
		local?: (signal: AbortSignal, complete: (value: T | undefined) => void) => Promise<T | undefined>,
		signal?: AbortSignal,
	): Promise<T | undefined> {
		if (this.#closed || this.#cancelling || signal?.aborted) return Promise.resolve(undefined);
		if (this.#pending.size >= 32) return Promise.reject(new Error("Too many pending user interactions"));
		const interaction = copy({
			toolCallId: toolCalls.getStore(),
			...spec,
			id: randomUUID(),
		});
		const abort = new AbortController();
		return new Promise((resolve, reject) => {
			const onAbort = () => finish(undefined, true, undefined, "interrupted");
			const finish: Pending["finish"] = (value, abortLocal, failure, reason) => {
				if (!failure && !this.#valid(interaction, value)) return;
				if (!this.#pending.delete(interaction.id)) return;
				if (this.#localActive === interaction.id) this.#localActive = undefined;
				signal?.removeEventListener("abort", onAbort);
				if (abortLocal) abort.abort();
				this.#emit(
					"resolved",
					interaction,
					reason ?? (failure ? "owner_lost" : value === undefined ? "dismissed" : "answered"),
				);
				if (failure) reject(failure.error);
				else resolve(value as T | undefined);
				this.#presentNext();
			};
			const startLocal = () => {
				if (!local) return;
				try {
					void local(abort.signal, value => finish(value, false)).then(
						value => finish(value, false),
						error => finish(undefined, false, { error }),
					);
				} catch (error) {
					finish(undefined, false, { error });
				}
			};
			this.#pending.set(interaction.id, {
				interaction,
				finish,
				startLocal,
				hasLocal:
					interaction.kind === "request_user_input" ? this.#questionPresenter !== undefined : local !== undefined,
			});
			signal?.addEventListener("abort", onAbort, { once: true });
			this.#emit("opened", interaction);
			this.#presentNext();
		});
	}
	#presentNext(): void {
		if (this.#localActive || this.#localPauses > 0 || this.#closed || this.#cancelling) return;
		const next = [...this.#pending.values()].find(
			value => value.hasLocal && (value.interaction.delivery !== "async" || value.presentationRequested),
		);
		if (!next) return;
		this.#localActive = next.interaction.id;
		next.startLocal();
	}
	#valid(interaction: UserInteraction, value: unknown): boolean {
		if (value === undefined) return true;
		if (interaction.kind === "request_user_input") return validInputResponse(interaction.inputQuestions ?? [], value);
		return (
			typeof value === "string" && (interaction.kind !== "select" || interaction.options?.includes(value) === true)
		);
	}
	respond(id: string, value: unknown, identity?: InteractionIdentity): boolean {
		const pending = this.#pending.get(id);
		if (!pending) return false;
		if (
			identity &&
			(!pending.interaction.identity ||
				Object.entries(identity).some(
					([key, field]) => pending.interaction.identity?.[key as keyof InteractionIdentity] !== field,
				))
		)
			return false;
		if (!this.#valid(pending.interaction, value)) return false;
		pending.finish(structuredClone(value), true);
		return true;
	}
	respondExternal(id: string, responseId: string, value: unknown, identity: InteractionIdentity): boolean {
		if (
			typeof responseId !== "string" ||
			!/^[A-Za-z0-9:_-]{1,128}$/.test(responseId) ||
			!isInteractionIdentity(identity) ||
			value === undefined
		)
			return false;
		const receipt = this.#receipts.get(responseId);
		if (receipt)
			return (
				receipt.requestId === id &&
				isDeepStrictEqual(receipt.identity, identity) &&
				isDeepStrictEqual(receipt.value, value)
			);
		const pending = this.#pending.get(id);
		if (
			!pending?.interaction.identity ||
			!isDeepStrictEqual(pending.interaction.identity, identity) ||
			!this.#valid(pending.interaction, value)
		)
			return false;
		this.#receipts.set(responseId, {
			requestId: id,
			value: structuredClone(value),
			identity: structuredClone(identity),
		});
		pending.finish(structuredClone(value), true);
		if (this.#receipts.size > 256) this.#receipts.delete(this.#receipts.keys().next().value!);
		return true;
	}
	resolve(id: string, reason: Exclude<InteractionResolution, "answered">): boolean {
		const pending = this.#pending.get(id);
		if (!pending) return false;
		pending.finish(undefined, true, undefined, reason);
		return true;
	}
	cancelAll(reason: Exclude<InteractionResolution, "answered"> = "cancelled"): void {
		if (reason === "superseded" || reason === "interrupted" || reason === "owner_lost") this.#receipts.clear();
		this.#cancelling = true;
		try {
			for (const pending of [...this.#pending.values()]) pending.finish(undefined, true, undefined, reason);
		} finally {
			this.#cancelling = false;
		}
	}
	close(): void {
		this.#closed = true;
		this.cancelAll("owner_lost");
		this.#listeners.clear();
		this.#receipts.clear();
	}
}
