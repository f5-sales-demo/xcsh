import { describe, expect, it } from "bun:test";
import { EXTENSION_ID, EXTENSION_IDS, writeNativeHostManifest } from "@f5-sales-demo/xcsh/cli/chrome-cli";

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
