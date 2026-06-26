import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	EXTENSION_ID,
	EXTENSION_IDS,
	ensureNativeHostInstalled,
	nativeHostInvocation,
	WEB_STORE_URL,
	writeNativeHostManifest,
} from "@f5-sales-demo/xcsh/cli/chrome-cli";

describe("writeNativeHostManifest", () => {
	it("writes the macOS native-host manifest with allowed_origins for each extension id", () => {
		let path = "",
			content = "";
		const r = writeNativeHostManifest({
			platform: "darwin",
			home: "/Users/u",
			xcshBinPath: "/usr/local/bin/xcsh",
			extensionIds: ["abcdefghabcdefghabcdefghabcdefgh", "ponmlkjihgfedcbaponmlkjihgfedcba"],
			write: (p, c) => {
				path = p;
				content = c;
			},
		});
		expect(r.manifestPath).toBe(
			"/Users/u/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.xcsh.xcsh.chrome_host.json",
		);
		expect(path).toBe(r.manifestPath);
		const m = JSON.parse(content);
		expect(m).toMatchObject({
			name: "com.xcsh.xcsh.chrome_host",
			type: "stdio",
			path: "/usr/local/bin/xcsh",
			args: ["chrome-host"],
			allowed_origins: [
				"chrome-extension://abcdefghabcdefghabcdefghabcdefgh/",
				"chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/",
			],
		});
	});
	it("EXTENSION_ID is the canonical Chrome Web Store ID", () => {
		expect(EXTENSION_ID).toBe("klajkjdoehjidngligegnpknogmjjhkc");
	});

	it("EXTENSION_IDS contains only the CWS ID — no legacy IDs", () => {
		expect(EXTENSION_IDS).toEqual(["klajkjdoehjidngligegnpknogmjjhkc"]);
	});

	it("produces allowed_origins with only the CWS origin when using EXTENSION_IDS", () => {
		let content = "";
		writeNativeHostManifest({
			platform: "darwin",
			home: "/Users/u",
			xcshBinPath: "/usr/local/bin/xcsh",
			extensionIds: EXTENSION_IDS,
			write: (_p, c) => {
				content = c;
			},
		});
		const m = JSON.parse(content);
		expect(m.allowed_origins).toEqual(["chrome-extension://klajkjdoehjidngligegnpknogmjjhkc/"]);
	});

	it("uses the linux native-host dir", () => {
		const r = writeNativeHostManifest({
			platform: "linux",
			home: "/home/u",
			xcshBinPath: "/x",
			extensionIds: ["e"],
			write: () => {},
		});
		expect(r.manifestPath).toBe("/home/u/.config/google-chrome/NativeMessagingHosts/com.xcsh.xcsh.chrome_host.json");
	});
});

describe("WEB_STORE_URL", () => {
	it("is the Chrome Web Store detail URL for the canonical extension id", () => {
		expect(WEB_STORE_URL).toBe(`https://chromewebstore.google.com/detail/${EXTENSION_ID}`);
	});
});

describe("nativeHostInvocation", () => {
	it("a compiled xcsh binary resolves the subcommand directly", () => {
		expect(nativeHostInvocation(["/usr/local/bin/xcsh", "chrome", "setup"], "/usr/local/bin/xcsh")).toEqual({
			binPath: "/usr/local/bin/xcsh",
			args: ["chrome-host"],
		});
	});
	it("a dev run under bun passes the entry script so `chrome-host` resolves", () => {
		expect(
			nativeHostInvocation(["/opt/homebrew/bin/bun", "/repo/src/cli.ts", "chrome"], "/opt/homebrew/bin/bun"),
		).toEqual({ binPath: "/opt/homebrew/bin/bun", args: ["/repo/src/cli.ts", "chrome-host"] });
	});
	it("falls back to bare subcommand when the bun entry script is not a script path", () => {
		expect(nativeHostInvocation(["/opt/homebrew/bin/bun", "chrome"], "/opt/homebrew/bin/bun")).toEqual({
			binPath: "/opt/homebrew/bin/bun",
			args: ["chrome-host"],
		});
	});
});

describe("ensureNativeHostInstalled (idempotent)", () => {
	const home = path.join(os.tmpdir(), `xcsh-nativehost-test-${process.pid}`);
	afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

	it("writes on first call and is a no-op on the second (same inputs)", () => {
		const opts = {
			platform: "darwin" as const,
			home,
			argv: ["/usr/local/bin/xcsh", "chrome"],
			execPath: "/usr/local/bin/xcsh",
		};
		const first = ensureNativeHostInstalled(opts);
		expect(first.changed).toBe(true);
		const m = JSON.parse(fs.readFileSync(first.manifestPath, "utf8"));
		expect(m.name).toBe("com.xcsh.xcsh.chrome_host");
		expect(m.allowed_origins).toEqual([`chrome-extension://${EXTENSION_ID}/`]);
		const second = ensureNativeHostInstalled(opts);
		expect(second.changed).toBe(false);
		expect(second.manifestPath).toBe(first.manifestPath);
	});

	it("rewrites when the invocation changes (stale manifest)", () => {
		ensureNativeHostInstalled({
			platform: "darwin",
			home,
			argv: ["/usr/local/bin/xcsh", "chrome"],
			execPath: "/usr/local/bin/xcsh",
		});
		const changed = ensureNativeHostInstalled({
			platform: "darwin",
			home,
			argv: ["/opt/homebrew/bin/bun", "/repo/src/cli.ts"],
			execPath: "/opt/homebrew/bin/bun",
		});
		expect(changed.changed).toBe(true);
	});

	it("is a no-op on win32 (out of slice)", () => {
		expect(ensureNativeHostInstalled({ platform: "win32", home }).changed).toBe(false);
	});
});
