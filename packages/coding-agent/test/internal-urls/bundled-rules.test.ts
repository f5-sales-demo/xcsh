import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getBundledRules } from "../../src/bundled-rules";
import { Settings } from "../../src/config/settings";
import { InternalUrlRouter, RuleProtocolHandler } from "../../src/internal-urls";
import { createAgentSession } from "../../src/sdk";
import { SessionManager } from "../../src/session/session-manager";

describe("bundled system rules", () => {
	it("ships every rule referenced directly by the system prompt", () => {
		const names = getBundledRules().map(rule => rule.name);
		expect(names).toContain("llms-search");
		expect(names).toContain("epistemic-integrity");
	});

	it("resolves llms-search without project or user rule discovery", async () => {
		const router = new InternalUrlRouter();
		router.register(new RuleProtocolHandler({ getRules: getBundledRules }));

		const resource = await router.resolve("rule://llms-search");

		expect(resource.sourcePath).toBe("embedded:llms-search.md");
		expect(resource.content).toContain("Follow `## Contents` links recursively");
		expect(resource.content).toContain("/_llms-txt/{locale}/");
		expect(resource.content).toContain("xcsh-action");
	});

	it("resolves llms-search from an SDK session in a clean directory with discovery disabled", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-bundled-rule-"));
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			rules: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			toolNames: ["read"],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			const read = session.getToolByName("read");
			expect(read).toBeDefined();
			const result = await read?.execute("bundled-rule-test", { path: "rule://llms-search" });
			const text = result?.content.find(block => block.type === "text")?.text ?? "";
			expect(text).toContain("xcsh-action");
		} finally {
			await session.dispose();
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
