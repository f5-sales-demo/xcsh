import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBundledModels } from "@f5-sales-demo/pi-ai";
import { Settings } from "../../src/config/settings";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";
import { RemoteRouter, type RemoteTaskSettings, type RemoteThreadLifecycle } from "../../src/remote-control/router";
import { resolveRemoteTaskSettings } from "../../src/remote-control/task-settings";

test("empty host resolves authenticated task settings without creating a thread or worker", async () => {
	let starts = 0;
	const lifecycle = {
		defaultCwd: "/fixture",
		list: () => [],
		start: async () => {
			starts++;
			throw new Error("not requested");
		},
	} as unknown as RemoteThreadLifecycle;
	const bootstrap: RemoteTaskSettings = {
		models: [
			{
				id: "fixture-model",
				provider: "fixture-provider",
				displayName: "Fixture model",
				description: "Synthetic",
				supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
				defaultReasoningEffort: "medium",
				inputModalities: ["text"],
			},
		],
		defaults: { model: "fixture-model", modelProvider: "fixture-provider", reasoningEffort: "medium" },
	};
	const router = new RemoteRouter("/fixture/remote", "fixture", lifecycle, undefined, async () => bootstrap);
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		});
		expect(
			await router.handle("phone", { id: 2, method: "config/read", params: { includeLayers: false } }),
		).toMatchObject({
			result: {
				config: { model: "fixture-model", model_provider: "fixture-provider", model_reasoning_effort: "medium" },
			},
		});
		expect(await router.handle("phone", { id: 3, method: "configRequirements/read" })).toMatchObject({
			result: { requirements: null },
		});
		expect(await router.handle("phone", { id: 4, method: "model/list", params: {} })).toMatchObject({
			result: {
				data: [{ id: "fixture-model", isDefault: true, inputModalities: ["text", "audio"] }],
				nextCursor: null,
			},
		});
		expect(await router.handle("phone", { id: 5, method: "thread/list" })).toMatchObject({ result: { data: [] } });
		expect(starts).toBe(0);
		expect(router.sessions.size).toBe(0);
	} finally {
		router.dispose();
	}
});
test("actual empty host serves the phone's task-settings sequence before any session registers", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-empty-task-settings-"));
	const host = await startLocalHost(join(root, "host.sock"), "fixture", undefined, {
		taskSettings: async () => ({
			models: [
				{
					id: "fixture-model",
					provider: "fixture-provider",
					displayName: "Fixture",
					description: "Synthetic",
					supportedReasoningEfforts: [],
					defaultReasoningEffort: "medium",
					inputModalities: ["text"],
				},
			],
			defaults: { model: "fixture-model", modelProvider: "fixture-provider", reasoningEffort: "medium" },
		}),
	});
	const peer = await connectPeer(join(root, "host.sock"));
	peer.handle = async () => ({});
	const call = (method: string, params = {}) => peer.call("protocol", { request: { id: method, method, params } });
	try {
		await call("initialize", {
			clientInfo: { name: "fixture-phone", version: "1" },
			capabilities: { experimentalApi: true },
		});
		expect(await call("config/read", { includeLayers: false })).toMatchObject({
			result: { config: { model: "fixture-model" } },
		});
		expect(await call("configRequirements/read")).toMatchObject({ result: { requirements: null } });
		expect(await call("model/list")).toMatchObject({ result: { data: [{ id: "fixture-model", isDefault: true }] } });
		expect(await call("thread/list")).toMatchObject({ result: { data: [] } });
		expect(host.router.sessions.size).toBe(0);
	} finally {
		peer.close();
		await host.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("bootstrap catalog does not widen the active terminal's model catalog or change its defaults", async () => {
	let bootstrapReads = 0;
	const router = new RemoteRouter("/fixture/remote", "fixture", undefined, undefined, async () => {
		bootstrapReads++;
		throw new Error("Bootstrap must not replace a live terminal");
	});
	try {
		router.registerSession("terminal", {
			thread: { id: "terminal", model: "terminal-model", modelProvider: "terminal-provider" },
			call: async () => ({}),
		});
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(await router.handle("phone", { id: 2, method: "model/list" })).toMatchObject({
			result: { data: [{ id: "terminal-model" }] },
		});
		expect(await router.handle("phone", { id: 3, method: "config/read" })).toMatchObject({
			result: { config: { model: "terminal-model" } },
		});
		expect(bootstrapReads).toBe(0);
	} finally {
		router.dispose();
	}
});
test("first phone chat preserves the bootstrap selection and rejects an unavailable model before creating a worker", async () => {
	const calls: Record<string, unknown>[] = [];
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [],
		start: async (params: Record<string, unknown>) => {
			calls.push(params);
			const thread = { id: "fresh", cwd: "/tmp", model: params.model, modelProvider: params.modelProvider };
			return { thread, call: async () => ({ thread, ...params }) };
		},
	} as unknown as RemoteThreadLifecycle;
	const router = new RemoteRouter("/tmp", "fixture", lifecycle, undefined, async () => ({
		models: [
			{
				id: "fixture-model",
				provider: "fixture-provider",
				displayName: "Fixture",
				description: "Synthetic",
				supportedReasoningEfforts: [],
				defaultReasoningEffort: "medium",
				inputModalities: ["text"],
			},
		],
		defaults: { model: "fixture-model", modelProvider: "fixture-provider", reasoningEffort: "medium" },
	}));
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(
			await router.handle("phone", { id: 2, method: "thread/start", params: { cwd: "/tmp", model: "unavailable" } }),
		).toMatchObject({ error: { code: -32602 } });
		expect(calls).toEqual([]);
		expect(
			await router.handle("phone", {
				id: 3,
				method: "thread/start",
				params: { cwd: "/tmp", model: "fixture-model" },
			}),
		).toMatchObject({ result: { model: "fixture-model", modelProvider: "fixture-provider" } });
		expect(calls).toEqual([
			{ cwd: "/tmp", model: "fixture-model", modelProvider: "fixture-provider", effort: "medium" },
		]);
	} finally {
		router.dispose();
	}
});

