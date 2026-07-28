/**
 * Pure evaluation of a tool call against a SandboxPolicy.
 *
 * Maps each path-taking tool to its path argument(s) and access mode, resolves the
 * path relative to the session cwd, and asks the policy whether it is allowed. Kept
 * free of settings/runtime so it is fully unit-testable; the bundled `sandbox-guard`
 * extension is a thin wrapper that supplies cwd, settings, and the policy.
 *
 * Search tools (`find`/`grep`/`ast_grep`/`ast_edit`) accept comma-/whitespace-delimited
 * multi-path inputs that the tools split (via `splitTopLevel`) and search from a common
 * base directory. We split the same way and policy-check EVERY token's base, so a
 * multi-path input cannot smuggle a sibling directory past the gate.
 *
 * Arbitrary-code tools (`bash`, `python`) cannot be fully contained in-process: this
 * checks the `cwd` argument precisely and scans the command/code for path tokens
 * (bare, quoted, `~`, `..`, absolute) that escape the tree. OS system paths are exempt.
 * This is best-effort; the opt-in OS-level sandbox (Phase 2) is the airtight enforcement
 * for both bash and python.
 */
import * as path from "node:path";
import { parseFindPattern, parseSearchPath, resolveToCwd, splitTopLevel } from "../tools/path-utils";
import { lexShellCommand } from "../tools/shell-lex";
import { provenExemptWords } from "./command-operands";
import type { SandboxAccess, SandboxPolicy } from "./policy";

export interface ToolCallCheck {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
	policy: SandboxPolicy;
}

export interface ToolCallDecision {
	block: boolean;
	reason?: string;
}

const ALLOW: ToolCallDecision = { block: false };

interface PathArgSpec {
	/** Candidate input keys, tried in order; first non-empty string wins. */
	keys: string[];
	access: SandboxAccess;
	/** Exempt OS system paths (for tools that legitimately execute system binaries). */
	systemExempt?: boolean;
}

/**
 * Tools that touch explicit path argument(s). Each tool lists one or more specs; every
 * present path is checked. Remote/in-memory path-looking args (xcsh_api HTTP paths,
 * ssh remote cwd) are intentionally absent.
 */
const TOOL_PATHS: Record<string, PathArgSpec[]> = {
	read: [{ keys: ["file_path", "path"], access: "read" }],
	write: [{ keys: ["file_path", "path"], access: "write" }],
	notebook: [{ keys: ["notebook_path"], access: "write" }],
	inspect_image: [{ keys: ["path"], access: "read" }],
	display_image: [{ keys: ["path"], access: "read" }],
	lsp: [{ keys: ["file"], access: "read" }], // read for most actions; rename-apply writes
	catalog_workflow_runner: [
		{ keys: ["catalog_path"], access: "read" },
		{ keys: ["screenshot_dir"], access: "write" },
	],
	// debug executes an arbitrary program and reads source files; system binaries are ok.
	debug: [
		{ keys: ["program"], access: "read", systemExempt: true },
		{ keys: ["file"], access: "read", systemExempt: true },
		{ keys: ["cwd"], access: "read", systemExempt: true },
	],
};

interface SearchSpec {
	/** Input key holding the (possibly multi-) path or glob list. */
	key: string;
	/** Extract the base directory of one token (matches the tool's own resolver). */
	base: (token: string) => string;
	access: SandboxAccess;
}

/** Tools that accept multi-path search inputs split from a common base directory. */
const SEARCH_TOOLS: Record<string, SearchSpec> = {
	find: { key: "pattern", base: token => parseFindPattern(token).basePath, access: "read" },
	grep: { key: "path", base: token => parseSearchPath(token).basePath, access: "read" },
	ast_grep: { key: "path", base: token => parseSearchPath(token).basePath, access: "read" },
	ast_edit: { key: "path", base: token => parseSearchPath(token).basePath, access: "write" },
};

