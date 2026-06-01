import { describe, expect, it } from "bun:test";
import { getFixableServices } from "@f5xc-salesdemos/xcsh/modes/components/welcome-checks";

describe("getFixableServices", () => {
	it("returns empty array (all cloud services extracted to plugins)", () => {
		expect(getFixableServices()).toEqual([]);
	});
});
