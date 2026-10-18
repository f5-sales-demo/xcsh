import { expect, test } from "bun:test";
import { presentCode } from "../../../utils/src/code-presentation";
import { codeLanguageCatalog } from "../../../utils/test/fixtures/code-language.catalog";
import { renderMarkdown } from "../../src/markdown/render";

test("per-language panels preserve source metadata with no visible labels", () => {
	for (const item of codeLanguageCatalog) {
		const root = document.createElement("div");
		root.innerHTML = renderMarkdown(`\`\`\`${item.language}\n${item.source}\n\`\`\``);
		const code = root.querySelector<HTMLElement>("pre code");
		expect(root.querySelector(".md-lang-label")).toBeNull();
		expect(JSON.parse(code?.dataset.codeSource ?? '""')).toBe(item.source);
		expect(code?.textContent).toBe(presentCode(item.source, item.language).display);
		expect(root.querySelector("script")).toBeNull();
		if (!item.language || item.language === "f5-example") expect(code?.querySelector("span")).toBeNull();
	}
});

test("HTTP API calls without protocol versions have typed JSON syntax", () => {
	const item = codeLanguageCatalog.find(item => item.id === "http-api-call")!;
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(`\`\`\`http\n${item.source}\n\`\`\``);
	expect(root.querySelector(".hljs-keyword")?.textContent).toBe("POST");
	expect(
		[...root.querySelectorAll(".hljs-string")].some(
			s => s.textContent === "/api/shape/csd/namespaces/{namespace}/testjs",
		),
	).toBe(true);
	expect([...root.querySelectorAll(".hljs-attr")].some(s => s.textContent === '"pageURL"')).toBe(true);
	expect(root.querySelector("code")?.textContent).toBe(item.source);
});

test("actual HCL and control-flow syntax categories survive sanitization", () => {
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(
		'```tf\n# demo\nresource "xcsh_http_loadbalancer" "demo" {\n  count = 2\n  enabled = true\n  names = [for n in var.names : n]\n}\n```',
	);
	for (const category of ["comment", "keyword", "attr", "string", "number", "operator", "control"])
		expect(root.querySelector(`.hljs-${category}`)).not.toBeNull();
});

test("streaming JSON keeps source layout until the real closing fence arrives", () => {
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown('```json\n{"count":2}');
	expect(root.querySelector("code")?.textContent).toBe('{"count":2}');
	root.innerHTML = renderMarkdown('```json\n{"count":2}\n```');
	expect(root.querySelector("code")?.textContent).toBe('{\n  "count": 2\n}');
});

test("HCL heredoc interpolations have variable syntax and keep literal source", () => {
	const source = `locals {\n  script = <<EOT\nhello \${var.domain}\nEOT\n}`;
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(`\`\`\`hcl\n${source}\n\`\`\``);
	expect(root.querySelector(".hljs-variable")?.textContent).toBe("var.domain");
	expect(root.querySelector("code")?.textContent).toBe(source);
});

test("raw HTML cannot forge a hidden code clipboard source", () => {
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(
		'<pre><code data-code-source="&quot;hidden command&quot;" data-code-display="&quot;safe text&quot;">safe text</code></pre>',
	);
	expect(root.querySelector("code[data-code-source]") === null).toBe(true);
	expect(root.textContent).toContain("safe text");
});

test("quoted shell heredocs keep variables as literal strings", () => {
	const source = "cat <<'EOF'\nLiteral $HOME and `date`\nEOF\n";
	const root = document.createElement("div");
	root.innerHTML = renderMarkdown(`\`\`\`bash\n${source}\n\`\`\``);
	expect(root.querySelectorAll(".hljs-variable").length).toBe(0);
	expect(root.querySelector("code")?.textContent).toBe(source);
});
