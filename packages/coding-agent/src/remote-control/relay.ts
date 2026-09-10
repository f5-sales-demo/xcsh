/** Codex v3 relay framing port; see NOTICE.md. Buffers are deliberately smaller for live TUIs. */
const CHUNK_BYTES = 75 * 1024;
const MAX_MESSAGE = 8 * 1024 * 1024;
type Frame = Record<string, unknown>;
interface Assembly {
	seq: number;
	count: number;
	size: number;
	chunks: Buffer[];
	received: number;
}
export interface RelayMessage {
	clientId: string;
	streamId: string;
	message?: unknown;
	event: string;
}
export class RelayCodec {
	cursor?: string;
	#inbound = new Map<string, number>();
	#outbound = new Map<string, number>();
	#pending: { key: string; seq: number; segment: number; wire: string }[] = [];
	#assemblies = new Map<string, Assembly>();
	constructor(private readonly maxBufferedBytes = 16 * 1024 * 1024) {}
	receive(wire: string): RelayMessage | null {
		let frame: Frame;
		try {
			frame = JSON.parse(wire);
		} catch {
			throw new Error("Invalid relay frame");
		}
		if (
			!frame ||
			typeof frame !== "object" ||
			typeof frame.client_id !== "string" ||
			typeof frame.type !== "string" ||
			typeof frame.stream_id !== "string" ||
			(frame.seq_id !== undefined && (!Number.isSafeInteger(frame.seq_id) || (frame.seq_id as number) < 0)) ||
			wire.length > MAX_MESSAGE
		)
			throw new Error("Invalid relay frame");
		const clientId = frame.client_id;
		const streamId = frame.stream_id;
		const key = JSON.stringify([clientId, streamId]);
		const seq = frame.seq_id as number | undefined;
		if (frame.type === "ack") {
			if (seq === undefined) throw new Error("Invalid relay frame");
			const segment = frame.segment_id === undefined ? Infinity : Number(frame.segment_id);
			this.#pending = this.#pending.filter(
				item => item.key !== key || item.seq > seq || (item.seq === seq && item.segment > segment),
			);
			return null;
		}
		if (frame.type === "ping" || frame.type === "client_closed") return { clientId, streamId, event: frame.type };
		if (!["client_message", "client_message_chunk"].includes(frame.type)) throw new Error("Invalid relay frame");
		if (seq === undefined) throw new Error("Invalid relay frame");
		if (seq <= (this.#inbound.get(key) ?? -1)) return null;
		if (frame.type === "client_message_chunk") {
			const {
				segment_id: segment,
				segment_count: count,
				message_size_bytes: size,
				message_chunk_base64: encoded,
			} = frame;
			if (
				!Number.isSafeInteger(segment) ||
				!Number.isSafeInteger(count) ||
				!Number.isSafeInteger(size) ||
				(count as number) < 1 ||
				(count as number) > 1024 ||
				(segment as number) < 0 ||
				(segment as number) >= (count as number) ||
				(size as number) < 1 ||
				(size as number) > MAX_MESSAGE ||
				typeof encoded !== "string" ||
				encoded.length > 150 * 1024 ||
				!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
			)
				throw new Error("Invalid relay frame");
			let assembly = this.#assemblies.get(key);
			if (assembly && assembly.seq !== seq) {
				this.#assemblies.delete(key);
				assembly = undefined;
			}
			if (!assembly) {
				if (segment !== 0) throw new Error("Invalid relay chunk order");
				if (this.#assemblies.size >= 16) throw new Error("Relay buffer limit");
				assembly = { seq, count: count as number, size: size as number, chunks: [], received: 0 };
				this.#assemblies.set(key, assembly);
			}
			if (assembly.count !== count || assembly.size !== size) {
				this.#assemblies.delete(key);
				throw new Error("Invalid relay frame");
			}
			if ((segment as number) < assembly.chunks.length) return null;
			if (segment !== assembly.chunks.length) {
				this.#assemblies.delete(key);
				throw new Error("Invalid relay chunk order");
			}
			const chunk = Buffer.from(encoded, "base64");
			assembly.received += chunk.length;
			if (assembly.received > assembly.size) {
				this.#assemblies.delete(key);
				throw new Error("Relay buffer limit");
			}
			assembly.chunks.push(chunk);
			if (assembly.chunks.length < assembly.count) return null;
			this.#assemblies.delete(key);
			if (assembly.received !== assembly.size) throw new Error("Invalid relay frame");
			try {
				frame.message = JSON.parse(Buffer.concat(assembly.chunks).toString("utf8"));
			} catch {
				throw new Error("Invalid relay frame");
			}
		}
		if (!frame.message || typeof frame.message !== "object") throw new Error("Invalid relay frame");
		if (this.#inbound.size >= 256 && !this.#inbound.has(key)) throw new Error("Relay buffer limit");
		this.#inbound.set(key, seq);
		if (typeof frame.cursor === "string") this.cursor = frame.cursor;
		return { clientId, streamId, message: frame.message, event: "client_message" };
	}
	send(clientId: string, streamId: string, message: unknown, event = "server_message"): string[] {
		const key = JSON.stringify([clientId, streamId]);
		const seq = (this.#outbound.get(key) ?? 0) + 1;
		const base = { client_id: clientId, stream_id: streamId, seq_id: seq };
		const raw = Buffer.from(JSON.stringify(message));
		if (raw.length > MAX_MESSAGE || (this.#outbound.size >= 256 && !this.#outbound.has(key)))
			throw new Error("Relay buffer limit");
		const frames: string[] = [];
		if (raw.length <= CHUNK_BYTES || event !== "server_message") {
			frames.push(
				JSON.stringify({ type: event, ...base, ...(event === "pong" ? { status: message } : { message }) }),
			);
		} else {
			const count = Math.ceil(raw.length / CHUNK_BYTES);
			for (let segment = 0; segment < count; segment++)
				frames.push(
					JSON.stringify({
						type: "server_message_chunk",
						...base,
						segment_id: segment,
						segment_count: count,
						message_size_bytes: raw.length,
						message_chunk_base64: raw
							.subarray(segment * CHUNK_BYTES, (segment + 1) * CHUNK_BYTES)
							.toString("base64"),
					}),
				);
		}
		if (
			this.#pending.reduce((sum, item) => sum + Buffer.byteLength(item.wire), 0) +
				frames.reduce((sum, frame) => sum + Buffer.byteLength(frame), 0) >
			this.maxBufferedBytes
		)
			throw new Error("Relay buffer limit");
		this.#outbound.set(key, seq);
		frames.forEach((wire, segment) => {
			this.#pending.push({ key, seq, segment: frames.length === 1 ? Infinity : segment, wire });
		});
		return frames;
	}
	replay(): string[] {
		return this.#pending.map(item => item.wire);
	}
}
