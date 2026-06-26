import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import { createTools, type ToolSession } from "@f5-sales-demo/xcsh/tools";
import { astGrepToolRenderer } from "@f5-sales-demo/xcsh/tools/ast-grep";
import { getThemeByName } from "../../src/modes/theme/theme";

function createTestSession(cwd = "/tmp/test", overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd,
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...overrides,
	};
}

describe("ast_grep parse errors", () => {
	it("collapses per-pattern parse errors for the same file", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-grep-parse-"));
		try {
			const filePath = path.join(tempDir, "broken.ts");
			await Bun.write(filePath, "export function broken( { return 1; }");

			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_grep");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-grep-parse", {
				pat: ["someUnlikelyCall($A)", "anotherUnlikelyCall($A)"],
				lang: "typescript",
				path: filePath,
			});

			const text = result.content.find(content => content.type === "text")?.text ?? "";
			const details = result.details as { parseErrors?: string[]; matchCount?: number } | undefined;

			expect(details?.matchCount).toBe(0);
			expect(text).toContain("No matches found");
			expect(text).toContain("Parse issues mean the query may be mis-scoped");
			expect(details?.parseErrors).toHaveLength(1);
			expect(details?.parseErrors?.[0]).toContain("broken.ts: parse error (syntax tree contains error nodes)");
			expect(details?.parseErrors?.[0]).not.toContain("someUnlikelyCall($A):");
			expect(details?.parseErrors?.[0]).not.toContain("anotherUnlikelyCall($A):");
			expect(text.match(/parse error \(syntax tree contains error nodes\)/g)?.length ?? 0).toBe(1);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
	it("combines globbing from path and glob parameters", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-grep-glob-"));
		try {
			const packagesDir = path.join(tempDir, "packages");
			const sourceDir = path.join(packagesDir, "pkg-123", "src");
			const nestedDir = path.join(sourceDir, "nested");
			await fs.mkdir(nestedDir, { recursive: true });
			await Bun.write(path.join(sourceDir, "root.ts"), "const providerOptions = {};\n");
			await Bun.write(path.join(nestedDir, "child.ts"), "const providerOptions = { nested: true };\n");
			await Bun.write(path.join(sourceDir, "ignore.js"), "const providerOptions = {};\n");
			await Bun.write(path.join(tempDir, "outside.ts"), "const providerOptions = {};\n");

			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_grep");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-grep-glob", {
				pat: ["providerOptions"],
				sel: "identifier",
				lang: "typescript",
				path: `${packagesDir}/pkg-*/src`,
				glob: "**/*.ts",
			});

			const text = result.content.find(content => content.type === "text")?.text ?? "";
			const details = result.details as { matchCount?: number; fileCount?: number } | undefined;

			expect(text).toContain("## └─ root.ts");
			expect(text).toContain("## └─ child.ts");
			expect(text).not.toContain("ignore.js");
			expect(text).not.toContain("outside.ts");
			expect(details?.matchCount).toBe(2);
			expect(details?.fileCount).toBe(2);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("parses PlusCal content through the tlaplus language aliases", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-grep-tlaplus-"));
		try {
			const filePath = path.join(tempDir, "Spec.tla");
			await Bun.write(
				filePath,
				`---- MODULE Spec ----\n(* --algorithm Demo\nvariables x = 0;\nbegin\n  Inc:\n    x := x + 1;\nend algorithm; *)\n====\n`,
			);

			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_grep");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-grep-tlaplus", {
				pat: ["Inc"],
				sel: "identifier",
				lang: "pluscal",
				path: filePath,
			});

			const text = result.content.find(content => content.type === "text")?.text ?? "";
			const details = result.details as { matchCount?: number; parseErrors?: string[] } | undefined;

			expect(text).toContain("Inc");
			expect(details?.matchCount).toBe(1);
			expect(details?.parseErrors).toBeUndefined();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

describe("ast-grep renderResult has no terminal status glyph", () => {
	it("zero-match renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				matchCount: 0,
				fileCount: 0,
				filesSearched: 3,
				limitReached: false,
				scopePath: ".",
				files: [],
				fileMatches: [],
			},
		};
		const component = astGrepToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ pat: ["noSuchPattern($A)"] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("zero-match renderResult with parse errors contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
			details: {
				matchCount: 0,
				fileCount: 0,
				filesSearched: 1,
				limitReached: false,
				scopePath: ".",
				files: [],
				fileMatches: [],
				parseErrors: ["broken.ts: parse error (syntax tree contains error nodes)"],
			},
		};
		const component = astGrepToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ pat: ["noSuchPattern($A)"] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("match renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "1:const providerOptions = {};" }],
			details: {
				matchCount: 1,
				fileCount: 1,
				filesSearched: 1,
				limitReached: false,
				scopePath: ".",
				files: ["foo.ts"],
				fileMatches: [{ path: "foo.ts", count: 1 }],
			},
		};
		const component = astGrepToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ pat: ["providerOptions"] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("limit-reached renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "1:const providerOptions = {};" }],
			details: {
				matchCount: 1,
				fileCount: 1,
				filesSearched: 1,
				limitReached: true,
				scopePath: ".",
				files: ["foo.ts"],
				fileMatches: [{ path: "foo.ts", count: 1 }],
			},
		};
		const component = astGrepToolRenderer.renderResult(
			result as never,
			{ expanded: false, isPartial: false },
			theme!,
			{ pat: ["providerOptions"] },
		);
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});

describe("ast-grep execute signals isWarning on 0 matches", () => {
	it("result.isWarning is true when no matches found", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-grep-isWarning-none-"));
		try {
			await Bun.write(path.join(tempDir, "hello.ts"), "const hello = 1;\n");
			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_grep");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-grep-isWarning-none", {
				pat: ["astGrepTask10NoSuchIdentifierXyz1234567890"],
				lang: "typescript",
				path: tempDir,
			});

			expect(result.isWarning).toBe(true);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("result.isWarning is falsy when matches found", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ast-grep-isWarning-match-"));
		try {
			await Bun.write(path.join(tempDir, "hello.ts"), "const providerOptions = {};\n");
			const tools = await createTools(createTestSession(tempDir));
			const tool = tools.find(entry => entry.name === "ast_grep");
			expect(tool).toBeDefined();

			const result = await tool!.execute("ast-grep-isWarning-match", {
				pat: ["providerOptions"],
				sel: "identifier",
				lang: "typescript",
				path: tempDir,
			});

			expect(result.isWarning).toBeFalsy();
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