/** Arbitrary-code tools whose command/code strings are scanned best-effort. */
const CODE_FIELDS: Record<string, string[]> = {
	bash: ["command"],
	python: ["code"],
};

/**
 * Standard OS directories a subprocess may legitimately read or traverse (interpreters,
 * libraries, device files) and which hold no customer data. Only the code-tool scan
 * treats these as benign; the file tools stay strictly confined to the policy. Notably
 * excludes /tmp, /var, /private, and home — those can hold per-session or per-user data.
 */
const SYSTEM_READ_ROOTS = [
	"/usr",
	"/bin",
	"/sbin",
	"/lib",
	"/lib64",
	"/opt",
	"/etc",
	"/dev",
	"/proc",
	"/sys",
	"/System",
	"/Library",
];

function isSystemPath(resolved: string): boolean {
	return SYSTEM_READ_ROOTS.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

/**
 * Character devices that discard output or route it back to the caller's own descriptors. Writing
 * to one stores nothing and reaches no file, so it cannot carry data across the boundary — and
 * `> /dev/null` is too common to refuse.
 *
 * An exact list, not a `/dev` prefix: `/dev` also holds raw block devices like `/dev/disk0`, where
 * a write is both an escape and a catastrophe.
 */
const SYSTEM_WRITE_SINKS = new Set([
	"/dev/null",
	"/dev/zero",
	"/dev/full",
	"/dev/tty",
	"/dev/stdin",
	"/dev/stdout",
	"/dev/stderr",
]);

function isSystemWriteSink(resolved: string): boolean {
	// /dev/fd/N is an already-open descriptor of this process, not a path it can newly reach.
	return SYSTEM_WRITE_SINKS.has(resolved) || resolved.startsWith("/dev/fd/");
}

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function deny(policy: SandboxPolicy, resolved: string, access: SandboxAccess): ToolCallDecision {
	return { block: true, reason: policy.describe(resolved, access) };
}

function looksLikePath(token: string): boolean {
	return path.isAbsolute(token) || token.startsWith("~") || /(^|[/\\])\.\.([/\\]|$)/.test(token);
}

/** A path-like token found by the floor, with where it was found. */
interface PathOccurrence {
	token: string;
	/** Offset of the token's first character — past any opening quote — in the scanned string. */
	at: number;
	/** Set when a redirection operator in the raw text says what the shell will do with it. */
	access?: SandboxAccess;
}

/**
 * What a redirection operator does to the operand that follows it. `skip` is a here-string or a
 * heredoc delimiter: that operand is literal data the shell never opens — verified against bash,
 * where `cat <<</tmp/f` prints the string `/tmp/f` rather than the contents of that file.
 */
function operandAccess(operator: string): SandboxAccess | "skip" {
	if (operator.includes("<<")) return "skip";
	// `<>` opens for both; the write side is the one a read-only grant must not license.
	return operator.includes(">") ? "write" : "read";
}

/** A path to check, and the boundary to check it against. */
interface PathCandidate {
	token: string;
	access: SandboxAccess;
}

/** Write first, so a `<>` denial names the stricter boundary the caller is most likely missing. */
const WRITE_AND_READ = ["write", "read"] as const satisfies readonly SandboxAccess[];

/** A redirection operator, with its optional file-descriptor prefix. Longest forms first. */
const REDIRECT_OPERATOR = /[0-9]*(?:&>>|&>|<<<|<<-|<<|>>|>\||<>|>&|<&|>|<)/g;

/** A whitespace token that is only a redirection operator, so the next token is its operand. */
const BARE_REDIRECT = /^[0-9]*(?:&>>|&>|<<<|<<-|<<|>>|>\||<>|>&|<&|>|<)$/;

/**
 * A path glued to its option, as one shell word (#2524).
 *
 * `path.isAbsolute("if=/work/custB/secret")` is false, so the floor's whole-token test
 * never saw these — a single space was the difference between the blocked form and the
 * allowed one.
 *
 * Only the option's VALUE is captured, never an arbitrary `/`-containing substring. That
 * distinction is what keeps #2470 shut: scanning any slash-bearing fragment would read
 * `sed -n '/a/p'` as a path again, which is the false positive #2479 exists to remove.
 * The captured value still has to satisfy `looksLikePath`, so `--output=./out` stays
 * allowed while `--output=/work/custB/x` does not.
 *
 * The short-option form additionally requires its value to begin with `/` or `~`. Without
 * that, `-la` and friends would be read as an option carrying a relative path.
 */
const OPTION_VALUE_FORMS: readonly RegExp[] = [
	/^-{1,2}[A-Za-z0-9][^=]*=(.+)$/, // --output=/p, -o=/p
	/^[A-Za-z_][A-Za-z0-9_]*=(.+)$/, // if=/p, of=/p (operand style)
	/^-[A-Za-z0-9]+([/~].*)$/, // -o/p, -C/p (no separator)
];

/**
 * Path-like tokens in a command/code string: bare (whitespace-split) and quoted.
 *
 * Indiscriminate by design, and that is the point: because it never asks what a command *means*, it
 * also catches paths hidden inside quoted scripts, heredoc bodies, `-exec` runs and substitutions.
 * This is the coverage floor for both bash and python. Do not narrow it.
 *
 * Offsets come along so a caller can tell one occurrence of a token from another. Nothing else about
 * what this finds has changed: the two passes and `looksLikePath` are the floor.
 */
function codePathOccurrences(command: string): PathOccurrence[] {
	const found: PathOccurrence[] = [];
	const add = (token: string, at: number, access?: SandboxAccess): void => {
		if (token.length > 0 && looksLikePath(token)) found.push({ token, at, access });
	};
	// Set when the previous token was nothing but a redirection operator, so this one is its operand.
	let carried: SandboxAccess | "skip" | undefined;
	for (const match of command.matchAll(/\S+/g)) {
		const raw = match[0];
		const operand = carried;
		carried = undefined;

		if (BARE_REDIRECT.test(raw)) {
			carried = operandAccess(raw);
			continue;
		}

		const stripped = raw.replace(/^["']|["']$/g, "");
		const openingQuote = raw.length !== stripped.length && (raw[0] === '"' || raw[0] === "'") ? 1 : 0;
		if (operand !== "skip") add(stripped, match.index + openingQuote, operand);
		// An operator glued to its operand is one whitespace token, and `>/work/x` is not absolute.
		// The lexer resolves this for words it can see, but not for text inside a quoted script or a
		// heredoc body — where the floor is the only thing looking — so scan past the operator here
		// too, anywhere it appears in the token: `echo a>/work/x` is one token as well. The operator
		// is also the only thing that says which boundary a nested redirect crosses.
		for (const operator of stripped.matchAll(REDIRECT_OPERATOR)) {
			const access = operandAccess(operator[0]);
			if (access === "skip") continue;
			const from = operator.index + operator[0].length;
			add(stripped.slice(from).replace(/^["']|["']$/g, ""), match.index + openingQuote + from, access);
		}

		// An option glued to its value is one word too, and the lexer cannot help: it
		// correctly reports `if=/work/custB/secret` as a single word, because that is what
		// it is. Which options introduce a filename is command-specific knowledge the floor
		// deliberately does not have, so scan the value and let `looksLikePath` decide.
		//
		// Skipped after a here-string or heredoc delimiter for the same reason the whole
		// token is: that operand is literal data the shell never opens, so `cat <<<if=/tmp/f`
		// prints the text rather than reading the file.
		if (operand !== "skip") {
			for (const form of OPTION_VALUE_FORMS) {
				const optionValue = stripped.match(form);
				if (!optionValue?.[1]) continue;
				const from = stripped.length - optionValue[1].length;
				add(optionValue[1].replace(/^["']|["']$/g, ""), match.index + openingQuote + from, operand);
				break; // the forms overlap; the first that matches has already captured the value
			}
		}
	}
	for (const match of command.matchAll(/["']([^"']+)["']/g)) add(match[1], match.index + 1);
	return found;
}

/** The floor as plain read candidates — what a non-shell language gets. */
function codePathCandidates(command: string): PathCandidate[] {
	return codePathOccurrences(command).map(({ token }) => ({ token, access: "read" as const }));
}

/**
 * Path candidates of a *bash* command. Three things happen here, and only the first narrows:
 *
 * 1. **Exempt words are blanked.** Words the invoked command provably treats as a script or pattern
 *    rather than a filename stop being scanned (issue #2470: `sed -n '/a/p'` was refused because
 *    `/a/p` looks absolute, though sed never opens it). Implemented by blanking the exempt spans and
 *    re-running the floor over what remains, rather than by subtracting a set of token strings. Set
 *    subtraction loses which *occurrence* a token came from, so `echo '/elsewhere/x' && cat
 *    /elsewhere/x` would exempt the echo operand and thereby clear the identical token belonging to
 *    `cat`. Blanking is positional and cannot leak that way.
 *
 * 2. **A word the shell opens for writing is checked against the write boundary** (issue #2516).
 *    Every candidate used to be checked as a read, so a path granted read access but not write was
 *    writable through `>`. Marking is by span, for the same occurrence-identity reason as blanking:
 *    in `cat /shared/x && printf y > /shared/x` only the second occurrence is the write.
 *
 * 3. **Redirect targets are added as candidates** (issue #2520). The floor splits on whitespace, so
 *    an operator glued to its path — `cat </work/custB/secret` — was one token that did not look
 *    like a path and was never checked at all. The lexer parses those correctly, so its redirect
 *    targets go in on top of the floor. This only ever adds candidates.
 *
 * The floor's reach is unchanged: text the lexer never turns into a word — a heredoc body, an
 * `-exec` run — is not blanked, so it is still scanned. When the command cannot be lexed
 * confidently, the floor stands alone.
 */
function shellPathCandidates(command: string): PathCandidate[] {
	const lexed = lexShellCommand(command);
	// Unbalanced quotes mean every word boundary is a guess: neither the blanking nor the write
	// marking below can be trusted, so fall back to the floor, checked as reads.
	if (lexed.unterminated) return codePathCandidates(command);

	const exemptSpans = lexed.commands.flatMap(simpleCommand => provenExemptWords(simpleCommand));
	let scanned = command;
	// Replace each exempt word with equivalent-length whitespace, so surrounding offsets and word
	// boundaries are preserved and only that word's own text stops being scanned.
	for (const word of exemptSpans) {
		scanned = scanned.slice(0, word.start) + " ".repeat(word.end - word.start) + scanned.slice(word.end);
	}

	// `<>` opens for both, so it stays a read here and picks up its write below: a floor occurrence
	// may carry only one access, and read is the one the floor would have used anyway.
	const writeTargets = lexed.words.filter(word => word.redirect === "write");
	const inWriteTarget = (at: number): boolean => writeTargets.some(word => at >= word.start && at < word.end);

	// A floor occurrence takes the access its own operator gave it; failing that, the span of a
	// lexed write target it sits inside; failing that, read.
	const candidates: PathCandidate[] = codePathOccurrences(scanned).map(({ token, at, access }) => ({
		token,
		access: access ?? (inWriteTarget(at) ? "write" : "read"),
	}));

	// Not gated on `looksLikePath`: that test is for the floor's *guesses* about which fragments of a
	// command might be filenames. A redirect target is one the shell will certainly open, so a bare
	// `out.txt` is checked too — it resolves under the cwd, which a read-only cwd does not license.
	for (const word of lexed.words) {
		if (word.redirect === undefined || word.redirect === "here-string") continue;
		for (const access of word.redirect === "read-write" ? WRITE_AND_READ : [word.redirect]) {
			candidates.push({ token: word.text, access });
		}
	}
	return candidates;
}

/** Base directories a search input would actually search, split like the tools do. */
function searchBases(raw: string, base: (token: string) => string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	const tokens = new Set<string>();
	// Union of comma and whitespace splits — over-splitting only adds harmless in-tree
	// checks; it can never hide an out-of-tree token from the gate.
	for (const separator of ["comma", "whitespace"] as const) {
		for (const token of splitTopLevel(trimmed, separator)) {
			const cleaned = token.trim();
			if (cleaned) tokens.add(base(cleaned));
		}
	}
	return [...tokens];
}

function evaluateCodeTool(check: ToolCallCheck, fields: string[], shell: boolean): ToolCallDecision {
	const { input, cwd, policy } = check;

	const rawCwd = typeof input.cwd === "string" ? input.cwd : undefined;
	const base = rawCwd ? resolveToCwd(rawCwd, cwd) : cwd;
	if (rawCwd && !policy.isAllowed(base, "read")) return deny(policy, base, "read");

	const commands: string[] = [];
	for (const field of fields) {
		if (typeof input[field] === "string") commands.push(input[field] as string);
	}
	// python also accepts a `cells` array of { code }.
	if (Array.isArray(input.cells)) {
		for (const cell of input.cells) {
			const code = (cell as { code?: unknown })?.code;
			if (typeof code === "string") commands.push(code);
		}
	}

	for (const command of commands) {
		// Only bash gets the shell-aware treatment. Python is not shell: lexing `open('/x')` as
		// shell yields one non-absolute word and would lose the check entirely, and it has no
		// redirects, so every candidate it produces is a read.
		const seen = new Set<string>();
		for (const { token, access } of shell ? shellPathCandidates(command) : codePathCandidates(command)) {
			if (!seen.add(`${access}\0${token}`)) continue;
			const resolved = resolveToCwd(token, base);
			if (policy.isAllowed(resolved, access)) continue;
			// SYSTEM_READ_ROOTS is a read allowance — "directories a subprocess may legitimately
			// read or traverse". It never licenses writing into /etc, /usr or /opt; only the
			// discard-and-echo devices are writable.
			if (access === "read" ? isSystemPath(resolved) : isSystemWriteSink(resolved)) continue;
			return deny(policy, resolved, access);
		}
	}

	return ALLOW;
}

/**
 * The `edit` tool is mode-dependent; every mode writes. Targets, across modes:
 *  - vim mode: top-level `file`
 *  - replace/patch/hashline/chunk: each `edits[]` entry's `path`
 *  - hashline rename: `edits[].move`; patch rename: `edits[].rename`
 * (Chunk paths embed a `:selector#hash~` suffix, but a `..`/absolute escape still resolves
 * out of tree via the leading segments, so no stripping is needed for the boundary check.)
 */
function evaluateEdit(check: ToolCallCheck): ToolCallDecision {
	const { input, cwd, policy } = check;
	const targets: string[] = [];
	const add = (value: unknown): void => {
		if (typeof value === "string" && value.length > 0) targets.push(value);
	};
	add(input.file); // vim mode
	add(input.file_path);
	add(input.path);
	if (Array.isArray(input.edits)) {
		for (const entry of input.edits) {
			if (entry && typeof entry === "object") {
				const e = entry as Record<string, unknown>;
				add(e.path);
				add(e.move); // hashline rename
				add(e.rename); // patch rename
			}
		}
	}
	for (const target of targets) {
		const resolved = resolveToCwd(target, cwd);
		if (!policy.isAllowed(resolved, "write")) return deny(policy, resolved, "write");
	}
	return ALLOW;
}

/**
 * `generate_image` reads local files named in its `input[]` array (each `{ path?, data? }`)
 * and sends the bytes to an external API — so an out-of-tree path is both a read escape
 * and an exfiltration. Registered dynamically (not in BUILTIN_TOOLS).
 */
function evaluateGenerateImage(check: ToolCallCheck): ToolCallDecision {
	const { input, cwd, policy } = check;
	if (Array.isArray(input.input)) {
		for (const entry of input.input) {
			const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>).path : undefined;
			if (typeof value === "string" && value.length > 0) {
				const resolved = resolveToCwd(value, cwd);
				if (!policy.isAllowed(resolved, "read")) return deny(policy, resolved, "read");
			}
		}
	}
	return ALLOW;
}

const REMOTE_URL_SCHEME = /^(https?|about|data|chrome|chrome-extension|blob|ws|wss):/i;

/**
 * If a browser navigation target refers to the LOCAL filesystem, return the path to
 * check; otherwise undefined (remote/benign scheme). Covers file: URLs, the filesystem:
 * wrapper, and bare/relative/absolute paths that `goto` would resolve against disk.
 */
function navLocalPath(raw: string): string | undefined {
	const url = raw.trim();
	if (!url || REMOTE_URL_SCHEME.test(url)) return undefined;
	if (url.toLowerCase().startsWith("file:")) return url; // resolveToCwd → stripFileUrl
	if (url.toLowerCase().startsWith("filesystem:")) return url.slice("filesystem:".length);
	if (path.isAbsolute(url) || url.startsWith("~") || url.startsWith(".")) return url;
	return undefined; // domain-like host or unknown scheme → not local disk
}

/**
 * `puppeteer` (the browser tool) writes screenshots to `path` and navigates to `url`.
 * A file:// / local navigation target followed by get_text/evaluate/screenshot returns
 * another session's file contents to the model, so local navigation is a read escape.
 */
function evaluatePuppeteer(check: ToolCallCheck): ToolCallDecision {
	const { input, cwd, policy } = check;
	const screenshot = firstString(input, ["path"]);
	if (screenshot) {
		const resolved = resolveToCwd(screenshot, cwd);
		if (!policy.isAllowed(resolved, "write")) return deny(policy, resolved, "write");
	}
	if (typeof input.url === "string") {
		const local = navLocalPath(input.url);
		if (local) {
			const resolved = resolveToCwd(local, cwd);
			if (!policy.isAllowed(resolved, "read")) return deny(policy, resolved, "read");
		}
	}
	return ALLOW;
}

function evaluateSearchTool(check: ToolCallCheck, spec: SearchSpec): ToolCallDecision {
	const { input, cwd, policy } = check;
	const raw = typeof input[spec.key] === "string" ? (input[spec.key] as string) : "";
	for (const basePath of searchBases(raw, spec.base)) {
		const resolved = resolveToCwd(basePath, cwd);
		if (!policy.isAllowed(resolved, spec.access)) return deny(policy, resolved, spec.access);
	}
	return ALLOW;
}

/**
 * Decide whether a tool call is allowed under the policy. Tools with no recognized
 * path argument are always allowed.
 */
export function evaluateToolCall(check: ToolCallCheck): ToolCallDecision {
	const { toolName, input, cwd, policy } = check;
	if (!policy.enabled) return ALLOW;

	const codeFields = CODE_FIELDS[toolName];
	if (codeFields) return evaluateCodeTool(check, codeFields, toolName === "bash");

	if (toolName === "edit") return evaluateEdit(check);
	if (toolName === "generate_image") return evaluateGenerateImage(check);
	if (toolName === "puppeteer") return evaluatePuppeteer(check);

	const searchSpec = SEARCH_TOOLS[toolName];
	if (searchSpec) return evaluateSearchTool(check, searchSpec);

	const specs = TOOL_PATHS[toolName];
	if (!specs) return ALLOW;

	for (const spec of specs) {
		const raw = firstString(input, spec.keys);
		if (!raw) continue; // optional path → defaults to cwd, which is allowed
		const resolved = resolveToCwd(raw, cwd);
		if (policy.isAllowed(resolved, spec.access)) continue;
		if (spec.systemExempt && isSystemPath(resolved)) continue;
		return deny(policy, resolved, spec.access);
	}
	return ALLOW;
}
