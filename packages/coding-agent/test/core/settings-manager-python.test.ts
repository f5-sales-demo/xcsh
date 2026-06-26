import { describe, expect, it } from "bun:test";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";

describe("Settings python settings", () => {
	it("defaults to both and session", () => {
		const settings = Settings.isolated({});

		expect(settings.get("python.toolMode")).toBe("both");
		expect(settings.get("python.kernelMode")).toBe("session");
	});
});
