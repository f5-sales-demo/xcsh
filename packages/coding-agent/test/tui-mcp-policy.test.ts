import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("the TUI resolves MCP from explicit flags and the trusted user setting", async () => {
	const source = await readFile(join(import.meta.dir, "../src/main.ts"), "utf8");

	expect(source).toContain("resolveCliMCPEnabled");
	expect(source).toContain('settings.inspectScopes("mcp.enabled").userValue');
});
