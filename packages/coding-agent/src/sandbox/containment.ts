/**
 * The containment fence: what the shell may reach, enforced below the command text.
 *
 * This is deliberately NOT `SandboxPolicy`. That object is deny-by-default — "a path matched by no
 * rule is denied" — which is the right posture for the structured file tools and the wrong one here.
 * Confining a shell that way refuses ordinary work: measured on macOS 26.3, a deny-default seatbelt
 * profile could not even `execvp /bin/cat`.
 *
 * So the fence is gentle. It leaves `/usr`, `/tmp`, package caches, the network and process execution
 * alone. Its cross-tenant courtesy removes the discovery step — enumerating the session root's parent —
 * while keeping named operator access. Other operators' accounts, explicit data roots and cross-session
 * state remain denied where the model has no legitimate reason to wander (#2554).
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
	getMemoriesDir,
	getSessionsDir,
	getXCSHContextsDir,
	normalizePathForComparison,
	pathIsWithin,
} from "@f5-sales-demo/pi-utils";

export type FenceAccess = "read" | "write" | "enumerate";
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
	/** Canonical directories whose own entries may not be enumerated. Descendants remain reachable by name. */
	readonly denyEnumerate: readonly string[];
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
	 * Home directory used to expand a leading `~` in a granted root. Overridable for tests, which cannot
	 * put a fixture in the operator's real home.
	 */
	homeForTilde?: string;
	/**
	 * Filesystem roots other than the workspace's own, denied wholesale — on Windows, the other drive
	 * letters. Overridable for tests, which cannot mount a second volume.
	 */
	otherRoots?: readonly string[];
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
 * Config and state directories of the CLIs xcsh ships plugins and skills for.
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
 * anything. The same operator-rights rule applies to all other files in home, including SSH and GPG
 * state: this fence isolates session context; it does not withhold the operator's own files.
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
 * Top-level directories that hold data on some machine even when this one has none of them.
 *
 * Denied by name whether or not the root enumeration sees them, because that enumeration is one
 * `readdir` and a fence whose coverage disappears if the call fails is not a fence. Everything the
 * fleet actually keeps customer material under is here, so enumeration only ever *adds* the
 * unforeseen — `/data`, `/scratch`, a bespoke mount.
 */
