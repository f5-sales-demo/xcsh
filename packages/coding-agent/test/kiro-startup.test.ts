import { expect, it, vi } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import { createAgentSession } from "../src/sdk";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

it("awaits the saved Kiro service default before selecting a startup fallback", async () => {
	const dir = await mkdtemp(join(tmpdir(), "kiro-startup-"));
	const auth = await AuthStorage.create(join(dir, "auth.db"));
	const settings = Settings.isolated({ defaultThinkingLevel: "inherit" });
	settings.setModelRole("default", "kiro/auto");
	const registry = new ModelRegistry(auth, join(dir, "models.yml"));
	const background = vi.spyOn(registry, "awaitBackgroundRefresh").mockImplementation(async () => {});
	const refresh = vi.spyOn(registry, "refreshProvider").mockImplementation(async provider => {
		expect(provider).toBe("kiro");
		registry.registerProvider(
			"kiro",
			{
				api: "kiro-api",
				baseUrl: "https://q.us-east-1.amazonaws.com/generateAssistantResponse",
				apiKey: "synthetic",
				models: [
					{
						id: "auto",
						name: "Kiro Auto",
						reasoning: false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 1000000,
						maxTokens: 64000,
					},
				],
			},
			"kiro-startup-test",
		);
	});
	try {
		const { session } = await createAgentSession({
			cwd: dir,
			agentDir: dir,
			authStorage: auth,
			modelRegistry: registry,
			settings,
			sessionManager: SessionManager.inMemory(),
			disableExtensionDiscovery: true,
			extensions: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableLsp: false,
		});
		try {
			expect(session.model).toMatchObject({ provider: "kiro", id: "auto" });
			expect(background).toHaveBeenCalled();
			expect(refresh).toHaveBeenCalled();
		} finally {
			await session.dispose();
		}
	} finally {
		auth.close();
		await rm(dir, { recursive: true, force: true });
	}
});
