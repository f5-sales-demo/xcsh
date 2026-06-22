import { describe, expect, it } from "bun:test";
import { writeNativeHostManifest } from "@f5xc-salesdemos/xcsh/cli/chrome-cli";

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
			"/Users/u/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.f5xc.xcsh.chrome_host.json",
		);
		expect(path).toBe(r.manifestPath);
		const m = JSON.parse(content);
		expect(m).toMatchObject({
			name: "com.f5xc.xcsh.chrome_host",
			type: "stdio",
			path: "/usr/local/bin/xcsh",
			args: ["chrome-host"],
			allowed_origins: [
				"chrome-extension://abcdefghabcdefghabcdefghabcdefgh/",
				"chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba/",
			],
		});
	});
	it("uses the linux native-host dir", () => {
		const r = writeNativeHostManifest({
			platform: "linux",
			home: "/home/u",
			xcshBinPath: "/x",
			extensionIds: ["e"],
			write: () => {},
		});
		expect(r.manifestPath).toBe("/home/u/.config/google-chrome/NativeMessagingHosts/com.f5xc.xcsh.chrome_host.json");
	});
});
