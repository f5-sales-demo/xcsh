/** Canonical speech items ported from pinned core/src/realtime_history.rs. See NOTICE.md. */
import { randomUUID } from "node:crypto";

type Role = "user" | "assistant";
interface Item extends Record<string, unknown> {
	id: string;
	realtimeSessionId: string;
	type: "realtimeSessionStarted" | "transcriptSegment" | "realtimeSessionClosed";
}
export class VoiceHistory {
	#sessionId: string;
	#segments = new Map<Role, Item & { role: Role; text: string }>();
	#closed = false;
	constructor(
		sessionId: string | null,
		private readonly persist: (record: Record<string, unknown>) => Promise<void>,
		private readonly emit: (method: string, params: Record<string, unknown>) => void,
	) {
		this.#sessionId = sessionId ?? randomUUID();
	}
	#item(type: Item["type"]): Item {
		return { id: randomUUID(), realtimeSessionId: this.#sessionId, type };
	}
	async #complete(item: Item, started = false): Promise<void> {
		await this.persist({ kind: "voiceTimeline", item });
		if (!started) this.emit("thread/realtime/item/started", { item });
		this.emit("thread/realtime/item/completed", { item });
	}
	async start(): Promise<void> {
		await this.#complete(this.#item("realtimeSessionStarted"));
	}
	async transcript(role: Role, text: string, done: boolean): Promise<void> {
		if (this.#closed) return;
		let segment = this.#segments.get(role);
		if (!segment && text) {
			segment = { ...this.#item("transcriptSegment"), role, text: "" };
			this.#segments.set(role, segment);
			this.emit("thread/realtime/item/started", { item: { ...segment } });
			// A final without preceding deltas supplies a complete segment.
			if (done) {
				segment.text = text;
				this.emit("thread/realtime/item/transcript/delta", { itemId: segment.id, delta: text });
			}
		}
		if (!segment) return;
		if (!done) {
			if (Buffer.byteLength(segment.text) + Buffer.byteLength(text) > 1_048_576)
				throw new Error("Realtime transcript limit");
			segment.text += text;
			this.emit("thread/realtime/item/transcript/delta", { itemId: segment.id, delta: text });
		} else {
			this.#segments.delete(role);
			// Upstream seals the accumulated segment; a repeated final does not append it again.
			if (segment.text) await this.#complete({ ...segment }, true);
		}
	}
	async close(failed: boolean): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		for (const segment of this.#segments.values()) if (segment.text) await this.#complete({ ...segment }, true);
		this.#segments.clear();
		await this.#complete({ ...this.#item("realtimeSessionClosed"), outcome: failed ? "failed" : "ended" });
	}
}
