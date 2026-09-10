/** Opt-in, sanitized protocol evidence. Captures never establish semantic parity alone. */
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const credentials = new Set([
	"authorization",
	"cookie",
	"setcookie",
	"accesstoken",
	"refreshtoken",
	"remotecontroltoken",
	"apikey",
	"secret",
	"password",
	"pairingcode",
	"manualpairingcode",
]);
const protocolKeys = new Set([
	"method",
	"type",
	"status",
	"role",
	"phase",
	"channel",
	"version",
	"outputmodality",
	"effort",
	"reasoningeffort",
	"summary",
	"reason",
	"event",
	"architecture",
]);
const protocolValues = new Set([
	"client_message",
	"client_message_chunk",
	"client_closed",
	"server_message",
	"server_message_chunk",
	"unknown",
	"malformed",
	"binary",
	"timeout",
	"error",
	"initialize",
	"initialized",
	"webrtc",
	"websocket",
	"existingCall",
	"v1",
	"v2",
	"v3",
	"audio",
	"text",
	"user",
	"assistant",
	"developer",
	"system",
	"client",
	"server",
	"active",
	"idle",
	"inProgress",
	"completed",
	"failed",
	"interrupted",
	"unsubscribed",
	"notSubscribed",
	"notLoaded",
	"requested",
	"transportClosed",
	"open",
	"closed",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"none",
	"auto",
	"speakable",
	"final_answer",
	"commentary",
	"input_text",
	"output_text",
	"message",
	"delegation",
	"ping",
	"pong",
	"ack",
	"avas",
]);
const protocolName =
	/^(?:thread|turn|item|account|config|model|skills|fs|process|plugin|remoteControl|threadSection)\/|^(?:session|response|conversation|delegation|turn|input_transcript|output_transcript|output_audio|input_audio)\./;
