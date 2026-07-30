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
import {
	getAgentDir,
	getConfigRootDir,
	getMemoriesDir,
	getPluginsDir,
	getSessionsDir,
	getXCSHContextsDir,
	pathIsWithin,
} from "@f5-sales-demo/pi-utils";

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
	/**
	 * Whether the active backend can express "writable directory, except this file" — see
	 * COMMAND_BEARING_CONFIG. True for seatbelt, false for Landlock, which cannot.
	 *
	 * Defaults to false, so a caller that does not know its backend gets the portable policy rather
	 * than one that silently breaks the CLIs on Linux.
	 */
	narrowsWithinGrant?: boolean;
	/**
	 * The filesystem root whose immediate entries are classified as operational or data — see
	 * DATA_ROOTS. Overridable for tests; defaults to the real root.
	 *
	 * A test cannot use the real `/`, and pointing this at a temp directory instead is not merely
	 * convenient: it is the only way to assert that an unknown root is denied *while* its operational
	 * siblings are not, which is the whole property.
	 */
	fsRoot?: string;
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
	// Go keeps its module cache under ~/go, but ~/go also holds checked-out source and `go install`
	// output, so only the cache is granted. Missed in the original list; `go build` failed for it.
	path.join("go", "pkg", "mod"),
	// The build cache is separate from the module cache and `go build` needs both. On macOS it lands in
	// ~/Library/Caches (already granted); on Linux it is ~/.cache/go-build, which nothing else covers.
	path.join(".cache", "go-build"),
	// No credential convention of their own, so granted whole.
	".pnpm-store",
	".deno",
	path.join("Library", "Caches"),
	path.join("Library", "pnpm"),
];

/**
 * Config and state directories of the CLIs xcsh ships plugins and skills for — the same list it probes
 * for in `internal-urls/computer-profile.ts`.
 *
 * Granted read and write. In v19.100.0 the home deny covered all of these, so every one of `gh`, `glab`,
 * `sf`, `az`, `aws` and `gcloud` failed on its own configuration — and the agent is instructed to file
 * issues with `gh` (#2581). Write is required, not convenience: `az` writes a log per invocation to
 * `~/.azure/commands`, `sf` writes a dated log into `~/.sf`, and both `aws` and `gcloud` refresh cached
 * tokens without being asked. Measured with these read-only instead: `az` exits 1 on
 * `~/.azure/commands/<stamp>.log`, and `sf` reproduces the original `EPERM` crash on `~/.sf/sf-<date>.log`.
 *
 * The cost, stated plainly: a fence keyed on paths cannot let `aws` read `~/.aws/credentials` without
 * letting `cat` read it, so the operator's cloud credentials are readable from a fenced shell. Accepted,
 * because the fence exists to stop the assistant wandering between customer workspaces rather than to
 * withhold the operator's credential store from the operator's own CLIs — and the native `az`/`aws` tools
 * already act with those credentials, so denying only the shell path broke the CLIs without protecting
 * anything. `~/.ssh` and `~/.gnupg` are still denied: no shipped tool needs them.
 *
 * Reading a credential is not the same as being able to *replace* one, so see COMMAND_BEARING_CONFIG.
 */
const TOOL_CONFIG_DIRS = [
	path.join(".config", "gh"), // gh
	path.join(".config", "glab-cli"), // glab, XDG layout
	path.join("Library", "Application Support", "glab-cli"), // glab, macOS layout
	".sf", // sf
	".sfdx", // sf, legacy layout still read by current versions
	".azure", // az
	".aws", // aws
	path.join(".config", "gcloud"), // gcloud
	".docker", // docker
	".kube", // kubectl
	".terraform.d", // terraform
];

