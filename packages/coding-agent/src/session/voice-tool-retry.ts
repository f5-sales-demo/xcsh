import { AsyncLocalStorage } from "node:async_hooks";
import { AgentToolError } from "@f5-sales-demo/pi-agent-core";
import { type Effect, type Outcome, VoiceOperationRetry } from "./voice-operation-retry";

const managed = new AsyncLocalStorage<boolean>();
export const voiceRetryManaged = () => managed.getStore() === true;
export class VoiceToolRetry {
	#budget: VoiceOperationRetry;
	constructor(
		private readonly record: (record: Record<string, unknown>) => Promise<void> = async () => {},
		spent = false,
		restored: { id: string; effect: Effect; outcome: Outcome }[] = [],
	) {
		this.#budget = new VoiceOperationRetry(spent, restored);
	}
	async run<T extends object>(
		id: string,
		effect: Effect,
		execute: () => Promise<T>,
		aborted: () => boolean = () => false,
		canRetry: () => boolean = () => true,
	): Promise<T> {
		if (effect !== "readOnly" && this.#budget.snapshot().some(operation => operation.id === id))
			throw new Error("This operation was already admitted. Reconcile its authoritative outcome before retrying.");
		this.#budget.begin(id, effect);
		if (aborted()) throw new Error("Operation cancelled before execution");
		let attempt = 0;
		while (true) {
			await this.record({ kind: "voiceOperation", id, effect, outcome: "pending", attempt });
			if (aborted() || !canRetry())
				throw new Error("Operation target changed or cancellation was requested before execution");
			let result: T | undefined;
			let error: unknown;
			let threw = false;
			try {
				result = await managed.run(true, execute);
			} catch (caught) {
				error = caught;
				threw = true;
			}
			const outcome = threw
				? effect === "readOnly"
					? "failed"
					: "unknown"
				: (result as { isError?: boolean } | undefined)?.isError
					? effect === "readOnly"
						? "failed"
						: "unknown"
					: "completed";
			this.#budget.settle(id, outcome);
			await this.record({ kind: "voiceOperation", id, effect, outcome, attempt });
			if (
				(threw || (result as { isError?: boolean } | undefined)?.isError) &&
				!aborted() &&
				canRetry() &&
				transientReadFailure(threw ? error : result) &&
				this.#budget.retry(id)
			) {
				attempt++;
				await this.record({ kind: "voiceRetryReserved", id, effect, attempt });
				if (aborted() || !canRetry()) {
					if (threw) throw error;
					return result!;
				}
				continue;
			}
			if (threw && effect !== "readOnly") {
				const message =
					"The operation outcome is uncertain. Reconcile authoritative task or resource state before retrying.";
				// Tool errors already carry verified execution details. Preserve them
				// without promoting unknown effects to a safe retry or known failure.
				if (error instanceof AgentToolError)
					throw new AgentToolError(message, {
						...error.result,
						content: [...error.result.content, { type: "text", text: message }],
					});
				throw new Error(message, { cause: error });
			}
			if (threw) throw error;
			return result!;
		}
	}
	operations() {
		return this.#budget.snapshot();
	}
}

/** Only observed transient failure codes qualify; arbitrary error text does not. */
export function transientReadFailure(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const failure = value as { code?: unknown; details?: { status?: unknown } };
	return (
		["EAGAIN", "EIO", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"].includes(String(failure.code)) ||
		(typeof failure.details?.status === "number" &&
			[0, 408, 425, 429, 500, 502, 503, 504].includes(failure.details.status))
	);
}
