#!/usr/bin/env bun

/**
 * Reconcile git tags against what was actually published (#2505).
 *
 * #2496 waits for a CI run to exist for a tag, which is a real improvement over
 * trusting `git push` to exit 0. But `ghCountRuns` counts runs without filtering
 * conclusion, so a run that fired and was then cancelled still counts as success.
 * That is precisely how v19.96.0 came to be tagged, unreleased, and silent.
 *
 * It is also a one-shot check at tag time. Anything that dies afterwards leaves
 * no alarm at all, and a human can cancel a run between publish-npm and
 * update-homebrew no matter how the concurrency groups are configured. So the
 * only durable check is the end state, on a schedule: for every tag a release,
 * and for every release a published package.
 *
 * Every uncertainty is a failure. An unreachable registry is not a clean bill of
 * health -- same fail-closed rule as docs-control #806/#817. The alternative is a
 * monitor that goes quiet exactly when the thing it monitors is broken.
 *
 * Usage:
 *   bun scripts/ci-reconcile-releases.ts [--limit N]
 *
 * Requires `gh` authenticated with contents:read.
 */

/** How the caller enumerates git tags, newest first. */
export type ListTags = () => Promise<string[]>;
/** How the caller enumerates published GitHub releases. */
export type ListReleases = () => Promise<string[]>;
/** How the caller enumerates versions present on the npm registry. */
export type ListNpmVersions = () => Promise<string[]>;
/**
 * How the caller reads the tap's formula source. Raw text rather than a parsed
 * version, so the parsing and the health checks live in the pure layer where
 * they can be tested.
 */
export type ReadHomebrewFormula = () => Promise<string>;
/**
 * How the caller maps a release's asset names to their published sha256. GitHub
 * exposes a `digest` per asset, so verifying the tap against the real artifacts
 * costs one API call rather than downloading every archive.
 */
export type ListAssetDigests = (tag: string) => Promise<Map<string, string>>;

export interface ReconcileDeps {
	listTags: ListTags;
	listReleases: ListReleases;
	listNpmVersions: ListNpmVersions;
	readHomebrewFormula: ReadHomebrewFormula;
	listAssetDigests: ListAssetDigests;
	log: (message: string) => void;
}

export interface ReconcileOptions {
	/**
	 * Tags whose gap is deliberate, mapped to the reason. Entries are printed
	 * rather than dropped: an allowlist nobody sees becomes a place to hide real
	 * failures.
	 */
	allowlist?: Readonly<Record<string, string>>;
}

export interface Divergence {
	readonly tag: string;
	readonly missingRelease: boolean;
	readonly missingNpm: boolean;
	/**
	 * The tap serves one version, not a set, so this is only ever meaningful for
	 * the newest released tag. update-homebrew is a sibling of publish-npm (both
	 * needs: [create-release]), so it can die on its own and leave the tap behind.
	 */
	readonly missingHomebrew: boolean;
	/**
	 * The tap serves the right version but the formula cannot install:
	 * ci-release-homebrew.ts falls back to the literal "MISSING_SHA256" when an
	 * archive checksum is absent, so a formula can look current and still be
	 * unusable. Version equality alone would call that clean.
	 */
	readonly brokenHomebrew: boolean;
}

export interface ReconcileOutcome {
	status: "clean" | "diverged" | "unknown";
	divergences: Divergence[];
	detail?: string;
}

/**
 * Render the operator-facing reason a tag diverged. Exported and pure because
 * UAT caught the CLI printing "::error::v19.98.0: " with an empty reason -- the
 * inline builder knew about releases and npm but not the tap. An alarm that
 * fires without saying why is barely an alarm, and this is the piece unit tests
 * of the return value never touch.
 */
export function describeDivergence(d: Divergence): string {
	return [
		d.missingRelease ? "no GitHub release" : "",
		d.missingNpm ? "not on npm" : "",
		d.missingHomebrew ? "Homebrew tap is stale" : "",
		d.brokenHomebrew ? "Homebrew formula is broken" : "",
	]
		.filter(Boolean)
		.join(", ");
}

/** Strip the leading `v` git tags carry and npm versions do not. */
function toVersion(tag: string): string {
	return tag.replace(/^v/, "");
}