/**
 * Paths inside TOOL_CONFIG_DIRS that name a command or hold a loadable executable. Read-only, so the
 * grant above never becomes a way to run code later.
 *
 * This is the distinction that matters: reading `~/.aws/credentials` discloses a secret, but *writing*
 * `~/.aws/config` installs a `credential_process` that the operator's next — unfenced — `aws` call
 * executes, with access to every customer workspace and private file the fence exists to protect. That
 * is an escape from the sandbox rather than a leak inside it. `~/.cargo/config.toml` and
 * `~/.gradle/init.gradle` are excluded from the cache carve-out for exactly this reason; these are the
 * same class, and none of them was writable before #2581, so keeping them read-only means that change
 * adds no new write capability on any path that can cause execution.
 *
 * Each entry is a documented mechanism, not a guess: `credential_process` (aws), `user.exec`
 * (kubeconfig), `credsStore`/`credHelpers` and CLI plugins (docker), Python extensions (az), provider
 * binaries (terraform), the virtualenv `activate` that gcloud's launcher sources, and `!`-prefixed shell
 * aliases (gh, glab). The CLIs still read all of them, so nothing stops working; only rewriting does.
 * `gh auth login` and `glab auth login` are interactive and belong outside a fenced session anyway.
 */
const COMMAND_BEARING_CONFIG = [
	path.join(".aws", "config"), // credential_process = <command>
	path.join(".aws", "cli", "alias"), // aws aliases; a leading `!` runs through a shell
	path.join(".azure", "config"), // extension.index_url + use_dynamic_install fetch and run wheels
	path.join(".kube", "config"), // users[].user.exec.command
	path.join(".docker", "config.json"), // credsStore / credHelpers -> docker-credential-*
	path.join(".docker", "cli-plugins"), // docker-* plugin executables
	path.join(".azure", "cliextensions"), // az extensions, executed as Python
	path.join(".terraform.d", "plugins"), // provider binaries
	path.join(".config", "gcloud", "virtenv"), // sourced by the gcloud launcher
	path.join(".config", "gh", "config.yml"), // gh alias set x '!sh -c ...', plus editor/browser/pager
	// glab keeps aliases in their own file, so those can be held read-only. Its config.yml cannot:
	// glab rewrites it on ordinary commands (atomic rename) to refresh the OAuth token and the
	// update-check stamp, and holding it read-only reproduced #2581 — `glab auth status` exits 1 with
	// "rename …/.config.yml".
	//
	// Worse than a failed command, and the reason this is not merely a convenience: the OAuth refresh
	// already happened at GitLab, so a denied write loses the rotated refresh token and the operator's
	// login is permanently dead — `invalid_grant` afterwards, even outside the fence. Observed while
	// testing this change, which cost a real `glab auth login`. Any CLI that refreshes a rotating token
	// must be able to persist it.
	//
	// Left writable, and the residual exposure is stated rather than hidden:
	// that file also carries `editor`, `browser` and `duo_cli_binary_path`/`duo_cli_auto_run`, so a write
	// there IS a code-execution vector this fence does not close. `gh` needs no such exception because it
	// was measured working with its config.yml read-only.
	path.join(".config", "glab-cli", "aliases.yml"),
	path.join("Library", "Application Support", "glab-cli", "aliases.yml"),
];

/** Read-only inside home: configuration a tool needs to behave correctly, but must not rewrite. */
const READ_ONLY_HOME = [".gitconfig", path.join(".config", "git")];

/**
 * Names of top-level directories that hold tools rather than data.
 *
 * Used to classify the immediate entries of the filesystem root: an entry NOT named here holds
 * somebody's files, and is denied (see DATA_ROOTS). Matching is by basename, so it works the same for
 * the real `/` and for the synthetic root a test injects.
 *
 * A name here is not a grant — the fence is allow-by-default, so these are simply left unmentioned.
 * The list is deliberately generous: a wrong entry costs one unreachable data root, while a missing
 * entry breaks a toolchain, which is the failure this whole change exists to remove. Both platforms in
 * one list, because a name absent from a platform simply never matches.
 */
const OPERATIONAL_ROOT_NAMES = new Set([
	// macOS and Linux system trees
	"usr",
	"bin",
	"sbin",
	"lib",
	"lib32",
	"lib64",
	"libx32",
	"etc",
	"opt",
	"dev",
	"proc",
	"sys",
	"run",
	"boot",
	"var",
	"tmp",
	"private",
	"System",
	"Library",
	"Applications",
	"cores",
	// Package managers and container runtimes that own a root of their own
	"nix",
	"snap",
	"vendor",
]);

