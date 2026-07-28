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
import * as natives from "@f5-sales-demo/pi-natives";
import { getMemoriesDir, getSessionsDir, getXCSHContextsDir, pathIsWithin } from "@f5-sales-demo/pi-utils";

export type FenceAccess = "read" | "write";
export type FenceVerdict = "allow" | "deny";

export interface ContainmentFence {
	/** Canonical roots the shell may read and write. */
	readonly allow: readonly string[];
	/** Canonical roots the shell may read but not write. */
	readonly allowReadOnly: readonly string[];
	/** Canonical roots the shell may write but not read. */
	readonly allowWriteOnly: readonly string[];
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
	/** Roots granted read+write, as `--allow-path` does. */
	extraRoots?: readonly string[];
	/** Roots granted read only — `sandbox.allowRead`. Must NOT become writable. */
	readOnlyRoots?: readonly string[];
	/** Roots granted write only — `sandbox.allowWrite`. */
	writeOnlyRoots?: readonly string[];
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
	// Artifact subdirectories only. Granting the parents put credentials inside the fence —
	// `.cargo/credentials.toml`, `.m2/settings.xml`, `.npm/_authToken` — and `.cargo/config.toml`
	// and `.gradle/init.gradle` are worse than credentials: both can redirect a later build, so a
	// write there is persistence rather than theft. Found by adversarial review, verified writable.
	path.join(".bun", "install", "cache"),
	path.join(".cargo", "registry"),
	path.join(".cargo", "git"),
	path.join(".npm", "_cacache"),
	path.join(".m2", "repository"),
	path.join(".gradle", "caches"),
	path.join(".gradle", "wrapper"),
	path.join(".yarn", "berry", "cache"),
	path.join(".rustup", "toolchains"),
	path.join(".rustup", "downloads"),
	// No credential convention of their own, so granted whole.
	".pnpm-store",
	".deno",
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

/**
 * Parents that must never be denied, however the workspace is placed.
 *
 * Denying the workspace's parent closes sibling access, but the parent is not always a sibling
 * container. A workspace directly under `/`, under a system directory, or under the OS temp dir would
 * otherwise deny `/`, `/usr` or `/tmp` — refusing exactly the work this fence is supposed to leave
 * alone. The home tree is excluded too because the home deny already covers it, at the right depth.
 */
function tooBroadToDeny(candidate: string): boolean {
	if (candidate === path.parse(candidate).root) return true;
	const never = [
		safeReal(os.tmpdir()),
		"/usr",
		"/bin",
		"/sbin",
		"/lib",
		"/opt",
		"/etc",
		"/dev",
		"/proc",
		"/sys",
		"/var",
		"/private",
		"/System",
		"/Library",
		"/Users",
		"/home",
	];
	return never.includes(candidate);
}

/** realpath without throwing, for building the never-deny list. */
function safeReal(input: string): string {
	try {
		return fs.realpathSync(input);
	} catch {
		return input;
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
	const allowWriteOnly = new Set<string>();
	const deny = new Set<string>();

	// Home is one fence. The workspace's own parent is the other, and it is the one that matters when
	// checkouts live outside home: with /work/customer-a as the workspace, /work/customer-b matched no
	// rule at all and was readable and writable. Denying the parent closes sibling access wherever the
	// checkouts sit, which is the threat this exists for.
	if (home !== undefined && home !== workspace) deny.add(home);
	const parent = path.dirname(workspace);
	if (parent !== workspace && !tooBroadToDeny(parent)) deny.add(parent);

	for (const root of [options.sessionTmp, ...(options.extraRoots ?? [])]) {
		if (root === undefined) continue;
		const resolved = canonical(root);
		if (resolved !== undefined) allow.add(resolved);
	}
	// Kept distinct. Merging them into one read+write list made a folder shared for reading writable,
	// undoing the read/write split built for #2516 — found by adversarial review.
	for (const root of options.readOnlyRoots ?? []) {
		const resolved = canonical(root);
		if (resolved !== undefined) allowReadOnly.add(resolved);
	}
	for (const root of options.writeOnlyRoots ?? []) {
		const resolved = canonical(root);
		if (resolved !== undefined) allowWriteOnly.add(resolved);
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

	return {
		allow: [...allow],
		allowReadOnly: [...allowReadOnly],
		allowWriteOnly: [...allowWriteOnly],
		deny: [...deny],
	};
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
	const writeOnly = deepestMatch(fence.allowWriteOnly, candidate);
	const allowed = deepestMatch(fence.allow, candidate);

	const depth = (root: string | undefined): number => (root === undefined ? -1 : root.length);
	const deepest = Math.max(depth(denied), depth(readOnly), depth(writeOnly), depth(allowed));

	// Deny first at equal depth: the leak roots depend on it.
	if (denied !== undefined && depth(denied) === deepest) return "deny";
	if (readOnly !== undefined && depth(readOnly) === deepest) return access === "read" ? "allow" : "deny";
	if (writeOnly !== undefined && depth(writeOnly) === deepest) return access === "write" ? "allow" : "deny";
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
	/**
	 * Set when the backend enforces reads and writes but cannot govern truncation.
	 *
	 * True only on Landlock ABI 2 — kernels 5.19 to 6.1, which includes Debian 12 — where
	 * `LANDLOCK_ACCESS_FS_TRUNCATE` does not exist. A denied file cannot be read or written there, but
	 * `truncate(2)` can still zero it. That is destruction rather than disclosure, and it is not
	 * reachable through `>` (which needs write access at open), so the backend is still worth having.
	 * Reported rather than folded into `osEnforced`, because "enforced" and "enforced except this" are
	 * different claims and an operator is entitled to know which one they have.
	 */
	readonly truncationUngoverned?: boolean;
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
export function containmentStatus(
	enabled: boolean,
	platform: string = process.platform,
	probe: () => { backend: string; truncateHandled?: boolean } | undefined = probeNativeBackend,
): ContainmentStatus {
	if (!enabled) return { enabled: false, backend: "disabled", osEnforced: false };
	// macOS always has seatbelt, so there is nothing to ask.
	if (platform === "darwin") return { enabled: true, backend: "seatbelt", osEnforced: true };
	// Everywhere else the answer cannot be inferred from the platform name. Landlock can be compiled
	// out of the kernel, left out of its boot-time LSM list, or too old to allow cross-directory
	// rename — and none of that is visible from `process.platform`. Asking the native layer is the
	// difference between reporting what is enforcing and reporting what we hope is enforcing.
	// Guarded here rather than inside the probe, so *any* probe is safe to pass — including an injected
	// one. A native module from an older release has no such export, and letting a `TypeError` escape
	// would turn a missing status line into a broken `xcsh://about`. Falling back to `scanner-only`
	// understates the boundary, which is the safe direction to be wrong in.
	let probed: { backend: string; truncateHandled?: boolean } | undefined;
	try {
		probed = probe();
	} catch {
		probed = undefined;
	}
	if (probed?.backend === "landlock") {
		return {
			enabled: true,
			backend: "landlock",
			osEnforced: true,
			// Absent on the ABI that governs truncation; present, and stated, on the one that does not.
			...(probed.truncateHandled === false ? { truncationUngoverned: true } : {}),
		};
	}
	return { enabled: true, backend: "scanner-only", osEnforced: false };
}

/**
 * Ask the native layer which backend is active, if it can answer.
 *
 * **Reached through a namespace import on purpose.** A native module built before this export existed
 * does not have the symbol, and a static `import { containmentBackend }` against it fails at *link*
 * time with `SyntaxError: Export named 'containmentBackend' not found` — taking the whole module graph
 * down before any `try`/`catch` can run. Found exactly that way: the tarball install smoke test died on
 * it while the runtime guard sat there looking sufficient. A namespace member that is absent is merely
 * `undefined`, which is a case code can actually handle.
 */
function probeNativeBackend(): { backend: string; truncateHandled?: boolean } | undefined {
	const probe = (natives as { containmentBackend?: () => { backend: string; truncateHandled?: boolean } })
		.containmentBackend;
	return typeof probe === "function" ? probe() : undefined;
}
