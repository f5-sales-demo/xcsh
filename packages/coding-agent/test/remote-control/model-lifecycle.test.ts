import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import { ModelRegistry } from "../../src/config/model-registry";
import { Settings } from "../../src/config/settings";
import { createAgentSession } from "../../src/sdk";
import { AuthStorage } from "../../src/session/auth-storage";
import { SessionManager } from "../../src/session/session-manager";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
	for (const fn of cleanup.splice(0).reverse()) await fn();
});
const models = ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-6-astra"];
async function fixture() {
	const dir = await mkdtemp("/tmp/xcsh-model-lifecycle-");
	cleanup.push(() => rm(dir, { recursive: true, force: true }));
	const auth = await AuthStorage.create(":memory:");
	cleanup.push(() => auth.close());
	auth.setRuntimeApiKey("openai-codex", "fixture-key");
	auth.setRuntimeApiKey("openai", "fixture-key");
	const registry = new ModelRegistry(auth, `${dir}/models.yml`);
	registry.registerProvider("openai-codex", {
		baseUrl: "https://fixture.example/v1",
		api: "openai-completions",
		apiKey: "fixture-key",
		models: models.map(id => ({
			id,
			name: id,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		})),
	});
	const settings = Settings.isolated({ "compaction.enabled": false });
	settings.setModelRole("default", "openai/gpt-4o-mini");
	const create = async (manager: SessionManager, modelId?: string) => {
		const result = await createAgentSession({
			cwd: dir,
			agentDir: dir,
			sessionManager: manager,
			authStorage: auth,
			modelRegistry: registry,
			settings,
			...(modelId ? { model: registry.find("openai-codex", modelId)! } : {}),
			disableExtensionDiscovery: true,
			extensions: [],
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});
		cleanup.push(() => result.session.dispose());
		return result;
	};
	return { dir, create };
}

test.each(models)("a new terminal session persists %s for implicit SDK resume", async model => {
	const { dir, create } = await fixture();
	const { session } = await create(SessionManager.create(dir, dir), model);
	expect(session.model?.id).toBe(model);
	await session.newSession();
	session.sessionManager.appendMessage({ role: "user", content: "fixture context", timestamp: 1000 });
	await session.sessionManager.ensureOnDisk();
	const file = session.sessionFile!;
	await session.dispose();
	const resumed = await create(await SessionManager.open(file));
	expect(resumed.session.model?.id).toBe(model);
	expect(resumed.modelFallbackMessage).toBeUndefined();
});

test.each(models)("explicit resume with %s remains selected on the next implicit resume", async model => {
	const { dir, create } = await fixture();
	const { session: original } = await create(
		SessionManager.create(dir, dir),
		models.find(id => id !== model),
	);
	original.sessionManager.appendMessage({ role: "user", content: "fixture context", timestamp: 1000 });
	await original.sessionManager.ensureOnDisk();
	const file = original.sessionFile!;
	await original.dispose();
	const { session: selected } = await create(await SessionManager.open(file), model);
	expect(selected.model?.id).toBe(model);
	await selected.dispose();
	const resumed = await create(await SessionManager.open(file));
	expect(resumed.session.model?.id).toBe(model);
});

test.each(models.flatMap(model => ["branch", "tree", "handoff"].map(operation => ({ model, operation }))))(
	"$operation retains $model when its new storage is resumed",
	async ({ model, operation }) => {
		const { dir, create } = await fixture();
		const manager = SessionManager.create(dir, dir);
		const first = manager.appendMessage({ role: "user", content: "first fixture", timestamp: 1000 });
		manager.appendMessage({ role: "user", content: "second fixture", timestamp: 2000 });
		const { session } = await create(manager, model);
		if (operation === "branch") {
			await session.branch(first);
		} else if (operation === "tree") {
			await session.navigateTree(first);
		} else {
			const selected = session.model!;
			const message: AssistantMessage = {
				role: "assistant",
				content: [{ type: "text", text: "fixture handoff" }],
				api: selected.api,
				provider: selected.provider,
				model: selected.id,
				stopReason: "stop",
				timestamp: Date.now(),
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			const prompt = spyOn(session.agent, "prompt").mockImplementation(async () => {
				session.agent.replaceMessages([message]);
				session.agent.emitExternalEvent({ type: "message_end", message });
				session.agent.emitExternalEvent({ type: "agent_end", messages: [message] });
			});
			try {
				expect((await session.handoff())?.document).toBe("fixture handoff");
			} finally {
				prompt.mockRestore();
			}
		}
		expect(session.model?.id).toBe(model);
		await manager.ensureOnDisk();
		const file = session.sessionFile!;
		await session.dispose();
		const resumed = await create(await SessionManager.open(file));
		expect(resumed.session.model?.id).toBe(model);
	},
);
