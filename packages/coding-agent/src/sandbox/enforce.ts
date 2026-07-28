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
 *
 * **This scan is no longer the boundary for `bash` on macOS.** Containment now runs below the command
 * text (`sandbox/containment.ts`, #2554): the shell's own `cd` and redirections are checked where they
 * act, and spawned children are confined by a seatbelt profile. A path is therefore decided after
 * expansion, alias resolution and symlink following, which is what closed the escapes this scan kept
 * leaking — #2470, #2516, #2520, #2524, #2540, #2542, #2553, and GHSA-q4hg.
 *
 * What remains this file's job:
 *  - every structured file tool (`read`/`write`/`edit`/`grep`/…), which has no subprocess to confine
 *  - `python`, which is not covered by the shell fence at all
 *  - `bash` on platforms with no backend — Linux Landlock is a follow-up, Windows has no equivalent —
 *    where this is again the only layer, and `xcsh://about` says so
 *  - a fast pre-check that produces a readable refusal before a command runs
 *
 * So: keep it, and do not extend it. Another spelling caught here buys little now, and the pattern of
 * adding one has a poor record — two adversarial rounds on the #2542 fix alone produced six bypasses.
 */
import * as path from "node:path";
import { expandPath, parseFindPattern, parseSearchPath, resolveToCwd, splitTopLevel } from "../tools/path-utils";
import { lexShellCommand, type ShellSimpleCommand } from "../tools/shell-lex";
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

/**
 * `$HOME` and `${HOME}` are spellings of `~`, which `looksLikePath` already treats as a
 * path (#2534). Three ways to name one file, only one of them checked, is an oversight
 * rather than a policy: `cat ~/.ssh/id_rsa` was blocked while `cat $HOME/.ssh/id_rsa`
 * was not. Rewriting to `~` here means detection AND resolution both see the real path,
 * so the denial names the file rather than a literal dollar sign.
 *
 * `\b` keeps `$HOMEBREW_PREFIX` and friends out of it.
 */
const HOME_EXPANSION = /^\$(?:HOME\b|\{HOME\})/;

function normalizeHomeExpansion(token: string): string {
	return HOME_EXPANSION.test(token) ? token.replace(HOME_EXPANSION, "~") : token;
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
	/**
	 * A directory the shell is about to move into. It must clear both boundaries on its own merits,
	 * and the system-root read exemption does not apply: `/usr` being readable is no reason to let
	 * the working directory — and with it every unchecked relative path — move there.
	 */
	mustBeInTree?: boolean;
}

/** Write first, so a `<>` denial names the stricter boundary the caller is most likely missing. */
const WRITE_AND_READ = ["write", "read"] as const satisfies readonly SandboxAccess[];

/** A redirection operator, with its optional file-descriptor prefix. Longest forms first. */
const REDIRECT_OPERATOR = /[0-9]*(?:&>>|&>|<<<|<<-|<<|>>|>\||<>|>&|<&|>|<)/g;

/** A whitespace token that is only a redirection operator, so the next token is its operand. */
const BARE_REDIRECT = /^[0-9]*(?:&>>|&>|<<<|<<-|<<|>>|>\||<>|>&|<&|>|<)$/;

/** Where a shell word ends inside a whitespace token: an operator, separator, or grouping. */
const METACHARACTER = /[;&|<>()]/;

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
	const add = (raw: string, at: number, access?: SandboxAccess): void => {
		const token = normalizeHomeExpansion(raw);
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
			// The operand ends at the first shell metacharacter, not at the end of the whitespace
			// token. `>/dev/null; echo x` is one token, and taking all of it produced the "path"
			// `/dev/null;`, which matched no write sink and refused a completely ordinary command
			// (#2540). Truncating only ever shortens a candidate, so nothing blocked becomes allowed.
			const rest = stripped.slice(from);
			const stop = rest.search(METACHARACTER);
			add(
				(stop === -1 ? rest : rest.slice(0, stop)).replace(/^["']|["']$/g, ""),
				match.index + openingQuote + from,
				access,
			);
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
/**
 * Something the shell will act on whose path this layer cannot resolve — `cd "$DEST"`.
 *
 * Refusal is justified here and *not* for a redirect target, which is the asymmetry worth stating: a
 * redirect target that escapes damages one file, while a directory change silently relocates every
 * later relative path in the session, and relative paths are never candidates at all. So an
 * unresolvable `cd` fails closed, and an unresolvable `> "$LOG"` does not.
 *
 * The reverse was tried (#2552) and refused `make > "$LOG"`, `> "$TMPDIR/f"` and `> out-$$.txt` —
 * ordinary shell, writing in-tree. Narrowing it is not possible either: a variable's *value* can
 * contain `../`, so `> "out-$X"` escapes while looking relative. Resolving that needs the expansion,
 * which only the shell has — Phase 2 (#2554).
 */
interface UnresolvableTarget {
	text: string;
	/** What the shell was about to do, for a message that names the actual problem. */
	what: "directory change";
}

interface ShellScan {
	candidates: PathCandidate[];
	unresolvable: UnresolvableTarget[];
}

/**
 * Why a directory change was refused. Distinct from `describe` because the remedy differs: the path
 * may well be readable, and the problem is that standing there redefines every relative path the
 * boundary trusts to stay in the tree.
 */
function describeDirectoryChange(policy: SandboxPolicy, target?: string, unresolved?: string): string {
	const what =
		target === undefined
			? `a directory this check cannot resolve from the command text (${unresolved})`
			: `${target}, which is outside it`;
	return `Refusing to change the working directory to ${what} (session directory: ${policy.cwd}). Relative paths are trusted to stay inside the session tree, so moving out of it would silently take every later path with it. Use an absolute path, or --allow-path to widen the boundary first.`;
}

/** Builtins that move the shell, and therefore move what every later relative path means. */
const DIRECTORY_CHANGE = new Set(["cd", "pushd"]);

/** `cd`'s own options. All boolean, so the target is the first non-option operand. */
const DIRECTORY_CHANGE_OPTIONS = new Set(["-L", "-P", "-e", "-@"]);

/**
 * Commands whose operand is a script the shell will run. The lexer hands the script over as one
 * word, so a directory change inside it is invisible unless that word is lexed in turn.
 */
const SCRIPT_RUNNERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "eval"]);

/**
 * Prefixes that run the *following words* as a command rather than a script string. `command` is
 * already unwrapped by the lexer; `builtin` is not, and `builtin cd /` would otherwise sail past a
 * gate that only looks at `name`.
 */
const COMMAND_PREFIXES = new Set(["builtin"]);

/** Cheap pre-filter: only lex a script operand that could contain a directory change at all. */
const DIRECTORY_CHANGE_TOKEN = /(^|[\s;&|(])(cd|pushd)([\s;&|)]|$)/;

/**
 * Targets of a directory change: a candidate that must resolve in-tree, or the raw text when it
 * cannot be resolved at all.
 *
 * This gate exists because a relative operand is never a candidate — the floor assumes it resolves
 * under the session directory. `cd` is what breaks that assumption: the bash tool runs one
 * persistent brush-core shell in the agent's own process, so a directory change outlives the call
 * that made it and afterwards `cat tmp/x` reads somewhere else entirely (#2542).
 *
 * It is defence-in-depth, not a boundary. Verified still open: `c=cd; $c /`, `alias g=cd; g /`, and
 * a symlink created in the same command (#2553). Those need the shell's own resolution, which is
 * Phase 2 (#2554). Do not add a seventh spelling here — two adversarial rounds produced six.
 */
function directoryChangeTargets(commands: readonly ShellSimpleCommand[], depth = 0): (PathCandidate | string)[] {
	const targets: (PathCandidate | string)[] = [];

	for (const command of commands) {
		if (command.name === undefined) continue;
		let name = command.name;
		let operands = command.words.slice(command.operandStart).filter(word => word.redirect === undefined);
		// `builtin cd sub` is a `cd`; unwrap the prefix before deciding anything.
		while (COMMAND_PREFIXES.has(name) && operands.length > 0 && operands[0].literal) {
			name = operands[0].text;
			operands = operands.slice(1);
		}

		// A script operand is text the shell will run, so lex it and gate what it contains. `eval
		// 'cd /'` and `sh -c '…'` both arrive here. One level is enough for every real spelling;
		// deeper nesting is unprovable.
		if (SCRIPT_RUNNERS.has(name)) {
			for (const operand of operands) {
				if (!operand.literal) {
					targets.push(operand.text); // `eval "$cmd"` — nothing to read
					continue;
				}
				if (!DIRECTORY_CHANGE_TOKEN.test(operand.text)) continue;
				if (depth > 0) {
					targets.push(operand.text);
					continue;
				}
				const inner = lexShellCommand(operand.text);
				if (inner.unterminated) targets.push(operand.text);
				else targets.push(...directoryChangeTargets(inner.commands, depth + 1));
			}
			continue;
		}

		if (!DIRECTORY_CHANGE.has(name)) continue;

		// Options precede the target and are all boolean. One the model does not recognise means the
		// target cannot be located, so the proof fails rather than guessing which operand it is.
		let index = 0;
		let unparseable = false;
		while (index < operands.length && operands[index].text.startsWith("-") && operands[index].text !== "-") {
			if (!DIRECTORY_CHANGE_OPTIONS.has(operands[index].text)) {
				unparseable = true;
				break;
			}
			index++;
		}
		if (unparseable) {
			targets.push(operands.map(word => word.text).join(" "));
			continue;
		}

		const target = operands[index];
		// `cd` with no operand goes to $HOME; `cd -` returns somewhere only the shell remembers; a
		// non-literal target cannot be resolved from text.
		if (target === undefined) targets.push(`${name} (no target: goes to $HOME)`);
		else if (!target.literal || target.text === "-") targets.push(target.text);
		else targets.push({ token: target.text, access: "read", mustBeInTree: true });
	}
	return targets;
}

function shellPathCandidates(command: string): ShellScan {
	const lexed = lexShellCommand(command);
	// Unbalanced quotes mean every word boundary is a guess: neither the blanking nor the write
	// marking below can be trusted, so fall back to the floor, checked as reads.
	if (lexed.unterminated) return { candidates: codePathCandidates(command), unresolvable: [] };

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
			// A non-literal target — `$VAR`, a substitution, a glob — is not checked. `text` is not a
			// stand-in for one filesystem reference, and refusing on that basis rejected ordinary
			// in-tree shell (see UnresolvableTarget). Resolving it is Phase 2's job.
			if (word.literal) candidates.push({ token: word.text, access });
		}
	}

	const unresolvable: UnresolvableTarget[] = [];
	for (const target of directoryChangeTargets(lexed.commands)) {
		if (typeof target === "string") unresolvable.push({ text: target, what: "directory change" });
		else candidates.push(target);
	}
	return { candidates, unresolvable };
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
	// Both boundaries, for the same reason a `cd` target needs both: relative paths are never
	// scanned, so wherever the command runs is somewhere it can write freely. Read alone let
	// `{ cwd: "/shared/ctx", command: "touch notes.md" }` write into a read-only root.
	if (rawCwd && !(policy.isAllowed(base, "read") && policy.isAllowed(base, "write"))) {
		return { block: true, reason: describeDirectoryChange(policy, base) };
	}

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
		const scan: ShellScan = shell
			? shellPathCandidates(command)
			: { candidates: codePathCandidates(command), unresolvable: [] };
		// Refused before any candidate is resolved: there is no path to check, and that is
		// precisely the problem. The residual this does NOT cover is an expansion in an
		// operand rather than a redirect target — `cat "$SECRET"` — which cannot be resolved
		// at this layer at all. That is the Phase 2 OS-sandbox's job; do not read the text
		// boundary as complete (#2534).
		for (const target of scan.unresolvable) {
			return { block: true, reason: describeDirectoryChange(policy, undefined, target.text) };
		}
		const seen = new Set<string>();
		for (const { token, access, mustBeInTree } of scan.candidates) {
			if (!seen.add(`${access}\0${mustBeInTree ? "cd\0" : ""}${token}`)) continue;
			if (mustBeInTree) {
				// `path.resolve`, not `resolveToCwd`: the latter maps an all-slashes path to the cwd,
				// which would read `cd /` as `cd .` and let the shell walk out. Both boundaries,
				// because relative paths go unchecked wherever the shell is standing.
				const moved = path.resolve(base, expandPath(token));
				if (policy.isAllowed(moved, "read") && policy.isAllowed(moved, "write")) continue;
				return { block: true, reason: describeDirectoryChange(policy, moved) };
			}
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
