import { expect, test } from "bun:test";
import { join } from "node:path";

const root = new URL("../../../", import.meta.url).pathname;

test("first-party user-facing source and English documentation spell the product name as xcsh", async () => {
	const files = new Set<string>(["DEVELOPING.md", "TUI_HANDOFF.md", "TUI_IMPLEMENTATION.md"]);
	for (const pattern of ["packages/coding-agent/src/**/*.{ts,md}", "packages/tui/src/**/*.ts", "docs/en/**/*.mdx"])
		for await (const file of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
			if (file.endsWith(".generated.ts") || file.includes("/locales/")) continue;
			files.add(file);
		}

	const violations: string[] = [];
	for (const file of [...files].sort()) {
		const content = await Bun.file(join(root, file)).text();
		for (const match of content.matchAll(/\b(?:XCSH|Xcsh|xCsh)\b/g)) {
			// XCSH.md and XCSH_* are literal compatibility identifiers, not product-name styling.
			const suffix = content.slice(match.index + match[0].length);
			if (suffix.startsWith(".md") || suffix.startsWith("_")) continue;
			const line = content.slice(0, match.index).split("\n").length;
			violations.push(`${file}:${line}:${match[0]}`);
		}
	}

	expect(violations).toEqual([]);
});
