/** Ported from pinned realtime_conversation.rs and bem.rs. See NOTICE.md. */
import { ProtocolError } from "./session";
export type HandoffPhase = "commentary" | "final_answer";
export interface VoiceOutputUpdate {
	id: string;
	text: string;
	phase?: HandoffPhase;
	done: boolean;
}
interface Options {
	mode: "thinking" | "commentary" | "bemTags";
	prefixes: Record<string, string[]>;
	asItems: boolean;
	itemPrefix?: string;
}
export function handoffOptions(params: Record<string, unknown>): Options {
	if (
		(params.codexResponsesAsItems != null && typeof params.codexResponsesAsItems !== "boolean") ||
		(params.codexResponseItemPrefix != null && typeof params.codexResponseItemPrefix !== "string")
	)
		throw new ProtocolError(-32602, "Invalid realtime response-item options");
	const mode = params.codexResponseHandoffMode ?? "thinking";
	const prefixes = params.codexResponseHandoffChannelPrefixes ?? {};
	if (
		!["thinking", "commentary", "bemTags"].includes(String(mode)) ||
		!prefixes ||
		typeof prefixes !== "object" ||
		Array.isArray(prefixes)
	)
		throw new ProtocolError(-32602, "Invalid realtime handoff routing");
	if (
		Object.entries(prefixes).some(
			([key, value]) =>
				key.length > 256 ||
				!Array.isArray(value) ||
				value.length > 128 ||
				value.some(prefix => typeof prefix !== "string" || Buffer.byteLength(prefix) > 4096),
		) ||
		Buffer.byteLength(JSON.stringify(prefixes)) > 32768
	)
		throw new ProtocolError(-32602, "Invalid realtime handoff channel prefixes");
	return {
		mode: mode as Options["mode"],
		prefixes: prefixes as Record<string, string[]>,
		asItems: params.codexResponsesAsItems === true,
		itemPrefix: typeof params.codexResponseItemPrefix === "string" ? params.codexResponseItemPrefix : undefined,
	};
}

export function handoffPhase(text: string, prefixes: Options["prefixes"]): HandoffPhase | undefined {
	for (const [name, defaultPrefix, phase] of [
		["analysis", "[ANALYSIS]", "commentary"],
		["commentary", "[COMMENTARY]", "commentary"],
		["final", "[FINAL]", "final_answer"],
	] as const) {
		if ((prefixes[name] ?? [defaultPrefix]).some(prefix => prefix && text.startsWith(prefix))) return phase;
	}
}
export function handoffChannel(options: Options, phase?: HandoffPhase): "commentary" | "speakable" | undefined {
	return options.mode === "thinking"
		? undefined
		: options.mode === "commentary" || phase === "commentary"
			? "commentary"
			: "speakable";
}
const marker = "\n…output truncated…\n";
const budget = 4000;
const headLimit = Math.floor((budget - Buffer.byteLength(marker)) / 2);
const tailLimit = budget - headLimit - Buffer.byteLength(marker);
function head(text: string, limit: number): string {
	const bytes = Buffer.from(text);
	let end = Math.min(bytes.length, Math.max(0, limit));
	while (end > 0 && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
	return bytes.subarray(0, end).toString();
}
function tail(text: string, limit: number): string {
	const bytes = Buffer.from(text);
	let start = Math.max(0, bytes.length - limit);
	while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
	return bytes.subarray(start).toString();
}
interface Item {
	received: string;
	phase?: HandoffPhase;
	prefix: string;
	buffered: string;
	tail: string;
	sent: number;
	truncated: boolean;
	done: boolean;
	lastFlushAt: number;
	cancel?: () => void;
}
/** One delegation, with independently buffered text items; reasoning never enters this interface. */
export class VoiceHandoff {
	#items = new Map<string, Item>();
	#closed = false;
	#hasFinal = false;
	#receivedBytes = 0;
	constructor(
		private readonly options: Options,
		private readonly send: (channel: "commentary" | "speakable" | undefined, text: string) => void,
		private readonly schedule: (callback: () => void, delay: number) => () => void = (callback, delay) => {
			const timer = setTimeout(callback, delay);
			return () => clearTimeout(timer);
		},
		private readonly now: () => number = () => performance.now(),
	) {}
	update(update: VoiceOutputUpdate): void {
		if (this.#closed) return;
		if (Buffer.byteLength(update.text) > 1_048_576 || update.id.length > 1024)
			throw new Error("Realtime handoff input limit");
		let item = this.#items.get(update.id);
		if (!item) {
			if (this.#items.size >= 256) throw new Error("Realtime handoff item limit");
			item = {
				received: "",
				phase: this.options.mode === "bemTags" ? undefined : update.phase,
				prefix: "",
				buffered: "",
				tail: "",
				sent: 0,
				truncated: false,
				done: false,
				lastFlushAt: this.now(),
			};
			this.#items.set(update.id, item);
		}
		if (item.done) return;
		if (!update.text.startsWith(item.received)) throw new Error("Realtime handoff text changed after streaming");
		const total = this.#receivedBytes + Buffer.byteLength(update.text) - Buffer.byteLength(item.received);
		if (total > 2_097_152) throw new Error("Realtime handoff cumulative input limit");
		this.#receivedBytes = total;
		let delta = update.text.slice(item.received.length);
		item.received = update.text;
		if (this.options.mode === "bemTags" && !item.phase) {
			item.prefix += delta;
			item.phase = handoffPhase(item.prefix, this.options.prefixes);
			if (!item.phase && !update.done) return;
			item.phase ??= "final_answer";
			delta = item.prefix;
			item.prefix = "";
		}
		if (delta) {
			if (item.truncated) item.tail = tail(item.tail + delta, tailLimit);
			else {
				item.buffered += delta;
				if (Buffer.byteLength(item.buffered) > budget - item.sent) {
					item.tail = tail(item.buffered, tailLimit);
					item.buffered = head(item.buffered, headLimit - item.sent);
					item.truncated = true;
				}
			}
		}
		if (update.done) {
			item.done = true;
			item.cancel?.();
			item.cancel = undefined;
			this.#flush(item, true);
		} else if (!item.cancel && item.buffered && item.sent < headLimit) {
			item.cancel = this.schedule(
				() => {
					item!.cancel = undefined;
					if (!this.#closed && !item!.done) this.#flush(item!, false);
				},
				Math.max(0, 200 - (this.now() - item.lastFlushAt)),
			);
		}
	}
	#flush(item: Item, final: boolean): void {
		const chunk = final
			? item.buffered + (item.truncated ? marker + item.tail : "")
			: head(item.buffered, headLimit - item.sent);
		if (!chunk) return;
		if (final) {
			item.buffered = "";
			item.tail = "";
		} else item.buffered = item.buffered.slice(chunk.length);
		item.sent += Buffer.byteLength(chunk);
		item.lastFlushAt = this.now();
		const channel = handoffChannel(this.options, item.phase);
		if (item.phase !== "commentary") this.#hasFinal = true;
		this.send(channel, chunk);
	}
	finish(result: string): void {
		if (this.#closed) return;
		for (const [id, item] of this.#items) if (!item.done) this.update({ id, text: item.received, done: true });
		if (result && !this.#hasFinal && ![...this.#items.values()].some(item => item.received === result))
			this.update({ id: "completed-result", text: result, done: true });
		this.close();
	}
	close(): void {
		this.#closed = true;
		for (const item of this.#items.values()) item.cancel?.();
		this.#items.clear();
		this.#receivedBytes = 0;
	}
}
