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
	puppeteer: [{ keys: ["path"], access: "write" }], // screenshot destination
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

/** Path-like tokens in a command/code string: bare (whitespace-split) and quoted. */
function codePathTokens(command: string): string[] {
	const tokens = new Set<string>();
	for (const raw of command.split(/\s+/)) tokens.add(raw.replace(/^["']|["']$/g, ""));
	for (const match of command.matchAll(/["']([^"']+)["']/g)) tokens.add(match[1]);
	return [...tokens].filter(token => token.length > 0 && looksLikePath(token));
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

function evaluateCodeTool(check: ToolCallCheck, fields: string[]): ToolCallDecision {
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
		for (const token of codePathTokens(command)) {
			const resolved = resolveToCwd(token, base);
			if (!policy.isAllowed(resolved, "read") && !isSystemPath(resolved)) {
				return deny(policy, resolved, "read");
			}
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
	if (codeFields) return evaluateCodeTool(check, codeFields);

	if (toolName === "edit") return evaluateEdit(check);
	if (toolName === "generate_image") return evaluateGenerateImage(check);

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
