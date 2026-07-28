/**
 * Shell-aware tokenizer for bash command strings.
 *
 * Two subsystems used to scan raw command text with regexes and got argument *data* wrong in
 * opposite directions: internal-URL expansion rewrote `xcsh://` tokens sitting inside quoted
 * strings (#2468), and the sandbox read-boundary check reported `sed` regex addresses as
 * filesystem paths (#2470). Both need to know where a shell *word* starts and ends.
 *
 * This module answers only that question. It deliberately does NOT decide anything:
 *
 * - #2468 uses `text` plus `start`/`end` to tell "this whole word is the URL" from "the URL is
 *   mentioned inside this word", and to splice a replacement over the exact source span.
 * - #2470 uses `name` and `operandStart` to *locate* a script operand it may exempt, and to
 *   report a real word instead of a fragment like `` /a/p'; ``. The sandbox's safety still rests
 *   on its own coverage floor, never on this lexer being complete — see
 *   `sandbox/command-operands.ts`.
 *
 * Scope: enough POSIX shell to describe the commands an agent actually writes. Heredoc bodies are
 * consumed as data and never re-lexed, which is shell-correct but means a `bash <<EOF` body is
 * invisible here; that is exactly why the sandbox keeps a floor rather than trusting these words.
 */

/** How a word was quoted. `mixed` when built from differently-quoted segments, as in `a"b"'c'`. */
export type QuoteKind = "none" | "single" | "double" | "ansi-c" | "mixed";

/** What the shell will do with a redirect target. `<>` opens the file for both. */
export type RedirectDirection = "read" | "write" | "read-write";

export interface ShellWord {
	/** Literal text after quote removal and backslash processing. */
	text: string;
	/** Offset of the word's first character — its opening quote, if any — in the raw input. */
	start: number;
	/** Offset one past the word's last character, so `src.slice(start, end)` is the whole word. */
	end: number;
	quote: QuoteKind;
	/**
	 * False when the word contains an unquoted construct that makes `text` an unreliable stand-in
	 * for one filesystem reference: `$VAR`, `$(…)`, backticks, globs, or brace expansion. Callers
	 * must not treat a non-literal word as a resolvable path or a whole-word URL.
	 */
	literal: boolean;
	/**
	 * Set when this word is the target of a redirection, with the direction of that redirect.
	 * `read-write` is `<>`, which opens the one file for both.
	 */
	redirect: RedirectDirection | undefined;
}

export type ShellOperator = "|" | "||" | "&&" | ";" | "&" | "\n";

export interface ShellSimpleCommand {
	/** Words in source order, including the command name and any redirect targets. */
	words: ShellWord[];
	/**
	 * The program actually invoked: the basename of the first non-assignment word, after unwrapping
	 * `env`/`command`/`sudo`/`nohup`/`time`/`exec`. Undefined when the command is empty or starts
	 * with a non-literal word such as `$TOOL`.
	 */
	name: string | undefined;
	/** Index into `words` of the first operand — past assignment prefixes and the command name. */
	operandStart: number;
	/** The operator that ended this command; undefined at end of input. */
	terminator: ShellOperator | undefined;
	/** 0 at top level; greater inside `$(…)`, backticks, `(…)`, or `{ …; }`. */
	depth: number;
}

export interface ShellLexResult {
	/** Every simple command, including nested ones, each nested run following its enclosing command. */
	commands: ShellSimpleCommand[];
	/** Every word across every command, in the same order. */
	words: ShellWord[];
	/**
	 * True when input ended inside a quote, an escape, or a substitution. Callers must fail closed:
	 * the sandbox applies no exemptions, and URL expansion refuses to rewrite anything.
	 */
	unterminated: boolean;
}

