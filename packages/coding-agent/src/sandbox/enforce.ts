/**
 * Pure evaluation of a tool call against a SandboxPolicy.
 *
 * Maps each path-taking tool to its path argument(s) and access mode, resolves the
 * path relative to the session cwd, and asks the policy whether it is allowed. Kept
 * free of settings/runtime so it is fully unit-testable; the bundled `sandbox-guard`
 * extension is a thin wrapper that supplies cwd, settings, and the policy.
 *
 * Bash handling is best-effort (Phase 1): the `cwd` parameter is checked precisely,
 * and the command string is scanned for `../` traversals that escape the tree. Reads
 * of absolute paths inside a Bash command are NOT caught here — that gap is closed by
 * the opt-in OS-level Bash sandbox (Phase 2).
 */
import * as path from "node:path";
import { resolveToCwd } from "../tools/path-utils";
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
}

/** Tools that touch a single explicit path argument. */
const TOOL_PATHS: Record<string, PathArgSpec> = {
	read: { keys: ["file_path", "path"], access: "read" },
	grep: { keys: ["path"], access: "read" },
	ast_grep: { keys: ["path"], access: "read" },
	write: { keys: ["file_path", "path"], access: "write" },
	edit: { keys: ["file_path", "path"], access: "write" },
	ast_edit: { keys: ["path"], access: "write" },
	notebook: { keys: ["notebook_path"], access: "write" },
};

const GLOB_CHARS = ["*", "?", "[", "{"];

function firstString(input: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/** Derive the fixed directory prefix of a glob pattern (before the first glob char). */
function globBase(pattern: string): string {
	let cut = pattern.length;
	for (const char of GLOB_CHARS) {
		const idx = pattern.indexOf(char);
		if (idx >= 0 && idx < cut) cut = idx;
	}
	const prefix = pattern.slice(0, cut);
	const sep = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));
	return sep >= 0 ? prefix.slice(0, sep) : "";
}

function deny(policy: SandboxPolicy, resolved: string, access: SandboxAccess): ToolCallDecision {
	return { block: true, reason: policy.describe(resolved, access) };
}

/**
 * Standard OS directories a Bash subprocess may legitimately read or traverse
 * (interpreters, libraries, device files) and which hold no customer data. The file
 * tools stay strictly confined to the policy; only Bash command scanning treats these
 * as benign, so commands like `cat /etc/os-release` or `/usr/bin/env node` are not
 * falsely blocked. Notably excludes /tmp, /var, /private, and home — those can hold
 * per-session or per-user data.
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

/** Unquoted, whitespace-delimited tokens that look like filesystem paths. */
function pathLikeTokens(command: string): string[] {
	return command
		.split(/\s+/)
		.map(tok => tok.replace(/^["']|["']$/g, ""))
		.filter(tok => tok.length > 0)
		.filter(tok => path.isAbsolute(tok) || tok.startsWith("~") || /(^|[/\\])\.\.([/\\]|$)/.test(tok));
}

function evaluateBash(check: ToolCallCheck): ToolCallDecision {
	const { input, cwd, policy } = check;

	const bashCwd = typeof input.cwd === "string" ? input.cwd : undefined;
	if (bashCwd) {
		const resolved = resolveToCwd(bashCwd, cwd);
		if (!policy.isAllowed(resolved, "read")) return deny(policy, resolved, "read");
	}

	// Best-effort scan of the command for path tokens (absolute, `~`, or `..`) that
	// escape the boundary. OS system paths are exempt; the opt-in OS-level Phase 2
	// sandbox is the airtight enforcement for Bash.
	const base = bashCwd ? resolveToCwd(bashCwd, cwd) : cwd;
	const command = typeof input.command === "string" ? input.command : "";
	for (const token of pathLikeTokens(command)) {
		const resolved = resolveToCwd(token, base);
		if (!policy.isAllowed(resolved, "read") && !isSystemPath(resolved)) {
			return deny(policy, resolved, "read");
		}
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

	if (toolName === "bash") return evaluateBash(check);

	if (toolName === "find") {
		const base = globBase(typeof input.pattern === "string" ? input.pattern : "");
		const candidates = [base, typeof input.path === "string" ? input.path : ""].filter(Boolean);
		for (const candidate of candidates) {
			const resolved = resolveToCwd(candidate, cwd);
			if (!policy.isAllowed(resolved, "read")) return deny(policy, resolved, "read");
		}
		return ALLOW;
	}

	const spec = TOOL_PATHS[toolName];
	if (!spec) return ALLOW;

	const raw = firstString(input, spec.keys);
	if (!raw) return ALLOW; // optional path → defaults to cwd, which is allowed

	const resolved = resolveToCwd(raw, cwd);
	if (!policy.isAllowed(resolved, spec.access)) return deny(policy, resolved, spec.access);
	return ALLOW;
}
