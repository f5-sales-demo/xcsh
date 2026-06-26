import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { sanitizeText } from "@f5-sales-demo/pi-natives";
import { Settings } from "@f5-sales-demo/xcsh/config/settings";
import type { ToolSession } from "@f5-sales-demo/xcsh/tools";
import { FindTool, findToolRenderer } from "@f5-sales-demo/xcsh/tools/find";
import { getThemeByName } from "../../src/modes/theme/theme";

describe("find renderResult has no terminal status glyph", () => {
	it("zero-result renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "No files found matching pattern" }],
			details: { scopePath: ".", fileCount: 0, files: [], truncated: false },
		};
		const component = findToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "*.nonexistent",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("success renderResult contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "foo.ts\nbar.ts" }],
			details: {
				scopePath: ".",
				fileCount: 2,
				files: ["foo.ts", "bar.ts"],
				truncated: false,
			},
		};
		const component = findToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "*.ts",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("truncated result contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "foo.ts" }],
			details: {
				scopePath: ".",
				fileCount: 1,
				files: ["foo.ts"],
				truncated: true,
				resultLimitReached: 1,
			},
		};
		const component = findToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "*.ts",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});

	it("content-only (no details) success branch contains no ✓/✗/⚠ after ANSI strip", async () => {
		const theme = await getThemeByName("xcsh-dark");
		const result = {
			content: [{ type: "text", text: "foo.ts\nbar.ts" }],
		};
		const component = findToolRenderer.renderResult(result as never, { expanded: false, isPartial: false }, theme!, {
			pattern: "*.ts",
		});
		const rendered = sanitizeText(component.render(200).join("\n"));
		expect(rendered).not.toMatch(/[✓✔✗✘⚠ⓘ]/);
	});
});

describe("find execute signals isWarning on 0 results", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "find-isWarning-test-"));
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
			settings: Settings.isolated({}),
			...overrides,
		} as ToolSession;
	}

	it("result.isWarning is true when no files match", async () => {
		await fs.writeFile(path.join(tmpDir, "hello.txt"), "hello world\n");
		const tool = new FindTool(createSession());
		const result = await tool.execute("test-tool-call-id", {
			pattern: "*.no-such-ext-xyz-1234567890",
		});
		expect(result.isWarning).toBe(true);
	});

	it("result.isWarning is falsy when files match", async () => {
		await fs.writeFile(path.join(tmpDir, "hello.txt"), "hello world\n");
		const tool = new FindTool(createSession());
		const result = await tool.execute("test-tool-call-id", {
			pattern: "*.txt",
		});
		expect(result.isWarning).toBeFalsy();
	});
});