/** Commands that prefix another command rather than being one; unwrapped when resolving `name`. */
const WRAPPERS = new Set(["env", "command", "sudo", "doas", "nohup", "time", "exec", "stdbuf"]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

interface HeredocSpec {
	delimiter: string;
	stripTabs: boolean;
}

interface Lexer {
	src: string;
	pos: number;
	unterminated: boolean;
	commands: ShellSimpleCommand[];
	words: ShellWord[];
	pendingHeredocs: HeredocSpec[];
}

/** Tokenize a bash command string into simple commands and words. Never throws. */
export function lexShellCommand(command: string): ShellLexResult {
	const lexer: Lexer = {
		src: command,
		pos: 0,
		unterminated: false,
		commands: [],
		words: [],
		pendingHeredocs: [],
	};
	lexRegion(lexer, command.length, 0);
	return { commands: lexer.commands, words: lexer.words, unterminated: lexer.unterminated };
}

/**
 * Lex `[lexer.pos, end)` as a sequence of simple commands at `depth`.
 *
 * Nested regions found inside a word are lexed after the enclosing command is pushed, so
 * `cat $(echo x)` yields `cat` then `echo` rather than the reverse.
 */
function lexRegion(lexer: Lexer, end: number, depth: number): void {
	let words: ShellWord[] = [];
	let nested: Array<{ start: number; end: number }> = [];

	const flush = (terminator: ShellOperator | undefined): void => {
		if (words.length > 0) {
			lexer.commands.push(makeCommand(words, terminator, depth));
		}
		const pending = nested;
		words = [];
		nested = [];
		for (const region of pending) {
			const saved = lexer.pos;
			lexer.pos = region.start;
			lexRegion(lexer, region.end, depth + 1);
			lexer.pos = saved;
		}
	};

	while (lexer.pos < end) {
		const ch = lexer.src[lexer.pos];

		if (ch === " " || ch === "\t" || ch === "\r") {
			lexer.pos++;
			continue;
		}

		// Bash starts a comment wherever `#` begins a word, not only before the first word of a
		// command. The loop only reaches here at a word boundary, so this is that condition.
		if (ch === "#") {
			while (lexer.pos < end && lexer.src[lexer.pos] !== "\n") lexer.pos++;
			continue;
		}

		const operator = readOperator(lexer);
		if (operator !== undefined) {
			if (operator === "\n" && lexer.pendingHeredocs.length > 0) {
				consumeHeredocBodies(lexer, end);
			}
			flush(operator);
			continue;
		}

		// A subshell or brace group starts a nested region rather than contributing a word.
		if (ch === "(" || (ch === "{" && isGroupBrace(lexer, end))) {
			const closer = ch === "(" ? ")" : "}";
			const regionStart = lexer.pos + 1;
			const regionEnd = findCloser(lexer, regionStart, end, closer);
			if (regionEnd === undefined) {
				lexer.unterminated = true;
				lexer.pos = end;
				break;
			}
			nested.push({ start: regionStart, end: regionEnd });
			lexer.pos = regionEnd + 1;
			continue;
		}

		const redirect = readRedirect(lexer, end);
		if (redirect !== undefined) {
			if (redirect.kind === "fd-dup") continue;
			if (redirect.kind === "heredoc") {
				const delimiter = readWord(lexer, end, nested);
				if (delimiter) {
					lexer.pendingHeredocs.push({ delimiter: delimiter.text, stripTabs: redirect.stripTabs });
				}
				continue;
			}
			const target = readWord(lexer, end, nested);
			if (target) {
				words.push({ ...target, redirect: redirect.direction });
				lexer.words.push(words[words.length - 1]);
			}
			continue;
		}

		const word = readWord(lexer, end, nested);
		if (!word) {
			lexer.pos++;
			continue;
		}
		words.push(word);
		lexer.words.push(word);
	}

	flush(undefined);
}

/** True when `{` opens a brace group (`{ cmd; }`) rather than starting a word. */
function isGroupBrace(lexer: Lexer, end: number): boolean {
	const next = lexer.pos + 1;
	if (next >= end) return false;
	const ch = lexer.src[next];
	return ch === " " || ch === "\t" || ch === "\n";
}

function readOperator(lexer: Lexer): ShellOperator | undefined {
	const { src, pos } = lexer;
	const two = src.slice(pos, pos + 2);

	if (two === "&&") {
		lexer.pos += 2;
		return "&&";
	}
	if (two === "||") {
		lexer.pos += 2;
		return "||";
	}
	// `&>` and `&>>` are redirections, not the background operator.
	if (two === "&>") return undefined;
	if (src[pos] === "&") {
		lexer.pos++;
		return "&";
	}
	if (src[pos] === "|") {
		lexer.pos++;
		return "|";
	}
	if (two === ";;") {
		lexer.pos += 2;
		return ";";
	}
	if (src[pos] === ";") {
		lexer.pos++;
		return ";";
	}
	if (src[pos] === "\n") {
		lexer.pos++;
		return "\n";
	}
	return undefined;
}

type RedirectToken =
	| { kind: "file"; direction: RedirectDirection }
	| { kind: "fd-dup" }
	| { kind: "heredoc"; stripTabs: boolean };

/**
 * Consume a redirection operator at the current position, if there is one.
 *
 * Recognizing these is required for correctness rather than completeness: without it `2>&1` parses
 * `&` as the background operator and `1` as a whole new command.
 */
function readRedirect(lexer: Lexer, end: number): RedirectToken | undefined {
	const { src } = lexer;
	let cursor = lexer.pos;

	// An optional file-descriptor prefix only counts when a redirect operator follows immediately.
	while (cursor < end && src[cursor] >= "0" && src[cursor] <= "9") cursor++;
	const ch = src[cursor];
	if (ch !== "<" && ch !== ">" && ch !== "&") return undefined;
	if (ch === "&" && src[cursor + 1] !== ">") return undefined;

	if (src.startsWith("&>>", cursor)) {
		lexer.pos = cursor + 3;
		return { kind: "file", direction: "write" };
	}
	if (src.startsWith("&>", cursor)) {
		lexer.pos = cursor + 2;
		return { kind: "file", direction: "write" };
	}
	if (src.startsWith("<<<", cursor)) {
		// A here-string supplies literal text, not a filename, but treating it as a redirect target
		// keeps it out of the exemptible-operand set.
		lexer.pos = cursor + 3;
		return { kind: "file", direction: "read" };
	}
	if (src.startsWith("<<-", cursor)) {
		lexer.pos = cursor + 3;
		return { kind: "heredoc", stripTabs: true };
	}
	if (src.startsWith("<<", cursor)) {
		lexer.pos = cursor + 2;
		return { kind: "heredoc", stripTabs: false };
	}
	// `<>` opens one file for reading and writing; reported as `<` alone the write would be invisible.
	if (src.startsWith("<>", cursor)) {
		lexer.pos = cursor + 2;
		return { kind: "file", direction: "read-write" };
	}
	if (src.startsWith(">&", cursor) || src.startsWith("<&", cursor)) {
		lexer.pos = cursor + 2;
		while (lexer.pos < end && (isDigit(src[lexer.pos]) || src[lexer.pos] === "-")) lexer.pos++;
		return { kind: "fd-dup" };
	}
	if (src.startsWith(">>", cursor)) {
		lexer.pos = cursor + 2;
		return { kind: "file", direction: "write" };
	}
	// `>|` overrides noclobber. Without this the `|` reads as a pipe and the filename after it
	// becomes the next command's name, so the write target is lost.
	if (src.startsWith(">|", cursor)) {
		lexer.pos = cursor + 2;
		return { kind: "file", direction: "write" };
	}
	if (ch === ">") {
		lexer.pos = cursor + 1;
		return { kind: "file", direction: "write" };
	}
	lexer.pos = cursor + 1;
	return { kind: "file", direction: "read" };
}

function isDigit(ch: string | undefined): boolean {
	return ch !== undefined && ch >= "0" && ch <= "9";
}

/** Skip heredoc bodies queued on the current line, up to and including each terminator line. */
function consumeHeredocBodies(lexer: Lexer, end: number): void {
	for (const spec of lexer.pendingHeredocs) {
		let terminated = false;
		while (lexer.pos < end) {
			let lineEnd = lexer.src.indexOf("\n", lexer.pos);
			if (lineEnd === -1 || lineEnd > end) lineEnd = end;
			const line = lexer.src.slice(lexer.pos, lineEnd);
			lexer.pos = lineEnd < end ? lineEnd + 1 : end;
			if ((spec.stripTabs ? line.replace(/^\t+/, "") : line).trimEnd() === spec.delimiter) {
				terminated = true;
				break;
			}
		}
		if (!terminated) lexer.unterminated = true;
	}
	lexer.pendingHeredocs = [];
}

/**
 * Find the offset of the closer that balances a region starting at `from`, skipping over quotes and
 * nested openers. Returns undefined when the region never closes.
 */
function findCloser(lexer: Lexer, from: number, end: number, closer: string): number | undefined {
	const { src } = lexer;
	const opener = closer === ")" ? "(" : "{";
	let depth = 0;
	let cursor = from;
	while (cursor < end) {
		const ch = src[cursor];
		if (ch === "\\") {
			cursor += 2;
			continue;
		}
		if (ch === "'") {
			const close = src.indexOf("'", cursor + 1);
			if (close === -1 || close >= end) return undefined;
			cursor = close + 1;
			continue;
		}
		if (ch === '"') {
			cursor = skipDoubleQuoted(src, cursor + 1, end);
			if (cursor > end) return undefined;
			continue;
		}
		if (ch === opener) depth++;
		else if (ch === closer) {
			if (depth === 0) return cursor;
			depth--;
		}
		cursor++;
	}
	return undefined;
}

/** Advance past a double-quoted run that started at `from`; returns `end + 1` when unterminated. */
function skipDoubleQuoted(src: string, from: number, end: number): number {
	let cursor = from;
	while (cursor < end) {
		const ch = src[cursor];
		if (ch === "\\") {
			cursor += 2;
			continue;
		}
		if (ch === '"') return cursor + 1;
		cursor++;
	}
	return end + 1;
}

/**
 * Read one word starting at the current position, concatenating adjacent quoted and bare segments.
 * Nested substitution regions are appended to `nested` for the caller to lex afterwards.
 */
function readWord(lexer: Lexer, end: number, nested: Array<{ start: number; end: number }>): ShellWord | undefined {
	while (lexer.pos < end && (lexer.src[lexer.pos] === " " || lexer.src[lexer.pos] === "\t")) lexer.pos++;
	if (lexer.pos >= end) return undefined;

	const { src } = lexer;
	const start = lexer.pos;
	const kinds = new Set<QuoteKind>();
	let text = "";
	let literal = true;

	while (lexer.pos < end) {
		const ch = src[lexer.pos];

		if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") break;
		// Operators and redirections end a word wherever they appear.
		if (ch === "|" || ch === "&" || ch === ";" || ch === "(" || ch === ")" || ch === "<" || ch === ">") break;

		if (ch === "\\") {
			if (lexer.pos + 1 >= end) {
				lexer.unterminated = true;
				lexer.pos = end;
				break;
			}
			const escaped = src[lexer.pos + 1];
			// A backslash-newline is a line continuation: both characters vanish.
			if (escaped !== "\n") {
				text += escaped;
				kinds.add("none");
			}
			lexer.pos += 2;
			continue;
		}

		if (ch === "'") {
			const close = src.indexOf("'", lexer.pos + 1);
			if (close === -1 || close >= end) {
				lexer.unterminated = true;
				lexer.pos = end;
				break;
			}
			text += src.slice(lexer.pos + 1, close);
			kinds.add("single");
			lexer.pos = close + 1;
			continue;
		}

		if (ch === '"') {
			const segment = readDoubleQuoted(lexer, end, nested);
			if (segment === undefined) break;
			text += segment.text;
			if (!segment.literal) literal = false;
			kinds.add("double");
			continue;
		}

		if (ch === "$" && src[lexer.pos + 1] === "'") {
			const close = findAnsiCClose(src, lexer.pos + 2, end);
			if (close === undefined) {
				lexer.unterminated = true;
				lexer.pos = end;
				break;
			}
			text += decodeAnsiC(src.slice(lexer.pos + 2, close));
			kinds.add("ansi-c");
			lexer.pos = close + 1;
			continue;
		}

		if (ch === "$" && src[lexer.pos + 1] === "(") {
			const regionStart = lexer.pos + 2;
			const regionEnd = findCloser(lexer, regionStart, end, ")");
			if (regionEnd === undefined) {
				lexer.unterminated = true;
				lexer.pos = end;
				break;
			}
			nested.push({ start: regionStart, end: regionEnd });
			text += src.slice(lexer.pos, regionEnd + 1);
			literal = false;
			kinds.add("none");
			lexer.pos = regionEnd + 1;
			continue;
		}

		if (ch === "`") {
			const close = src.indexOf("`", lexer.pos + 1);
			if (close === -1 || close >= end) {
				lexer.unterminated = true;
				lexer.pos = end;
				break;
			}
			nested.push({ start: lexer.pos + 1, end: close });
			text += src.slice(lexer.pos, close + 1);
			literal = false;
			kinds.add("none");
			lexer.pos = close + 1;
			continue;
		}

		if (ch === "$" || ch === "*" || ch === "?" || ch === "[" || ch === "{") {
			literal = false;
		}
		text += ch;
		kinds.add("none");
		lexer.pos++;
	}

	if (lexer.pos === start) return undefined;
	return { text, start, end: lexer.pos, quote: resolveQuoteKind(kinds), literal, redirect: undefined };
}

/** Read a double-quoted segment, honouring the escapes bash recognizes inside double quotes. */
function readDoubleQuoted(
	lexer: Lexer,
	end: number,
	nested: Array<{ start: number; end: number }>,
): { text: string; literal: boolean } | undefined {
	const { src } = lexer;
	let cursor = lexer.pos + 1;
	let text = "";
	let literal = true;

	while (cursor < end) {
		const ch = src[cursor];
		if (ch === "\\") {
			const escaped = src[cursor + 1];
			if (escaped === undefined) break;
			// Inside double quotes a backslash only escapes these; otherwise it stays literal.
			if (escaped === '"' || escaped === "\\" || escaped === "$" || escaped === "`") {
				text += escaped;
			} else if (escaped === "\n") {
				// Line continuation.
			} else {
				text += ch + escaped;
			}
			cursor += 2;
			continue;
		}
		if (ch === '"') {
			lexer.pos = cursor + 1;
			return { text, literal };
		}
		if (ch === "$" && src[cursor + 1] === "(") {
			const regionStart = cursor + 2;
			const regionEnd = findCloser(lexer, regionStart, end, ")");
			if (regionEnd === undefined) break;
			nested.push({ start: regionStart, end: regionEnd });
			text += src.slice(cursor, regionEnd + 1);
			literal = false;
			cursor = regionEnd + 1;
			continue;
		}
		if (ch === "`") {
			const close = src.indexOf("`", cursor + 1);
			if (close === -1 || close >= end) break;
			nested.push({ start: cursor + 1, end: close });
			text += src.slice(cursor, close + 1);
			literal = false;
			cursor = close + 1;
			continue;
		}
		if (ch === "$") literal = false;
		text += ch;
		cursor++;
	}

	lexer.unterminated = true;
	lexer.pos = end;
	return undefined;
}

function findAnsiCClose(src: string, from: number, end: number): number | undefined {
	let cursor = from;
	while (cursor < end) {
		if (src[cursor] === "\\") {
			cursor += 2;
			continue;
		}
		if (src[cursor] === "'") return cursor;
		cursor++;
	}
	return undefined;
}

const ANSI_C_ESCAPES: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	a: "\x07",
	b: "\b",
	f: "\f",
	v: "\v",
	"\\": "\\",
	"'": "'",
	'"': '"',
	e: "\x1b",
	"0": "\0",
};

