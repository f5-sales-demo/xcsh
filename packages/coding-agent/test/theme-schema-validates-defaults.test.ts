import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import Ajv from "ajv";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const schemaPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/theme-schema.json");
const darkPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json");
const lightPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/defaults/xcsh-light.json");

async function loadJson<T>(p: string): Promise<T> {
	return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

async function compileSchema() {
	const schema = await loadJson<object>(schemaPath);
	// strict:false silences Ajv's own meta-schema warnings; we're validating draft-07 themes.
	const ajv = new Ajv({ strict: false, allErrors: true });
	return ajv.compile(schema);
}

describe("theme-schema.json strictly validates shipped default themes (issue #242)", () => {
	it("xcsh-dark.json passes strict validation", async () => {
		const validate = await compileSchema();
		const theme = await loadJson<object>(darkPath);
		const ok = validate(theme);
		expect(validate.errors ?? [], "xcsh-dark.json must satisfy the strict schema").toEqual([]);
		expect(ok).toBe(true);
	});

	it("xcsh-light.json passes strict validation", async () => {
		const validate = await compileSchema();
		const theme = await loadJson<object>(lightPath);
		const ok = validate(theme);
		expect(validate.errors ?? [], "xcsh-light.json must satisfy the strict schema").toEqual([]);
		expect(ok).toBe(true);
	});

	it("rejects a theme missing a required powerline key (statusLineGitStagedBg)", async () => {
		const validate = await compileSchema();
		const theme = await loadJson<{ colors: Record<string, unknown> }>(darkPath);
		delete theme.colors.statusLineGitStagedBg;
		const ok = validate(theme);
		expect(ok).toBe(false);
		const missing = (validate.errors ?? []).some(
			e =>
				e.keyword === "required" &&
				(e.params as { missingProperty?: string }).missingProperty === "statusLineGitStagedBg",
		);
		expect(
			missing,
			`expected a 'required' error for statusLineGitStagedBg, got ${JSON.stringify(validate.errors)}`,
		).toBe(true);
	});

	it("rejects a theme with an undeclared extra color key (additionalProperties: false)", async () => {
		const validate = await compileSchema();
		const theme = await loadJson<{ colors: Record<string, unknown> }>(darkPath);
		theme.colors.bogusKey = "#fff";
		const ok = validate(theme);
		expect(ok).toBe(false);
		const extra = (validate.errors ?? []).some(
			e =>
				e.keyword === "additionalProperties" &&
				(e.params as { additionalProperty?: string }).additionalProperty === "bogusKey",
		);
		expect(
			extra,
			`expected an 'additionalProperties' error for bogusKey, got ${JSON.stringify(validate.errors)}`,
		).toBe(true);
	});
});