/**
 * The operator's own profile and settings, read by the agent to describe the machine it is on.
 *
 * Read-only, and named individually rather than by their directory: the config root also holds the
 * cross-session leak dirs, which stay denied at greater depth.
 */
const AGENT_PROFILE_FILES = ["user-profile.json", "computer-profile.json", "settings.json"].map(name =>
	path.join(getConfigRootDir(), name),
);

/**
 * Top-level directories that hold data on some machine even when this one has none of them.
 *
 * Denied by name whether or not the root enumeration sees them, because that enumeration is one
 * `readdir` and a fence whose coverage disappears if the call fails is not a fence. Everything the
 * fleet actually keeps customer material under is here, so enumeration only ever *adds* the
 * unforeseen — `/data`, `/scratch`, a bespoke mount.
 */
const DATA_ROOTS = [
	"/Users", // macOS home container: other operators' accounts, /Users/Shared
	"/home", // Linux home container
	"/root", // Linux superuser home
	"/Volumes", // macOS mounts. Per-container, not per-child: /Volumes/Macintosh HD resolves to /,
	"/mnt", // which `tooBroadToDeny` then rejects, and the kernel resolves such a path before any
	"/media", // rule matches it — so denying the container cannot deny the boot volume.
	"/srv",
	"/net",
	"/export",
];

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
 * Canonicalise as much of `target` as already exists, keeping the absent tail.
 *
 * `canonical` gives up on a path whose leaf is missing, and falling back to the literal string is not
 * safe for a rule whose job is to *narrow* another one. With `~/.aws` symlinked to a vault — chezmoi,
 * stow and yadm all do this — and no config file yet, the grant is emitted resolved (`<vault>`) while
 * the read-only rule keeps the link spelling (`~/.aws/config`). Both backends match a rule against the
 * path the kernel resolved, so the narrower rule covers nothing.
 *
 * That was verified as a real escape before this existed: through the real seatbelt profile,
 * `printf 'credential_process = …' > <vault>/config` succeeded. Note `fenceVerdict` did NOT show it,
 * because `pathIsWithin` normalises symlinks — the in-process check was safe while the emitted profile
 * was not, so a test asserting only the verdict passes while the boundary leaks.
 */
function canonicalThroughExisting(target: string): string {
	const tail: string[] = [];
	let current = target;
	for (;;) {
		const resolved = canonical(current);
		if (resolved !== undefined) return path.join(resolved, ...tail);
		const parent = path.dirname(current);
		if (parent === current) return target;
		tail.unshift(path.basename(current));
		current = parent;
	}
}

/**
 * Parents that must never be denied, however the workspace is placed.
 *
 * Denying the workspace's parent closes sibling access, but the parent is not always a sibling
 * container. A workspace directly under `/`, under a system directory, or under the OS temp dir would
 * otherwise deny `/`, `/usr` or `/tmp` — refusing exactly the work this fence is supposed to leave
 * alone.
 *
 * `/Users` and `/home` were here too, and deliberately are no longer: those hold other operators'
 * accounts, so denying them is the point rather than the accident (#2624). The workspace, the caches
 * and the tool config dirs all match at greater depth, and home is denied anyway, so nothing inside
 * the current account changes.
 */
function tooBroadToDeny(candidate: string, fsRoot: string): boolean {
	if (candidate === path.parse(candidate).root) return true;
	// The configured filesystem root, whatever it is. In production that is the same as the check
	// above; for a test it is the injected root, which the ancestor walk would otherwise deny — taking
	// every operational sibling with it and hiding the very distinction being asserted.
	if (candidate === fsRoot) return true;
	const never = [
		safeReal(os.tmpdir()),
		// Both spellings: `/tmp` resolves to `/private/tmp` on macOS, and the ancestor walk works on
		// resolved paths. Without the resolved form, a workspace at `/tmp/<x>/repo` denied `/private/tmp`
		// — every other temp path with it — which contradicts the `/tmp` guarantee in `xcsh://about`.
		"/tmp",
		safeReal("/tmp"),
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
	];
	return never.includes(candidate);
}