function decodeAnsiC(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] !== "\\") {
			out += raw[i];
			continue;
		}
		const next = raw[i + 1];
		if (next === undefined) {
			out += "\\";
			break;
		}
		if (next === "x") {
			const hex = /^[0-9a-fA-F]{1,2}/.exec(raw.slice(i + 2));
			if (hex) {
				out += String.fromCharCode(Number.parseInt(hex[0], 16));
				i += 1 + hex[0].length;
				continue;
			}
		}
		const mapped = ANSI_C_ESCAPES[next];
		out += mapped ?? next;
		i++;
	}
	return out;
}

function resolveQuoteKind(kinds: Set<QuoteKind>): QuoteKind {
	if (kinds.size === 0) return "none";
	// A single style covers the whole word; anything else is a concatenation, including bare text
	// joined to one quoted run (`a"b"`), which is why "mixed" is not limited to two quote styles.
	return kinds.size === 1 ? [...kinds][0] : "mixed";
}

/** Resolve the invoked program and the first operand index for one simple command. */
function makeCommand(words: ShellWord[], terminator: ShellOperator | undefined, depth: number): ShellSimpleCommand {
	let index = 0;
	// Assignment prefixes and redirect targets precede the command name without being it.
	while (index < words.length && (ASSIGNMENT.test(words[index].text) || words[index].redirect !== undefined)) {
		index++;
	}

	let name: string | undefined;
	while (index < words.length) {
		const candidate = words[index];
		if (!candidate.literal) {
			// `$TOOL foo` — the program is unknowable, so claim nothing.
			return { words, name: undefined, operandStart: index + 1, terminator, depth };
		}
		const base = basename(candidate.text);
		if (!WRAPPERS.has(base)) {
			name = base;
			index++;
			break;
		}
		// Step past the wrapper, plus any of its options and assignment arguments.
		index++;
		while (index < words.length && (words[index].text.startsWith("-") || ASSIGNMENT.test(words[index].text))) {
			index++;
		}
	}

	return { words, name, operandStart: index, terminator, depth };
}

function basename(value: string): string {
	const slash = value.lastIndexOf("/");
	return slash === -1 ? value : value.slice(slash + 1);
}