const keyName = (key: string) => key.replace(/[_-]/g, "").toLowerCase();
export function redactProtocolValue(value: unknown, salt: string): unknown {
	let nodes = 0;
	function visit(value: unknown, key = "", depth = 0): unknown {
		if (++nodes > 100_000 || depth > 64) throw new Error("Protocol capture bounds exceeded");
		if (value === null || value === undefined) return value ?? null;
		const name = keyName(key);
		if (credentials.has(name)) return { $redacted: "credential", valueType: typeof value };
		if (/id$/.test(name) && (typeof value === "string" || typeof value === "number"))
			return { $ref: createHash("sha256").update(salt).update(JSON.stringify(value)).digest("hex").slice(0, 24) };
		if (typeof value === "string") {
			if (protocolKeys.has(name) && (protocolValues.has(value) || (value.length <= 160 && protocolName.test(value))))
				return value;
			return {
				$redacted: name === "sdp" ? "sdp" : name === "audio" || name === "data" ? "opaque" : "string",
				valueType: "string",
				bytes: Buffer.byteLength(value),
			};
		}
		if (Array.isArray(value)) return value.map(item => visit(item, key, depth + 1));
		if (typeof value === "object")
			return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child, key, depth + 1)]));
		if (typeof value === "number" || typeof value === "boolean") return value;
		throw new Error("Unsupported protocol capture value");
	}
	return visit(value);
}
export interface TraceManifest {
	source: "codex" | "xcsh";
	version: string;
	sourceCommit: string;
	scenario: string;
}
export class ProtocolTrace {
	#fd: number;
	#salt: string;
	#sequence = 0;
	#started = performance.now();
	#bytes = 0;
	#failed = false;
	#closed = false;
	constructor(
		file: string,
		private readonly manifest: TraceManifest,
		private readonly maxBytes = 64 * 1024 * 1024,
		correlationSalt = randomBytes(32).toString("hex"),
	) {
		this.#salt = correlationSalt;
		const parent = lstatSync(dirname(file));
		if (!parent.isDirectory() || (parent.mode & 0o077) !== 0 || parent.uid !== process.getuid?.())
			throw new Error("Protocol capture requires a private owned directory");
		this.#fd = openSync(
			file,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		if (!fstatSync(this.#fd).isFile()) {
			closeSync(this.#fd);
			throw new Error("Invalid capture file");
		}
		try {
			this.#write({ kind: "manifest", schemaVersion: 1, startedAtUnixMs: Date.now(), ...manifest });
		} catch (error) {
			closeSync(this.#fd);
			throw error;
		}
	}
	#write(record: unknown): void {
		const line = `${JSON.stringify(record)}\n`;
		const data = Buffer.from(line);
		let offset = 0;
		while (offset < data.length) {
			const written = writeSync(this.#fd, data, offset, data.length - offset);
			if (!written) throw new Error("Capture write failed");
			offset += written;
		}
		this.#bytes += data.length;
	}
	record(layer: string, direction: "in" | "out", message: unknown): void {
		if (this.#closed || this.#failed) return;
		try {
			const record = {
				kind: "event",
				source: this.manifest.source,
				layer,
				direction,
				sequence: ++this.#sequence,
				elapsedMs: performance.now() - this.#started,
				message: redactProtocolValue(message, this.#salt),
			};
			if (this.#bytes + Buffer.byteLength(JSON.stringify(record)) > this.maxBytes) throw new Error("Capture limit");
			this.#write(record);
		} catch {
			this.#failed = true;
			try {
				this.#write({ kind: "captureOverflow", layer, direction, sequence: this.#sequence });
			} catch {
				/* A missing footer also marks capture incomplete. */
			}
		}
	}
	invalidate(reason: "producer-gap" | "producer-failure" | "truncated-frame" | "invalid-frame"): void {
		if (this.#closed || this.#failed) return;
		this.#failed = true;
		try {
			this.#write({ kind: "captureOverflow", reason });
		} catch {
			/* Missing footer marks incomplete evidence. */
		}
	}
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		try {
			this.#write({ kind: "footer", complete: !this.#failed, events: this.#sequence });
		} catch {
			// Recording failure must not interrupt the conversation. An absent or
			// truncated footer is rejected by the evidence reader.
		} finally {
			closeSync(this.#fd);
		}
	}
}
export function compareProtocolTraces(
	reference: readonly Record<string, any>[],
	candidate: readonly Record<string, any>[],
) {
	const normalize = (rows: readonly Record<string, any>[]) => {
		const refs = new Map<string, string>();
		let redactedContent = false;
		const visit = (value: any): any => {
			if (value === null || typeof value !== "object") return value;
			if (typeof value.$ref === "string") {
				if (!refs.has(value.$ref)) refs.set(value.$ref, `ref-${refs.size + 1}`);
				return { $ref: refs.get(value.$ref) };
			}
			if (value.$redacted) {
				if (value.$redacted === "string") redactedContent = true;
				return { $redacted: value.$redacted, valueType: value.valueType };
			}
			if (Array.isArray(value)) return value.map(visit);
			return Object.fromEntries(
				Object.entries(value)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, child]) => [key, visit(child)]),
			);
		};
		const events = rows
			.filter(row => row.kind == null || row.kind === "event")
			.map(row => ({ layer: row.layer, direction: row.direction, message: visit(row.message) }));
		const incomplete =
			!events.length ||
			rows[0]?.kind !== "manifest" ||
			rows.at(-1)?.kind !== "footer" ||
			rows.at(-1)?.events !== events.length ||
			rows.slice(1, -1).some((row, index) => row.kind !== "event" || row.sequence !== index + 1) ||
			rows.some(row => row.kind === "captureOverflow" || (row.kind === "footer" && !row.complete));
		return { events, incomplete, redactedContent };
	};
	const expected = normalize(reference),
		actual = normalize(candidate);
	const differences: { index: number; expected: unknown; actual: unknown }[] = [];
	for (let index = 0; index < Math.max(expected.events.length, actual.events.length); index++) {
		if (JSON.stringify(expected.events[index]) !== JSON.stringify(actual.events[index]))
			differences.push({ index, expected: expected.events[index] ?? null, actual: actual.events[index] ?? null });
		if (differences.length === 1000) break;
	}
	return {
		differences,
		complete:
			!expected.incomplete &&
			!actual.incomplete &&
			!expected.redactedContent &&
			!actual.redactedContent &&
			differences.length === 0,
		requiresSemanticReview: expected.redactedContent || actual.redactedContent,
		referenceEvents: expected.events.length,
		candidateEvents: actual.events.length,
	};
}
