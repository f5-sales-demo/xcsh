import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_MODEL_ROLE_VALUE, generateConfigYml, healConfigYmlModelRoles } from "../src/config/auto-config";
import { Settings } from "../src/config/settings";
import { DEFAULT_MODEL_ROLE } from "../src/config/settings-schema";

/**
 * WS6: the default model role is baked into the binary so a fresh install needs
 * NO config.yml. WS3: a leaked benchmark default (`bench-instant/bench-instant`)
 * must self-heal instead of dropping xcsh into the catalog-wide fallback that
 * surfaced the AWS-SSO / invalid-model errors.
 */
describe("F5 default model role (binary-baked)", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-autocfg-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("the binary bakes anthropic/claude-opus-4-8 as the default role", () => {
		expect(DEFAULT_MODEL_ROLE).toBe("anthropic/claude-opus-4-8");
		expect(DEFAULT_MODEL_ROLE_VALUE).toBe(DEFAULT_MODEL_ROLE);
	});

	test("a fresh install (no config.yml) resolves the default from the binary", () => {
		const settings = Settings.isolated();
		expect(settings.getModelRole("default")).toBe("anthropic/claude-opus-4-8");
	});

	test("generateConfigYml does NOT persist a model id (binary provides it)", () => {
		const yml = generateConfigYml();
		expect(yml).not.toContain("modelRoles:");
		expect(yml).not.toContain("claude-opus-4-8");
		expect(yml).toContain("providers:");
	});

	test("heal rewrites a bench-instant leak to the binary default", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "modelRoles:\n  default: bench-instant/bench-instant\nproviders:\n  image: openai\n");
		healConfigYmlModelRoles(cfg);
		const out = fs.readFileSync(cfg, "utf-8");
		expect(out).toContain("default: anthropic/claude-opus-4-8");
		expect(out).not.toContain("bench-instant");
		expect(out).toContain("providers:"); // untouched remainder preserved
	});

	test("heal leaves a config without modelRoles untouched (binary provides the default)", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "providers:\n  image: openai\n");
		healConfigYmlModelRoles(cfg);
		expect(fs.readFileSync(cfg, "utf-8")).toBe("providers:\n  image: openai\n");
	});

	test("heal leaves a legitimate user default untouched", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "modelRoles:\n  default: anthropic/claude-sonnet-4-6\n");
		healConfigYmlModelRoles(cfg);
		expect(fs.readFileSync(cfg, "utf-8")).toContain("default: anthropic/claude-sonnet-4-6");
	});
});
