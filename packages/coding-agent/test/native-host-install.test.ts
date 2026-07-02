import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { installNativeHost, NATIVE_HOST_NAME } from "../src/services/native-host-install";

describe("installNativeHost", () => {
	test("writes a user-level stdio manifest allowlisting the extension (macOS)", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-nmh-"));
		const p = installNativeHost({
			xcshBinPath: "/usr/local/bin/xcsh",
			extensionIds: ["klajkjdoehjidngligegnpknogmjjhkc"],
			home,
			platform: "darwin",
		});
		expect(p).toBe(
			path.join(
				home,
				"Library",
				"Application Support",
				"Google",
				"Chrome",
				"NativeMessagingHosts",
				`${NATIVE_HOST_NAME}.json`,
			),
		);
		const m = JSON.parse(fs.readFileSync(p, "utf8"));
		expect(m.name).toBe(NATIVE_HOST_NAME);
		expect(m.type).toBe("stdio");
		expect(m.path).toBe("/usr/local/bin/xcsh");
		expect(m.allowed_origins).toEqual(["chrome-extension://klajkjdoehjidngligegnpknogmjjhkc/"]);
		fs.rmSync(home, { recursive: true, force: true });
	});
	test("throws on unsupported platform", () => {
		expect(() =>
			installNativeHost({ xcshBinPath: "/x", extensionIds: ["a"], home: "/tmp", platform: "win32" }),
		).toThrow();
	});
});
