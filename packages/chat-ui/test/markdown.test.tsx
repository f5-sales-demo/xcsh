import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { MarkdownRenderer } from "../src/components/MarkdownRenderer";
import { escapeHtml, isSafeUrl, renderMarkdown } from "../src/markdown/render";

test("escapeHtml neutralizes all HTML metacharacters", () => {
	expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
		"&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
	);
});

test("renderMarkdown escapes raw HTML but keeps the bold/code/link allow-list", () => {
	const html = renderMarkdown("hi **bold** and `code` and <script>evil</script>");
	expect(html).toContain("<strong>bold</strong>");
	expect(html).toContain("<code>code</code>");
	expect(html).toContain("&lt;script&gt;");
	expect(html).not.toContain("<script>");
});

test("renderMarkdown allows safe links (new tab, noopener) and strips unsafe ones", () => {
	const safe = renderMarkdown("[docs](https://f5.com)");
	expect(safe).toContain('href="https://f5.com"');
	expect(safe).toContain('rel="noopener noreferrer"');

	const unsafe = renderMarkdown("[x](javascript:alert(1))");
	expect(unsafe).not.toContain("href");
	expect(unsafe).toContain("x");
});

test("isSafeUrl accepts http(s)/mailto and rejects javascript:", () => {
	expect(isSafeUrl("https://f5.com")).toBe(true);
	expect(isSafeUrl("mailto:a@b.com")).toBe(true);
	expect(isSafeUrl("javascript:alert(1)")).toBe(false);
});

test("MarkdownRenderer renders the produced HTML into the DOM", () => {
	const { container } = render(<MarkdownRenderer text="a **b**" />);
	expect(container.querySelector("strong")?.textContent).toBe("b");
});
