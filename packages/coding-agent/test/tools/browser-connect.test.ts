import { describe, expect, it } from "bun:test";
import { resolveBrowserConnectUrl } from "@f5xc-salesdemos/xcsh/tools/browser";

function fakeSettings(value?: string) {
	return { get: (k: string) => (k === "browser.connectUrl" ? value : undefined) } as never;
}

describe("resolveBrowserConnectUrl", () => {
	it("returns the configured URL", () => {
		expect(resolveBrowserConnectUrl(fakeSettings("http://127.0.0.1:9222"))).toBe("http://127.0.0.1:9222");
	});
	it("returns undefined when unset", () => {
		expect(resolveBrowserConnectUrl(fakeSettings(undefined))).toBeUndefined();
	});
	it("trims whitespace from the URL", () => {
		expect(resolveBrowserConnectUrl(fakeSettings("  http://127.0.0.1:9222  "))).toBe("http://127.0.0.1:9222");
	});
	it("returns undefined for empty string", () => {
		expect(resolveBrowserConnectUrl(fakeSettings(""))).toBeUndefined();
	});
	it("returns undefined for whitespace-only string", () => {
		expect(resolveBrowserConnectUrl(fakeSettings("   "))).toBeUndefined();
	});
});
