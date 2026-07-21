import { describe, expect, it } from "bun:test";
import { classifyReleaseAction } from "../../../../scripts/release";

/**
 * Self-healing auto-release decision (#deterministic-ci).
 *
 * A transient GitHub 500 on `git push origin v<X.Y.Z>` in tag-on-version-bump.yml
 * can leave the repo bumped-in-tree (e.g. 19.69.0) but UNTAGGED. On the next push,
 * `release.ts auto` recomputes the same target, the version bump is a no-op, and the
 * empty `git commit` used to crash-loop the release job. `classifyReleaseAction`
 * distinguishes the three states so the auto-release path can self-heal instead of
 * crashing: a real release, an already-released version, or a bumped-but-untagged
 * version needing the tag workflow re-run. Pure + deterministic.
 */
describe("classifyReleaseAction", () => {
	it("target > inRepo → 'release' (normal bump, proceed)", () => {
		expect(classifyReleaseAction({ target: "19.70.0", inRepoVersion: "19.69.0", tagExists: false })).toBe("release");
	});

	it("target == inRepo and tag exists → 'already-released'", () => {
		expect(classifyReleaseAction({ target: "19.69.0", inRepoVersion: "19.69.0", tagExists: true })).toBe(
			"already-released",
		);
	});

	it("target == inRepo and tag missing → 'bumped-untagged' (transient tag-push failure)", () => {
		expect(classifyReleaseAction({ target: "19.69.0", inRepoVersion: "19.69.0", tagExists: false })).toBe(
			"bumped-untagged",
		);
	});
});
