import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBundledModels } from "@f5-sales-demo/pi-ai";
import { RemoteRouter, type RemoteTaskSettings, type RemoteThreadLifecycle } from "../../src/remote-control/router";

const taskSettings: RemoteTaskSettings = {
	models: [
		{
			id: "fixture-astra",
			provider: "fixture-provider",
			displayName: "Fixture Astra",
			description: "Synthetic",
			supportedReasoningEfforts: [
				{ reasoningEffort: "low", description: "Low" },
				{ reasoningEffort: "high", description: "High" },
			],
			defaultReasoningEffort: "high",
			inputModalities: ["text"],
		},
	],
	defaults: { model: "fixture-astra", modelProvider: "fixture-provider", reasoningEffort: "high" },
};
const edits = [
	{ keyPath: "model", value: "fixture-astra", mergeStrategy: "replace" },
	{ keyPath: "model_reasoning_effort", value: "low", mergeStrategy: "replace" },
	{ keyPath: "approval_policy", value: "on-request", mergeStrategy: "replace" },
	{ keyPath: "approvals_reviewer", value: "user", mergeStrategy: "replace" },
	{ keyPath: "sandbox_mode", value: "workspace-write", mergeStrategy: "replace" },
];
async function initialize(router: RemoteRouter) {
	await router.handle("phone", {
		id: "initialize",
		method: "initialize",
		params: { clientInfo: { name: "fixture-phone", version: "1" }, capabilities: { experimentalApi: true } },
	});
	return (method: string, params = {}) => router.handle("phone", { id: method, method, params });
}

