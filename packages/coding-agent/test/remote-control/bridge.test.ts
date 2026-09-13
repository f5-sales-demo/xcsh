import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSessionBridge } from "../../src/remote-control/bridge";
import { startLocalHost } from "../../src/remote-control/host";
import type { SessionTarget } from "../../src/remote-control/session";

test("a running session reconnects to the host and unregisters on bridge shutdown", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-bridge-test-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0");
	const target = {
		sessionId: "fixture",
		sessionName: "Fixture",
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		modelRegistry: {
			getAvailable: () => [
				{
					id: "gpt-6-astra",
					name: "GPT-6 Astra",
					description: "Maximum capability",
					provider: "openai-codex",
					input: ["text", "image"],
					thinking: {
						supportedLevels: [{ effort: "high", description: "High" }],
						defaultLevel: "high",
					},
				},
				{
					id: "gpt-5.6-sol",
					name: "GPT-5.6 Sol",
					description: "Deep reasoning",
					provider: "openai-codex",
					input: ["text", "image"],
					thinking: {
						supportedLevels: [
							{ effort: "medium", description: "Medium" },
							{ effort: "high", description: "High" },
						],
						defaultLevel: "medium",
					},
				},
				{
					id: "gpt-5.4",
					name: "GPT-5.4",
					description: "Historical model",
					provider: "openai-codex",
					input: ["text", "image"],
				},
			],
		},
		messages: [],
		skills: [
			{
				name: "fixture",
				description: "Fixture",
				filePath: join(dir, "SKILL.md"),
				baseDir: dir,
				source: "agents:project",
				_source: { provider: "agents", providerName: "Agents", path: join(dir, "SKILL.md"), level: "project" },
			},
		],
		skillWarnings: [],
		sessionManager: { getCwd: () => dir },
		subscribe: () => () => {},
	} as unknown as SessionTarget;
	const collaborationModes: Array<"plan" | "default"> = [];
	const stop = startSessionBridge(target, path, 20, {
		getCollaborationMode: () => collaborationModes.at(-1) ?? "default",
		setCollaborationMode: async mode => {
			collaborationModes.push(mode);
		},
		setModel: async (model, thinkingLevel) => {
			(target as any).model = model;
			(target as any).thinkingLevel = thinkingLevel;
		},
	});
	try {
		const deadline = Date.now() + 1000;
		while (!host.router.sessions.has("fixture") && Date.now() < deadline) await Bun.sleep(10);
		expect(host.router.sessions.has("fixture")).toBe(true);
		expect(host.router.sessions.get("fixture")?.skills).toMatchObject([
			{ name: "fixture", path: join(dir, "SKILL.md"), scope: "repo", enabled: true },
		]);
		expect(host.router.sessions.get("fixture")?.models).toHaveLength(2);
		await host.router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		});
		expect(
			await host.router.handle("phone", {
				id: 2,
				method: "thread/settings/update",
				params: {
					threadId: "fixture",
					collaborationMode: { mode: "plan", settings: { model: "gpt-6-astra" } },
				},
			}),
		).toEqual({ id: 2, result: {} });
		expect(collaborationModes).toEqual(["plan"]);
		expect(
			await host.router.handle("phone", {
				id: 3,
				method: "model/list",
				params: {},
			}),
		).toMatchObject({
			id: 3,
			result: {
				data: [
					{ id: "gpt-6-astra", displayName: "GPT-6 Astra" },
					{
						id: "gpt-5.6-sol",
						displayName: "GPT-5.6 Sol",
						defaultReasoningEffort: "medium",
						supportedReasoningEfforts: [
							{ reasoningEffort: "medium", description: "Medium" },
							{ reasoningEffort: "high", description: "High" },
						],
					},
				],
			},
		});
		expect(
			await host.router.handle("phone", {
				id: 4,
				method: "thread/settings/update",
				params: { threadId: "fixture", model: "gpt-5.6-sol", effort: "high", serviceTier: null },
			}),
		).toEqual({ id: 4, result: {} });
		expect(target.model?.id).toBe("gpt-5.6-sol");
		expect(host.router.sessions.get("fixture")?.thread.model).toBe("gpt-5.6-sol");
		stop();
		await Bun.sleep(20);
		expect(host.router.sessions.has("fixture")).toBe(false);
	} finally {
		stop();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});
