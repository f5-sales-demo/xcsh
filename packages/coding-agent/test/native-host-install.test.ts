import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installNativeHost, NATIVE_HOST_NAME } from "../src/services/native-host-install";

describe("installNativeHost", () => {
	test("manifest path points at an executable wrapper that execs chrome-host (macOS)", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-nmh-"));
		const p = installNativeHost({
			launchCommand: ["/usr/local/bin/xcsh"],
			extensionIds: ["klajkjdoehjidngligegnpknogmjjhkc"],
			home,
			platform: "darwin",
		});
		const nmhDir = path.join(home, "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts");
		expect(p).toBe(path.join(nmhDir, `${NATIVE_HOST_NAME}.json`));
		const m = JSON.parse(fs.readFileSync(p, "utf8"));
		expect(m.name).toBe(NATIVE_HOST_NAME);
		expect(m.type).toBe("stdio");
		expect(m.allowed_origins).toEqual(["chrome-extension://klajkjdoehjidngligegnpknogmjjhkc/"]);
		// `path` must NOT point straight at the binary — Chrome ignores `args` and
		// would run the default launch/TUI. It points at a generated wrapper.
		expect(m.path).not.toBe("/usr/local/bin/xcsh");
		expect(m.path).toBe(path.join(nmhDir, `${NATIVE_HOST_NAME}.sh`));
		// The wrapper exists, is executable, and execs the real binary with chrome-host.
		const wrapper = fs.readFileSync(m.path, "utf8");
		expect(wrapper.startsWith("#!/bin/sh")).toBe(true);
		expect(wrapper).toContain("'/usr/local/bin/xcsh'");
		expect(wrapper).toContain("chrome-host");
		expect(wrapper).toContain(`"$@"`);
		expect(fs.statSync(m.path).mode & 0o111).not.toBe(0); // has an execute bit
		fs.rmSync(home, { recursive: true, force: true });
	});

	test("dev launch prefix (bun + entry script) is baked into the wrapper", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-nmh-"));
		const p = installNativeHost({
			launchCommand: ["/opt/bun/bin/bun", "/abs/src/cli.ts"],
			extensionIds: ["a"],
			home,
			platform: "linux",
		});
		const m = JSON.parse(fs.readFileSync(p, "utf8"));
		const wrapper = fs.readFileSync(m.path, "utf8");
		expect(wrapper).toContain("'/opt/bun/bin/bun' '/abs/src/cli.ts' chrome-host");
		fs.rmSync(home, { recursive: true, force: true });
	});

	test("throws on unsupported platform", () => {
		expect(() =>
			installNativeHost({ launchCommand: ["/x"], extensionIds: ["a"], home: "/tmp", platform: "win32" }),
		).toThrow();
	});

	test("throws on empty launchCommand", () => {
		expect(() =>
			installNativeHost({ launchCommand: [], extensionIds: ["a"], home: "/tmp", platform: "darwin" }),
		).toThrow();
	});
});
