import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import { QMD_SMOKE_SUCCESS, runQmdSmoke } from "../src/qmd-smoke";

const sourceRoot = path.resolve(import.meta.dir, "..", "src");

describe("MCP clean-removal contract", () => {
	it("ships no MCP runtime, configuration discovery, or protocol surface", () => {
		for (const relativePath of [
			"mcp",
			"capability/mcp.ts",
			"config/mcp-schema.json",
			"discovery/mcp-json.ts",
			"internal-urls/mcp-protocol.ts",
			"modes/controllers/mcp-command-controller.ts",
			"modes/components/mcp-add-wizard.ts",
		]) {
			expect(existsSync(path.join(sourceRoot, relativePath))).toBe(false);
		}
	});

	it("retains the in-process QMD documentation search, exact read, and SVG conversion path", async () => {
		expect(await runQmdSmoke()).toBe(QMD_SMOKE_SUCCESS);
	}, 30_000);
});
