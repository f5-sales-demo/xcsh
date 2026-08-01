import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { nativeHostLaunchCommand } from "../src/cli/chrome-cli";

// #1874: the native-messaging wrapper must launch a VERSION-STABLE xcsh (the
// PATH/symlink, e.g. /opt/homebrew/bin/xcsh) — never a versioned Cellar path
// like /opt/homebrew/Cellar/xcsh/<v>/bin/xcsh, which freezes the extension on
// the install-time version across `brew upgrade`s.
describe("nativeHostLaunchCommand (#1874 version-stable launcher)", () => {
	const CELLAR = "/opt/homebrew/Cellar/xcsh/19.58.1/bin/xcsh";
	const STABLE = "/opt/homebrew/bin/xcsh";

	it("compiled install prefers the PATH/symlink xcsh over the versioned execPath", () => {
		expect(nativeHostLaunchCommand([CELLAR], CELLAR, () => STABLE)).toEqual([STABLE]);
	});

	it("compiled install NEVER emits a Cellar path when PATH resolves", () => {
		const cmd = nativeHostLaunchCommand([CELLAR], CELLAR, () => STABLE);
		expect(cmd.some(s => s.includes("/Cellar/"))).toBe(false);
	});

	it("compiled install falls back to execPath when no PATH xcsh resolves", () => {
		expect(nativeHostLaunchCommand([CELLAR], CELLAR, () => null)).toEqual([CELLAR]);
	});

	it("bun install prefers the PATH xcsh", () => {
		const bun = "/usr/local/bin/bun";
		expect(nativeHostLaunchCommand([bun, "src/cli.ts"], bun, () => STABLE)).toEqual([STABLE]);
	});

	it("bun+script with no PATH xcsh uses the resolved dev script", () => {
		const bun = "/usr/local/bin/bun";
		expect(nativeHostLaunchCommand([bun, "src/cli.ts"], bun, () => null)).toEqual([bun, path.resolve("src/cli.ts")]);
	});

	it("bun with neither PATH xcsh nor a script falls back to execPath", () => {
		const bun = "/usr/local/bin/bun";
		expect(nativeHostLaunchCommand([bun], bun, () => null)).toEqual([bun]);
	});
});
