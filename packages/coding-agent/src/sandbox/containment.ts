/**
 * The containment fence: what the shell may reach, enforced below the command text.
 *
 * This is deliberately NOT `SandboxPolicy`. That object is deny-by-default — "a path matched by no
 * rule is denied" — which is the right posture for the structured file tools and the wrong one here.
 * Confining a shell that way refuses ordinary work: measured on macOS 26.3, a deny-default seatbelt
 * profile could not even `execvp /bin/cat`.
 *
 * So the fence is gentle. It restricts no operation — `/usr`, `/tmp`, package caches, the network and
 * process execution are never mentioned, and nothing that works today stops working. The single thing
 * it prevents is the assistant wandering the filesystem: reading or writing another customer's
 * checkout, `~/.ssh`, `~/Documents`. That is where the cross-customer risk actually lives (#2554).
 *
 * Produced declaratively rather than as an ordered rule list, because the two backends disagree about
 * order: seatbelt evaluates rules in sequence with the last match winning, while Landlock only grants
 * and cannot deny a subpath of something granted. Both can compile `{allow, allowReadOnly, deny}` with
 * deny-wins, so neither has to reason about ordering.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMemoriesDir, getSessionsDir, getXCSHContextsDir, pathIsWithin } from "@f5-sales-demo/pi-utils";

export type FenceAccess = "read" | "write";
export type FenceVerdict = "allow" | "deny";

export interface ContainmentFence {
	/** Canonical roots the shell may read and write. */
	readonly allow: readonly string[];
	/** Canonical roots the shell may read but not write. */
	readonly allowReadOnly: readonly string[];
	/** Canonical roots denied in both directions, winning over any allow they sit inside. */
	readonly deny: readonly string[];
}

export interface ContainmentOptions {
	/** The session's working directory. Must exist — it is the one root that cannot be dropped. */
	workspace: string;
	/** Overridable for tests; defaults to the real home directory. */
	home?: string;
	/** A session-specific temp dir, if the session has one. */
	sessionTmp?: string;
	/** Roots granted read+write by `--allow-path` / `sandbox.allow*`. */
	extraRoots?: readonly string[];
	/** Cross-session leak roots to deny. Defaults to the real memories/sessions/contexts dirs. */
	leakRoots?: readonly string[];
}

/**
 * Directories inside home that hold tool state rather than the operator's data. Denying home without
 * carving these back out is what would break `bun install`, `cargo build` and `npm ci` — the exact
 * class of breakage this fence must not cause.
 *
 * `~/Library/Caches` is macOS-wide tool cache; it is not customer data and several toolchains use it.
 */
const CACHE_DIRS = [
	".bun",
	".cargo",
	".npm",
	".rustup",
	".cache",
	".yarn",
	".pnpm-store",
	".deno",
	".gradle",
	".m2",
	path.join("Library", "Caches"),
	path.join("Library", "pnpm"),
];

/** Read-only inside home: configuration a tool needs to behave correctly, but must not rewrite. */
const READ_ONLY_HOME = [".gitconfig", path.join(".config", "git")];

/**
 * Canonicalise a root, or return undefined when it is absent.
 *
 * Canonicalisation is load-bearing rather than tidiness: a seatbelt `(subpath "/tmp/x")` rule grants
 * nothing, because the real path is `/private/tmp/x`. A rule that appears to enforce and does not is
 * the worst outcome available, so a root that cannot be resolved is dropped rather than emitted.
 */
function canonical(root: string): string | undefined {
	try {
		return fs.realpathSync(root);
	} catch {
		return undefined;
	}
}

/** The deepest root containing `candidate`, so a nested rule beats the broader one it sits inside. */
function deepestMatch(roots: readonly string[], candidate: string): string | undefined {
	let best: string | undefined;
	for (const root of roots) {
		if (!pathIsWithin(root, candidate)) continue;
		if (best === undefined || root.length > best.length) best = root;
	}
	return best;
}

