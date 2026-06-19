import { describe, expect, it } from "bun:test";
import { locateChrome } from "@f5xc-salesdemos/xcsh/browser/chrome-locate";

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

describe("locateChrome", () => {
	it("honors the browser.chromePath setting override when the file exists", () => {
		const r = locateChrome({
			settings: { get: k => (k === "browser.chromePath" ? "/custom/chrome" : undefined) },
			platform: "darwin",
			exists: p => p === "/custom/chrome",
		});
		expect(r).toEqual({ path: "/custom/chrome", source: "setting" });
	});

	it("finds Google Chrome on macOS", () => {
		const r = locateChrome({ platform: "darwin", exists: p => p === MAC_CHROME, which: () => null });
		expect(r).toEqual({ path: MAC_CHROME, source: "macos" });
	});

	it("finds google-chrome on PATH on linux", () => {
		const r = locateChrome({
			platform: "linux",
			exists: () => false,
			which: cmd => (cmd === "google-chrome" ? "/usr/bin/google-chrome" : null),
		});
		expect(r).toEqual({ path: "/usr/bin/google-chrome", source: "path" });
	});

	it("returns null when nothing is found", () => {
		const r = locateChrome({ platform: "linux", exists: () => false, which: () => null });
		expect(r).toBeNull();
	});

	it("ignores a chromePath override that does not exist (falls through)", () => {
		const r = locateChrome({
			settings: { get: () => "/nope/chrome" },
			platform: "darwin",
			exists: p => p === MAC_CHROME,
			which: () => null,
		});
		expect(r).toEqual({ path: MAC_CHROME, source: "macos" });
	});
});
