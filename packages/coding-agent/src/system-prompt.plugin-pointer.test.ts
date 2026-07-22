import { beforeAll, describe, expect, test } from "bun:test";
import * as path from "node:path";
import { prompt } from "@f5-sales-demo/pi-utils";
import { registerCodingAgentPromptHelpers } from "./config/prompt-templates";

// L0 of the MEDDPICC progressive-hints ladder: a single framework-agnostic line
// telling the agent that installed plugins expose capabilities/schemas via
// `xcsh://plugin/<name>`. It is gated on the `hasPlugins` render variable that
// `buildSystemPrompt` computes from discovered plugin roots.
//
// Seam: the Handlebars-compile path (`prompt.render(template, data)`) — the same
// seam every other conditional-rendering assertion in this package uses. It is
// deterministic (no dependency on what is installed under the real home dir) and
// exercises the exact template conditional this task adds. `buildSystemPrompt`
// resolves plugins from `os.homedir()` and takes no `home` override, so a
// true-case fixture through it would be non-deterministic.

const systemPromptPath = path.resolve(import.meta.dir, "prompts/system/system-prompt.md");

describe("L0 plugin-capability pointer", () => {
	beforeAll(() => {
		registerCodingAgentPromptHelpers();
	});

	test("renders the generic pointer when a plugin is present, naming no plugin", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, { hasPlugins: true });
		expect(rendered).toContain("xcsh://plugin");
		// Generic/reusable: it must not name any specific plugin.
		expect(rendered).not.toContain("meddpicc");
	});

	test("omits the pointer entirely when no plugins are present", async () => {
		const template = await Bun.file(systemPromptPath).text();
		const rendered = prompt.render(template, { hasPlugins: false });
		expect(rendered).not.toContain("xcsh://plugin");
	});
});