const DATA_ROOTS = [
	"/Users", // Account containers are denied, then this operator's canonical home is allowed back at
	"/home", // greater depth. That preserves #2637 without exposing another local account (#2788).
	"/root", // Linux superuser home: not this operator's account
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
 * `canonical` gives up on a path whose leaf is missing. Grants and leak roots must still be emitted
 * before their leaf exists, and they must share the namespace the kernel sees when an existing parent
 * is a symlink. Resolve the existing prefix and retain only the absent tail.
 */
function canonicalThroughExisting(target: string): string {
	const tail: string[] = [];
	let current = target;
	for (;;) {
		// `existsSync` before `realpathSync`, because the walk is otherwise exception-driven: every absent
		// segment costs a thrown-and-caught ENOENT. A fresh home has ten-or-so absent cache dirs, and that
		// alone was 8ms of a 15ms fence build — paid on the session's first `bash` call. `existsSync` does
		// not throw, so the common "absent leaf, present parent" case now costs two cheap stats.
		if (fs.existsSync(current)) {
			const resolved = canonical(current);
			if (resolved !== undefined) return path.join(resolved, ...tail);
		}
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

/**
 * Canonicalise a list of *granted* roots — `--allow-path`, `sandbox.allowRead`, `sandbox.allowWrite`.
 *
 * Two things a plain `canonical` got wrong, both found by adversarial review, and both the same mistake:
 * a grant that resolves to nothing is silently dropped, so the flag appears to do nothing while the
 * refusal it was meant to lift keeps recommending it.
 *
 *  - `~` is expanded. Passed straight to `realpathSync` it names a path that does not exist, so
 *    `sandbox.allowRead: ["~/shared"]` was discarded and could not restore parent enumeration. The
 *    policy this replaced expanded it, so this was a regression rather than an old gap.
 *  - An absent target is kept, resolved through the ancestors that do exist, so `--allow-path
 *    <new-output-dir>` can authorize creating it. Harmless while an unnamed path defaulted to allow;
 *    once unknown top-level roots are denied, dropping the grant turns the flag into a refusal.
 */
function resolveGrants(roots: readonly string[] | undefined, home: string): Set<string> {
	const resolved = new Set<string>();
	for (const root of roots ?? []) {
		const expanded = root === "~" ? home : root.startsWith(`~${path.sep}`) ? path.join(home, root.slice(2)) : root;
		resolved.add(canonicalThroughExisting(expanded));
	}
	return resolved;
}

/**
 * Filesystem roots other than the one the workspace is on.
 *
 * On POSIX there is one root and this is empty. On Windows every drive letter is its own root, so a
 * workspace on `C:` left `D:\customerB` and any mapped share matching no rule at all — and Windows has
 * no kernel backend, so the command-text scan is the entire boundary there. While that scan was
 * deny-by-default it refused those paths incidentally; making it agree with the fence (#2624) removed
 * the cover and exposed the gap. Found by adversarial review.
 *
 * **Unverified on Windows.** The probe below cannot run on the platforms this fleet uses, so what is
 * tested is the denying, not the discovery — see the test, which injects the list. A drive holding a
 * toolchain is opened again with `--allow-path`, which grants at greater depth.
 *
 * UNC paths (`\\server\share`) have no enumerable root and are not covered.
 */
function otherFilesystemRoots(fsRoot: string): string[] {
	if (process.platform !== "win32") return [];
	const roots: string[] = [];
	for (let letter = "A".charCodeAt(0); letter <= "Z".charCodeAt(0); letter++) {
		const drive = `${String.fromCharCode(letter)}:${path.sep}`;
		if (drive.toLowerCase() === fsRoot.toLowerCase()) continue;
		try {
			if (fs.statSync(drive).isDirectory()) roots.push(drive);
		} catch {
			// Not mounted. 26 stat calls once per fence build; cheaper than any alternative.
		}
	}
	return roots;
}

/**
 * Per-session state the agent keeps in the *shared* OS temp dir, which every session can reach.
 *
 * `local://` content lands at `<tmp>/xcsh-local/<sessionId>` (`internal-urls/local-protocol.ts`) and a
 * task's artifacts at `<tmp>/xcsh-tasks/<id>` (`task/index.ts`) whenever no session artifacts dir is
 * configured. Those are the same class as `~/.xcsh/agent/sessions` — one session reading another's
 * working notes — so they belong in the leak roots rather than being covered incidentally.
 *
 * Nothing else in the temp dir is touched: `xcsh://about` promises `/tmp` is reachable, and refusing it
 * wholesale is the false refusal #2582 removed. The session's OWN local root is granted back through
 * `extraRoots` at greater depth, so `local://` keeps working.
 *
 * **Two fixed parents, deliberately never enumerated.** The first version listed the temp dir looking for
 * `xcsh-task-*` siblings, which cost 15ms of a 25-42ms fence build on a 17k-entry temp directory — per
 * build, and unbounded as the directory fills. That was enough to push a trivial `echo` past the 50ms
 * auto-background threshold. It was also strictly weaker: enumeration cannot cover a directory created
 * after the fence was built, while a parent rule covers every child forever. `task/index.ts` was changed
 * to nest under `xcsh-tasks/` to make that possible.
 */
function sharedTempLeakRoots(): string[] {
	const tmp = safeReal(os.tmpdir());
	return [path.join(tmp, "xcsh-local"), path.join(tmp, "xcsh-tasks")];
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
	const denyEnumerate = new Set<string>();

	// The fence is a professional courtesy, not a privilege boundary. Refusing an entire parent tree
	// withheld paths the operator is entitled to use and recreated the whole-home failure from #2637.
	// What matters for cross-tenant context isolation is the discovery step: without a directory listing,
	// a session cannot casually scan the container and learn which sibling workspaces exist. The exact
	// parent therefore loses enumeration only; traversal and named reads/writes remain ordinary filesystem
	// operations. Operational parents such as `/usr` and the system temp directory are left alone.
	const parentToProtect = path.dirname(workspace);

	// Through `resolveGrants` like the allow-lists, so a session temp dir or artifacts dir that does not
	// exist yet is still granted rather than silently dropped.
	const tildeHome = canonical(options.homeForTilde ?? options.home ?? os.homedir()) ?? os.homedir();
	for (const root of resolveGrants(
		[options.sessionTmp, ...(options.extraRoots ?? [])].filter((r): r is string => r !== undefined),
		tildeHome,
	)) {
		allow.add(root);
	}
	// Kept distinct. Merging them into one read+write list made a folder shared for reading writable,
	// undoing the read/write split built for #2516 — found by adversarial review.
	//
	// A root in BOTH lists is the exception, and it is not hypothetical: `--allow-path <dir>` maps into
	// `sandbox.allowRead` *and* `sandbox.allowWrite` (main.ts:649). Left as two rules those sit at equal
	// depth, and `fenceVerdict` tests read-only first, so the write was refused — the flag the prompt
	// offers as the remedy for a refusal granted read only. A full allow is what both grants together
	// mean; the one-directional cases below are untouched.
	const readOnlyResolved = resolveGrants(options.readOnlyRoots, tildeHome);
	const writeOnlyResolved = resolveGrants(options.writeOnlyRoots, tildeHome);
	for (const root of readOnlyResolved) {
		if (writeOnlyResolved.has(root)) allow.add(root);
		else allowReadOnly.add(root);
	}
	for (const root of writeOnlyResolved) {
		if (!readOnlyResolved.has(root)) allowWriteOnly.add(root);
	}

	// An explicit read grant is the operator overriding this courtesy. The default allow-by-default
	// posture is intentionally not enough: it keeps named access working, while this one exact directory
	// still cannot be scanned. `--allow-path` appears in both settings lists, so it reaches this branch via
	// `readOnlyResolved`; a write-only grant does not imply permission to learn directory entries.
	const parentExplicitlyReadable = [...readOnlyResolved].some(root => pathIsWithin(root, parentToProtect));
	if (!tooBroadToDeny(parentToProtect, fsRoot) && !parentExplicitlyReadable) {
		denyEnumerate.add(parentToProtect);
	}

	if (home !== undefined) {
		// The account container is a data root, but this operator's whole home belongs to them (#2637).
		// A deeper full allow preserves their normal filesystem rights while leaving sibling accounts under
		// the broader deny. Cross-session stores are denied again at still greater depth below.
		allow.add(home);

		// Granted whether or not they exist yet. `~/.bun` has to be writable *before* the first
		// `bun install` creates it, so dropping absent caches would break exactly the first run.
		// Canonicalised when present, so a symlinked cache resolves to its real location.
		for (const cache of [...CACHE_DIRS, ...TOOL_CONFIG_DIRS]) {
			allow.add(canonicalThroughExisting(path.join(home, cache)));
		}
	}

	// Top-level directories that hold somebody's files. Without these the fence covered only home and
	// the workspace's ancestors, so with the workspace at `~/MEDDPICC/CUSTOMER-A` another operator's
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
	const accountRoots = new Set(["Users", "home"].map(name => canonicalThroughExisting(path.join(fsRoot, name))));
	const found = dataRootEntries(fsRoot).map(entry => canonical(entry) ?? entry);
	// Whole filesystem roots other than the workspace's own — the other Windows drives.
	//
	// Deliberately NOT run through `tooBroadToDeny`. On Windows `D:\` *is* a filesystem root, so that
	// check would drop every entry and make this rule a no-op on the one platform it exists for. The
	// protection it provides is already covered here: `otherFilesystemRoots` skips `fsRoot` itself, and
	// the workspace and grant checks below apply to these too. Verified as a live hazard rather than a
	// theoretical one — the first version of this did filter them, and the test could not see it because
	// a temp directory is not a filesystem root on this platform.
	const others = (options.otherRoots ?? otherFilesystemRoots(fsRoot)).map(root => canonicalThroughExisting(root));
	const rootScoped = new Set(others);
	for (const resolved of [...known, ...found, ...others]) {
		// e.g. /Volumes/Macintosh HD -> /. Skipped for the whole-root list, per the note above.
		if (!rootScoped.has(resolved) && tooBroadToDeny(resolved, fsRoot)) continue;
		if (resolved === fsRoot) continue; // never the root the workspace lives on
		// A directory containing home is normally too broad to deny because it would revoke the operator's
		// own files (#2637). Account containers are the deliberate exception: they are denied here and the
		// canonical home allow above wins at greater depth, isolating sibling accounts without hobbling the
		// operator (#2788).
		if (home !== undefined && pathIsWithin(resolved, home) && !accountRoots.has(resolved)) continue;
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
	// Emitted even when absent: a rule that appears only once the directory does is one nobody can rely
	// on, and creating it would otherwise be the way around it. This also covers relocated agent state.
	const leaks = options.leakRoots ?? [
		getMemoriesDir(),
		getSessionsDir(),
		getXCSHContextsDir(),
		...sharedTempLeakRoots(),
	];
	for (const leak of leaks) {
		deny.add(canonicalThroughExisting(leak));
	}

	return {
		allow: [...allow],
		allowReadOnly: [...allowReadOnly],
		allowWriteOnly: [...allowWriteOnly],
		deny: [...deny],
		denyEnumerate: [...denyEnumerate],
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
	if (access === "enumerate") {
		const normalizedCandidate = normalizePathForComparison(candidate);
		if (fence.denyEnumerate.some(root => normalizePathForComparison(root) === normalizedCandidate)) {
			return "deny";
		}
	}

	const denied = deepestMatch(fence.deny, candidate);
	const readOnly = deepestMatch(fence.allowReadOnly, candidate);
	const writeOnly = deepestMatch(fence.allowWriteOnly, candidate);
	const allowed = deepestMatch(fence.allow, candidate);
	const ordinaryAccess = access === "enumerate" ? "read" : access;

	const depth = (root: string | undefined): number => (root === undefined ? -1 : root.length);
	const deepest = Math.max(depth(denied), depth(readOnly), depth(writeOnly), depth(allowed));

	// Deny first at equal depth: the leak roots depend on it.
	if (denied !== undefined && depth(denied) === deepest) return "deny";
	if (readOnly !== undefined && depth(readOnly) === deepest) return ordinaryAccess === "read" ? "allow" : "deny";
	if (writeOnly !== undefined && depth(writeOnly) === deepest) return ordinaryAccess === "write" ? "allow" : "deny";
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