test("task defaults are drawn from eligible authenticated models, preserve valid configured reasoning, and never invent support", () => {
	const model = getBundledModels("openai-codex").find(m => m.id === "gpt-6-sol")!;
	expect(model).toBeDefined();
	const settings = Settings.isolated({ modelRoles: { default: "openai-codex/gpt-6-sol:high" } });
	const value = resolveRemoteTaskSettings([model], settings);
	expect(value.defaults).toEqual({ model: "gpt-6-sol", modelProvider: "openai-codex", reasoningEffort: "high" });
	expect(value.models.map(m => m.id)).toEqual(["gpt-6-sol"]);
	expect(resolveRemoteTaskSettings([], settings)).toEqual({ models: [], defaults: undefined });
	expect(resolveRemoteTaskSettings([{ ...model, visibility: "hide" }], settings).models).toEqual([]);
});
test("persisted chats retain the host model catalog and reasoning after workers unload", async () => {
	const model = (id: string) => ({
		id,
		provider: "fixture-provider",
		displayName: id,
		description: "Synthetic",
		supportedReasoningEfforts: [
			{ reasoningEffort: "low", description: "Low" },
			{ reasoningEffort: "high", description: "High" },
		],
		defaultReasoningEffort: "low",
		inputModalities: ["text" as const],
	});
	const thread = {
		id: "persisted",
		model: "fixture-astra",
		modelProvider: "fixture-provider",
		reasoningEffort: "high",
		cwd: "/tmp",
	};
	let started: Record<string, unknown> | undefined;
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [thread],
		start: async (params: Record<string, unknown>) => {
			started = params;
			const created = { ...thread, id: "new", model: params.model, modelProvider: params.modelProvider };
			return {
				thread: created,
				models: [model("fixture-astra"), model("fixture-luna")],
				call: async () => ({ thread: created, ...params }),
			};
		},
	} as unknown as RemoteThreadLifecycle;
	const router = new RemoteRouter("/tmp", "fixture", lifecycle, undefined, async () => ({
		models: [model("fixture-astra"), model("fixture-luna")],
		defaults: { model: "fixture-astra", modelProvider: "fixture-provider", reasoningEffort: "low" },
	}));
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		const list = () => router.handle("phone", { id: "models", method: "model/list" }) as Promise<any>;
		let response = await list();
		expect(response.result.data.map((m: any) => m.id)).toEqual(["fixture-astra", "fixture-luna"]);
		expect(response.result.data.every((m: any) => m.supportedReasoningEfforts.length === 2)).toBe(true);
		expect(response.result.data.filter((m: any) => m.isDefault).map((m: any) => m.id)).toEqual(["fixture-astra"]);
		expect(router.sessions.size).toBe(0);
		router.registerManagedSession("persisted", { thread, models: [model("fixture-astra")], call: async () => ({}) });
		response = await list();
		expect(response.result.data.map((m: any) => m.id)).toEqual(["fixture-astra", "fixture-luna"]);
		router.removeSession("persisted");
		expect(
			await router.handle("phone", {
				id: 2,
				method: "thread/start",
				params: { cwd: "/tmp", model: "fixture-luna", effort: "high" },
			}),
		).toMatchObject({ result: { model: "fixture-luna", modelProvider: "fixture-provider" } });
		expect(started).toMatchObject({ model: "fixture-luna", modelProvider: "fixture-provider", effort: "high" });
		router.removeSession("new");
		response = await list();
		expect(response.result.data.map((m: any) => m.id)).toEqual(["fixture-astra", "fixture-luna"]);
		expect(
			await router.handle("phone", { id: 3, method: "thread/start", params: { cwd: "/tmp", model: "unavailable" } }),
		).toMatchObject({ error: { code: -32602 } });
	} finally {
		router.dispose();
	}
});
