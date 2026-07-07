import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_MODEL_ROLE_VALUE, generateConfigYml, healConfigYmlModelRoles } from "../src/config/auto-config";

/**
 * WS2/WS3: the persisted default must be the F5 opus model, and a config that
 * carries an unresolvable benchmark default (`bench-instant/bench-instant`,
 * leaked from a TTFT bench run) must self-heal instead of dropping xcsh into the
 * catalog-wide fallback that surfaced the AWS-SSO / invalid-model errors.
 */
describe("F5 default model role (auto-config)", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-autocfg-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("DEFAULT_MODEL_ROLE_VALUE targets opus-4-8 on the anthropic passthrough", () => {
		expect(DEFAULT_MODEL_ROLE_VALUE).toBe("anthropic/claude-opus-4-8");
	});

	test("generateConfigYml writes the opus-4-8 default", () => {
		expect(generateConfigYml()).toContain("default: anthropic/claude-opus-4-8");
	});

	test("heal rewrites a bench-instant leak to the opus default", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "modelRoles:\n  default: bench-instant/bench-instant\nproviders:\n  image: openai\n");
		healConfigYmlModelRoles(cfg);
		const out = fs.readFileSync(cfg, "utf-8");
		expect(out).toContain("default: anthropic/claude-opus-4-8");
		expect(out).not.toContain("bench-instant");
		expect(out).toContain("providers:"); // untouched remainder preserved
	});

	test("heal adds a default when modelRoles is absent", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "providers:\n  image: openai\n");
		healConfigYmlModelRoles(cfg);
		expect(fs.readFileSync(cfg, "utf-8")).toContain("default: anthropic/claude-opus-4-8");
	});

	test("heal leaves a legitimate user default untouched", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "modelRoles:\n  default: anthropic/claude-sonnet-4-6\n");
		healConfigYmlModelRoles(cfg);
		expect(fs.readFileSync(cfg, "utf-8")).toContain("default: anthropic/claude-sonnet-4-6");
	});
});
