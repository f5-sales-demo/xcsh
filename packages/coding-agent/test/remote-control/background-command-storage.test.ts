import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { Settings } from "../../src/config/settings";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";

test("SDK background completion persists executor facts in the actual custom-message storage format", async () => {
	const cwd = await mkdtemp("/tmp/xcsh-background-storage-");
	const auth = await AuthStorage.create(":memory:");
	const { session } = await createAgentSession({
		cwd,
		agentDir: join(cwd, "agent"),
		authStorage: auth,
		model: getBundledModel("openai", "gpt-4o-mini")!,
		toolNames: ["bash"],
		settings: Settings.isolated({
			"async.enabled": true,
			"bash.autoBackground.enabled": false,
			"bashInterceptor.enabled": false,
		}),
		disableExtensionDiscovery: true,
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
	});
	const delivered = Promise.withResolvers<void>();
	const original = session.sendCustomMessage.bind(session);
	const delivery = spyOn(session, "sendCustomMessage").mockImplementation(async (message, options) => {
		expect(options).toMatchObject({ deliverAs: "followUp", triggerTurn: true });
		await original(message, { ...options, triggerTurn: false });
		delivered.resolve();
	});
	try {
		const tool = session.getToolByName("bash")!;
		const started = await tool.execute("background-storage", { command: "printf BACKGROUND-HARBOR", async: true });
		await delivered.promise;
		await session.sessionManager.flush();
		const entry = session.sessionManager
			.getBranch()
			.findLast(value => value.type === "custom_message" && value.customType === "async-result");
		expect(entry?.type).toBe("custom_message");
		if (entry?.type !== "custom_message") throw new Error("Missing durable background completion");
		expect(entry.details).toMatchObject({
			jobId: (started.details as any).async.jobId,
			execution: {
				kind: "command",
				command: "printf BACKGROUND-HARBOR",
				cwd,
				status: "completed",
				aggregatedOutput: "BACKGROUND-HARBOR",
				exitCode: 0,
			},
		});
	} finally {
		delivery.mockRestore();
		await session.dispose();
		auth.close();
		await rm(cwd, { recursive: true, force: true });
	}
});
