import { beforeAll, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { prompt } from "@f5-sales-demo/pi-utils";
import { registerCodingAgentPromptHelpers } from "../src/config/prompt-templates";

// Technique A of the MEDDPICC progressive-hints ladder: a generic, framework-agnostic
// "Installed Plugins" capability index. When ≥1 plugin is present, the template enumerates
// each installed plugin by name + own-manifest description + `xcsh://plugin/<name>` pointer,
// so the agent reliably consults the plugin instead of answering from memory. It is gated on
// the `hasPlugins` render variable and iterates the `plugins` array that `buildSystemPrompt`
// computes from discovered plugin summaries.
//
// Seam: the Handlebars-compile path (`prompt.render(template, data)`) — the same seam every
// other conditional-rendering assertion in this package uses. It is deterministic (no
// dependency on what is installed under the real home dir) and exercises the exact template
// block this task renders. `buildSystemPrompt` resolves plugins from `os.homedir()` and takes
// no `home` override, so a true-case fixture through it would be non-deterministic.

const systemPromptPath = path.resolve(import.meta.dir, "../src/prompts/system/system-prompt.md");

describe("Installed Plugins index (technique A)", () => {
	beforeAll(() => {
		registerCodingAgentPromptHelpers();
	});

	test("enumerates installed plugins with pointer, names no plugin in the core template", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, {
			hasPlugins: true,
			plugins: [{ id: "meddpicc", name: "meddpicc", description: "MEDDPICC qualification helper" }],
		});
		expect(rendered).toContain("Installed plugins");
		expect(rendered).toContain("xcsh://plugin/meddpicc");
		expect(rendered).toContain("MEDDPICC qualification helper");
	});

	test("pointer uses the registry id while the label uses the manifest name", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, {
			hasPlugins: true,
			plugins: [{ id: "registry-id", name: "Display Name", description: "mismatched name and id" }],
		});
		// POINTER must resolve against the registry id, not the display name.
		expect(rendered).toContain("xcsh://plugin/registry-id");
		expect(rendered).not.toContain("xcsh://plugin/Display Name");
		// DISPLAY label keeps the manifest name.
		expect(rendered).toContain("**Display Name**");
	});

	test("omits the block entirely when no plugins are present", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, { hasPlugins: false, plugins: [] });
		expect(rendered).not.toContain("Installed plugins");
		expect(rendered).not.toContain("xcsh://plugin");
	});
});
