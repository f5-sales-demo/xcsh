/**
 * Pure evaluation of a tool call against the containment fence.
 *
 * Maps each path-taking tool to its path argument(s) and access mode, resolves the
 * path relative to the session cwd, and asks the fence whether it is allowed. Kept
 * free of settings/runtime so it is fully unit-testable; the bundled `sandbox-guard`
 * extension is a thin wrapper that supplies cwd, settings, and the fence.
 *
 * Search tools (`find`/`grep`/`ast_grep`/`ast_edit`) accept comma-/whitespace-delimited
 * multi-path inputs that the tools split (via `splitTopLevel`) and search from a common
 * base directory. We split the same way and check EVERY token's base, so a
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
 *  - `python`, whose kernel is a shared, lock-protected gateway reused across sessions, so it can never
 *    carry a per-session fence and this is the only thing deciding for it
 *  - `bash` on a platform with no backend, where this is again the only layer and `xcsh://about` says so
 *  - a fast pre-check that produces a readable refusal before a command runs
 *
 * So: keep it, and do not extend it. Another spelling caught here buys little now, and the pattern of
 * adding one has a poor record — two adversarial rounds on the #2542 fix alone produced six bypasses.
 *
 * **One policy, asked at two places (#2624.)** This used to consult `SandboxPolicy`, which was
 * deny-by-default and confined to the cwd, while the fence below it is allow-by-default with targeted
 * denies. Running both made the effective boundary their intersection, and the intersection refused
 * ordinary work: `grep -oE '<title>[^<]*</title>'` was rejected because the floor reads the fragment
 * `/title` out of the closing tag and a deny-by-default policy has to refuse an unrecognised absolute
 * path. So were `</h1>`, `</td>`, `--pretty=format:'%h </%an>'`, `cd "$DEST"`, `read /etc/hosts` and a
 * `/tmp` write — none of which has anything to do with reaching another customer's files.
 *
 * The floor is unchanged, because the floor was never the problem. It guesses which fragments of a
 * command might be paths, and under allow-by-default a wrong guess matches no rule and costs nothing.
 * Deny-by-default is what turned each wrong guess into a refusal, so the posture went rather than the
 * guessing — which also means this file no longer needs to know about system roots, temp directories or
 * which backend is running. The fence answers all of that, and it is the same answer the kernel gives.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expandPath, parseFindPattern, parseSearchPath, resolveToCwd, splitTopLevel } from "../tools/path-utils";
import { lexShellCommand, type ShellSimpleCommand } from "../tools/shell-lex";
import { provenExemptWords, writtenOperandWords } from "./command-operands";
import { type ContainmentFence, type FenceAccess, fenceVerdict } from "./containment";

/** The two access directions, named as the fence names them. */
type SandboxAccess = FenceAccess;

