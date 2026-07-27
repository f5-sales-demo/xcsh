import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureTagReleaseRun } from "../../../../scripts/ci-ensure-tag-release-run";

/**
 * The tagging workflow's real post-condition (#2487).
 *
 * `git push origin <tag>` exiting 0 does NOT mean the release chain will fire.
 * On 2026-07-27 v19.96.0 was tagged and never released: the first push attempt
 * half-succeeded — GitHub wrote the ref, then failed with
 * `fatal error in commit_refs` and reported `[remote rejected]` — so **no push
 * event was emitted**. The retry five seconds later found the ref already there
 * and printed `Everything up-to-date`, which the `until` loop read as success.
 * The workflow exited 0 announcing a chain that never fired.
 *
 * Worse, the state is unrecoverable by re-running: the duplicate-tag guard sees
 * the tag on origin and skips the push, so nothing ever emits an event again.
 *
 * So the post-condition to wait on is not "push exited 0" but "a CI run exists
 * for refs/tags/<tag>" — and when it is missing, the chain must be dispatched
 * explicitly rather than assumed. Same rule as #2364/#2463: wait on the thing
 * you actually need, never on a proxy for it.
 */

type Call = string;

function harness(runCounts: number[], opts: { dispatchThrows?: boolean; afterDispatch?: number[] } = {}) {
	const calls: Call[] = [];
	const before = [...runCounts];
	const after = [...(opts.afterDispatch ?? [])];
	let dispatched = false;
	return {
		calls,
		deps: {
			countRuns: async () => {
				calls.push("count");
				const queue = dispatched ? after : before;
				return queue.length > 0 ? (queue.shift() as number) : 0;
			},
			dispatch: async () => {
				calls.push("dispatch");
				dispatched = true;
				if (opts.dispatchThrows) throw new Error("dispatch refused");
			},
			sleep: async () => {
				calls.push("sleep");
			},
			log: () => {},
		},
	};
}

const FAST = { pollAttempts: 3, pollDelayMs: 0, confirmAttempts: 2 };

describe("ensureTagReleaseRun waits on 'a run exists', not on 'push exited 0' (#2487)", () => {
	it("reports already-fired without dispatching when the run is already there", async () => {
		const h = harness([1]);
		const out = await ensureTagReleaseRun("v1.2.3", h.deps, FAST);
		expect(out.status).toBe("already-fired");
		expect(h.calls).not.toContain("dispatch");
	});

	it("tolerates event lag: polls until the run shows up, still without dispatching", async () => {
		// GitHub can take a moment to register the run; absence on the first look
		// is not yet evidence the event was dropped.
		const h = harness([0, 0, 1]);
		const out = await ensureTagReleaseRun("v1.2.3", h.deps, FAST);
		expect(out.status).toBe("already-fired");
		expect(h.calls).not.toContain("dispatch");
	});

	it("dispatches the chain when the push emitted no event at all", async () => {
		// The v19.96.0 case: tag present, zero runs, forever.
		const h = harness([0, 0, 0], { afterDispatch: [1] });
		const out = await ensureTagReleaseRun("v19.96.0", h.deps, FAST);
		expect(out.status).toBe("dispatched");
		expect(h.calls.filter(c => c === "dispatch")).toHaveLength(1);
	});

	it("fails loudly when even the dispatch produces no run", async () => {
		const h = harness([0, 0, 0], { afterDispatch: [0, 0] });
		const out = await ensureTagReleaseRun("v19.96.0", h.deps, FAST);
		expect(out.status).toBe("failed");
	});

	it("fails loudly when the dispatch itself is refused", async () => {
		const h = harness([0, 0, 0], { dispatchThrows: true });
		const out = await ensureTagReleaseRun("v19.96.0", h.deps, FAST);
		expect(out.status).toBe("failed");
		expect(out.detail).toContain("dispatch refused");
	});

	it("never dispatches twice", async () => {
		const h = harness([0, 0, 0], { afterDispatch: [0, 0] });
		await ensureTagReleaseRun("v19.96.0", h.deps, FAST);
		expect(h.calls.filter(c => c === "dispatch")).toHaveLength(1);
	});

	it("reports how many polls it took, so a slow event is visible in the log", async () => {
		const h = harness([0, 1]);
		const out = await ensureTagReleaseRun("v1.2.3", h.deps, FAST);
		expect(out.status).toBe("already-fired");
		expect(out.polls).toBe(2);
	});
});

describe("the tagging workflow is wired to the check (#2487)", () => {
	const workflow = async () =>
		await fs.readFile(path.join(import.meta.dir, "../../../../.github/workflows/tag-on-version-bump.yml"), "utf8");

	it("invokes the verification script", async () => {
		expect(await workflow()).toContain("bun scripts/ci-ensure-tag-release-run.ts");
	});

	it("runs the verification even when the duplicate-tag guard skipped the push", async () => {
		// The unrecoverable state IS the skip path: tag on origin, no event, and a
		// re-run skips the push and emits nothing. Gating the check on
		// `skip != 'true'` would reintroduce exactly the trap it exists to catch.
		const src = await workflow();
		const step = src.slice(src.indexOf("Verify the release chain actually fired"));
		expect(step).not.toContain("steps.guard.outputs.skip");
	});

	it("provides bun to the job, since the job is otherwise a bare checkout", async () => {
		expect(await workflow()).toContain("oven-sh/setup-bun");
	});

	it("no longer claims the chain will fire merely because the push exited 0", async () => {
		expect(await workflow()).not.toContain("tag-gated release chain will now fire");
	});

	it("passes the tag through env rather than interpolating it into the shell", async () => {
		// Workflow-injection hygiene: the tag must reach the command as a quoted
		// shell variable supplied via `env:`, never as a GitHub expression expanded
		// directly into the run: body. Written as regexes so the assertion itself
		// does not embed a literal `${...}` (which reads as a broken JS template).
		const src = await workflow();
		const step = src.slice(src.indexOf("Verify the release chain actually fired"));
		expect(step).toMatch(/bun scripts\/ci-ensure-tag-release-run\.ts "\$\{TAG\}"/);
		expect(step.slice(0, step.indexOf("run:"))).toMatch(/env:\s*\n\s*GH_TOKEN:/);
		// No `${{ ... }}` inside the run: body.
		expect(step.slice(step.indexOf("run:"))).not.toMatch(/\$\{\{/);
	});
});
