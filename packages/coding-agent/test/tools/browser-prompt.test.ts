import { describe, expect, it } from "bun:test";
import browserDescription from "../../src/prompts/tools/browser.md" with { type: "text" };

describe("browser.md prompt", () => {
	it("mentions /browser visible for switching to visible mode", () => {
		expect(browserDescription).toContain("/browser visible");
	});

	it("documents headless as the default launch mode", () => {
		expect(browserDescription).toContain("headless");
	});
});
