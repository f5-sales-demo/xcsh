/** Canonical speech persistence ported from pinned core/src/realtime_history.rs. See NOTICE.md. */
import { type TimelineInput, type TimelineItem, VoiceTimeline } from "./voice-timeline";

/** One ordered persistence owner can span successive realtime calls in the same backing session. */
export class VoiceHistory {
	#timeline = new VoiceTimeline();
	#engaged = false;
	get engaged(): boolean {
		return this.#engaged;
	}
	#pending: Promise<void> = Promise.resolve();
	constructor(
		private readonly sessionId: string | null,
		private readonly persist: (record: Record<string, unknown>) => Promise<void>,
		private readonly emit: (method: string, params: Record<string, unknown>) => void,
	) {}
	async #complete(item: TimelineItem): Promise<void> {
		await this.persist({ kind: "voiceTimeline", item });
		if (item.type !== "transcriptSegment") this.emit("thread/realtime/item/started", { item });
		this.emit("thread/realtime/item/completed", { item });
	}
	observe(event: TimelineInput, forward?: () => void | Promise<void>): Promise<void> {
		if (event.type === "start") this.#engaged = true;
		const pending = this.#pending.then(async () => {
			const effects = this.#timeline.observe(event);
			const publishEffects = async () => {
				if (effects.stream) {
					const { startedItem, itemId, delta } = effects.stream;
					if (startedItem) this.emit("thread/realtime/item/started", { item: startedItem });
					this.emit("thread/realtime/item/transcript/delta", { itemId, delta });
				}
				for (const item of effects.items) await this.#complete(item);
			};
			if (effects.before) {
				await publishEffects();
				await forward?.();
			} else {
				await forward?.();
				await publishEffects();
			}
		});
		// The caller receives the failure; later closure must still be able to drain the queue.
		this.#pending = pending.catch(() => {});
		return pending;
	}
	/** Join queued effects before storage ownership changes. */
	drain(): Promise<void> {
		return this.#pending;
	}
	start(sessionId: string | null = this.sessionId): Promise<void> {
		return this.observe({ type: "start", sessionId });
	}
	transcript(role: "user" | "assistant", text: string, done: boolean): Promise<void> {
		return this.observe({ type: "transcript", role, text, done });
	}
	async close(failed: boolean): Promise<void> {
		if (failed) await this.observe({ type: "error" });
		await this.observe({ type: "close" });
	}
}