export interface ToolCallCheck {
	toolName: string;
	input: Record<string, unknown>;
	cwd: string;
	/**
	 * The session's boundary — the same object the OS backend compiles for `bash`.
	 *
	 * Absent is not a case: a session with isolation off has no fence, and its caller does not evaluate
	 * at all (`resolveSessionFence` returns undefined and `sandbox-guard` returns early). Passing one
	 * here means "decide against this".
	 */
	fence: ContainmentFence;
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
	// debug executes an arbitrary program and reads source files. System binaries needed no exemption
	// once the fence started deciding: it never mentions `/usr` or `/bin`, so they are simply allowed.
	debug: [
		{ keys: ["program"], access: "read" },
		{ keys: ["file"], access: "read" },
		{ keys: ["cwd"], access: "read" },
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

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/** Whether the session's boundary permits `access` on an already-resolved absolute path. */
function permits(check: ToolCallCheck, resolved: string, access: SandboxAccess): boolean {
	return fenceVerdict(check.fence, resolved, access) === "allow";
}

/**
 * The refusal the model sees. Wording preserved from the policy this replaced, because the bash prompt
 * and the skill-URL boundary both tell the model to expect it.
 */
function deny(cwd: string, resolved: string, access: SandboxAccess): ToolCallDecision {
	return {
		block: true,
		reason:
			`Path is outside this session's ${access} boundary (working directory: ${cwd}): ${resolved}. ` +
			"Use --allow-path or the sandbox.allow* settings to widen it, or --no-sandbox to disable isolation.",
	};
}

/**
 * `$HOME` and `${HOME}` are spellings of `~`, which `looksLikePath` already treats as a path (#2534).
 * Rewriting to `~` means detection and resolution answer consistently whether the resulting home path
 * is allowed or denied by an explicit rule.
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
 * A `cd` whose target this layer cannot resolve — `cd "$DEST"`, `cd $(git rev-parse …)`, `cd -` — is
 * **not** refused (#2624).
 *
 * It used to be, on the reasoning that a directory change relocates every later relative path while a
 * redirect target damages only one file. That reasoning is sound and the refusal still had to go: the
 * three spellings above are ordinary shell, they were refused outright, and the layer that actually
 * decides now checks `cd` where the shell performs it — after expansion, with the boundary fixed for
 * the session so standing somewhere new widens nothing (#2589).
 *
 * It was never a boundary in any case. Its own history records `c=cd; $c /`, `alias g=cd; g /` and a
 * symlink created in the same command as still open (#2553), so what it cost in refused work it did not
 * buy back in coverage. A resolvable target is still checked — that is precise and free.
 */
interface ShellScan {
	candidates: PathCandidate[];
}

/**
 * Why a directory change was refused. Distinct from `describe` because the remedy differs: the path
 * may well be readable, and the problem is that standing there redefines every relative path the
 * boundary trusts to stay in the tree.
 */
function describeDirectoryChange(cwd: string, target: string): string {
	return `Refusing to change the working directory to ${target}, which is outside it (session directory: ${cwd}). Relative paths are trusted to stay inside the session tree, so moving out of it would silently take every later path with it. Use an absolute path, or --allow-path to widen the boundary first.`;
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
 * Literal targets of a directory change, as candidates that must resolve in-tree.
 *
 * This gate exists because a relative operand is never a candidate — the floor assumes it resolves
 * under the session directory. `cd` is what breaks that assumption: the bash tool runs one
 * persistent brush-core shell in the agent's own process, so a directory change outlives the call
 * that made it and afterwards `cat tmp/x` reads somewhere else entirely (#2542).
 *
 * Only what can be read from the text. A target this cannot resolve — `cd "$DEST"`, `cd -`, `cd` with
 * no operand, an option nobody here recognises — is skipped rather than refused (#2624): see ShellScan
 * for why, and note that the escapes this gate never caught (`c=cd; $c /`, `alias g=cd; g /`) are
 * caught below the text by the shell itself. Do not add a seventh spelling here — two adversarial
 * rounds produced six.
 */
function directoryChangeTargets(commands: readonly ShellSimpleCommand[], depth = 0): PathCandidate[] {
	const targets: PathCandidate[] = [];

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
			if (depth > 0) continue;
			for (const operand of operands) {
				if (!operand.literal) continue; // `eval "$cmd"` — nothing to read
				if (!DIRECTORY_CHANGE_TOKEN.test(operand.text)) continue;
				const inner = lexShellCommand(operand.text);
				if (!inner.unterminated) targets.push(...directoryChangeTargets(inner.commands, depth + 1));
			}
			continue;
		}

		if (!DIRECTORY_CHANGE.has(name)) continue;

		// Options precede the target and are all boolean. One this does not recognise means the target
		// cannot be located, so nothing is claimed about it.
		let index = 0;
		let unparseable = false;
		while (index < operands.length && operands[index].text.startsWith("-") && operands[index].text !== "-") {
			if (!DIRECTORY_CHANGE_OPTIONS.has(operands[index].text)) {
				unparseable = true;
				break;
			}
			index++;
		}
		if (unparseable) continue;

		const target = operands[index];
		// `cd` with no operand goes to $HOME and `cd -` somewhere only the shell remembers; a non-literal
		// target cannot be resolved from text. All three are the shell's to decide.
		if (target === undefined || !target.literal || target.text === "-") continue;
		targets.push({ token: target.text, access: "read", mustBeInTree: true });
	}
	return targets;
}

function shellPathCandidates(command: string): ShellScan {
	const lexed = lexShellCommand(command);
	// Unbalanced quotes mean every word boundary is a guess: neither the blanking nor the write
	// marking below can be trusted, so fall back to the floor, checked as reads.
	if (lexed.unterminated) return { candidates: codePathCandidates(command) };

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
	// Plus the operands the invoked program writes itself — `tee FILE`, `dd of=FILE`, `cp SRC DST`.
	// Those had no direction signal and defaulted to a read check, so a write into an allowRead-only
	// root passed and a write into an allowWrite-only root was refused (GHSA-q4hg).
	const writtenOperands = lexed.commands.flatMap(simpleCommand => writtenOperandWords(simpleCommand));
	const inWriteTarget = (at: number): boolean =>
		[...writeTargets, ...writtenOperands].some(word => at >= word.start && at < word.end);

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
			// in-tree shell (#2552). The shell resolves it below the text instead.
			if (word.literal) candidates.push({ token: word.text, access });
		}
	}

	candidates.push(...directoryChangeTargets(lexed.commands));
	return { candidates };
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
	const { input, cwd } = check;

	const rawCwd = typeof input.cwd === "string" ? input.cwd : undefined;
	const base = rawCwd ? resolveToCwd(rawCwd, cwd) : cwd;
	// Both directions, for the same reason a `cd` target needs both: relative paths are never scanned,
	// so wherever the command runs is somewhere it can write freely. Read alone let
	// `{ cwd: "/shared/ctx", command: "touch notes.md" }` write into a read-only root.
	if (rawCwd && !(permits(check, base, "read") && permits(check, base, "write"))) {
		return { block: true, reason: describeDirectoryChange(cwd, base) };
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
		const scan: ShellScan = shell ? shellPathCandidates(command) : { candidates: codePathCandidates(command) };
		const seen = new Set<string>();
		for (const { token, access, mustBeInTree } of scan.candidates) {
			if (!seen.add(`${access}\0${mustBeInTree ? "cd\0" : ""}${token}`)) continue;
			if (mustBeInTree) {
				// `path.resolve`, not `resolveToCwd`: the latter maps an all-slashes path to the cwd,
				// which would read `cd /` as `cd .` and let the shell walk out. Both directions,
				// because relative paths go unchecked wherever the shell is standing.
				const moved = path.resolve(base, expandPath(token));
				if (permits(check, moved, "read") && permits(check, moved, "write")) continue;
				return { block: true, reason: describeDirectoryChange(cwd, moved) };
			}
			const resolved = resolveToCwd(token, base);
			if (permits(check, resolved, access)) continue;
			return deny(cwd, resolved, access);
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
	const { input, cwd } = check;
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
		if (!permits(check, resolved, "write")) return deny(cwd, resolved, "write");
	}
	return ALLOW;
}

/**
 * `generate_image` reads local files named in its `input[]` array (each `{ path?, data? }`)
 * and sends the bytes to an external API — so an out-of-tree path is both a read escape
 * and an exfiltration. Registered dynamically (not in BUILTIN_TOOLS).
 */
function evaluateGenerateImage(check: ToolCallCheck): ToolCallDecision {
	const { input, cwd } = check;
	if (Array.isArray(input.input)) {
		for (const entry of input.input) {
			const value = entry && typeof entry === "object" ? (entry as Record<string, unknown>).path : undefined;
			if (typeof value === "string" && value.length > 0) {
				const resolved = resolveToCwd(value, cwd);
				if (!permits(check, resolved, "read")) return deny(cwd, resolved, "read");
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
	const { input, cwd } = check;
	const screenshot = firstString(input, ["path"]);
	if (screenshot) {
		const resolved = resolveToCwd(screenshot, cwd);
		if (!permits(check, resolved, "write")) return deny(cwd, resolved, "write");
	}
	if (typeof input.url === "string") {
		const local = navLocalPath(input.url);
		if (local) {
			const resolved = resolveToCwd(local, cwd);
			if (!permits(check, resolved, "read")) return deny(cwd, resolved, "read");
		}
	}
	return ALLOW;
}

function evaluateSearchTool(check: ToolCallCheck, spec: SearchSpec): ToolCallDecision {
	const { input, cwd } = check;
	const raw = typeof input[spec.key] === "string" ? (input[spec.key] as string) : "";
	for (const basePath of searchBases(raw, spec.base)) {
		const resolved = resolveToCwd(basePath, cwd);
		if (!permits(check, resolved, spec.access)) return deny(cwd, resolved, spec.access);
		if (!permits(check, resolved, "enumerate")) return deny(cwd, resolved, "enumerate");
	}
	return ALLOW;
}

/** `read` lists a directory when its path resolves to one; named file reads do not enumerate it. */
function evaluateReadTool(check: ToolCallCheck): ToolCallDecision {
	const raw = firstString(check.input, ["file_path", "path"]);
	if (!raw) return ALLOW;
	const resolved = resolveToCwd(raw, check.cwd);
	if (!permits(check, resolved, "read")) return deny(check.cwd, resolved, "read");
	try {
		if (fs.statSync(resolved).isDirectory() && !permits(check, resolved, "enumerate")) {
			return deny(check.cwd, resolved, "enumerate");
		}
	} catch {
		// The tool owns its normal not-found/error contract; the fence has already decided the read path.
	}
	return ALLOW;
}

/**
 * Decide whether a tool call is allowed under the session's fence. Tools with no recognized path
 * argument are always allowed.
 */
export function evaluateToolCall(check: ToolCallCheck): ToolCallDecision {
	const { toolName, input, cwd } = check;

	const codeFields = CODE_FIELDS[toolName];
	if (codeFields) return evaluateCodeTool(check, codeFields, toolName === "bash");

	if (toolName === "edit") return evaluateEdit(check);
	if (toolName === "read") return evaluateReadTool(check);
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
		if (permits(check, resolved, spec.access)) continue;
		return deny(cwd, resolved, spec.access);
	}
	return ALLOW;
}
