import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { Snowflake } from "@f5-sales-demo/pi-utils";
import { Settings } from "../src/config/settings";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

describe("SDK system prompt overrides", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	for (const [form, systemPrompt] of [
		["string", "custom operator prompt"],
		["function", () => "custom operator prompt"],
	] as const) {
		it(`retains mandatory blocks for a ${form} override`, async () => {
			const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `xcsh-sdk-prompt-${Snowflake.next()}-`));
			tempDirs.push(cwd);
			const model = getBundledModel("openai", "gpt-4o-mini");
			if (!model) throw new Error("Expected bundled test model");

			const { session } = await createAgentSession({
				cwd,
				agentDir: cwd,
				sessionManager: SessionManager.inMemory(),
				settings: Settings.isolated(),
				model,
				disableExtensionDiscovery: true,
				skills: [],
				contextFiles: [],
				promptTemplates: [],
				slashCommands: [],
				enableMCP: false,
				enableLsp: false,
				systemPrompt,
			});

			try {
				expect(session.systemPrompt).toContain("custom operator prompt");
				expect(session.systemPrompt).toContain("<workspace-boundary>");
				expect(session.systemPrompt).toContain("## Deprecation guardrails");
				expect(session.systemPrompt).not.toContain("%%WORKSPACE_BOUNDARY%%");
				expect(session.systemPrompt).not.toContain("%%DEPRECATION_GUARDRAILS%%");
			} finally {
				await session.dispose();
			}
		});
	}
});