/**
 * Immediate entries of `fsRoot` that are not operational, so they hold data.
 *
 * One `readdir`, and its failure is not fatal: DATA_ROOTS already covers everything the fleet keeps
 * customer material under, so this only adds the unforeseen. Entries are returned as their link path
 * and canonicalised by the caller, which is where `/Volumes/Macintosh HD -> /` gets rejected.
 *
 * A directory mounted *after* this runs is not seen, and is therefore allowed. Stated rather than
 * hidden: the alternative — denying the root itself and re-allowing the operational set — is complete
 * but denies every path not on that list, which is the failure mode #2624 exists to remove.
 */
function dataRootEntries(fsRoot: string): string[] {
	try {
		return (
			fs
				.readdirSync(fsRoot, { withFileTypes: true })
				.filter(entry => entry.isDirectory() || entry.isSymbolicLink())
				// A dotted entry at the filesystem root is a system synthetic — `/.vol`, `/.resolve`,
				// `/.nofollow` on macOS — not a place anyone keeps material. Denying them adds noise to every
				// emitted profile and, for `/.vol`, restricts a lookup path the OS uses itself.
				.filter(entry => !entry.name.startsWith("."))
				.filter(entry => !OPERATIONAL_ROOT_NAMES.has(entry.name))
				.map(entry => path.join(fsRoot, entry.name))
		);
	} catch {
		return [];
	}
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
	const fsRoot = options.fsRoot ?? path.parse(workspace).root;
	const allow = new Set<string>([workspace]);
	const allowReadOnly = new Set<string>();
	const allowWriteOnly = new Set<string>();
	const deny = new Set<string>();

	// Home is one fence. The workspace's ancestors are the other, and they are what matters when
	// checkouts live outside home: with /work/customer-a as the workspace, /work/customer-b matched no
	// rule at all and was readable and writable.
	//
	// Every ancestor, not just the immediate parent. One level only works when the parent happens to be
	// the container the tenants sit in; with `<container>/<tenant>/repo` the immediate parent IS the
	// tenant, so every OTHER tenant matched nothing and the fence allowed it, read and write. That went
	// unnoticed because the command-text scan is deny-by-default and refused those paths on the way in —
	// the composite looked right while the fence alone did not. Removing that scan for OS-confined shells
	// (#2582) is what exposed it, so the two changes ship together.
	//
	// Denying an ancestor costs nothing above it: the walk stops before anything `tooBroadToDeny`
	// rejects, so `/`, `/usr`, `/tmp` and `$TMPDIR` are never denied and operational paths stay
	// reachable. And it costs nothing below: the workspace is allowed at greater depth, and
	// `fenceVerdict` takes the deepest match.
	if (home !== undefined && home !== workspace) deny.add(home);
	for (let ancestor = path.dirname(workspace); ; ancestor = path.dirname(ancestor)) {
		if (tooBroadToDeny(ancestor, fsRoot)) break;
		deny.add(ancestor);
		const next = path.dirname(ancestor);
		if (next === ancestor) break; // reached a filesystem root that `tooBroadToDeny` did not name
	}

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
		for (const cache of [...CACHE_DIRS, ...TOOL_CONFIG_DIRS]) {
			allow.add(canonicalThroughExisting(path.join(home, cache)));
		}
		// Deeper than the grant above, so `fenceVerdict` picks these and write becomes a deny while read
		// stays allowed. Emitted even when absent, or creating the file would be the way around it — and
		// resolved through existing ancestors, or a symlinked config dir puts the two rules in different
		// namespaces and the narrower one stops applying.
		//
		// COMMAND_BEARING_CONFIG only when the backend can express a narrowing *inside* a grant.
		// Seatbelt can: it is last-match-wins, so a deeper deny simply overrides. Landlock cannot — its
		// rules are allow-only and always recursive, so a read-only child turns its parent into a split
		// dir that loses write on its own inode. Verified with `containment-check plan`: adding
		// `~/.azure/cliextensions` as read-only made `~/.azure` itself `r-`, which would stop `az` from
		// creating `azureProfile.json` at all. Applying it anyway would trade a code-execution path for
		// breaking the very CLIs #2581 is about, so the gap is reported instead — the same choice already
		// made for `truncationUngoverned`.
		const narrowed = options.narrowsWithinGrant ? COMMAND_BEARING_CONFIG : [];
		for (const config of [...READ_ONLY_HOME, ...narrowed]) {
			allowReadOnly.add(canonicalThroughExisting(path.join(home, config)));
		}
	}

	// The agent's own inputs, which sit inside the denied home tree. The file tools allow-listed these
	// while the fence did not, so `bash` could not read a plugin that `read` could — one of the
	// asymmetries #2624 removes now that both consult this fence. Read-only: they are inputs, and a
	// write changes what a later session loads. Emitted through existing ancestors so the skills
	// directory, which is created on first use, is covered before it exists rather than after.
	for (const own of [getPluginsDir(), path.join(getAgentDir(), "skills"), ...AGENT_PROFILE_FILES]) {
		allowReadOnly.add(canonicalThroughExisting(own));
	}

	// Top-level directories that hold somebody's files. Without these the fence covered only home and
	// the workspace's ancestors, so with the workspace at `~/MEDDPICC/EQUIFAX` another operator's
	// account, an external volume and `/data/globex` were all readable AND writable — measured. The
	// command-text scan was refusing them on the way in, which is exactly why that scan could not
	// simply be stood down (#2624).
	//
	// Two sources, and the static one is not redundant: enumeration is a single `readdir` that can
	// fail, and coverage that evaporates with it would be worse than no claim at all. So the known data
	// roots are denied by name, and enumeration adds whatever this machine has that the list does not
	// foresee.
	//
	// The known roots are resolved through their existing ancestors rather than dropped when absent, so
	// a `/data` created *after* the session starts is already denied. Seatbelt matches a `(subpath …)`
	// prefix whether or not the path exists; Landlock cannot attach a rule to an absent inode, but its
	// plan never grants a path `readdir` did not see either, so nothing is lost there.
	const known = DATA_ROOTS.map(name => canonicalThroughExisting(path.join(fsRoot, path.basename(name))));
	const found = dataRootEntries(fsRoot).map(entry => canonical(entry) ?? entry);
	for (const resolved of [...known, ...found]) {
		if (tooBroadToDeny(resolved, fsRoot)) continue; // e.g. /Volumes/Macintosh HD -> /
		// A deny beats an allow at EQUAL depth, so denying a root that IS the workspace or IS something
		// the operator granted would not be redundant — it would silently revoke the grant. Deeper is
		// fine and intended: an ancestor deny with the workspace allowed inside it is the normal shape.
		if (resolved === workspace) continue;
		if (allow.has(resolved) || allowReadOnly.has(resolved) || allowWriteOnly.has(resolved)) continue;
		deny.add(resolved);
	}

	// Cross-session leak roots. These may sit *under* an allowed root — the agent dir is inside home,
	// and a session whose workspace is the agent dir would otherwise re-expose every other session's
	// transcript. `fenceVerdict` resolves that by depth, so nesting is safe rather than accidental.
	//
	// Emitted even when absent, for the reason COMMAND_BEARING_CONFIG is: a rule that appears only once
	// the directory does is one nobody can rely on, and creating it would otherwise be the way around
	// it. Today the home deny covers all three anyway, so this matters only where the agent dir has
	// been relocated outside home — but "only matters in that case" is how the last few holes were built.
	const leaks = options.leakRoots ?? [getMemoriesDir(), getSessionsDir(), getXCSHContextsDir()];
	for (const leak of leaks) {
		deny.add(canonicalThroughExisting(leak));
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
	/**
	 * Set when the backend cannot hold a file read-only inside a writable directory, so the
	 * command-bearing CLI settings (`~/.aws/config`, `~/.kube/config`, …) are writable. Landlock's rules
	 * are allow-only and recursive; narrowing inside a grant would strip write from the parent directory
	 * and break the CLIs the grant exists for. Reported rather than folded into `osEnforced`, because it
	 * changes what a write to those paths means, not whether the boundary holds.
	 */
	readonly commandConfigWritable?: boolean;
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
			// Always true here: no Landlock ABI can narrow a right inside a grant.
			commandConfigWritable: true,
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
