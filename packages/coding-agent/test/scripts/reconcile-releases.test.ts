import { describe, expect, it } from "bun:test";
import { describeDivergence, reconcileReleases } from "../../../../scripts/ci-reconcile-releases";

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

const SHA = "a".repeat(64);

/** A tap formula as ci-release-homebrew.ts generates it. */
const formula = (version: string, sha: string = SHA) => `class Xcsh < Formula
  version "${version}"
  url "https://example.invalid/v${version}/xcsh-darwin-arm64.zip"
  sha256 "${sha}"
`;

const deps = (over: Partial<Parameters<typeof reconcileReleases>[0]> = {}) => ({
	listTags: async () => ["v1.0.0"],
	listReleases: async () => ["v1.0.0"],
	listNpmVersions: async () => ["1.0.0"],
	readHomebrewFormula: async () => formula("1.0.0"),
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
		expect(r.divergences).toEqual([
			{ tag: "v1.0.0", missingRelease: true, missingNpm: false, missingHomebrew: false, brokenHomebrew: false },
		]);
	});

	it("reports a release that never reached npm — the partial publish", async () => {
		// create-release succeeded, publish-npm did not. A tag/release check alone
		// calls this clean; it is the failure mode a cancelled chain actually leaves.
		const r = await reconcileReleases(deps({ listNpmVersions: async () => [] }));
		expect(r.status).toBe("diverged");
		expect(r.divergences).toEqual([
			{ tag: "v1.0.0", missingRelease: false, missingNpm: true, missingHomebrew: false, brokenHomebrew: false },
		]);
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
				// v1.1.0 is the newest tag with a release, so it is what the tap is
				// held against; keep them equal so this test stays about "reports all".
				readHomebrewFormula: async () => formula("1.1.0"),
			}),
		);
		expect(r.divergences.map(d => d.tag)).toEqual(["v1.0.0", "v1.2.0"]);
	});

	// --- the Homebrew leg (#73) ------------------------------------------------
	// publish-npm and update-homebrew are independent siblings, both
	// needs: [create-release]. update-homebrew can fail or be cancelled while npm
	// succeeds, which is the exact partial publish this whole check exists for --
	// and the first version of it could not see that case at all.

	it("reports a release that reached npm but not the Homebrew tap", async () => {
		const r = await reconcileReleases(deps({ readHomebrewFormula: async () => formula("0.9.0") }));
		expect(r.status).toBe("diverged");
		expect(r.divergences).toEqual([
			{ tag: "v1.0.0", missingRelease: false, missingNpm: false, missingHomebrew: true, brokenHomebrew: false },
		]);
	});

	it("fails closed when the Homebrew lookup throws, rather than assuming current", async () => {
		const r = await reconcileReleases(
			deps({
				readHomebrewFormula: async () => {
					throw new Error("tap unreachable");
				},
			}),
		);
		expect(r.status).toBe("unknown");
	});

	it("only holds the NEWEST tag against the tap, since a tap carries one version", async () => {
		// npm retains every version; the tap has exactly one. Set-membership logic
		// would mark every older tag as missing from Homebrew and alarm forever.
		const r = await reconcileReleases(
			deps({
				listTags: async () => ["v1.2.0", "v1.1.0", "v1.0.0"],
				listReleases: async () => ["v1.2.0", "v1.1.0", "v1.0.0"],
				listNpmVersions: async () => ["1.2.0", "1.1.0", "1.0.0"],
				readHomebrewFormula: async () => formula("1.2.0"),
			}),
		);
		expect(r.status).toBe("clean");
	});

	it("tolerates a v-prefix on the tap version", async () => {
		const r = await reconcileReleases(deps({ readHomebrewFormula: async () => formula("v1.0.0") }));
		expect(r.status).toBe("clean");
	});

	it("does not flag Homebrew on a tag that has no release yet", async () => {
		// A tag mid-publish is already reported for the missing release; adding a
		// Homebrew complaint to it is noise, not information.
		const r = await reconcileReleases(
			deps({ listReleases: async () => [], readHomebrewFormula: async () => formula("0.9.0") }),
		);
		expect(r.divergences).toEqual([
			{ tag: "v1.0.0", missingRelease: true, missingNpm: false, missingHomebrew: false, brokenHomebrew: false },
		]);
	});

	it("tolerates a v-prefix mismatch between git tags and npm versions", async () => {
		// git tags carry `v`, npm versions do not. A naive comparison reports every
		// release as unpublished.
		const r = await reconcileReleases(
			deps({
				listTags: async () => ["v2.3.4"],
				listReleases: async () => ["v2.3.4"],
				listNpmVersions: async () => ["2.3.4"],
				readHomebrewFormula: async () => formula("2.3.4"),
			}),
		);
		expect(r.status).toBe("clean");
	});

	// --- formula health (#73, second Codex finding) -----------------------------
	// ci-release-homebrew.ts:113 does `checksums.get(archive) || "MISSING_SHA256"`,
	// so a formula can carry the correct version with a placeholder checksum. A
	// version-only comparison calls that clean while `brew install` fails.

	it("reports a formula whose checksum is the MISSING_SHA256 placeholder", async () => {
		const r = await reconcileReleases(deps({ readHomebrewFormula: async () => formula("1.0.0", "MISSING_SHA256") }));
		expect(r.status).toBe("diverged");
		expect(r.divergences[0]?.brokenHomebrew).toBe(true);
		expect(r.divergences[0]?.missingHomebrew).toBe(false);
	});

	it("reports a formula whose checksum is not a real digest", async () => {
		const r = await reconcileReleases(deps({ readHomebrewFormula: async () => formula("1.0.0", "deadbeef") }));
		expect(r.divergences[0]?.brokenHomebrew).toBe(true);
	});

	it("treats a formula with no version line as unknown, not clean", async () => {
		const r = await reconcileReleases(deps({ readHomebrewFormula: async () => "class Xcsh < Formula\nend\n" }));
		expect(r.status).toBe("unknown");
	});

	it("names a broken formula distinctly from a stale one", () => {
		expect(
			describeDivergence({
				tag: "v1.0.0",
				missingRelease: false,
				missingNpm: false,
				missingHomebrew: false,
				brokenHomebrew: true,
			}),
		).toBe("Homebrew formula is broken");
	});

	// --- operator-facing rendering ---------------------------------------------
	// Caught by UAT, not by any of the above: the CLI printed "::error::v19.98.0: "
	// with an empty reason, because the message builder knew about releases and npm
	// but not the tap. An alarm that fires without saying why is barely an alarm.

	it("names the Homebrew leg in the operator message", () => {
		expect(
			describeDivergence({
				tag: "v1.0.0",
				missingRelease: false,
				missingNpm: false,
				missingHomebrew: true,
				brokenHomebrew: false,
			}),
		).toBe("Homebrew tap is stale");
	});

	it("never renders an empty reason for any divergence it can produce", () => {
		for (const missingRelease of [true, false]) {
			for (const missingNpm of [true, false]) {
				for (const missingHomebrew of [true, false]) {
					if (!missingRelease && !missingNpm && !missingHomebrew) continue;
					const text = describeDivergence({
						tag: "v1.0.0",
						missingRelease,
						missingNpm,
						missingHomebrew,
						brokenHomebrew: false,
					});
					expect(text).not.toBe("");
				}
			}
		}
	});

	it("lists every failing leg, not just the first", () => {
		expect(
			describeDivergence({
				tag: "v1.0.0",
				missingRelease: true,
				missingNpm: true,
				missingHomebrew: true,
				brokenHomebrew: false,
			}),
		).toBe("no GitHub release, not on npm, Homebrew tap is stale");
	});
});
