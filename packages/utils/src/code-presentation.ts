/** Browser-safe display policy. Source is immutable; decorations never become code. */
import { isCollection, isPair, isScalar, parseAllDocuments } from "yaml";

const ALIASES: Record<string, string> = {
	yml: "yaml",
	tf: "hcl",
	tfvars: "hcl",
	terraform: "hcl",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	py: "python",
	js: "javascript",
	ts: "typescript",
	cplusplus: "cpp",
};

export function normalizeCodeLanguage(info?: string): string {
	const first = (info ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
	return /^[a-z0-9+#._-]{1,20}$/.test(first) ? (ALIASES[first] ?? first) : "";
}

/** Offsets are UTF-16 indices. A formatted YAML document maps as a whole document. */
export interface CodeMapping {
	sourceStart: number;
	sourceEnd: number;
	displayStart: number;
	displayEnd: number;
}
export interface CodePresentation {
	source: string;
	display: string;
	language: string;
	formatted: boolean;
	mapping: CodeMapping[];
}

export function isCodeBlockComplete(raw: string, indented = false): boolean {
	if (indented) return true;
	const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(raw);
	if (!opening) return true;
	const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
	return raw
		.slice(opening[0].length)
		.split("\n")
		.some(line => closing.test(line));
}

/** Validate JSON grammar while emitting the original lexical tokens, never JS values. */
function formatJson(source: string): { display: string; mapping: CodeMapping[] } {
	let position = 0;
	let display = "";
	const mapping: CodeMapping[] = [];
	const whitespace = () => {
		while (/[ \t\r\n]/.test(source[position] ?? "") && position < source.length) position++;
	};
	const emit = (start: number, end: number) => {
		mapping.push({
			sourceStart: start,
			sourceEnd: end,
			displayStart: display.length,
			displayEnd: display.length + end - start,
		});
		display += source.slice(start, end);
	};
	const punctuation = (expected: string) => {
		whitespace();
		if (source[position] !== expected) throw new Error("Incomplete JSON");
		emit(position, ++position);
	};
	const string = () => {
		whitespace();
		const match = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"/.exec(source.slice(position));
		if (!match) throw new Error("Invalid JSON string");
		const start = position;
		position += match[0].length;
		emit(start, position);
	};
	const newline = (depth: number) => {
		display += `\n${"  ".repeat(depth)}`;
	};
	const value = (depth: number): void => {
		if (depth > 200) throw new Error("JSON nesting limit");
		whitespace();
		const char = source[position];
		if (char === "{") {
			punctuation("{");
			whitespace();
			if (source[position] !== "}") {
				while (true) {
					newline(depth + 1);
					string();
					punctuation(":");
					display += " ";
					value(depth + 1);
					whitespace();
					if (source[position] !== ",") break;
					punctuation(",");
				}
				newline(depth);
			}
			punctuation("}");
		} else if (char === "[") {
			punctuation("[");
			whitespace();
			if (source[position] !== "]") {
				while (true) {
					newline(depth + 1);
					value(depth + 1);
					whitespace();
					if (source[position] !== ",") break;
					punctuation(",");
				}
				newline(depth);
			}
			punctuation("]");
		} else if (char === '"') string();
		else {
			const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(position));
			if (!match) throw new Error("Invalid JSON value");
			const start = position;
			position += match[0].length;
			emit(start, position);
		}
	};
	value(0);
	whitespace();
	if (position !== source.length) throw new Error("Trailing JSON content");
	return { display, mapping };
}

/** Preserve node types, order, metadata and lexical scalar values across YAML formatting. */
function yamlSignature(node: unknown): unknown {
	if (isPair(node)) return [yamlSignature(node.key), yamlSignature(node.value)];
	if (isScalar(node))
		return [
			"scalar",
			typeof node.value,
			String(node.value),
			node.source,
			node.tag,
			node.anchor,
			node.comment,
			node.commentBefore,
		];
	if (isCollection(node))
		return [
			node.constructor.name,
			node.tag,
			node.anchor,
			node.comment,
			node.commentBefore,
			node.items.map(yamlSignature),
		];
	if (node && typeof node === "object") {
		const alias = node as { source?: string; comment?: string; commentBefore?: string };
		return ["alias", alias.source, alias.comment, alias.commentBefore];
	}
	return node;
}

function formatYaml(source: string): string {
	const options = { keepSourceTokens: true, intAsBigInt: true };
	const docs = parseAllDocuments(source, options);
	if (!docs.length || docs.some(doc => doc.errors.length || doc.warnings.length)) return source;
	const signature = (documents: typeof docs) =>
		JSON.stringify(
			documents.map(doc => [doc.directives, doc.commentBefore, doc.comment, yamlSignature(doc.contents)]),
		);
	const before = signature(docs);
	const block = (node: unknown): void => {
		if (isPair(node)) {
			block(node.key);
			block(node.value);
		} else if (isCollection(node)) {
			node.flow = false;
			node.items.forEach(block);
		}
	};
	for (const doc of docs) block(doc.contents);
	const display = docs.map(doc => doc.toString({ indent: 2, lineWidth: 0 })).join("");
	const check = parseAllDocuments(display, options);
	return check.every(doc => !doc.errors.length && !doc.warnings.length) && signature(check) === before
		? display.replace(/\n$/, "")
		: source;
}

export function presentCode(source: string, info?: string, complete = true): CodePresentation {
	const language = normalizeCodeLanguage(info);
	let display = source;
	let mapping: CodeMapping[] = [];
	try {
		if (complete && language === "json") ({ display, mapping } = formatJson(source));
		else if (complete && language === "yaml") display = formatYaml(source);
	} catch {
		/* Invalid/incomplete/unsupported content always remains readable source. */
	}
	if (!mapping.length)
		mapping = [{ sourceStart: 0, sourceEnd: source.length, displayStart: 0, displayEnd: display.length }];
	return { source, display, language, formatted: display !== source, mapping };
}

export interface CodeSegment {
	start: number;
	end: number;
	continuation: boolean;
}

/** HTTP examples may omit a protocol version and use documented path placeholders. */
export function mapHttpCode(
	source: string,
	render: (text: string, category?: "keyword" | "string" | "number" | "variable" | "punctuation") => string,
	body: (text: string, language: string) => string,
): string {
	const separator = /\r?\n[ \t]*\r?\n/.exec(source);
	const headers = separator ? source.slice(0, separator.index) : source;
	let bodyLanguage = "";
	let result = "";
	for (const line of headers.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
		const ending = /\r?\n$/.exec(line)?.[0] ?? "";
		const content = line.slice(0, line.length - ending.length);
		const request =
			/^([ \t]*)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)([ \t]+)(\S+)(?:([ \t]+)(HTTP\/\d(?:\.\d)?))?([ \t]*)$/.exec(
				content,
			);
		const status = /^([ \t]*)(HTTP\/\d(?:\.\d)?)([ \t]+)(\d{3})(.*)$/.exec(content);
		const header = /^([ \t]*)([\w-]+)(:)(.*)$/.exec(content);
		if (request)
			result +=
				render(request[1]) +
				render(request[2], "keyword") +
				render(request[3]) +
				render(request[4], "string") +
				render(request[5] ?? "") +
				render(request[6] ?? "", "keyword") +
				render(request[7]);
		else if (status)
			result +=
				render(status[1]) +
				render(status[2], "keyword") +
				render(status[3]) +
				render(status[4], "number") +
				render(status[5], "string");
		else if (header) {
			if (/^content-type$/i.test(header[2])) {
				const mime = header[4].trim().split(";")[0].trim().toLowerCase();
				bodyLanguage = /^(?:application|text)\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mime)
					? "json"
					: /^(?:application|text)\/(?:(?:x-)?ya?ml|[a-z0-9!#$&^_.+-]+\+yaml)$/.test(mime)
						? "yaml"
						: "";
			}
			result +=
				render(header[1]) +
				render(header[2], "variable") +
				render(":", "punctuation") +
				render(header[4], "string");
		} else result += render(content);
		result += render(ending);
	}
	return separator
		? result + render(separator[0]) + body(source.slice(separator.index + separator[0].length), bodyLanguage)
		: result;
}

/** Prefer token boundaries outside quoted literals. A hard wrap is explicitly visual. */
export function wrapCodeLine(
	line: string,
	width: number,
	measure: (text: string) => number = text => [...text].length,
): CodeSegment[] {
	const boundaries = new Set<number>();
	let quote = "";
	let escaped = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = "";
		} else if (char === '"' || char === "'" || char === "`") quote = char;
		else if (/[\s,;{}[\]()=:+]/.test(char)) boundaries.add(i + 1);
	}
	const result: CodeSegment[] = [];
	let start = 0;
	while (start < line.length) {
		let end = start;
		let boundary = start;
		for (const char of line.slice(start)) {
			const next = end + char.length;
			if (measure(line.slice(start, next)) > Math.max(1, width)) break;
			end = next;
			if (boundaries.has(end)) boundary = end;
		}
		if (end === start) end = start + (line.codePointAt(start)! > 0xffff ? 2 : 1);
		if (end < line.length && boundary > start) end = boundary;
		result.push({ start, end, continuation: start > 0 });
		start = end;
	}
	return result.length ? result : [{ start: 0, end: 0, continuation: false }];
}
