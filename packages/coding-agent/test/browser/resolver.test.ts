import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { buildElementResolverScript } from "../../src/browser/extension-page-actions";

/**
 * Evaluate the REAL resolver script (the string sent to the page) against a
 * linkedom DOM fixture. linkedom implements querySelectorAll/contains/matches;
 * getBoundingClientRect returns zeros and offsetParent is undefined (so the
 * script's isVisible() treats elements as visible), and scrollIntoView is
 * shimmed because linkedom lacks it.
 */
function resolveElement(html: string, selector: string): { id: string; tag: string } | null {
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	for (const el of document.querySelectorAll("*")) {
		(el as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
	}
	const code = buildElementResolverScript(selector); // "(()=>{ ... return el; })()"
	const fn = new Function("document", `return ${code};`);
	const el = fn(document) as { id?: string; tagName?: string } | null;
	return el ? { id: el.id ?? "", tag: (el.tagName ?? "").toLowerCase() } : null;
}

describe("buildElementResolverScript — text() element preference", () => {
	// Bug 1 root cause: the F5 console renders "Add Health Check" as a <button>
	// wrapped in container <div>s whose only text is that label. findByText
	// searched all elements and returned the FIRST (outermost) match by document
	// order — a non-interactive <div> — so the trusted click was a no-op and the
	// create form never opened. It must pick the innermost matching element (the
	// button / its span), which is what actually handles the click.
	test("prefers the interactive element over an outer container", () => {
		const el = resolveElement(
			`<div id="wrap"><button id="btn">Add Health Check</button></div>`,
			"text('Add Health Check')",
		);
		expect(el).not.toBeNull();
		expect(el?.id).toBe("btn");
	});

	test("resolves to the interactive control, not the inner text span it wraps", () => {
		// The real F5 console renders "Add Health Check" as <button role=tab>
		// wrapping label <span>s. The click target must be the button (a robust,
		// semantic hit target) — not the innermost span, which makes the trusted
		// CDP click flaky.
		const el = resolveElement(
			`<div id="outer"><button id="tab" role="tab"><div class="btn-label"><span id="label">Add Health Check</span></div></button></div>`,
			"text('Add Health Check')",
		);
		expect(el?.id).toBe("tab");
	});

	test("falls back to the innermost element when no match is interactive", () => {
		// Readiness gates like wait_for text('Health Checks') target plain text.
		const el = resolveElement(`<div id="page"><h1 id="title">Health Checks</h1></div>`, "text('Health Checks')");
		expect(el?.id).toBe("title");
	});

	test("still resolves a plain single match", () => {
		const el = resolveElement(`<button id="only">Save</button>`, "text('Save')");
		expect(el?.id).toBe("only");
	});
});
