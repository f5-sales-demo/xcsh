import { expect, test } from "bun:test";
import { Marked } from "marked";
import { createMathExtensions } from "../../src/markdown/math";
import { renderMarkdown } from "../../src/markdown/render";
import { sanitizeHtml } from "../../src/markdown/sanitize";
import { softCloseForStreaming } from "../../src/markdown/streaming";
import catalog from "./fixtures/synthesized.catalog.json";

for (const item of catalog) {
	test(`synthesized ${item.id}: semantic coverage and streamed convergence`, () => {
		const el = document.createElement("div");
		el.innerHTML = renderMarkdown(item.markdown);
		for (const [selector, minimum] of Object.entries(item.selectors))
			expect(el.querySelectorAll(selector).length, `${item.id}: ${selector}`).toBeGreaterThanOrEqual(minimum!);
		for (const text of item.text) expect(el.textContent).toContain(text);
		expect(softCloseForStreaming(item.markdown)).toBe(item.markdown);
		// Walk chunk boundaries inside every construct, then converge to independently
		// parsed complete source rather than comparing a render call to itself.
		let buffer = "";
		for (let offset = 0; offset < item.markdown.length; offset += 17) {
			buffer += item.markdown.slice(offset, offset + 17);
			renderMarkdown(buffer);
		}
		expect(buffer).toBe(item.markdown);
		const complete = new Marked({ gfm: true, async: false })
			.use({ extensions: createMathExtensions() })
			.parse(buffer, { async: false });
		const parsed = document.createElement("div");
		parsed.innerHTML = sanitizeHtml(complete);
		// Compare authoritative source, independently parsed by uncustomized marked.
		for (const code of el.querySelectorAll<HTMLElement>("pre code[data-code-source]")) {
			expect(code.dataset.codeSource).toBeDefined();
			code.textContent = `${JSON.parse(code.dataset.codeSource ?? '""')}\n`;
		}
		expect(el.textContent?.replace(/\s+/g, " ").trim()).toBe(parsed.textContent?.replace(/\s+/g, " ").trim());
	}, 20_000);
}
