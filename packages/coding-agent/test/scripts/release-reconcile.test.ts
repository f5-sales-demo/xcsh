import { describe, expect, it } from "bun:test";
import { planReleaseReconcile } from "../../../../scripts/release";

/**
 * Idempotent auto-release reconcile (#deterministic-ci).
 *
 * `auto-release` runs `release.ts auto` on each non-chore main push. Running it for
 * a fix (→ patch) and then a feat (→ minor) used to leave TWO release branches
 * (e.g. v19.62.1 AND v19.63.0); when the patch merged first, the minor was stranded
 * as a CONFLICTING phantom. There must be exactly ONE canonical next version (or
 * none), so `planReleaseReconcile` closes every open release PR that isn't the
 * target and creates the target only when it isn't already open. Pure + deterministic:
 * the same (open PRs, target) always yields the same plan, so re-running converges.
 */
describe("planReleaseReconcile", () => {
	it("closes stale phantom release PRs, keeps/creates only the canonical target", () => {
		// The exact bug: v19.63.0 stranded after v19.62.1 shipped the same commits.
		expect(planReleaseReconcile({ openReleaseVersions: ["19.63.0"], target: "19.62.2" })).toEqual({
			toCreate: "19.62.2",
			toClose: ["19.63.0"],
		});
	});

	it("creates the target when no release PR is open", () => {
		expect(planReleaseReconcile({ openReleaseVersions: [], target: "19.62.2" })).toEqual({
			toCreate: "19.62.2",
			toClose: [],
		});
	});

	it("is idempotent: the target already open → nothing to create or close", () => {
		expect(planReleaseReconcile({ openReleaseVersions: ["19.62.2"], target: "19.62.2" })).toEqual({
			toCreate: null,
			toClose: [],
		});
	});

	it("no releasable commits (target null) → closes ALL open release PRs (phantoms), creates nothing", () => {
		expect(planReleaseReconcile({ openReleaseVersions: ["19.63.0", "19.62.2"], target: null })).toEqual({
			toCreate: null,
			toClose: ["19.63.0", "19.62.2"],
		});
	});

	it("closes multiple stale versions while keeping the canonical one open", () => {
		expect(
			planReleaseReconcile({ openReleaseVersions: ["19.62.2", "19.63.0", "20.0.0"], target: "19.62.2" }),
		).toEqual({ toCreate: null, toClose: ["19.63.0", "20.0.0"] });
	});
});
