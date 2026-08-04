import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effort } from "@f5-sales-demo/pi-ai";
import { DEFAULT_MODEL_ROLE_VALUE, generateConfigYml, healConfigYmlModelRoles } from "../src/config/auto-config";
import { Settings } from "../src/config/settings";
import { DEFAULT_MODEL_ROLE } from "../src/config/settings-schema";

/**
 * The benchmark-selected production role is binary-baked so a fresh install
 * needs no config.yml. A leaked benchmark-only default must self-heal instead
 * of dropping xcsh into the catalog-wide fallback.
 */
describe("xcsh production model defaults", () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-default-model-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("bakes LiteLLM GPT-5.6 Sol High as the production default", () => {
		expect(DEFAULT_MODEL_ROLE).toBe("litellm/gpt-5.6-sol:high");
		expect(DEFAULT_MODEL_ROLE_VALUE).toBe(DEFAULT_MODEL_ROLE);
		const settings = Settings.isolated();
		expect(settings.getModelRole("default")).toBe(DEFAULT_MODEL_ROLE);
		expect(settings.get("defaultThinkingLevel")).toBe(Effort.High);
	});

	test("uses GPT-5.6 Sol Low for fast work and restores High for thinking work", () => {
		const settings = Settings.isolated();
		expect(settings.getModelRole("smol")).toBe("litellm/gpt-5.6-sol:low");
		expect(settings.getModelRole("slow")).toBe("litellm/gpt-5.6-sol:high");
	});

	test("does not persist the binary model default in generated config", () => {
		const yml = generateConfigYml();
		expect(yml).not.toContain("modelRoles:");
		expect(yml).not.toContain("gpt-5.6-sol");
		expect(yml).toContain("providers:");
	});

	test("repairs an unresolvable benchmark model role to the production default", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "modelRoles:\n  default: bench-instant/bench-instant\nproviders:\n  image: openai\n");
		healConfigYmlModelRoles(cfg);
		const out = fs.readFileSync(cfg, "utf-8");
		expect(out).toContain("default: litellm/gpt-5.6-sol:high");
		expect(out).not.toContain("bench-instant");
		expect(out).toContain("providers:");
	});

	test("leaves config without model roles untouched", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "providers:\n  image: openai\n");
		healConfigYmlModelRoles(cfg);
		expect(fs.readFileSync(cfg, "utf-8")).toBe("providers:\n  image: openai\n");
	});

	test("leaves an intentional user default untouched", () => {
		const cfg = path.join(dir, "config.yml");
		fs.writeFileSync(cfg, "modelRoles:\n  default: anthropic/claude-sonnet-4-6\n");
		healConfigYmlModelRoles(cfg);
		expect(fs.readFileSync(cfg, "utf-8")).toContain("default: anthropic/claude-sonnet-4-6");
	});
});
