/**
 * SandboxPolicy — resolves whether a file path is inside the current session's
 * read/write boundary.
 *
 * The model is longest-prefix-wins over an ordered set of allow/deny rules, with
 * deny beating allow on an exact-depth tie (fail-safe). A path matched by no rule
 * is denied (default-deny outside the working tree). This mirrors the deny-then-allow
 * precedence used by Anthropic's sandbox-runtime, but is enforced in-process for the
 * structured file tools (read/write/edit/find/grep) and the Bash `cwd`, rather than at
 * the OS level.
 *
 * The boundary only gates model-invoked tools. Internal subsystems (memory pipeline,
 * session manager, settings) do not go through the file tools, so they are unaffected.
 */
import * as path from "node:path";
import {
	getAgentDir,
	getConfigRootDir,
	getMemoriesDir,
	getPluginsDir,
	getSessionsDir,
	getXCSHContextsDir,
	normalizePathForComparison,
	pathIsWithin,
} from "@f5-sales-demo/pi-utils";
import { expandPath } from "../tools/path-utils";

export type SandboxAccess = "read" | "write";

export interface SandboxRule {
	/** Absolute directory or file this rule governs. */
	root: string;
	/** true = allow, false = deny. */
	allow: boolean;
}

export interface SandboxPolicyConfig {
	enabled: boolean;
	/** Session working directory, used for messaging and as the primary allowed root. */
	cwd: string;
	read: SandboxRule[];
	write: SandboxRule[];
}

interface NormalizedRule {
	root: string;
	depth: number;
	allow: boolean;
}

function normalizeRule(rule: SandboxRule): NormalizedRule {
	const normalized = normalizePathForComparison(rule.root);
	return {
		root: rule.root,
		depth: normalized.split(path.sep).filter(Boolean).length,
		allow: rule.allow,
	};
}

export class SandboxPolicy {
	readonly enabled: boolean;
	readonly cwd: string;
	readonly #read: NormalizedRule[];
	readonly #write: NormalizedRule[];

	constructor(config: SandboxPolicyConfig) {
		this.enabled = config.enabled;
		this.cwd = config.cwd;
		this.#read = config.read.map(normalizeRule);
		this.#write = config.write.map(normalizeRule);
	}

	/**
	 * Whether `candidate` (an absolute, already-resolved path) may be accessed for
	 * the given mode. Callers must resolve `~`/relative/`..` first (see resolveToCwd).
	 */
	isAllowed(candidate: string, access: SandboxAccess): boolean {
		if (!this.enabled) return true;
		const rules = access === "write" ? this.#write : this.#read;
		let best: NormalizedRule | undefined;
		for (const rule of rules) {
			if (!pathIsWithin(rule.root, candidate)) continue;
			const deeper = !best || rule.depth > best.depth;
			const denyTie = best !== undefined && rule.depth === best.depth && best.allow && !rule.allow;
			if (deeper || denyTie) best = rule;
		}
		return best?.allow ?? false;
	}

	/** Human-readable reason surfaced to the model when a path is blocked. */
	describe(candidate: string, access: SandboxAccess): string {
		return `Path is outside this session's ${access} boundary (working directory: ${this.cwd}): ${candidate}. Use --allow-path or the sandbox.allow* settings to widen it, or --no-sandbox to disable isolation.`;
	}
}

export interface DefaultSandboxOptions {
	/** Session working directory. */
	cwd: string;
	/** Defaults to true — isolation is enforced by default. */
	enabled?: boolean;
	/** A session-specific temp dir to allow (read+write). NOT the shared OS temp dir. */
	tmpDir?: string;
	/** Extra roots (read+write) — e.g. from `--allow-path`. */
	extraAllowRoots?: string[];
	allowRead?: string[];
	allowWrite?: string[];
}

/**
 * Build the default session policy: confine reads/writes to the CWD subtree, plus a
 * curated global allowlist (plugin cache, user-level skills, operator profile/settings)
 * for reads. Cross-session leak surfaces under `~/.xcsh` and the shared global tenant
 * contexts are explicitly denied, so even a broad user-configured allow cannot re-expose
 * another customer's memory, session, or credentials.
 *
 * Note: the OS temp dir is deliberately NOT allowlisted here. It is shared across all
 * sessions, so allowing it would let one customer's session read another's scratch
 * files. The agent should work in temp directories under its CWD; internal tool temp
 * usage bypasses this boundary (it is not a model-invoked path). A specific session
 * temp dir can still be granted via `tmpDir`.
 *
 * That still holds for every tool this policy governs directly. It does NOT hold for
 * `bash` on a host with an OS backend: the containment fence never mentions the temp
 * directories, so they are reachable below the command text regardless, and refusing
 * them in the text scan produced only a diagnostic that contradicted `xcsh://about`
 * (#2582). The protection was spelling-deep in any case — `T=/tmp/other; cat "$T"`
 * never went through this check. Treat shared temp as readable by a fenced shell, and
 * put anything that must not cross sessions under the session directory or `tmpDir`.
 */
export function buildDefaultSandboxPolicy(opts: DefaultSandboxOptions): SandboxPolicy {
	const cwd = path.resolve(opts.cwd);
	const configRoot = getConfigRootDir();
	const skillsDir = path.join(getAgentDir(), "skills");

	const allow = (root: string): SandboxRule => ({ root, allow: true });
	const deny = (root: string): SandboxRule => ({ root, allow: false });
	const expand = (roots: string[] | undefined, allowed: boolean): SandboxRule[] =>
		(roots ?? []).map(r => ({ root: expandPath(r), allow: allowed }));

	// Denied even though some sit under otherwise-allowlisted roots. Longest-prefix
	// precedence makes these win over any broader allow.
	const leakDenies = [deny(getMemoriesDir()), deny(getSessionsDir()), deny(getXCSHContextsDir())];
	const extraAllow = expand(opts.extraAllowRoots, true);
	// Only allowed if a specific (non-shared) session temp dir is passed in.
	const sessionTmp = opts.tmpDir ? [allow(opts.tmpDir)] : [];

	const read: SandboxRule[] = [
		allow(cwd),
		...sessionTmp,
		allow(getPluginsDir()), // plugin engines/schemas (e.g. meddpicc)
		allow(skillsDir), // user-level skills
		allow(path.join(configRoot, "user-profile.json")),
		allow(path.join(configRoot, "computer-profile.json")),
		allow(path.join(configRoot, "settings.json")),
		...leakDenies,
		...extraAllow,
		...expand(opts.allowRead, true),
	];

	const write: SandboxRule[] = [
		allow(cwd),
		...sessionTmp,
		...leakDenies,
		...extraAllow,
		...expand(opts.allowWrite, true),
	];

	return new SandboxPolicy({ enabled: opts.enabled ?? true, cwd, read, write });
}