test("phone Intelligence batch write persists Low instead of reverting to an old thread's High", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-config-"));
	const oldThread = {
		id: "old-thread",
		cwd: "/tmp",
		model: "fixture-astra",
		modelProvider: "fixture-provider",
		reasoningEffort: "high",
	};
	const starts: Record<string, unknown>[] = [];
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [oldThread],
		start: async (params: Record<string, unknown>) => {
			starts.push(params);
			const thread = {
				id: "new-thread",
				cwd: "/tmp",
				model: params.model,
				modelProvider: params.modelProvider,
				reasoningEffort: params.effort,
			};
			return { thread, call: async () => ({ ...params, thread, reasoningEffort: params.effort }) };
		},
	} as unknown as RemoteThreadLifecycle;
	let router = new RemoteRouter(root, "fixture", lifecycle, undefined, async () => structuredClone(taskSettings));
	try {
		let call = await initialize(router);
		const written = await call("config/batchWrite", { edits, reloadUserConfig: true });
		expect(written).toMatchObject({
			result: {
				status: "ok",
				version: expect.any(String),
				filePath: join(root, "task-settings.json"),
				overriddenMetadata: null,
			},
		});
		expect(await call("config/read", { includeLayers: true })).toMatchObject({
			result: {
				config: {
					model: "fixture-astra",
					model_reasoning_effort: "low",
					approval_policy: "on-request",
					sandbox_mode: "workspace-write",
				},
			},
		});
		expect(oldThread.reasoningEffort).toBe("high");
		expect(starts).toEqual([]);
		router.dispose();
		router = new RemoteRouter(root, "fixture", lifecycle, undefined, async () => structuredClone(taskSettings));
		call = await initialize(router);
		expect(await call("config/read")).toMatchObject({ result: { config: { model_reasoning_effort: "low" } } });
		expect(await call("thread/start", { cwd: "/tmp" })).toMatchObject({
			result: { model: "fixture-astra", reasoningEffort: "low" },
		});
		expect(starts).toEqual([
			{
				cwd: "/tmp",
				model: "fixture-astra",
				modelProvider: "fixture-provider",
				effort: "low",
				approvalPolicy: "on-request",
				approvalsReviewer: "user",
				sandbox: "workspace-write",
			},
		]);
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("every advertised execution model and reasoning choice can be saved and read without creating a thread", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-model-options-"));
	const models = getBundledModels("openai-codex").map(model => ({
		id: model.id,
		provider: model.provider,
		displayName: model.name,
		description: "Synthetic",
		supportedReasoningEfforts:
			model.thinking?.supportedLevels.map(level => ({
				reasoningEffort: level.effort,
				description: level.description,
			})) ?? [],
		defaultReasoningEffort: model.thinking?.defaultLevel ?? "none",
		inputModalities: ["text" as const],
	}));
	const bootstrap = {
		models,
		defaults: {
			model: models[0].id,
			modelProvider: models[0].provider,
			reasoningEffort: models[0].defaultReasoningEffort,
		},
	};
	const router = new RemoteRouter(root, "fixture", undefined, undefined, async () => bootstrap);
	try {
		const call = await initialize(router);
		for (const model of models)
			for (const option of model.supportedReasoningEfforts) {
				expect(
					await call("config/batchWrite", {
						edits: [
							{ keyPath: "model", value: model.id, mergeStrategy: "replace" },
							{ keyPath: "model_reasoning_effort", value: option.reasoningEffort, mergeStrategy: "replace" },
						],
					}),
				).toMatchObject({ result: { status: "ok" } });
				expect(await call("config/read")).toMatchObject({
					result: {
						config: {
							model: model.id,
							model_provider: model.provider,
							model_reasoning_effort: option.reasoningEffort,
						},
					},
				});
				const listed = (await call("model/list")) as { result: { data: { id: string; isDefault: boolean }[] } };
				expect(listed.result.data.filter(item => item.isDefault).map(item => item.id)).toEqual([model.id]);
				expect(router.sessions.size).toBe(0);
			}
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("concurrent configuration writes with the same expected version admit exactly one change", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-config-race-"));
	const routers = [
		new RemoteRouter(root, "fixture", undefined, undefined, async () => taskSettings),
		new RemoteRouter(root, "fixture", undefined, undefined, async () => taskSettings),
	];
	try {
		const calls = await Promise.all(routers.map(initialize));
		const first = (await calls[0]("config/batchWrite", {
			edits: edits.map(edit => (edit.keyPath === "model_reasoning_effort" ? { ...edit, value: "high" } : edit)),
		})) as { result: { version: string } };
		const responses = await Promise.all(
			calls.map(call =>
				call("config/value/write", {
					keyPath: "model_reasoning_effort",
					value: "low",
					mergeStrategy: "replace",
					expectedVersion: first.result.version,
				}),
			),
		);
		expect(responses.filter(response => (response as any).error)).toHaveLength(1);
	} finally {
		for (const router of routers) router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("config writes reject unavailable efforts, unsupported keys, stale versions and alternate files atomically", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-config-negative-"));
	const router = new RemoteRouter(root, "fixture", undefined, undefined, async () => structuredClone(taskSettings));
	try {
		const call = await initialize(router);
		const first = await call("config/batchWrite", { edits });
		expect(first).toMatchObject({ result: { status: "ok" } });
		const path = join(root, "task-settings.json");
		const before = await readFile(path, "utf8");
		for (const invalid of [
			{ edits: [{ keyPath: "model_reasoning_effort", value: "ultra", mergeStrategy: "replace" }] },
			{ edits: [{ keyPath: "model", value: "unavailable", mergeStrategy: "replace" }] },
			{ edits: [...edits, { keyPath: "instructions", value: "not supported", mergeStrategy: "replace" }] },
			{ edits, expectedVersion: "stale" },
			{ edits, filePath: "/tmp/not-the-owned-config" },
			{ edits: [{ keyPath: "model_reasoning_effort", value: "high", mergeStrategy: "invalid" }] },
			{ edits: [{ keyPath: "sandbox_mode", value: "danger-full-access", mergeStrategy: "replace" }] },
		]) {
			expect(await call("config/batchWrite", invalid)).toHaveProperty("error");
			expect(await readFile(path, "utf8")).toBe(before);
		}
		expect(
			await call("config/value/write", {
				keyPath: "model_reasoning_effort",
				value: "high",
				mergeStrategy: "upsert",
				expectedVersion: (first as any).result.version,
			}),
		).toMatchObject({ result: { status: "ok" } });
		expect(await call("config/read")).toMatchObject({ result: { config: { model_reasoning_effort: "high" } } });
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