/**
 * Compare tags against releases and published packages. Pure with respect to
 * I/O -- every effect arrives through `deps`, so the decision logic is testable
 * in milliseconds rather than against a live release.
 */
export async function reconcileReleases(
	deps: ReconcileDeps,
	options: ReconcileOptions = {},
): Promise<ReconcileOutcome> {
	const allowlist = options.allowlist ?? {};

	let tags: string[];
	let releases: string[];
	let npmVersions: string[];
	let formula: string;
	try {
		[tags, releases, npmVersions, formula] = await Promise.all([
			deps.listTags(),
			deps.listReleases(),
			deps.listNpmVersions(),
			deps.readHomebrewFormula(),
		]);
	} catch (error) {
		// Fail closed. A lookup that errored tells us nothing about the release
		// state, and reporting "clean" here would silence the alarm precisely when
		// the infrastructure it depends on is degraded.
		const detail = error instanceof Error ? error.message : String(error);
		return { status: "unknown", divergences: [], detail: `lookup failed: ${detail}` };
	}

	const brewVersion = formula.match(/^\s*version\s+"([^"]+)"/m)?.[1];
	if (brewVersion === undefined) {
		// Unparseable formula tells us nothing about the tap's state.
		return { status: "unknown", divergences: [], detail: "no version line in the Homebrew formula" };
	}
	// A formula can carry the right version and still not install. The generator
	// substitutes the literal "MISSING_SHA256" when an archive is absent, an empty
	// digest list is vacuously "all valid", and URLs are written independently of
	// the version line so they can point at an older tag's assets.
	//
	// Limit worth stating: this checks the formula is internally coherent, not that
	// each digest matches the artifact it names. Proving that needs the archives
	// downloaded, which is a different job from a cheap scheduled check.
	const digests = [...formula.matchAll(/sha256\s+"([^"]*)"/g)].map(m => m[1] ?? "");
	const urlVersions = [...formula.matchAll(/url\s+"[^"]*?\/v?([0-9]+\.[0-9]+\.[0-9]+)\//g)].map(m => m[1]);
	// Pair each url with the sha256 that follows it, so a checksum can be checked
	// against the artifact it actually names.
	const pairs = [...formula.matchAll(/url\s+"([^"]+)"\s*\n\s*sha256\s+"([^"]*)"/g)].map(m => ({
		asset: (m[1] ?? "").split("/").pop() ?? "",
		sha: m[2] ?? "",
	}));

	let assetDigests: Map<string, string>;
	try {
		assetDigests = await deps.listAssetDigests(`v${toVersion(brewVersion)}`);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { status: "unknown", divergences: [], detail: `asset digest lookup failed: ${detail}` };
	}

	const brokenFormula =
		digests.length === 0 ||
		digests.some(d => !/^[a-f0-9]{64}$/.test(d)) ||
		urlVersions.some(v => v !== toVersion(brewVersion)) ||
		// --clobber means an archive can be replaced after the tap was written, so a
		// syntactically valid checksum proves nothing on its own.
		pairs.some(({ asset, sha }) => assetDigests.get(asset) !== sha);

	if (tags.length === 0) {
		// `git tag` returning nothing means a shallow or misconfigured checkout, not
		// a project without releases. Treating it as clean would pass forever.
		return { status: "unknown", divergences: [], detail: "no tags returned -- checkout is not usable" };
	}

	const released = new Set(releases);
	const published = new Set(npmVersions.map(toVersion));

	// The tap holds exactly one version, so only the newest tag that actually has
	// a release can be compared against it. Treating it as a set would mark every
	// older tag as missing from Homebrew and alarm permanently.
	const newestReleased = tags.find(t => released.has(t));

	const divergences: Divergence[] = [];
	for (const tag of tags) {
		const missingRelease = !released.has(tag);
		const missingNpm = !published.has(toVersion(tag));
		const isNewest = tag === newestReleased;
		const missingHomebrew = isNewest && toVersion(brewVersion) !== toVersion(tag);
		const brokenHomebrew = isNewest && !missingHomebrew && brokenFormula;
		if (!missingRelease && !missingNpm && !missingHomebrew && !brokenHomebrew) continue;

		const reason = allowlist[tag];
		if (reason !== undefined) {
			deps.log(`Known gap: ${tag} -- ${reason}`);
			// The allowlist records deliberate history, so it excuses a missing
			// release or npm publish. It must never excuse the tap: the tap holds
			// current state, and a regression there is new information regardless of
			// what was once decided about this tag.
			if (!missingHomebrew && !brokenHomebrew) continue;
			divergences.push({ tag, missingRelease: false, missingNpm: false, missingHomebrew, brokenHomebrew });
			continue;
		}
		divergences.push({ tag, missingRelease, missingNpm, missingHomebrew, brokenHomebrew });
	}

	return { status: divergences.length > 0 ? "diverged" : "clean", divergences };
}

