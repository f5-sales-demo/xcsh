import { describe, expect, it } from "bun:test";
import { reconcileReleases } from "../../../../scripts/ci-reconcile-releases";

/**
 * The end-state check the release chain never had (#2505).
 *
 * #2496 asserts that a CI run exists for a tag, but `ghCountRuns` counts runs
 * without filtering conclusion — a run that fired and was then cancelled still
 * counts. That is exactly how v19.96.0 ended up tagged, unreleased, and silent.
 *
 * So this asserts the state that actually matters: for every tag there is a
 * release, and for every release there is a published package. The partial case
 * — released but not on npm — is the one a tag/release check alone calls clean
 * and which no amount of concurrency tuning can rule out, because a human can
 * always cancel a run between publish-npm and update-homebrew.
 *
 * Every unknown is a failure. An unreachable registry is not a clean result.
 */

const deps = (over: Partial<Parameters<typeof reconcileReleases>[0]> = {}) => ({
	listTags: async () => ["v1.0.0"],
	listReleases: async () => ["v1.0.0"],
	listNpmVersions: async () => ["1.0.0"],
	log: () => {},
	...over,
});

describe("reconcileReleases", () => {
	it("is clean when every tag has a release and a published package", async () => {
		const r = await reconcileReleases(deps());
		expect(r.status).toBe("clean");
		expect(r.divergences).toHaveLength(0);
	});

	it("reports a tag that has no release", async () => {
		const r = await reconcileReleases(deps({ listReleases: async () => [] }));
		expect(r.status).toBe("diverged");
		expect(r.divergences).toEqual([{ tag: "v1.0.0", missingRelease: true, missingNpm: false }]);
	});

	it("reports a release that never reached npm — the partial publish", async () => {
		// create-release succeeded, publish-npm did not. A tag/release check alone
		// calls this clean; it is the failure mode a cancelled chain actually leaves.
		const r = await reconcileReleases(deps({ listNpmVersions: async () => [] }));
		expect(r.status).toBe("diverged");
		expect(r.divergences).toEqual([{ tag: "v1.0.0", missingRelease: false, missingNpm: true }]);
	});

	it("fails closed when the tag lookup throws", async () => {
		const r = await reconcileReleases(
			deps({
				listTags: async () => {
					throw new Error("network");
				},
			}),
		);
		expect(r.status).toBe("unknown");
		expect(r.detail).toMatch(/network/);
	});

	it("fails closed when the npm lookup throws, rather than assuming published", async () => {
		const r = await reconcileReleases(
			deps({
				listNpmVersions: async () => {
					throw new Error("registry 503");
				},
			}),
		);
		expect(r.status).toBe("unknown");
	});

	it("treats an empty tag list as unknown, not clean", async () => {
		// `git tag` returning nothing means the checkout is wrong, not that the
		// project has no releases. Reading that as clean would silence the alarm
		// permanently on a misconfigured runner.
		const r = await reconcileReleases(deps({ listTags: async () => [] }));
		expect(r.status).toBe("unknown");
	});

	it("does not fail on an allowlisted gap, but still surfaces it with its reason", async () => {
		const logged: string[] = [];
		const r = await reconcileReleases(
			deps({ listReleases: async () => [], log: (m: string) => void logged.push(m) }),
			{ allowlist: { "v1.0.0": "skipped version, see #2487" } },
		);
		expect(r.status).toBe("clean");
		expect(r.divergences).toHaveLength(0);
		expect(logged.join("\n")).toMatch(/v1\.0\.0.*skipped version, see #2487/);
	});

	it("reports every diverging tag, not just the first", async () => {
		// All three are on npm, so only the missing release drives divergence —
		// keeping this test about "reports all of them" and nothing else.
		const r = await reconcileReleases(
			deps({
				listTags: async () => ["v1.0.0", "v1.1.0", "v1.2.0"],
				listReleases: async () => ["v1.1.0"],
				listNpmVersions: async () => ["1.0.0", "1.1.0", "1.2.0"],
			}),
		);
		expect(r.divergences.map(d => d.tag)).toEqual(["v1.0.0", "v1.2.0"]);
	});

	it("tolerates a v-prefix mismatch between git tags and npm versions", async () => {
		// git tags carry `v`, npm versions do not. A naive comparison reports every
		// release as unpublished.
		const r = await reconcileReleases(
			deps({
				listTags: async () => ["v2.3.4"],
				listReleases: async () => ["v2.3.4"],
				listNpmVersions: async () => ["2.3.4"],
			}),
		);
		expect(r.status).toBe("clean");
	});
});
