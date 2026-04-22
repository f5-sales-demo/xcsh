import type { KeyId } from "./keys";

export interface ParsedBinding {
	sequence: KeyId[];
}

export interface BindingParseError {
	readonly message: string;
	readonly input: string;
}

export type ParseResult = { ok: true; sequence: KeyId[] } | { ok: false; error: BindingParseError };

/**
 * Parse a binding string into a keystroke sequence.
 *
 * - Whitespace separates keystrokes in a chord.
 * - One keystroke = single-stroke binding; two keystrokes = chord.
 * - v1 rejects 3+ keystrokes.
 * - Individual keystroke validation (known key names + modifier combos) is
 *   deferred to KeyId at type check time and at runtime via parseKey on input.
 */
export function parseBinding(input: string): ParseResult {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return { ok: false, error: { message: "empty binding", input } };
	}
	const tokens = trimmed.split(/\s+/);
	if (tokens.length > 2) {
		return {
			ok: false,
			error: {
				message: `chord bindings support at most 2 keystrokes (got ${tokens.length})`,
				input,
			},
		};
	}
	return { ok: true, sequence: tokens as KeyId[] };
}
