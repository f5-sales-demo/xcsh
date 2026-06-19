import { describe, expect, it } from "bun:test";
import { buildLaunchArgs, dedicatedProfileDir, isProfileLockError } from "@f5xc-salesdemos/xcsh/browser/acquire";

describe("acquire helpers", () => {
	it("dedicatedProfileDir is under ~/.xcsh", () => {
		expect(dedicatedProfileDir("/home/u")).toBe("/home/u/.xcsh/chrome-profile");
	});

	it("buildLaunchArgs includes the debug port and hygiene flags", () => {
		const args = buildLaunchArgs({ debugPort: 9222 });
		expect(args).toContain("--remote-debugging-port=9222");
		expect(args).toContain("--no-first-run");
		expect(args).toContain("--no-default-browser-check");
		expect(args.some(a => a.startsWith("--user-data-dir="))).toBe(false);
	});

	it("buildLaunchArgs adds --user-data-dir when a profileDir is given", () => {
		const args = buildLaunchArgs({ debugPort: 9333, profileDir: "/home/u/.xcsh/chrome-profile" });
		expect(args).toContain("--user-data-dir=/home/u/.xcsh/chrome-profile");
		expect(args).toContain("--remote-debugging-port=9333");
	});

	it("isProfileLockError detects singleton-lock failures", () => {
		expect(isProfileLockError("Failed to create a ProcessSingleton for your profile")).toBe(true);
		expect(isProfileLockError("SingletonLock: file exists")).toBe(true);
		expect(isProfileLockError("The profile appears to be in use by another Chrome process")).toBe(true);
		expect(isProfileLockError("some unrelated error")).toBe(false);
	});
});
