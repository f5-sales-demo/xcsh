import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { alignNativeOptionalDependencies } from "../../../../scripts/ci-release-publish";

/**
 * Regression guard for the release lockfile-update step (#1898).
 *
 * `scripts/release.ts` bumps versions and then relocks. It MUST use
 * `cargo update --workspace` (relocks only workspace members, preserves
 * registry resolutions) rather than `cargo generate-lockfile` (re-resolves the
 * whole graph). The latter both defeats the "preserve existing resolutions"
 * intent AND fails when a locked dependency has since been yanked from
 * crates.io — which broke the auto-release job (tree-sitter-perl-next was
 * yanked). This guard keeps the release path from regressing to the
 * yank-prone command.
 */

const RELEASE_TS = path.resolve(import.meta.dir, "../../../../scripts/release.ts");
const PI_NATIVES_CARGO_TOML = path.resolve(import.meta.dir, "../../../../crates/pi-natives/Cargo.toml");

describe("release.ts lockfile update is yank-safe", () => {
	it("uses `cargo update --workspace` and not `cargo generate-lockfile`", async () => {
		const source = await Bun.file(RELEASE_TS).text();
		expect(source).toContain("cargo update --workspace");
		expect(source).not.toContain("cargo generate-lockfile");
	});

	it("keeps published native dependencies locked until publish time", async () => {
		const releaseSource = await Bun.file(RELEASE_TS).text();
		const packageJson = {
			name: "@f5-sales-demo/pi-natives",
			version: "20.3.2",
			optionalDependencies: {
				"@f5-sales-demo/pi-natives-linux-x64-gnu": "20.3.1",
				"unrelated-package": "1.0.0",
			},
		};

		expect(releaseSource).not.toContain("Update optionalDependencies versions in pi-natives package");
		expect(alignNativeOptionalDependencies(packageJson)).toBe(true);
		expect(packageJson.optionalDependencies).toEqual({
			"@f5-sales-demo/pi-natives-linux-x64-gnu": "20.3.2",
			"unrelated-package": "1.0.0",
		});
	});
});

describe("release Rust toolchain compatibility", () => {
	it("does not enable nightly-only SmallVec specialization", async () => {
		const cargoToml = await Bun.file(PI_NATIVES_CARGO_TOML).text();

		expect(cargoToml).not.toContain('"specialization",');
	});
});
