import { describe, expect, it } from "bun:test";
import { generateFormula } from "../../../../scripts/ci-release-homebrew";

/**
 * Guard for the brew `post_install` recycle hook (#upgrade-recycle).
 *
 * `brew upgrade` drops the new binary + repoints the symlink but runs no xcsh hook,
 * so the old detached manager lingered on the replaced binary. The generated formula
 * now carries a `post_install` that runs `xcsh chrome recycle` (refresh the native-
 * messaging wrapper + step the old manager down) using the just-installed binary. It
 * is rescue-wrapped so a sandboxed/offline post_install can never fail the upgrade —
 * the manager also self-recycles on its next sweep/provision (xcsh #1930).
 */
describe("homebrew formula post_install recycle", () => {
	const formula = generateFormula(
		"19.99.0",
		"v19.99.0",
		new Map([
			["xcsh-darwin-x64.zip", "aaa"],
			["xcsh-darwin-arm64.zip", "bbb"],
			["xcsh-linux-x64.tar.gz", "ccc"],
			["xcsh-linux-arm64.tar.gz", "ddd"],
		]),
	);

	it("emits a rescue-wrapped post_install that runs `xcsh chrome recycle`", () => {
		expect(formula).toContain("def post_install");
		expect(formula).toContain('system bin/"xcsh", "chrome", "recycle"');
		expect(formula).toContain("rescue StandardError"); // never fails the upgrade
	});

	it("still installs the binary for every arch and carries the version", () => {
		expect(formula.match(/bin\.install "xcsh"/g)?.length).toBe(4); // 2 macOS + 2 linux
		expect(formula).toContain('version "19.99.0"');
	});
});
