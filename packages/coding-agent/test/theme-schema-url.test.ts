/**
 * Issue #220 — the `$schema` URL declared in xcsh-dark.json / xcsh-light.json
 * must point to an in-repo file that actually exists, so editor/IDE schema
 * validators can fetch it and project consumers have a working reference.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const themeDir = path.join(repoRoot, "packages/coding-agent/src/modes/theme/defaults");

async function repoPathFromSchemaUrl(themeFile: string): Promise<string> {
	const raw = await fs.readFile(themeFile, "utf8");
	const parsed = JSON.parse(raw);
	const url = parsed.$schema;
	expect(typeof url).toBe("string");
	// Expected form: https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
	const match = url.match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
	expect(match).not.toBeNull();
	return match![1];
}

describe("theme JSON $schema URL resolves to an existing file (issue #220)", () => {
	it("xcsh-dark.json $schema references a file that exists in the repo", async () => {
		const repoRelative = await repoPathFromSchemaUrl(path.join(themeDir, "xcsh-dark.json"));
		const abs = path.join(repoRoot, repoRelative);
		const stat = await fs.stat(abs).catch(() => null);
		expect(stat, `$schema points at "${repoRelative}" which does not exist in the repo`).not.toBeNull();
	});

	it("xcsh-light.json $schema references a file that exists in the repo", async () => {
		const repoRelative = await repoPathFromSchemaUrl(path.join(themeDir, "xcsh-light.json"));
		const abs = path.join(repoRoot, repoRelative);
		const stat = await fs.stat(abs).catch(() => null);
		expect(stat, `$schema points at "${repoRelative}" which does not exist in the repo`).not.toBeNull();
	});
});
