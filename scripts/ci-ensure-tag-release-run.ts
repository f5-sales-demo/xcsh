#!/usr/bin/env bun

/**
 * Assert the tagging workflow's REAL post-condition: a CI run exists for the tag.
 *
 * `git push origin <tag>` exiting 0 does not mean the tag-gated release chain will
 * fire. On 2026-07-27 v19.96.0 was tagged and never released (#2487): the first
 * push attempt half-succeeded — GitHub wrote the ref, then failed with
 * `fatal error in commit_refs` and reported `[remote rejected]` — so no push event
 * was emitted. The retry five seconds later found the ref already present and
 * printed `Everything up-to-date`, which the workflow's `until` loop read as
 * success. It exited 0 announcing a chain that never fired, and npm/Homebrew sat
 * on the previous version while every merge after it went unshipped.
 *
 * That state is also unrecoverable by re-running the tagging workflow: its
 * duplicate-tag guard sees the tag already on origin, skips the push, and so emits
 * nothing — forever. Only a manual dispatch or a later version bump escapes it.
 *
 * So this script waits on the post-condition instead of a proxy for it, and runs
 * whether or not the push step was skipped. If no run appears it dispatches the
 * chain explicitly; if that also fails it exits non-zero so the tag never sits
 * silently unreleased again.
 *
 * Usage:
 *   bun scripts/ci-ensure-tag-release-run.ts <tag>
 *
 * Requires `gh` authenticated (GH_TOKEN) with actions:read and actions:write.
 */

/** How the caller looks up how many CI runs exist for a tag ref. */
export type CountRuns = (tag: string) => Promise<number>;
/** How the caller triggers the tag-gated chain for a tag ref. */
export type Dispatch = (tag: string) => Promise<void>;

export interface EnsureDeps {
	countRuns: CountRuns;
	dispatch: Dispatch;
	sleep: (ms: number) => Promise<void>;
	log: (message: string) => void;
}

export interface EnsureOptions {
	/** Polls before concluding the push emitted no event. */
	pollAttempts?: number;
	/** Delay between polls, ms. */
	pollDelayMs?: number;
	/** Polls after dispatching, before giving up. */
	confirmAttempts?: number;
}

export interface EnsureOutcome {
	status: "already-fired" | "dispatched" | "failed";
	/** Total lookups performed — makes a slow event visible in the workflow log. */
	polls: number;
	detail?: string;
}

const DEFAULTS = { pollAttempts: 12, pollDelayMs: 10_000, confirmAttempts: 6 } as const;

/**
 * Ensure a CI run exists for `tag`, dispatching the chain if the push emitted no
 * event. Pure with respect to I/O — every effect arrives through `deps`, so the
 * decision logic is testable in milliseconds instead of against a live release.
 */
export async function ensureTagReleaseRun(
	tag: string,
	deps: EnsureDeps,
	options: EnsureOptions = {},
): Promise<EnsureOutcome> {
	const { pollAttempts, pollDelayMs, confirmAttempts } = { ...DEFAULTS, ...options };
	let polls = 0;

	// A run can lag the push by a few seconds, so absence on the first look is not
	// yet evidence the event was dropped.
	for (let i = 0; i < pollAttempts; i++) {
		polls++;
		if ((await deps.countRuns(tag)) > 0) {
			deps.log(`A CI run exists for ${tag} (after ${polls} check${polls === 1 ? "" : "s"}).`);
			return { status: "already-fired", polls };
		}
		if (i < pollAttempts - 1) await deps.sleep(pollDelayMs);
	}

	deps.log(
		`No CI run appeared for ${tag} after ${polls} checks — the tag exists but its push emitted no event. Dispatching the release chain explicitly.`,
	);
	try {
		await deps.dispatch(tag);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { status: "failed", polls, detail: `dispatch failed: ${detail}` };
	}

	for (let i = 0; i < confirmAttempts; i++) {
		polls++;
		if ((await deps.countRuns(tag)) > 0) {
			deps.log(`Dispatched chain for ${tag} is running.`);
			return { status: "dispatched", polls };
		}
		if (i < confirmAttempts - 1) await deps.sleep(pollDelayMs);
	}

	return {
		status: "failed",
		polls,
		detail: `dispatched the chain for ${tag} but no run appeared`,
	};
}

/** Count CI runs on `refs/tags/<tag>` via the GitHub CLI. */
async function ghCountRuns(tag: string): Promise<number> {
	const proc = Bun.spawn(
		["gh", "run", "list", "--workflow=ci.yml", "--branch", tag, "--limit", "1", "--json", "databaseId"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const out = await new Response(proc.stdout).text();
	if ((await proc.exited) !== 0) return 0;
	try {
		return (JSON.parse(out) as unknown[]).length;
	} catch {
		return 0;
	}
}

/** Dispatch ci.yml on `refs/tags/<tag>`. */
async function ghDispatch(tag: string): Promise<void> {
	const proc = Bun.spawn(["gh", "workflow", "run", "ci.yml", "--ref", tag], { stdout: "pipe", stderr: "pipe" });
	const err = await new Response(proc.stderr).text();
	if ((await proc.exited) !== 0) throw new Error(err.trim() || `gh workflow run failed for ${tag}`);
}

if (import.meta.main) {
	const tag = process.argv[2];
	if (!tag) {
		console.error("::error::usage: bun scripts/ci-ensure-tag-release-run.ts <tag>");
		process.exit(2);
	}
	const outcome = await ensureTagReleaseRun(tag, {
		countRuns: ghCountRuns,
		dispatch: ghDispatch,
		sleep: (ms: number) => Bun.sleep(ms),
		log: (message: string) => {
			console.log(message);
		},
	});
	if (outcome.status === "failed") {
		console.error(
			`::error::${tag} is tagged but no release run could be started (${outcome.detail}). The tag is on origin, so re-running the tagging workflow will NOT help — its duplicate-tag guard will skip the push. Dispatch ci.yml on ${tag} manually.`,
		);
		process.exit(1);
	}
}
