/**
 * StdinBuffer buffers input and emits complete sequences.
 *
 * This is necessary because stdin data events can arrive in partial chunks,
 * especially for escape sequences like mouse events. Without buffering,
 * partial sequences can be misinterpreted as regular keypresses.
 *
 * For example, the mouse SGR sequence `\x1b[<35;20;5m` might arrive as:
 * - Event 1: `\x1b`
 * - Event 2: `[<35`
 * - Event 3: `;20;5m`
 *
 * The buffer accumulates these until a complete sequence is detected.
 * Call the `process()` method to feed input data.
 *
 * Based on code from OpenTUI (https://github.com/anomalyco/opentui)
 * MIT License - Copyright (c) 2025 opentui
 */
import { EventEmitter } from "events";

const ESC = "\x1b";
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

// How long after flushing an incomplete escape we will still stitch a late
// continuation back onto it. Generous because the same render stall that split
// the keypress also delays processing of its second half.
const ESCAPE_CONTINUATION_WINDOW_MS = 2000;

/**
 * Does `combined` (a just-flushed incomplete-escape prefix joined with the next
 * chunk) look like a fragmented CSI/SS3/OSC/DCS/APC sequence being stitched back
 * together — as opposed to an Escape keypress followed by ordinary typed text?
 * Only the former should be reassembled.
 */
function isEscapeContinuation(combined: string): boolean {
	if (combined.length < 2 || !combined.startsWith(ESC)) {
		return false;
	}
	// Only CSI (ESC [). That is the family that fragments as keyboard input —
	// arrows, function keys, modifyOtherKeys (ESC[27;5;99~), kitty (ESC[99;5u).
	// OSC/DCS/APC are string-terminated terminal *responses*, not fragmented
	// keypresses, and must never be glued onto unrelated input.
	return combined[1] === "[";
}

/**
 * Check if a string is a complete escape sequence or needs more data
 */
function isCompleteSequence(data: string): "complete" | "incomplete" | "not-escape" {
	if (!data.startsWith(ESC)) {
		return "not-escape";
	}

	if (data.length === 1) {
		return "incomplete";
	}

	const afterEsc = data.slice(1);

	// CSI sequences: ESC [
	if (afterEsc.startsWith("[")) {
		// Check for old-style mouse sequence: ESC[M + 3 bytes
		if (afterEsc.startsWith("[M")) {
			// Old-style mouse needs ESC[M + 3 bytes = 6 total
			return data.length >= 6 ? "complete" : "incomplete";
		}
		return isCompleteCsiSequence(data);
	}

	// OSC sequences: ESC ]
	if (afterEsc.startsWith("]")) {
		return isCompleteOscSequence(data);
	}

	// DCS sequences: ESC P ... ESC \ (includes XTVersion responses)
	if (afterEsc.startsWith("P")) {
		return isCompleteDcsSequence(data);
	}

	// APC sequences: ESC _ ... ESC \ (includes Kitty graphics responses)
	if (afterEsc.startsWith("_")) {
		return isCompleteApcSequence(data);
	}

	// SS3 sequences: ESC O
	if (afterEsc.startsWith("O")) {
		// ESC O followed by a single character
		return afterEsc.length >= 2 ? "complete" : "incomplete";
	}

	// Meta key sequences: ESC followed by a single character
	if (afterEsc.length === 1) {
		return "complete";
	}

	// Unknown escape sequence - treat as complete
	return "complete";
}

/**
 * Check if CSI sequence is complete
 * CSI sequences: ESC [ ... followed by a final byte (0x40-0x7E)
 */
function isCompleteCsiSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}[`)) {
		return "complete";
	}

	// Need at least ESC [ and one more character
	if (data.length < 3) {
		return "incomplete";
	}

	const payload = data.slice(2);

	// CSI sequences end with a byte in the range 0x40-0x7E (@-~)
	// This includes all letters and several special characters
	const lastChar = payload[payload.length - 1];
	const lastCharCode = lastChar.charCodeAt(0);

	if (lastCharCode >= 0x40 && lastCharCode <= 0x7e) {
		// Special handling for SGR mouse sequences
		// Format: ESC[<B;X;Ym or ESC[<B;X;YM
		if (payload.startsWith("<")) {
			// Must have format: <digits;digits;digits[Mm]
			const mouseMatch = /^<\d+;\d+;\d+[Mm]$/.test(payload);
			if (mouseMatch) {
				return "complete";
			}
			// If it ends with M or m but doesn't match the pattern, still incomplete
			if (lastChar === "M" || lastChar === "m") {
				// Check if we have the right structure
				const parts = payload.slice(1, -1).split(";");
				if (parts.length === 3 && parts.every(p => /^\d+$/.test(p))) {
					return "complete";
				}
			}

			return "incomplete";
		}

		return "complete";
	}

	return "incomplete";
}

/**
 * Check if OSC sequence is complete
 * OSC sequences: ESC ] ... ST (where ST is ESC \ or BEL)
 */
function isCompleteOscSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}]`)) {
		return "complete";
	}

	// OSC sequences end with ST (ESC \) or BEL (\x07)
	if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) {
		return "complete";
	}

	return "incomplete";
}