/**
 * Tags whose gap is deliberate or already tracked. Each entry must say why, and
 * must be removable -- an entry that can never be deleted is a bug being
 * annotated rather than fixed.
 *
 * Entries are printed on every run. That is the point: a silent allowlist
 * becomes the place real failures go to hide.
 */
export const KNOWN_GAPS: Readonly<Record<string, string>> = {};

async function sh(cmd: string[]): Promise<string> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	if ((await proc.exited) !== 0) throw new Error(err.trim() || `${cmd[0]} failed`);
	return out;
}

if (import.meta.main) {
	const limitArg = process.argv.indexOf("--limit");
	const limit = limitArg === -1 ? 20 : Number(process.argv[limitArg + 1]);
	if (!Number.isInteger(limit) || limit <= 0) {
		console.error("::error::--limit must be a positive integer");
		process.exit(2);
	}

	const outcome = await reconcileReleases(
		{
			// Newest N only. Older tags may predate the current publishing pipeline,
			// and an alarm that always fires is an alarm nobody reads.
			listTags: async () =>
				(await sh(["git", "tag", "--sort=-v:refname"]))
					.split("\n")
					.map(t => t.trim())
					.filter(Boolean)
					.slice(0, limit),
			listReleases: async () => {
				const body = (await sh(["gh", "release", "list", "--limit", String(limit * 2), "--json", "tagName"])).trim();
				if (!body) return [];
				return (JSON.parse(body) as { tagName: string }[]).map(r => r.tagName);
			},
			listNpmVersions: async () => {
				const body = await sh(["curl", "-sSf", "--max-time", "30", "https://registry.npmjs.org/@f5-sales-demo/xcsh"]);
				return Object.keys((JSON.parse(body) as { versions?: Record<string, unknown> }).versions ?? {});
			},
			listAssetDigests: async (tag: string) => {
				const body = await sh(["gh", "api", `repos/f5-sales-demo/xcsh/releases/tags/${tag}`]);
				const assets = (JSON.parse(body) as { assets?: { name: string; digest?: string }[] }).assets ?? [];
				return new Map(
					assets
						.filter(a => typeof a.digest === "string")
						.map(a => [a.name, (a.digest as string).replace(/^sha256:/, "")] as const),
				);
			},
			readHomebrewFormula: async () => {
				// Formulae live at the tap root, not under Formula/.
				const rb = await sh(["gh", "api", "repos/f5-sales-demo/homebrew-tap/contents/xcsh.rb", "--jq", ".content"]);
				return Buffer.from(rb.trim(), "base64").toString("utf8");
			},
			log: (message: string) => {
				console.log(message);
			},
		},
		{ allowlist: KNOWN_GAPS },
	);

	if (outcome.status === "unknown") {
		console.error(`::error::release reconciliation could not complete (${outcome.detail}). Treating as a failure.`);
		process.exit(1);
	}
	if (outcome.status === "diverged") {
		for (const d of outcome.divergences) {
			console.error(`::error::${d.tag}: ${describeDivergence(d)}`);
		}
		console.error(
			`::error::${outcome.divergences.length} tag(s) diverge from what was published. Re-running the tagging workflow will NOT help once a tag is on origin; dispatch ci.yml on the tag instead.`,
		);
		process.exit(1);
	}
	console.log("All checked tags have a GitHub release and a published package.");
}
