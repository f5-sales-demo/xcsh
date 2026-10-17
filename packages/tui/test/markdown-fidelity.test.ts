import { describe, expect, test } from "bun:test";
import { Marked, type Token } from "marked";
import catalog from "../../chat-ui/test/markdown/fixtures/synthesized.catalog.json";
import { Markdown } from "../src/components/markdown";
import { visibleWidth } from "../src/utils";
import { defaultMarkdownTheme } from "./test-themes";

const plain = (source: string, width = 40) =>
	new Markdown(source, 0, 0, defaultMarkdownTheme).render(width).map(line => Bun.stripANSI(line).trimEnd());

describe("Markdown structural fidelity", () => {
	test("retains checked and unchecked tasks", () => {
		expect(plain("- [x] Ready\n- [ ] Pending")).toEqual(["- [x] Ready", "- [ ] Pending"]);
	});
	test("renders all blocks inside a list item", () => {
		const lines = plain(
			"- Runbook\n\n  | Name | Count |\n  | --- | --- |\n  | Widget | 0 |\n\n  > ## Warning\n  > Keep this value.\n\n  ---",
		);
		for (const value of ["Name", "Count", "Widget", "0", "Warning", "Keep this value."])
			expect(lines.join("\n")).toContain(value);
	});
	test("nesting is structural under any bullet color", () => {
		const theme = { ...defaultMarkdownTheme, listBullet: (s: string) => s };
		expect(
			new Markdown("- Parent\n  - Child\n    - Grandchild", 0, 0, theme)
				.render(40)
				.map(s => Bun.stripANSI(s).trimEnd()),
		).toEqual(["- Parent", "  - Child", "    - Grandchild"]);
	});
	test("ordered continuation lines align beneath content including nested blocks", () => {
		const lines = plain(`9. ${"word ".repeat(16)}\n10. next`, 40);
		expect(lines[1].startsWith("   word")).toBe(true);
		expect(lines[2].startsWith("   word")).toBe(true);
		expect(lines.at(-1)).toBe("10. next");
	});
	test("highlighting receives original tabs and wrapped code keeps indentation", () => {
		let received = "";
		const theme = {
			...defaultMarkdownTheme,
			highlightCode: (s: string) => {
				received = s;
				return s.split("\n");
			},
		};
		const source = `\tprintf '%s' '${"x".repeat(100)}'`;
		const lines = new Markdown(`\`\`\`bash\n${source}\n\`\`\``, 0, 0, theme).render(40);
		expect(received).toBe(source);
		expect(lines.slice(1).every(s => Bun.stripANSI(s).startsWith("  "))).toBe(true);
		expect(lines.every(s => visibleWidth(s) <= 40)).toBe(true);
	});
	test("mixed nested wrapping stays in bounds and retains values on resize", () => {
		const source = `- [x] ${"word ".repeat(50)}\n\n  > Quote ${"value ".repeat(50)}\n\n  \`\`\`unknown\n  ${"abcdefghij".repeat(20)}\n  \`\`\``;
		const md = new Markdown(source, 0, 0, defaultMarkdownTheme);
		for (const width of [40, 76, 120, 153, 40]) {
			const lines = md.render(width);
			expect(lines.every(s => visibleWidth(s) <= width)).toBe(true);
			expect(lines.map(Bun.stripANSI).join("\n")).toContain("[x]");
		}
	});
});

test("source-based copied JSON and Bash remain syntactically valid without execution", () => {
	const parser = new Marked();
	let json = 0;
	let bash = 0;
	const walk = (tokens: readonly Token[]) => {
		for (const token of tokens) {
			if (token.type === "code") {
				if (token.lang === "json") {
					expect(() => JSON.parse(token.text)).not.toThrow();
					json++;
				}
				if (token.lang === "bash") {
					const check = Bun.spawnSync(["bash", "-n"], {
						stdin: Buffer.from(token.text),
						stdout: "pipe",
						stderr: "pipe",
					});
					expect(check.exitCode).toBe(0);
					bash++;
				}
			} else if (token.type === "list") {
				for (const item of token.items) walk(item.tokens);
			} else if ("tokens" in token && token.tokens) walk(token.tokens);
		}
	};
	for (const item of catalog) walk(parser.lexer(item.markdown));
	expect(json).toBeGreaterThan(0);
	expect(bash).toBeGreaterThan(0);
});

test("wrapped code continuations retain source indentation", () => {
	const source = `\`\`\`bash\n    printf '%s' '${"x".repeat(100)}'\n\`\`\``;
	const lines = new Markdown(source, 0, 0, defaultMarkdownTheme).render(40).slice(1);
	expect(lines.every(line => Bun.stripANSI(line).startsWith("      "))).toBe(true);
});
