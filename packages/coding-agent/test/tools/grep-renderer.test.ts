import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import type { ToolSession } from "@f5-sales-demo/xcsh/tools";
import { GrepTool, grepToolRenderer } from "@f5-sales-demo/xcsh/tools/grep";
import { getThemeByName } from "../../src/modes/theme/theme";

describe("grepToolRenderer", () => {
	it("keeps summary and truncation rows inside the collapsed line budget", async () => {
		const theme = await getThemeByName("xcsh-dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const result = {
			content: [
				{
					type: "text",
					text: ["alpha:1", "alpha:2", "", "beta:1", "beta:2", "", "gamma:1", "gamma:2"].join("\n"),
				},
			],
			details: {
				matchCount: 6,
				fileCount: 3,
				meta: {
					limits: {
						matchLimit: { reached: 6 },
					},
				},
			},
		};

		const collapsed = grepToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, uiTheme, {
			pattern: "needle",
		});
		const renderedLines = sanitizeText(collapsed.render(200).join("\n")).split("\n");
		const bodyLines = renderedLines.slice(1);

		expect(bodyLines).toHaveLength(6);
		expect(bodyLines.at(-1)).toContain("truncated: limit 6 matches");
		expect(bodyLines.some(line => line.includes("1 more match"))).toBe(true);
		expect(bodyLines.some(line => line.includes("gamma:1"))).toBe(false);
	});
});

describe("grep renderResult has no terminal status glyph", () => {
	it("zero-match result contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "" }],
			details: { matchCount: 0, fileCount: 0 },
		};
		const component = grepToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "needle",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("successful match result contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "foo:1:bar" }],
			details: { matchCount: 1, fileCount: 1 },
		};
		const component = grepToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "bar",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("truncated result contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "foo:1:bar" }],
			details: {
				matchCount: 1,
				fileCount: 1,
				truncated: true,
				meta: { limits: { matchLimit: { reached: 1 } } },
			},
		};
		const component = grepToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "bar",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("content-only (no details) success branch contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "foo:1:match\nbar:2:match" }],
		};
		const component = grepToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "match",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});

describe("grep execute signals isWarning on 0 matches", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-isWarning-test-"));
	});

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
		return {
			cwd: tmpDir,
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings: Settings.isolated({ "grep.contextBefore": 0, "grep.contextAfter": 0 }),
			...overrides,
		} as ToolSession;
	}

	it("result.isWarning is true when no matches found", async () => {
		await Bun.write(path.join(tmpDir, "hello.txt"), "hello world\n");
		const tool = new GrepTool(createSession());
		const result = await tool.execute("test-tool-call-id", {
			pattern: "grep-task8-no-such-string-xyz-1234567890",
		});
		expect(result.isWarning).toBe(true);
	});

	it("result.isWarning is falsy when matches found", async () => {
		await Bun.write(path.join(tmpDir, "hello.txt"), "hello world\nimport foo\n");
		const tool = new GrepTool(createSession());
		const result = await tool.execute("test-tool-call-id", {
			pattern: "hello",
		});
		expect(result.isWarning).toBeFalsy();
	});
});