/**
 * Check if DCS (Device Control String) sequence is complete
 * DCS sequences: ESC P ... ST (where ST is ESC \)
 * Used for XTVersion responses like ESC P >| ... ESC \
 */
function isCompleteDcsSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}P`)) {
		return "complete";
	}

	// DCS sequences end with ST (ESC \)
	if (data.endsWith(`${ESC}\\`)) {
		return "complete";
	}

	return "incomplete";
}

/**
 * Check if APC (Application Program Command) sequence is complete
 * APC sequences: ESC _ ... ST (where ST is ESC \)
 * Used for Kitty graphics responses like ESC _ G ... ESC \
 */
function isCompleteApcSequence(data: string): "complete" | "incomplete" {
	if (!data.startsWith(`${ESC}_`)) {
		return "complete";
	}

	// APC sequences end with ST (ESC \)
	if (data.endsWith(`${ESC}\\`)) {
		return "complete";
	}

	return "incomplete";
}

/**
 * Split accumulated buffer into complete sequences
 */
function extractCompleteSequences(buffer: string): { sequences: string[]; remainder: string } {
	const sequences: string[] = [];
	let pos = 0;

	while (pos < buffer.length) {
		const remaining = buffer.slice(pos);

		// Try to extract a sequence starting at this position
		if (remaining.startsWith(ESC)) {
			// Find the end of this escape sequence
			let seqEnd = 1;
			while (seqEnd <= remaining.length) {
				const candidate = remaining.slice(0, seqEnd);
				const status = isCompleteSequence(candidate);

				if (status === "complete") {
					sequences.push(candidate);
					pos += seqEnd;
					break;
				} else if (status === "incomplete") {
					seqEnd++;
				} else {
					// Should not happen when starting with ESC
					sequences.push(candidate);
					pos += seqEnd;
					break;
				}
			}

			if (seqEnd > remaining.length) {
				return { sequences, remainder: remaining };
			}
		} else {
			// Not an escape sequence - take a single character
			sequences.push(remaining[0]!);
			pos++;
		}
	}

	return { sequences, remainder: "" };
}

export type StdinBufferOptions = {
	/**
	 * Maximum time to wait for sequence completion (default: 50ms)
	 * After this time, the buffer is flushed even if incomplete.
	 *
	 * This is effectively the "ESC hold" window: a lone ESC (the Escape key)
	 * registers after this delay, and a multi-byte escape sequence fragmented
	 * across stdin reads (common under heavy render load) has this long to
	 * reassemble before its tail would leak as individual printable characters.
	 * 50ms is the standard ESC timeout — long enough to survive multi-frame
	 * stalls, short enough to feel instant.
	 */
	timeout?: number;
};

export type StdinBufferEventMap = {
	data: [string];
	paste: [string];
};

/**
 * Buffers stdin input and emits complete sequences via the 'data' event.
 * Handles partial escape sequences that arrive across multiple chunks.
 */
export class StdinBuffer extends EventEmitter<StdinBufferEventMap> {
	#buffer: string = "";
	#timeout?: NodeJS.Timeout;
	readonly #timeoutMs: number;
	#pasteMode: boolean = false;
	#pasteBuffer: string = "";
	// An incomplete escape sequence we flushed on timeout, kept so a continuation
	// arriving in the next read (a keypress fragmented across stdin reads by an
	// extreme render stall) can be reassembled instead of leaking its tail as text.
	#pendingEscape: string | null = null;
	#pendingEscapeAt = 0;

	constructor(options: StdinBufferOptions = {}) {
		super();
		this.#timeoutMs = options.timeout ?? 50;
	}

	process(data: string | Buffer): void {
		// Clear any pending timeout
		if (this.#timeout) {
			clearTimeout(this.#timeout);
			this.#timeout = undefined;
		}

		// Handle high-byte conversion (for compatibility with parseKeypress)
		// If buffer has single byte > 127, convert to ESC + (byte - 128)
		let str: string;
		if (Buffer.isBuffer(data)) {
			if (data.length === 1 && data[0]! > 127) {
				const byte = data[0]! - 128;
				str = `\x1b${String.fromCharCode(byte)}`;
			} else {
				str = data.toString();
			}
		} else {
			str = data;
		}

		// If we recently flushed an incomplete escape (its hold window expired before
		// the rest of the keypress arrived), stitch this continuation back onto it so
		// it parses as one sequence. The lone ESC was already delivered as a harmless
		// Escape; here we recover the CSI/SS3 tail that would otherwise leak as text.
		if (this.#pendingEscape !== null) {
			const prefix = this.#pendingEscape;
			this.#pendingEscape = null;
			if (
				!str.startsWith(ESC) && // a bare tail, not a fresh escape sequence of its own
				Date.now() - this.#pendingEscapeAt < ESCAPE_CONTINUATION_WINDOW_MS &&
				isEscapeContinuation(prefix + str)
			) {
				str = prefix + str;
			}
		}

		if (str.length === 0 && this.#buffer.length === 0) {
			this.emit("data", "");
			return;
		}

		this.#buffer += str;

		if (this.#pasteMode) {
			this.#pasteBuffer += this.#buffer;
			this.#buffer = "";

			const endIndex = this.#pasteBuffer.indexOf(BRACKETED_PASTE_END);
			if (endIndex !== -1) {
				const pastedContent = this.#pasteBuffer.slice(0, endIndex);
				const remaining = this.#pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);

				this.#pasteMode = false;
				this.#pasteBuffer = "";

				this.emit("paste", pastedContent);

				if (remaining.length > 0) {
					this.process(remaining);
				}
			}
			return;
		}

		const startIndex = this.#buffer.indexOf(BRACKETED_PASTE_START);
		if (startIndex !== -1) {
			if (startIndex > 0) {
				const beforePaste = this.#buffer.slice(0, startIndex);
				const result = extractCompleteSequences(beforePaste);
				for (const sequence of result.sequences) {
					this.emit("data", sequence);
				}
			}

			this.#buffer = this.#buffer.slice(startIndex + BRACKETED_PASTE_START.length);
			this.#pasteMode = true;
			this.#pasteBuffer = this.#buffer;
			this.#buffer = "";

			const endIndex = this.#pasteBuffer.indexOf(BRACKETED_PASTE_END);
			if (endIndex !== -1) {
				const pastedContent = this.#pasteBuffer.slice(0, endIndex);
				const remaining = this.#pasteBuffer.slice(endIndex + BRACKETED_PASTE_END.length);

				this.#pasteMode = false;
				this.#pasteBuffer = "";

				this.emit("paste", pastedContent);

				if (remaining.length > 0) {
					this.process(remaining);
				}
			}
			return;
		}

		const result = extractCompleteSequences(this.#buffer);
		this.#buffer = result.remainder;

		for (const sequence of result.sequences) {
			this.emit("data", sequence);
		}

		if (this.#buffer.length > 0) {
			this.#timeout = setTimeout(() => {
				const flushed = this.flush();

				for (const sequence of flushed) {
					this.emit("data", sequence);
				}

				// Remember a flushed incomplete escape so a continuation arriving in
				// the next read can be reassembled (see process()). Only a genuinely
				// incomplete trailing fragment qualifies — a complete sequence (e.g.
				// one peeled out of a de-blobbed probe response) is not a keypress
				// awaiting its tail and must not glue onto the next read.
				const last = flushed[flushed.length - 1];
				if (last !== undefined && last.startsWith(ESC) && isCompleteSequence(last) === "incomplete") {
					this.#pendingEscape = last;
					this.#pendingEscapeAt = Date.now();
				}
			}, this.#timeoutMs);
		}
	}

	flush(): string[] {
		if (this.#timeout) {
			clearTimeout(this.#timeout);
			this.#timeout = undefined;
		}

		if (this.#buffer.length === 0) {
			return [];
		}

		// Re-split the abandoned buffer into individual complete sequences instead
		// of emitting it whole. Under render load a terminal *response* can arrive
		// before its terminator (notably an OSC 11 reply missing its ST); the
		// tokenizer then treats it as incomplete and, while scanning for the
		// terminator, absorbs any following replies (DA1, Kitty) into one fragment.
		// Emitting that as a single event defeats the terminal's anchored
		// single-sequence matchers, so the whole blob leaks into the editor as text
		// (#1446). Split an unterminated string sequence (OSC/DCS/APC) at an
		// embedded ESC that introduces a new sequence so each reply is recognized
		// and swallowed on its own.
		const out: string[] = [];
		let work = this.#buffer;
		this.#buffer = "";

		while (work.length > 0) {
			const { sequences, remainder } = extractCompleteSequences(work);
			out.push(...sequences);
			if (remainder.length === 0) {
				break;
			}
			// The remainder is an incomplete ESC-led fragment. If it absorbed a
			// later sequence (an embedded ESC beyond the introducer), peel off the
			// abandoned prefix and re-extract from the embedded boundary; otherwise
			// it is a genuine trailing fragment (e.g. a lone Escape keypress or a
			// half-arrived CSI) and is emitted as-is.
			const embeddedEsc = remainder.indexOf(ESC, 1);
			if (embeddedEsc > 0) {
				out.push(remainder.slice(0, embeddedEsc));
				work = remainder.slice(embeddedEsc);
			} else {
				out.push(remainder);
				break;
			}
		}

		return out;
	}

	clear(): void {
		if (this.#timeout) {
			clearTimeout(this.#timeout);
			this.#timeout = undefined;
		}
		this.#buffer = "";
		this.#pasteMode = false;
		this.#pasteBuffer = "";
		this.#pendingEscape = null;
	}

	getBuffer(): string {
		return this.#buffer;
	}

	destroy(): void {
		this.clear();
	}
}
