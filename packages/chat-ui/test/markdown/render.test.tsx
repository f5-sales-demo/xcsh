/**
 * Renderer primitives + the `MarkdownRenderer` React sink (jsdom; see
 * register-jsdom.ts). `escapeHtml`/`isSafeUrl` are the retained, load-bearing
 * helpers; the component tests pin the block-`<div>` sink (Task 1) and the
 * streaming rAF debounce convergence.
 */
import { expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { MarkdownRenderer } from "../../src/components/MarkdownRenderer";
import { escapeHtml, isSafeUrl, renderMarkdown } from "../../src/markdown/render";

test("escapeHtml neutralizes all HTML metacharacters", () => {
	expect(escapeHtml(`<img src=x onerror="alert('x')">`)).toBe(
		"&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
	);
});

test("isSafeUrl accepts http(s)/mailto and rejects javascript:", () => {
	expect(isSafeUrl("https://f5.com")).toBe(true);
	expect(isSafeUrl("http://f5.com")).toBe(true);
	expect(isSafeUrl("mailto:a@b.com")).toBe(true);
	expect(isSafeUrl("javascript:alert(1)")).toBe(false);
	expect(isSafeUrl("data:text/html,x")).toBe(false);
});

test("renderMarkdown escapes raw HTML but keeps the bold/code/link allow-list", () => {
	const html = renderMarkdown("hi **bold** and `code` and <script>evil</script>");
	expect(html).toContain("<strong>bold</strong>");
	expect(html).toContain("<code>code</code>");
	expect(html).not.toContain("<script>");
});

test("MarkdownRenderer renders the produced HTML into the DOM", () => {
	const { container } = render(<MarkdownRenderer text="a **b**" />);
	expect(container.querySelector("strong")?.textContent).toBe("b");
});

test("MarkdownRenderer sink is a block-level <div> so block markup is not reparented", () => {
	const { container } = render(<MarkdownRenderer text={"```\ncode block\n```"} />);
	const sink = container.firstElementChild as HTMLElement;
	// The sink MUST be a block container: a <span> is inline, and block children
	// (<pre>/<table>/<h1>) inside it are invalid HTML that the browser reparents.
	expect(sink.tagName).toBe("DIV");
	expect(sink.querySelector("pre")).not.toBeNull();
});

test("MarkdownRenderer renders a table as a direct descendant of the block sink", () => {
	const { container } = render(<MarkdownRenderer text={"| a | b |\n|---|---|\n| 1 | 2 |"} />);
	const sink = container.firstElementChild as HTMLElement;
	expect(sink.querySelector("table thead th")).not.toBeNull();
});

test("MarkdownRenderer carries the markdown-root class for the scoped block stylesheet", () => {
	const { container } = render(<MarkdownRenderer text="a **b**" className="body markdown-root" />);
	const sink = container.firstElementChild as HTMLElement;
	expect(sink.classList.contains("markdown-root")).toBe(true);
});

test("MarkdownRenderer streaming path converges to the final render after a frame", async () => {
	const { container, rerender } = render(<MarkdownRenderer text="partial" streaming className="body" />);
	// First paint shows the first text synchronously (no blank flash).
	expect(container.textContent).toContain("partial");
	rerender(<MarkdownRenderer text={"# Done\n\nfull **content**"} streaming className="body" />);
	await waitFor(() => {
		expect(container.querySelector("h1")?.textContent).toBe("Done");
		expect(container.querySelector("strong")?.textContent).toBe("content");
	});
});
