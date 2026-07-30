import { describe, expect, it } from "bun:test";
import { stagedPathsOutsideVersionBump } from "../../../../scripts/release";

/**
 * A release commit must contain the version bump and nothing else (#2578).
 *
 * `openReleasePR` runs `bun run check` and then `git add .`, so anything a generator rewrote in between is
 * staged and committed as "chore: bump version". That is how a stale sibling extension checkout came within
 * one release of shipping a capability contract four minor versions old, with the whole `handshake` feature
 * block deleted. The generator no longer downgrades; this refuses to ship whatever the next one does by
 * accident.
 *
 * Allowed by shape rather than by an enumerated list, so adding a workspace package needs no change here.
 */
describe("stagedPathsOutsideVersionBump", () => {
	// The exact staged set of release PR #2590 (v19.101.0), which must pass unchanged.
	const realReleaseBump = [
		"Cargo.lock",
		"Cargo.toml",
		"bun.lock",
		"packages/agent/package.json",
		"packages/ai/package.json",
		"packages/coding-agent/package.json",
		"packages/natives/npm/darwin-arm64/package.json",
		"packages/natives/npm/darwin-x64/package.json",
		"packages/natives/npm/linux-arm64-gnu/package.json",
		"packages/natives/npm/linux-x64-gnu/package.json",
		"packages/natives/npm/win32-x64-msvc/package.json",
		"packages/natives/package.json",
		"packages/resource-management/package.json",
		"packages/stats/package.json",
		"packages/swarm-extension/package.json",
		"packages/tui/package.json",
		"packages/utils/package.json",
	];

	it("accepts a real release bump", () => {
		expect(stagedPathsOutsideVersionBump(realReleaseBump)).toEqual([]);
	});

	it("accepts crate manifests and changelogs, which the bump also rewrites", () => {
		expect(
			stagedPathsOutsideVersionBump(["crates/containment-check/Cargo.toml", "packages/coding-agent/CHANGELOG.md"]),
		).toEqual([]);
	});

	// The incident: a generator rewrote committed content and `git add .` staged it.
	it("rejects the capabilities manifest that #2578 nearly shipped", () => {
		expect(
			stagedPathsOutsideVersionBump([
				"package.json",
				"packages/coding-agent/src/browser/capabilities.json",
				"packages/coding-agent/src/browser/capabilities.generated.ts",
			]),
		).toEqual([
			"packages/coding-agent/src/browser/capabilities.json",
			"packages/coding-agent/src/browser/capabilities.generated.ts",
		]);
	});

	// Other generators drift the same way — sitecli-index.generated.ts did so on every check run.
	it("rejects any other generated file that drifts in", () => {
		expect(
			stagedPathsOutsideVersionBump(["packages/coding-agent/src/internal-urls/sitecli-index.generated.ts"]),
		).toEqual(["packages/coding-agent/src/internal-urls/sitecli-index.generated.ts"]);
	});

	it("rejects source and workflow changes hiding in a release commit", () => {
		expect(
			stagedPathsOutsideVersionBump([
				"packages/coding-agent/src/sandbox/containment.ts",
				".github/workflows/ci.yml",
			]),
		).toEqual(["packages/coding-agent/src/sandbox/containment.ts", ".github/workflows/ci.yml"]);
	});

	it("ignores blank entries from splitting git output", () => {
		expect(stagedPathsOutsideVersionBump(["package.json", "", "  "])).toEqual([]);
	});

	it("normalises Windows separators", () => {
		expect(stagedPathsOutsideVersionBump(["packages\\utils\\package.json"])).toEqual([]);
	});
});
