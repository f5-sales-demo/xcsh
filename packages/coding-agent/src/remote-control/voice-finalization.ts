export interface VoiceClosureReceipt {
	confirmed: boolean;
	seconds?: number;
	usageConfirmed?: boolean;
	reason?: string;
}
/** Receiver is installed before sending close, including synchronous fixture replies. */
export class VoiceFinalization {
	#receipt?: VoiceClosureReceipt;
	#resolve?: (receipt: VoiceClosureReceipt) => void;
	#closing?: Promise<VoiceClosureReceipt>;
	observe(value: unknown): boolean {
		if (!value || typeof value !== "object") return false;
		const event = value as { type?: unknown; usage?: { seconds?: unknown }; reason?: unknown };
		if (event.type !== "session.closed") return false;
		const seconds = event.usage?.seconds;
		if (event.usage !== undefined && (!event.usage || typeof event.usage !== "object")) return false;
		if (seconds !== undefined && (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0))
			return false;
		this.#receipt = {
			confirmed: true,
			...(typeof seconds === "number" ? { seconds } : { usageConfirmed: false }),
			...(typeof event.reason === "string" && /^[a-z_]{1,64}$/.test(event.reason) ? { reason: event.reason } : {}),
		};
		this.#resolve?.(this.#receipt);
		return true;
	}
	lost(): void {
		this.#resolve?.(this.#receipt ?? { confirmed: false });
	}
	close(send: () => void, cleanup: () => void, timeoutMs = 15_000): Promise<VoiceClosureReceipt> {
		if (this.#closing) return this.#closing;
		this.#closing = new Promise<VoiceClosureReceipt>(resolve => {
			this.#resolve = resolve;
			if (this.#receipt) resolve(this.#receipt);
		}).then(receipt => receipt);
		const timeout = setTimeout(() => this.lost(), timeoutMs);
		const pending = this.#closing;
		this.#closing = pending.finally(() => {
			clearTimeout(timeout);
			this.#resolve = undefined;
			cleanup();
		});
		try {
			send();
		} catch {
			this.lost();
		}
		return this.#closing;
	}
}
