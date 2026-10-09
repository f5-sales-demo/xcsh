import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseQmdSmokeOutput } from "../../../../scripts/qmd-smoke-output";

test("release validator accepts the verified canonical WAF smoke route", async () => {
	const trace = await readFile(new URL("../fixtures/qmd-canonical-smoke.txt", import.meta.url), "utf8");
	expect(() => parseQmdSmokeOutput(trace)).not.toThrow();
});
