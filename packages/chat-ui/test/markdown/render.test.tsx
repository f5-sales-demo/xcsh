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
	expect(isSafeUrl("mailto:yuri@example.net")).toBe(true);
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

test("renderMarkdown emits semantic inline and display MathML", () => {
	const html = renderMarkdown("Inline $x^2$.\n\n$$\nI \\propto \\frac{1}{\\lambda^4}\n$$");
	const root = document.createElement("div");
	root.innerHTML = html;
	const math = root.querySelectorAll("math");
	expect(math).toHaveLength(2);
	expect(math[0]?.getAttribute("display")).not.toBe("block");
	expect(math[1]?.getAttribute("display")).toBe("block");
	expect(math[1]?.querySelector("mfrac")).not.toBeNull();
	expect(math[1]?.textContent).toContain("I");
	expect(math[1]?.textContent).toContain("∝");
	expect(math[1]?.textContent).toContain("λ");
	expect(html).not.toContain("\\frac");
});

test("math renders inside lists, tables, and blockquotes", () => {
	const markdown = [
		"- $F_1=u^2$",
		"",
		"| value |",
		"| --- |",
		"| \\(\\mathbb{C}^3\\) |",
		"",
		"> $s \\to \\infty$",
	].join("\n");
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(markdown);
	expect(root.querySelector("li math")?.textContent).toContain("F");
	expect(root.querySelector("td math")?.textContent).toContain("ℂ");
	expect(root.querySelector("blockquote math")?.textContent).toContain("∞");
});

test("multiline matrices, cases, and aligned operators survive sanitization", () => {
	const source =
		"$$\\begin{aligned}A&=\\begin{matrix}a&b\\\\c&d\\end{matrix}\\\\f(x)&=\\begin{cases}x&x>0\\\\-x&x\\leq0\\end{cases}\\end{aligned}$$";
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(source);
	expect(root.querySelector("math mtable")).not.toBeNull();
	expect(root.querySelectorAll("mtr").length).toBeGreaterThanOrEqual(2);
	expect(root.textContent).toContain("≤");
	expect(root.textContent).not.toContain("\\begin");
});

test("incomplete and unsupported math remains exact readable source", () => {
	const cases = [
		"Map $\\mathbb{C}^3",
		"Unknown $x + \\unknown{y}$ after",
		"\\[\n\\frac{1}{x\n\\]",
	];
	for (const source of cases) {
		const root = document.createElement("div");
		root.innerHTML = renderMarkdown(source);
		expect(root.textContent?.trimEnd()).toBe(source);
		expect(root.querySelector("math")).toBeNull();
	}
});

test("currency, shell variables, escaped dollars, and code remain literal", () => {
	const source =
		"Costs $5 and $10 or $8k–$12k; $HOME; $" +
		"{PATH}; \\$x-y\\$; " +
		String.fromCharCode(96) +
		"$\\lambda$" +
		String.fromCharCode(96);
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(source);
	expect(root.querySelector("math")).toBeNull();
	expect(root.textContent?.trimEnd()).toBe(
		"Costs $5 and $10 or $8k–$12k; $HOME; $" + "{PATH}; $x-y$; $\\lambda$",
	);
	const adjacent = document.createElement("div");
	adjacent.innerHTML = renderMarkdown("Pay $5; use $HOME or ${PATH}; escape \\$x$.");
	expect(adjacent.querySelector("math")).toBeNull();
	expect(adjacent.textContent?.trimEnd()).toBe("Pay $5; use $HOME or ${PATH}; escape $x$.");
});
