import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThinkingLevel } from "@f5-sales-demo/pi-agent-core";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { Settings } from "../src/config/settings";
import { createAgentSession } from "../src/sdk";
import { SessionManager } from "../src/session/session-manager";

test("SDK about tool reads the session's current reasoning after a reasoning-only change", async () => {
	const directory = await mkdtemp(join(tmpdir(), "xcsh-about-reasoning-"));
	try {
		const { session } = await createAgentSession({
			cwd: directory,
			agentDir: directory,
			sessionManager: SessionManager.inMemory(directory),
			settings: Settings.isolated(),
			model: getBundledModel("openai", "gpt-5.4"),
			thinkingLevel: ThinkingLevel.High,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
			toolNames: ["read"],
		});
		try {
			const read = session.getToolByName("read")!;
			const about = async () => {
				const result = await read.execute("about-fixture", { path: "xcsh://about" });
				return result.content
					.filter(part => part.type === "text")
					.map(part => part.text)
					.join("\n");
			};
			expect(await about()).toContain("**Reasoning effort:** `high`");
			session.setThinkingLevel(ThinkingLevel.Low);
			expect(await about()).toContain("**Reasoning effort:** `low`");
		} finally {
			await session.dispose();
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
