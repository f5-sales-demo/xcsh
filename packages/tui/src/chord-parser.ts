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

export interface ChordBinding {
	action: string;
	sequence: KeyId[];
}

export type BindingsInput = Record<string, string | string[]>;

export type ParseBindingsResult = { ok: true; bindings: ChordBinding[] } | { ok: false; error: BindingParseError };

/**
 * Parse a map of action → binding string(s) into a flat list of ChordBinding.
 * Array values expand into multiple ChordBindings for the same action.
 * Stops at the first parse error.
 */
export function parseBindings(input: BindingsInput): ParseBindingsResult {
	const bindings: ChordBinding[] = [];
	for (const [action, value] of Object.entries(input)) {
		const list = Array.isArray(value) ? value : [value];
		for (const str of list) {
			const parsed = parseBinding(str);
			if (!parsed.ok) return parsed;
			bindings.push({ action, sequence: parsed.sequence });
		}
	}
	return { ok: true, bindings };
}
