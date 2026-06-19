import { describe, expect, it } from "bun:test";
import type { Page } from "puppeteer";
import { waitForXcSettled } from "../../src/browser/actions";

/** Build a minimal fake Page whose evaluate returns the given value. */
function fakePage(busy: boolean | (() => boolean)): Page {
	return {
		evaluate: async () => (typeof busy === "function" ? busy() : busy),
	} as unknown as Page;
}

describe("waitForXcSettled", () => {
	it("returns promptly when page reports not-busy", async () => {
		const page = fakePage(false);
		const start = Date.now();
		await waitForXcSettled(page, 5000);
		expect(Date.now() - start).toBeLessThan(500);
	});

	it("respects timeout and returns (does not throw) when always busy", async () => {
		const page = fakePage(true);
		const start = Date.now();
		// Use a short timeout to keep the test fast
		await waitForXcSettled(page, 300);
		const elapsed = Date.now() - start;
		// Should have waited roughly the timeout duration
		expect(elapsed).toBeGreaterThanOrEqual(250);
		// Should not take much longer than the timeout + a couple of sleep cycles
		expect(elapsed).toBeLessThan(1000);
	});
});