/** Build the fence for a session. Throws only when the workspace itself cannot be resolved. */
export function buildContainmentFence(options: ContainmentOptions): ContainmentFence {
	const workspace = canonical(options.workspace);
	if (workspace === undefined) {
		throw new Error(
			`sandbox containment: cannot canonicalise the session workspace ${options.workspace}. ` +
				"A fence built on an unresolved path would silently grant nothing, so refusing to build one.",
		);
	}

	const home = canonical(options.home ?? os.homedir());
	const allow = new Set<string>([workspace]);
	const allowReadOnly = new Set<string>();
	const deny = new Set<string>();

	// Home is the fence. Everything outside it is left alone entirely.
	if (home !== undefined && home !== workspace) deny.add(home);

	for (const root of [options.sessionTmp, ...(options.extraRoots ?? [])]) {
		if (root === undefined) continue;
		const resolved = canonical(root);
		if (resolved !== undefined) allow.add(resolved);
	}

	if (home !== undefined) {
		// Granted whether or not they exist yet. `~/.bun` has to be writable *before* the first
		// `bun install` creates it, so dropping absent caches would break exactly the first run.
		// Canonicalised when present, so a symlinked cache resolves to its real location.
		for (const cache of CACHE_DIRS) allow.add(canonical(path.join(home, cache)) ?? path.join(home, cache));
		for (const config of READ_ONLY_HOME) {
			allowReadOnly.add(canonical(path.join(home, config)) ?? path.join(home, config));
		}
	}

	// Cross-session leak roots. These may sit *under* an allowed root — the agent dir is inside home,
	// and a session whose workspace is the agent dir would otherwise re-expose every other session's
	// transcript. `fenceVerdict` resolves that by depth, so nesting is safe rather than accidental.
	const leaks = options.leakRoots ?? [getMemoriesDir(), getSessionsDir(), getXCSHContextsDir()];
	for (const leak of leaks) {
		const resolved = canonical(leak);
		if (resolved !== undefined) deny.add(resolved);
	}

	return { allow: [...allow], allowReadOnly: [...allowReadOnly], deny: [...deny] };
}

/**
 * Whether the fence permits `access` on `candidate`.
 *
 * Deepest match wins, and a deny beats an allow at equal depth — the same precedence `SandboxPolicy`
 * uses, so the two layers cannot disagree about a path they both see. Unlike that policy, the default
 * here is **allow**: a path matched by no rule is outside the fence and none of its business.
 */
export function fenceVerdict(fence: ContainmentFence, candidate: string, access: FenceAccess): FenceVerdict {
	const denied = deepestMatch(fence.deny, candidate);
	const readOnly = deepestMatch(fence.allowReadOnly, candidate);
	const allowed = deepestMatch(fence.allow, candidate);

	const depth = (root: string | undefined): number => (root === undefined ? -1 : root.length);
	const deepest = Math.max(depth(denied), depth(readOnly), depth(allowed));

	// Deny first at equal depth: the leak roots depend on it.
	if (denied !== undefined && depth(denied) === deepest) return "deny";
	if (readOnly !== undefined && depth(readOnly) === deepest) return access === "read" ? "allow" : "deny";
	if (allowed !== undefined && depth(allowed) === deepest) return "allow";
	return "allow";
}

/** Which mechanism is actually enforcing the boundary for the `bash` tool. */
export type ContainmentBackend = "seatbelt" | "landlock" | "scanner-only" | "disabled";

export interface ContainmentStatus {
	readonly enabled: boolean;
	readonly backend: ContainmentBackend;
	/** True when the kernel enforces it, false when only the command-text scan does. */
	readonly osEnforced: boolean;
}

/**
 * What is actually enforcing the boundary right now.
 *
 * Reported so an operator can tell a confined session from an unconfined one. The distinction is not
 * cosmetic: with a backend, a path is checked where it is opened and the spelling cannot matter;
 * without one, the only check reads the command text and is best-effort by construction. Two sessions
 * that look identical can offer very different guarantees, and `xcsh://about` is where that is stated.
 *
 * Deliberately not surfaced at startup or anywhere in the TUI — the operator asked for no UI change.
 */
export function containmentStatus(enabled: boolean, platform: string = process.platform): ContainmentStatus {
	if (!enabled) return { enabled: false, backend: "disabled", osEnforced: false };
	// Only the macOS seatbelt backend exists today. Linux Landlock is a follow-up; until it lands,
	// Linux and Windows fall back to the scanner and say so rather than implying enforcement.
	if (platform === "darwin") return { enabled: true, backend: "seatbelt", osEnforced: true };
	return { enabled: true, backend: "scanner-only", osEnforced: false };
}
