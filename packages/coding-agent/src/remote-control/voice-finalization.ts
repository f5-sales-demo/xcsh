import { type VoiceClosureReceipt, voiceClosureReceipt } from "../../../chat-ui/src/voice/contract";

export type { VoiceClosureReceipt } from "../../../chat-ui/src/voice/contract";
/** Receiver is installed before sending close, including synchronous fixture replies. */
export class VoiceFinalization {
	#receipt?: VoiceClosureReceipt;
	#resolve?: (receipt: VoiceClosureReceipt) => void;
	#closing?: Promise<VoiceClosureReceipt>;
	observe(value: unknown, expectedSessionId?: string): boolean {
		const receipt = voiceClosureReceipt(value, expectedSessionId);
		if (!receipt) return false;
		// A duplicate terminal event cannot rewrite the first confirmed final usage.
		this.#receipt ??= receipt;
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
