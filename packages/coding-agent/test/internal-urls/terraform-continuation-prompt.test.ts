import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

test("both system prompts require a current-turn terminal anchored read after clarification", () => {
	const root = path.resolve(import.meta.dir, "../../src/prompts/system");
	expect(readFileSync(path.join(root, "progressive-system-prompt.md"), "utf8")).toContain(
		"reread the terminal anchor before answering",
	);
	expect(readFileSync(path.join(root, "progressive-system-prompt.md"), "utf8")).toContain(
		"role alone never implies configurable or computed",
	);
	expect(readFileSync(path.join(root, "system-prompt.md"), "utf8")).toContain(
		"prior-turn reads do not satisfy this continuation contract",
	);
});
