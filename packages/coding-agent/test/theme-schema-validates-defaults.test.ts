import { beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import Ajv, { type ValidateFunction } from "ajv";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const schemaPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/theme-schema.json");
const darkPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/defaults/xcsh-dark.json");
const lightPath = path.join(repoRoot, "packages/coding-agent/src/modes/theme/defaults/xcsh-light.json");

async function loadJson<T>(p: string): Promise<T> {
	return JSON.parse(await fs.readFile(p, "utf8")) as T;
}

let validate: ValidateFunction;
let darkTheme: object;
let lightTheme: object;

describe("theme-schema.json strictly validates shipped default themes (issue #242)", () => {
	beforeAll(async () => {
		const schema = await loadJson<object>(schemaPath);
		// strict:false silences Ajv's own meta-schema warnings; we're validating draft-07 themes.
		const ajv = new Ajv({ strict: false, allErrors: true });
		validate = ajv.compile(schema);
		darkTheme = await loadJson<object>(darkPath);
		lightTheme = await loadJson<object>(lightPath);
	});

	it("xcsh-dark.json passes strict validation", () => {
		const ok = validate(darkTheme);
		expect(validate.errors ?? [], "xcsh-dark.json must satisfy the strict schema").toEqual([]);
		expect(ok).toBe(true);
	});

	it("xcsh-light.json passes strict validation", () => {
		const ok = validate(lightTheme);
		expect(validate.errors ?? [], "xcsh-light.json must satisfy the strict schema").toEqual([]);
		expect(ok).toBe(true);
	});

	it("rejects a theme missing a required powerline key (statusLineGitStagedBg)", () => {
		const mutated = structuredClone(darkTheme) as { colors: Record<string, unknown> };
		delete mutated.colors.statusLineGitStagedBg;
		const ok = validate(mutated);
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

	it("rejects a theme with an undeclared extra color key (additionalProperties: false)", () => {
		const mutated = structuredClone(darkTheme) as { colors: Record<string, unknown> };
		mutated.colors.bogusKey = "#fff";
		const ok = validate(mutated);
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
