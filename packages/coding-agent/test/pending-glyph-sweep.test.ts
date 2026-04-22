/**
 * Source-level regression guards for the "no inline pending glyph" sweep
 * performed during PR #207 UAT.
 *
 * The gutter ball is the sole spinner — inline ⏳/hourglass references were
 * stripped from tool-call-context renderers. These tests guard against the
 * pattern creeping back in via merges/refactors.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const srcRoot = path.join(import.meta.dir, "../src");

async function readSrc(rel: string): Promise<string> {
	return fs.readFile(path.join(srcRoot, rel), "utf8");
}

describe("pending glyph — removed from tool-call-context renderers (PR #207)", () => {
	it("oauth-selector checking fallback no longer uses theme.status.pending", async () => {
		const src = await readSrc("modes/components/oauth-selector.ts");
		expect(src).not.toMatch(/theme\.status\.pending/);
	});

	it("btw-panel waiting message no longer prefixes theme.status.pending", async () => {
		const src = await readSrc("modes/components/btw-panel.ts");
		expect(src).not.toMatch(/theme\.status\.pending/);
	});

	it("command-controller resolveStatusIcon pending branch returns no glyph", async () => {
		const src = await readSrc("modes/controllers/command-controller.ts");
		expect(src).not.toMatch(/uiTheme\.status\.pending/);
	});

	it("read-tool-group no longer calls theme.status.pending via #formatStatus", async () => {
		const src = await readSrc("modes/components/read-tool-group.ts");
		expect(src).not.toMatch(/theme\.status\.pending/);
		// #formatStatus method itself is gone
		expect(src).not.toMatch(/#formatStatus/);
	});

	it("render-utils formatStatusIcon returns empty for pending", async () => {
		const src = await readSrc("tools/render-utils.ts");
		// Pending case returns literal "" (no theme.styledSymbol call)
		expect(src).toMatch(/case "pending":\s*\/\/[^\n]*\s*return "";/);
	});
});

describe("tool-execution — paddingX=0 for tool content across both render paths", () => {
	it("custom-tool path sets paddingX to 0", async () => {
		const src = await readSrc("modes/components/tool-execution.ts");
		// Must set paddingX to 0 after setBgFn in the first path
		expect(src).toMatch(/this\.#contentBox\.setPaddingX\(0\)/);
	});

	it("toolRenderers path sets paddingX to 0 before children added", async () => {
		const src = await readSrc("modes/components/tool-execution.ts");
		// Both paths should have setPaddingX calls
		const matches = src.match(/this\.#contentBox\.setPaddingX\(0\)/g) ?? [];
		expect(matches.length).toBeGreaterThanOrEqual(2);
	});
});
