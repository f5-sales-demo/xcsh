/** Pinned completed handoffs and realtime_context/string truncation. See NOTICE.md. */
import type { HandoffPhase, VoiceOutputUpdate } from "./voice-handoff";

/** The pinned completed-output budget includes its truncation marker. */
export function completedVoiceText(text: string): string {
	const bytes = Buffer.from(text);
	let tokens = 1000;
	for (;;) {
		const budget = tokens * 4;
		if (bytes.length <= budget) return text;
		let end = Math.floor(budget / 2);
		while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
		let start = bytes.length - (budget - Math.floor(budget / 2));
		while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
		const candidate = `${bytes.subarray(0, end).toString()}…${Math.ceil((bytes.length - budget) / 4)} tokens truncated…${bytes.subarray(start).toString()}`;
		const excess = Math.ceil(Buffer.byteLength(candidate) / 4) - 1000;
		if (excess <= 0) return candidate;
		tokens = Math.max(0, tokens - excess);
	}
}

/** Completed handoffs and response-item mode ignore partial output and share duplicate/buffer limits. */
export class CompletedVoiceHandoff {
	#closed = false;
	#completed = new Set<string>();
	#lastText?: string;
	#bytes = 0;
	constructor(private readonly send: (text: string, phase?: HandoffPhase) => void) {}
	update(update: VoiceOutputUpdate): void {
		if (this.#closed || !update.done || this.#completed.has(update.id)) return;
		if (update.id.length > 1024 || this.#completed.size >= 256) throw new Error("Realtime handoff item limit");
		this.#completed.add(update.id);
		this.#output(update.text, update.phase);
	}
	#output(text: string, phase?: HandoffPhase): void {
		const bytes = Buffer.byteLength(text);
		if (bytes > 1_048_576 || this.#bytes + bytes > 2_097_152) throw new Error("Realtime handoff input limit");
		this.#bytes += bytes;
		this.#lastText = text;
		this.send(text, phase);
	}
	finish(result: string): void {
		if (this.#closed) return;
		if (result && result !== this.#lastText) this.#output(result);
		this.close();
	}
	close(): void {
		this.#closed = true;
		this.#completed.clear();
		this.#lastText = undefined;
		this.#bytes = 0;
	}
}
