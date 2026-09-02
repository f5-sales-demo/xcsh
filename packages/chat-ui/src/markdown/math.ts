import type { TokenizerAndRendererExtension, Tokens } from "marked";
import temml, { type Options as TemmlOptions } from "temml";

export interface MathToken extends Tokens.Generic {
	type: "math" | "mathBlock";
	text: string;
	pending?: boolean;
}

export const TEMML_OPTIONS: Readonly<TemmlOptions> = Object.freeze({
	throwOnError: true,
	trust: false,
	strict: true,
	maxExpand: 200,
	maxSize: [10, 72] as [number, number],
});

function escapeHtml(source: string): string {
	return source
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function isEscaped(source: string, index: number): boolean {
	let backslashes = 0;
	for (let position = index - 1; position >= 0 && source[position] === "\\"; position--) {
		backslashes++;
	}
	return backslashes % 2 === 1;
}

function findClosingDelimiter(source: string, closing: string, start: number): number {
	let index = source.indexOf(closing, start);
	while (index >= 0 && isEscaped(source, index)) {
		index = source.indexOf(closing, index + closing.length);
	}
	return index;
}

function looksLikePendingDollarMath(source: string): boolean {
	return /\\[A-Za-z]+|[_^=+*/<>()[\]|±≤≥≠≈∈→⇒∞∫∑√-]/.test(source);
}

function startsWithLiteralDollarToken(source: string): boolean {
	const match = /^\$(?:\d+(?:[.,]\d+)?|[A-Z_][A-Z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})/.exec(source);
	if (match === null) return false;
	const remainder = source.slice(match[0].length);
	return !remainder.startsWith("$") && !/^\s*[=+*<>[\]|^]/.test(remainder);
}

function tokenizeInlineMath(source: string): MathToken | undefined {
	let opening = "";
	let closing = "";
	if (source.startsWith("$$")) {
		opening = "$$";
		closing = "$$";
	} else if (source.startsWith("\\(")) {
		opening = "\\(";
		closing = "\\)";
	} else if (source.startsWith("\\[")) {
		opening = "\\[";
		closing = "\\]";
	} else if (source.startsWith("$") && !/^\$\s/.test(source) && !startsWithLiteralDollarToken(source)) {
		opening = "$";
		closing = "$";
	} else {
		return undefined;
	}

	const closingIndex = findClosingDelimiter(source, closing, opening.length);
	if (
		closingIndex >= 0 &&
		opening === "$" &&
		(/\s$/.test(source.slice(opening.length, closingIndex)) ||
			/^\d/.test(source.slice(closingIndex + 1)) ||
			(/^[A-Z_][A-Z0-9_]*(?:[^A-Za-z0-9_\s])?$/.test(source.slice(opening.length, closingIndex)) &&
				/^[A-Za-z_][A-Za-z0-9_]*/.test(source.slice(closingIndex + 1))) ||
			source.slice(opening.length, closingIndex).includes(String.fromCharCode(96)))
	) {
		return undefined;
	}

	if (closingIndex < 0) {
		const pendingSource = source.slice(opening.length);
		if (opening.startsWith("\\") || looksLikePendingDollarMath(pendingSource)) {
			return { type: "math", raw: source, text: pendingSource, pending: true };
		}
		return undefined;
	}

	const text = source.slice(opening.length, closingIndex);
	if (!text || text.includes("\n")) {
		return undefined;
	}
	return {
		type: "math",
		raw: source.slice(0, closingIndex + closing.length),
		text,
	};
}

function tokenizeBlockMath(source: string): MathToken | undefined {
	const dollarMatch = /^ {0,3}\$\$[ \t]*(?:\n)?([\s\S]*?)\$\$[ \t]*(?:\n|$)/.exec(source);
	if (dollarMatch?.[1]) {
		return { type: "mathBlock", raw: dollarMatch[0], text: dollarMatch[1].trim() };
	}
	const bracketMatch = /^ {0,3}\\\[[ \t]*(?:\n)?([\s\S]*?)\\\][ \t]*(?:\n|$)/.exec(source);
	if (bracketMatch?.[1]) {
		return { type: "mathBlock", raw: bracketMatch[0], text: bracketMatch[1].trim() };
	}
	const pendingBracket = /^ {0,3}\\\[[ \t]*(?:\n)?([\s\S]*)$/.exec(source);
	if (pendingBracket) {
		return { type: "mathBlock", raw: pendingBracket[0], text: pendingBracket[1], pending: true };
	}
	const pendingDollar = /^ {0,3}\$\$[ \t]*(?:\n)?([\s\S]*)$/.exec(source);
	if (pendingDollar?.[1] && looksLikePendingDollarMath(pendingDollar[1])) {
		return { type: "mathBlock", raw: pendingDollar[0], text: pendingDollar[1], pending: true };
	}
	return undefined;
}

export function renderMath(source: string, displayMode = false): string | undefined {
	try {
		return temml.renderToString(source, { ...TEMML_OPTIONS, displayMode });
	} catch {
		return undefined;
	}
}

function renderToken(token: MathToken): string {
	if (!token.pending) {
		const rendered = renderMath(token.text, token.type === "mathBlock");
		if (rendered !== undefined) return rendered;
	}
	const raw = token.raw.endsWith("\n") ? token.raw.slice(0, -1) : token.raw;
	const escaped = escapeHtml(raw);
	return token.type === "mathBlock" ? `<pre><code>${escaped}</code></pre>` : escaped;
}

export function createMathExtensions(): TokenizerAndRendererExtension[] {
	return [
		{
			name: "mathBlock",
			level: "block",
			start(source) {
				const match = /(?:^|\n) {0,3}(?:\$\$|\\\[)/.exec(source);
				return match ? match.index + (match[0].startsWith("\n") ? 1 : 0) : undefined;
			},
			tokenizer: tokenizeBlockMath,
			renderer(token) {
				return renderToken(token as MathToken);
			},
		},
		{
			name: "math",
			level: "inline",
			start(source) {
				const indices = [source.indexOf("$"), source.indexOf("\\("), source.indexOf("\\[")].filter(
					index => index >= 0,
				);
				return indices.length > 0 ? Math.min(...indices) : undefined;
			},
			tokenizer: tokenizeInlineMath,
			renderer(token) {
				return renderToken(token as MathToken);
			},
		},
	];
}
