import { visibleWidth } from "@f5-sales-demo/pi-tui";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function quote(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
	// Escape control characters as Bash/Zsh literals, so viewport rows never alter argv.
	return (
		value
			.split(/([\x01-\x1f\x7f])/)
			.filter(Boolean)
			.map(part =>
				/^[\x01-\x1f\x7f]$/.test(part)
					? `$'\\x${part.charCodeAt(0).toString(16).padStart(2, "0")}'`
					: `'${part.replaceAll("'", "'\\''")}'`,
			)
			.join("") || "''"
	);
}

/** Shell continuations between arguments, adjacent quoted chunks within an argument. */
export function copyableCommand(argv: readonly string[], width: number): string[] {
	const available = Math.max(8, Math.floor(width));
	const lines: string[] = [];
	let line = "";
	const flush = (betweenArguments: boolean) => {
		lines.push(line + (betweenArguments ? " \\" : "\\"));
		line = "";
	};
	for (const [index, arg] of argv.entries()) {
		const last = index === argv.length - 1;
		const encoded = quote(arg);
		const prefix = line ? " " : "";
		if (visibleWidth(line + prefix + encoded) <= available - (last ? 0 : 2)) {
			line += prefix + encoded;
			continue;
		}
		if (line) flush(true);
		if (visibleWidth(encoded) <= available - (last ? 0 : 2)) {
			line = encoded;
			continue;
		}
		// Segment only oversized arguments. Never insert whitespace between their chunks.
		let chunk = "";
		for (const { segment } of segmenter.segment(arg)) {
			if (chunk && visibleWidth(quote(chunk + segment)) > available - 2) {
				line = quote(chunk);
				flush(false);
				chunk = "";
			}
			chunk += segment;
		}
		line = quote(chunk);
	}
	if (line) lines.push(line);
	return lines;
}
