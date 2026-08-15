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
 * Arbitrary-code tools are intentionally different. Their source text is data, not a reliable account
 * of what the program will open, and scanning it caused false refusals such as #2931. `bash` therefore
 * pre-checks only filesystem effects the shell lexer proves: an explicit `cwd`, literal redirections,
 * known write operands, and literal directory changes. The OS backend remains the boundary for spawned
 * processes. The shared `python` kernel cannot carry a per-session OS fence, so only its explicit `cwd`
 * is checked; source and cell text are never scanned.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { expandPath, parseFindPattern, parseSearchPath, resolveToCwd, splitTopLevel } from "../tools/path-utils";
import { lexShellCommand, type ShellSimpleCommand } from "../tools/shell-lex";
import { writtenOperandWords } from "./command-operands";
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
 * The refusal the model sees. Read/write wording stays compatible with the directional policy this
 * replaced; enumeration gets the discovery-specific recovery that matches the ordinary session fence.
 */
function deny(cwd: string, resolved: string, access: SandboxAccess): ToolCallDecision {
	if (access === "enumerate") {
		return {
			block: true,
			reason:
				`Directory discovery is outside this session's enumerate boundary (working directory: ${cwd}): ${resolved}. ` +
				"This refusal is about listing names, not general filesystem access. Use the exact path the task names directly. " +
				"If the directory must be listed, use --allow-path or the sandbox.allow* settings to grant discovery, " +
				"or --no-sandbox to disable the discovery guard.",
		};
	}
	return {
		block: true,
		reason:
			`Path is outside this session's ${access} boundary (working directory: ${cwd}): ${resolved}. ` +
			"Use --allow-path or the sandbox.allow* settings to widen it, or --no-sandbox to disable isolation.",
	};
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
 * This gate exists because ordinary relative operands are runtime decisions. `cd` changes where
 * those operands resolve: the bash tool runs one
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
	// An unfinished command has no filesystem effect, and treating partial words as paths is exactly
	// the source-text guessing this layer avoids.
	if (lexed.unterminated) return { candidates: [] };

	const candidates: PathCandidate[] = [];

	// A redirect target is one the shell will certainly open, so a bare `out.txt` is checked too — it
	// resolves under the cwd, which a read-only cwd does not license.
	for (const word of lexed.words) {
		if (word.redirect === undefined || word.redirect === "here-string") continue;
		for (const access of word.redirect === "read-write" ? WRITE_AND_READ : [word.redirect]) {
			// A non-literal target — `$VAR`, a substitution, a glob — is not checked. `text` is not a
			// stand-in for one filesystem reference, and refusing on that basis rejected ordinary
			// in-tree shell (#2552). The shell resolves it below the text instead.
			if (word.literal) candidates.push({ token: word.text, access });
		}
	}

	// Known program operands that are written — `tee FILE`, `dd of=FILE`, `cp SRC DST` — are as
	// explicit as redirects. Ordinary read operands are deliberately absent: only the process that
	// opens them can decide whether path-looking argument text is a filename, a pattern, or data.
	for (const word of lexed.commands.flatMap(simpleCommand => writtenOperandWords(simpleCommand))) {
		if (word.literal) candidates.push({ token: word.text, access: "write" });
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

function evaluateCodeTool(check: ToolCallCheck, shell: boolean): ToolCallDecision {
	const { input, cwd } = check;

	const rawCwd = typeof input.cwd === "string" ? input.cwd : undefined;
	const base = rawCwd ? resolveToCwd(rawCwd, cwd) : cwd;
	// Both directions, for the same reason a `cd` target needs both: relative paths are never scanned,
	// so wherever the command runs is somewhere it can write freely. Read alone let
	// `{ cwd: "/shared/ctx", command: "touch notes.md" }` write into a read-only root.
	if (rawCwd && !(permits(check, base, "read") && permits(check, base, "write"))) {
		return { block: true, reason: describeDirectoryChange(cwd, base) };
	}

	// Python's persistent shared kernel has no per-session OS fence. Scanning source cannot fix that:
	// path-like strings may be inert data while computed paths never appear in source at all. Keep the
	// explicit cwd contract and otherwise let Python run without a heuristic pre-check (#2931).
	if (!shell || typeof input.command !== "string") return ALLOW;

	const scan = shellPathCandidates(input.command);
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

function evaluateDisplayMedia(check: ToolCallCheck): ToolCallDecision {
	const sources: string[] = [];
	if (typeof check.input.source === "string") sources.push(check.input.source);
	if (Array.isArray(check.input.frames)) {
		for (const frame of check.input.frames) {
			if (frame && typeof frame === "object" && "source" in frame && typeof frame.source === "string") {
				sources.push(frame.source);
			}
		}
	}
	for (const source of sources) {
		if (source.startsWith("https://") || source.startsWith("artifact://")) continue;
		const resolved = resolveToCwd(source, check.cwd);
		if (!permits(check, resolved, "read")) return deny(check.cwd, resolved, "read");
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

	if (toolName === "bash") return evaluateCodeTool(check, true);
	if (toolName === "python") return evaluateCodeTool(check, false);

	if (toolName === "edit") return evaluateEdit(check);
	if (toolName === "read") return evaluateReadTool(check);
	if (toolName === "generate_image") return evaluateGenerateImage(check);
	if (toolName === "puppeteer") return evaluatePuppeteer(check);
	if (toolName === "display_media") return evaluateDisplayMedia(check);

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
