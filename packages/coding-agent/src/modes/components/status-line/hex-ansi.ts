/**
 * Hex color → 24-bit truecolor ANSI escape sequences.
 *
 * Inputs are internal constants (from the context gradient), so invalid
 * input indicates a programming bug — we throw rather than return a
 * fallback color.
 */

export function hexToRgb(hex: string): readonly [number, number, number] {
	const stripped = hex.startsWith("#") ? hex.slice(1) : hex;
	if (stripped.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(stripped)) {
		throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
	}
	return [
		parseInt(stripped.substring(0, 2), 16),
		parseInt(stripped.substring(2, 4), 16),
		parseInt(stripped.substring(4, 6), 16),
	];
}

export function hexToFgAnsi(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m`;
}

export function hexToBgAnsi(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[48;2;${r};${g};${b}m`;
}
