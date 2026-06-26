import { describe, expect, test } from "bun:test";
import { buildElementResolverScript, buildResolverScript } from "../../src/browser/extension-page-actions";

describe("buildElementResolverScript (deterministic-click resolver)", () => {
	test("returns the element, never JSON coords", () => {
		const js = buildElementResolverScript("text('Add Virtual Site')");
		expect(js).toContain("return el;");
		expect(js).not.toContain("found:true"); // no JSON coords tail — click geometry is from CDP
		// (isVisible still uses getBoundingClientRect for MATCHING, not for click coords.)
	});

	test("the __FAIL__ sentinel is fully substituted (no leftover, valid JS)", () => {
		const js = buildElementResolverScript("row:has-text('foo') >> button:text('Delete')");
		expect(js).not.toContain("__FAIL__");
		expect(js).toContain("return null;"); // fails resolve to null, not a JSON error
	});

	test("shares the exact matcher with buildResolverScript (same helpers + find)", () => {
		// Both embed RESOLVER_HELPERS + RESOLVER_FIND, so the role/text grammar is identical.
		for (const sel of ["text('X')", "tab:text('Add')", "listbox[name='Site Type']", "button"]) {
			const coords = buildResolverScript(sel);
			const elem = buildElementResolverScript(sel);
			expect(coords).toContain("findInScope"); // matcher present
			expect(elem).toContain("findInScope");
			expect(elem).not.toContain("__FAIL__");
			expect(coords).not.toContain("__FAIL__");
		}
	});

	test("coords resolver still substitutes __FAIL__ into a JSON error return", () => {
		const js = buildResolverScript("text('Y')");
		expect(js).not.toContain("__FAIL__");
		expect(js).toContain("found:false"); // error path is JSON
		expect(js).toContain("found:true"); // success path is JSON coords
	});
});
