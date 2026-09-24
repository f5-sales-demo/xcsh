import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("the TUI preserves enabled MCP unless the caller explicitly disables it", async () => {
	const source = await readFile(join(import.meta.dir, "../src/main.ts"), "utf8");

	expect(source).not.toContain("sessionOptions.enableMCP = false;");
	expect(source).toContain("if (parsed.noTools || parsed.noMcp)");
});
