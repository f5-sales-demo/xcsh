import { describe, expect, it } from "bun:test";
import * as path from "node:path";

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

describe("release.ts lockfile update is yank-safe", () => {
	it("uses `cargo update --workspace` and not `cargo generate-lockfile`", async () => {
		const source = await Bun.file(RELEASE_TS).text();
		expect(source).toContain("cargo update --workspace");
		expect(source).not.toContain("cargo generate-lockfile");
	});
});
