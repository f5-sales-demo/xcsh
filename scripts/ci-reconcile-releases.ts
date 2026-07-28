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

export interface ReconcileDeps {
	listTags: ListTags;
	listReleases: ListReleases;
	listNpmVersions: ListNpmVersions;
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
}

export interface ReconcileOutcome {
	status: "clean" | "diverged" | "unknown";
	divergences: Divergence[];
	detail?: string;
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
	try {
		[tags, releases, npmVersions] = await Promise.all([
			deps.listTags(),
			deps.listReleases(),
			deps.listNpmVersions(),
		]);
	} catch (error) {
		// Fail closed. A lookup that errored tells us nothing about the release
		// state, and reporting "clean" here would silence the alarm precisely when
		// the infrastructure it depends on is degraded.
		const detail = error instanceof Error ? error.message : String(error);
		return { status: "unknown", divergences: [], detail: `lookup failed: ${detail}` };
	}

	if (tags.length === 0) {
		// `git tag` returning nothing means a shallow or misconfigured checkout, not
		// a project without releases. Treating it as clean would pass forever.
		return { status: "unknown", divergences: [], detail: "no tags returned -- checkout is not usable" };
	}

	const released = new Set(releases);
	const published = new Set(npmVersions.map(toVersion));

	const divergences: Divergence[] = [];
	for (const tag of tags) {
		const missingRelease = !released.has(tag);
		const missingNpm = !published.has(toVersion(tag));
		if (!missingRelease && !missingNpm) continue;

		const reason = allowlist[tag];
		if (reason !== undefined) {
			deps.log(`Known gap: ${tag} -- ${reason}`);
			continue;
		}
		divergences.push({ tag, missingRelease, missingNpm });
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
export const KNOWN_GAPS: Readonly<Record<string, string>> = {
	// Tagged 2026-07-27, never released: the push half-succeeded and emitted no
	// event (#2487), and the recovery dispatch was then cancelled. Nothing was
	// published -- npm has no 19.96.0 -- so the state is consistent, just a
	// skipped version. Whether to delete the tag is an open decision; this entry
	// exists so the daily check stays meaningful instead of failing forever on a
	// gap we already know about. Remove it when that decision lands.
	"v19.96.0": "skipped version -- tagged, never published; see #2487",
};

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
			const missing = [d.missingRelease ? "no GitHub release" : "", d.missingNpm ? "not on npm" : ""]
				.filter(Boolean)
				.join(", ");
			console.error(`::error::${d.tag}: ${missing}`);
		}
		console.error(
			`::error::${outcome.divergences.length} tag(s) diverge from what was published. Re-running the tagging workflow will NOT help once a tag is on origin; dispatch ci.yml on the tag instead.`,
		);
		process.exit(1);
	}
	console.log("All checked tags have a GitHub release and a published package.");
}
