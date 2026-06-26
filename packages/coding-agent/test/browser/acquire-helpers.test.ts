import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import {
	buildLaunchArgs,
	decideAcquireAction,
	dedicatedProfileDir,
	defaultProfileDir,
	isChromeRunning,
	isProfileLockError,
	quitChromeCommand,
} from "@f5-sales-demo/xcsh/browser/acquire";

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
		// Puppeteer's message when an explicit --user-data-dir is held by a running browser.
		expect(
			isProfileLockError(
				"The browser is already running for /Users/u/Library/Application Support/Google/Chrome. Use a different `userDataDir` or stop the running browser first.",
			),
		).toBe(true);
		expect(isProfileLockError("some unrelated error")).toBe(false);
	});

	it("defaultProfileDir resolves the macOS default profile", () => {
		expect(defaultProfileDir({ platform: "darwin", home: "/Users/u" })).toBe(
			"/Users/u/Library/Application Support/Google/Chrome",
		);
	});

	it("defaultProfileDir resolves the Linux default profile", () => {
		expect(defaultProfileDir({ platform: "linux", home: "/home/u" })).toBe("/home/u/.config/google-chrome");
	});

	it("defaultProfileDir resolves the Windows default profile from LOCALAPPDATA", () => {
		expect(defaultProfileDir({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } })).toBe(
			path.join("C:\\Users\\u\\AppData\\Local", "Google", "Chrome", "User Data"),
		);
	});

	it("defaultProfileDir returns null for unsupported platforms", () => {
		expect(defaultProfileDir({ platform: "freebsd" as NodeJS.Platform })).toBeNull();
	});
});

describe("decideAcquireAction", () => {
	const base = { debuggableNow: false, chromeRunning: false, chromeInstalled: true, allowRelaunch: false };
	it("no Chrome installed -> no-chrome (even if a port answers)", () => {
		expect(decideAcquireAction({ ...base, chromeInstalled: false, debuggableNow: true })).toBe("no-chrome");
	});
	it("debuggable now -> attach", () => {
		expect(decideAcquireAction({ ...base, debuggableNow: true })).toBe("attach");
	});
	it("not debuggable, Chrome not running -> launch", () => {
		expect(decideAcquireAction(base)).toBe("launch");
	});
	it("not debuggable, Chrome running, relaunch allowed -> relaunch", () => {
		expect(decideAcquireAction({ ...base, chromeRunning: true, allowRelaunch: true })).toBe("relaunch");
	});
	it("not debuggable, Chrome running, relaunch NOT allowed -> dedicated", () => {
		expect(decideAcquireAction({ ...base, chromeRunning: true, allowRelaunch: false })).toBe("dedicated");
	});
});

describe("quitChromeCommand", () => {
	it("darwin uses osascript graceful quit", () => {
		expect(quitChromeCommand("darwin")).toEqual({ cmd: "osascript", args: ["-e", 'quit app "Google Chrome"'] });
	});
	it("linux uses SIGTERM (graceful), never -KILL", () => {
		const q = quitChromeCommand("linux");
		expect(q?.cmd).toBe("pkill");
		expect(q?.args).toContain("-TERM");
		expect(q?.args.join(" ")).not.toMatch(/-9|-KILL/i);
	});
	it("win32 uses taskkill WITHOUT /F (graceful)", () => {
		const q = quitChromeCommand("win32");
		expect(q?.cmd.toLowerCase()).toBe("taskkill");
		expect(q?.args.join(" ")).not.toMatch(/\/F/i);
	});
});

describe("isChromeRunning", () => {
	it("darwin pgrep exit 0 => running", () => {
		expect(isChromeRunning({ platform: "darwin", exec: () => ({ code: 0 }) })).toBe(true);
	});
	it("darwin pgrep exit 1 => not running", () => {
		expect(isChromeRunning({ platform: "darwin", exec: () => ({ code: 1 }) })).toBe(false);
	});
	it("win32 tasklist finds chrome.exe => running", () => {
		expect(isChromeRunning({ platform: "win32", exec: () => ({ code: 0 }) })).toBe(true);
	});
});

describe("buildLaunchArgs loopback", () => {
	it("always binds the debug endpoint to loopback", () => {
		expect(buildLaunchArgs({ debugPort: 9222 })).toContain("--remote-debugging-address=127.0.0.1");
	});
});
