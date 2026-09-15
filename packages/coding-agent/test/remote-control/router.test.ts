import { expect, test } from "bun:test";
import { RemoteRouter } from "../../src/remote-control/router";
import bootstrapReference from "./fixtures/codex-0.153.4-phone-bootstrap.json";

test("initialization is per phone stream; lists and attaches registered terminal only", async () => {
	const calls: unknown[] = [];
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	router.sessions.set("fixture-thread", {
		thread: { id: "fixture-thread", name: "Fixture terminal", turns: [], updatedAt: 1 },
		call: async (...args) => {
			calls.push(args);
			return { thread: { id: "fixture-thread" } };
		},
	});
	expect(await router.handle("phone", { id: 1, method: "thread/list" })).toMatchObject({ error: { code: -32002 } });
	expect(
		await router.handle("phone", {
			id: 2,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		}),
	).toMatchObject({ result: { userAgent: "xcsh/21.22.0", codexHome: "/tmp/xcsh" } });
	expect(await router.handle("other", { id: 3, method: "thread/list" })).toMatchObject({ error: { code: -32002 } });
	expect(await router.handle("phone", { id: 4, method: "thread/list" })).toMatchObject({
		result: { data: [{ id: "fixture-thread" }], nextCursor: null },
	});
	expect(
		await router.handle("phone", { id: 5, method: "thread/resume", params: { threadId: "fixture-thread" } }),
	).toMatchObject({ result: { thread: { id: "fixture-thread" } } });
	expect(calls).toHaveLength(1);
	expect(await router.handle("phone", { id: 6, method: "thread/start" })).toMatchObject({ error: { code: -32000 } });
});

test("the vanilla remote catalog exposes one active terminal and only its dynamic models", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const calls: Array<{ id: string; method: string }> = [];
	const endpoint = (id: string, model: string, models: any[]) => ({
		thread: {
			id,
			name: id,
			model,
			modelProvider: "openai-codex",
			cwd: `/tmp/${id}`,
			updatedAt: 1,
			createdAt: 1,
			turns: [],
		},
		models,
		call: async (_identity: string, method: string) => {
			calls.push({ id, method });
			return {};
		},
	});
	const primaryModels = [
		{
			id: "gpt-5.6-luna",
			provider: "openai-codex",
			displayName: "Luna",
			description: "Primary",
			supportedReasoningEfforts: [],
			defaultReasoningEffort: "medium",
			inputModalities: ["text"],
		},
		{
			id: "gpt-6-astra",
			provider: "openai-codex",
			displayName: "Astra",
			description: "Selectable",
			supportedReasoningEfforts: [],
			defaultReasoningEffort: "medium",
			inputModalities: ["text"],
		},
	];
	router.registerSession("primary", endpoint("primary", "gpt-5.6-luna", primaryModels));
	router.registerSession(
		"fixture-secondary",
		endpoint("fixture-secondary", "gpt-5.6-sol", [
			{
				id: "gpt-5.6-sol",
				provider: "openai-codex",
				displayName: "Sol",
				description: "Fixture only",
				supportedReasoningEfforts: [],
				defaultReasoningEffort: "medium",
				inputModalities: ["text" as const],
			},
		]),
	);
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "thread/list", params: {} })).toMatchObject({
		result: { data: [{ id: "primary" }] },
	});
	expect(await router.handle("phone", { id: 3, method: "model/list", params: {} })).toMatchObject({
		result: { data: [{ id: "gpt-5.6-luna" }, { id: "gpt-6-astra" }] },
	});
	expect(
		await router.handle("phone", {
			id: 4,
			method: "thread/settings/update",
			params: { threadId: "fixture-secondary", model: "gpt-5.6-sol", effort: "medium" },
		}),
	).toMatchObject({ error: { code: -32602 } });
	expect(
		await router.handle("phone", {
			id: 5,
			method: "thread/settings/update",
			params: { threadId: "primary", model: "gpt-6-astra", effort: "medium" },
		}),
	).toMatchObject({ result: {} });
	expect(calls).toEqual([{ id: "primary", method: "thread/settings/update" }]);
	router.removeSession("primary");
	expect(await router.handle("phone", { id: 6, method: "thread/list", params: {} })).toMatchObject({
		result: { data: [{ id: "fixture-secondary" }] },
	});
});
test("malformed and experimental unsupported operations are explicit errors", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	let calls = 0;
	router.sessions.set("fixture", {
		thread: { id: "fixture" },
		call: async () => {
			calls++;
			return {};
		},
	});
	expect(await router.handle("phone", null)).toMatchObject({ error: { code: -32600 } });
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "collaborationMode/list", params: {} })).toMatchObject({
		error: { code: -32600 },
	});
	expect(
		await router.handle("phone", { id: 3, method: "thread/realtime/unsupported", params: { threadId: "fixture" } }),
	).toMatchObject({ error: { code: -32601 } });
	expect(
		await router.handle("phone", {
			id: 4,
			method: "thread/settings/update",
			params: {
				threadId: "fixture",
				collaborationMode: { mode: "plan", settings: { model: "gpt-6-astra" } },
			},
		}),
	).toMatchObject({ error: { code: -32600 } });
	expect(
		await router.handle("phone", {
			id: 5,
			method: "turn/start",
			params: {
				threadId: "fixture",
				input: [{ type: "text", text: "fixture" }],
				collaborationMode: { mode: "default", settings: { model: "gpt-6-astra" } },
			},
		}),
	).toMatchObject({ error: { code: -32600 } });
	expect(calls).toBe(0);
});

test("permission profile discovery is an empty non-mutating native catalog", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	let calls = 0;
	router.sessions.set("fixture", {
		thread: { id: "fixture", cwd: "/tmp/project" },
		call: async () => {
			calls++;
			return {};
		},
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "permissionProfile/list", params: {} })).toEqual({
		id: 2,
		result: { data: [], nextCursor: null },
	});
	expect(
		await router.handle("phone", {
			id: 3,
			method: "permissionProfile/list",
			params: { cursor: "0", limit: 0, cwd: "/tmp/project" },
		}),
	).toEqual({ id: 3, result: { data: [], nextCursor: null } });
	for (const params of [{ cursor: "1" }, { cursor: "bad" }, { limit: -1 }, { limit: 1.5 }, { cwd: 1 }])
		expect(await router.handle("phone", { id: 4, method: "permissionProfile/list", params })).toMatchObject({
			error: { code: -32602 },
		});
	expect(calls).toBe(0);
	router.dispose();
});

test("initialize notification opt-outs suppress exact methods for only that client", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const notifications: Array<{ client: string; method: string }> = [];
	router.notify = (client, event) => notifications.push({ client, method: event.method });
	router.sessions.set("fixture-thread", {
		thread: { id: "fixture-thread", name: "Fixture terminal", turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	await router.handle("quiet", {
		id: 1,
		method: "initialize",
		params: {
			clientInfo: { name: "fixture", version: "1" },
			capabilities: { optOutNotificationMethods: ["thread/name/updated", "unknown/notification"] },
		},
	});
	await router.handle("loud", {
		id: 2,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: {} },
	});
	await router.handle("quiet", { id: 3, method: "thread/resume", params: { threadId: "fixture-thread" } });
	await router.handle("loud", { id: 4, method: "thread/resume", params: { threadId: "fixture-thread" } });

	router.publish({ method: "thread/name/updated", params: { threadId: "fixture-thread", threadName: "Renamed" } });
	router.publish({ method: "turn/completed", params: { threadId: "fixture-thread", turn: { id: "turn-1" } } });
	expect(notifications).toEqual([
		{ client: "loud", method: "thread/name/updated" },
		{ client: "quiet", method: "turn/completed" },
		{ client: "loud", method: "turn/completed" },
	]);
	expect(
		await router.handle("quiet", {
			id: 5,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: {} },
		}),
	).toMatchObject({ error: { code: -32600 } });
	router.publish({ method: "thread/name/updated", params: { threadId: "fixture-thread", threadName: "Again" } });
	expect(notifications.at(-1)).toEqual({ client: "loud", method: "thread/name/updated" });

	expect(
		await router.handle("invalid", {
			id: 6,
			method: "initialize",
			params: {
				clientInfo: { name: "fixture", version: "1" },
				capabilities: { optOutNotificationMethods: ["thread/started", 1] },
			},
		}),
	).toMatchObject({ error: { code: -32602 } });
	for (const capabilities of [[], { experimentalApi: "yes" }, { requestAttestation: 1 }])
		expect(
			await router.handle("invalid", {
				id: 7,
				method: "initialize",
				params: { clientInfo: { name: "fixture", version: "1" }, capabilities },
			}),
		).toMatchObject({ error: { code: -32602 } });
});

test("a newly registered live thread is announced once with capability-specific wire fields", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const notifications: Array<{ client: string; event: any }> = [];
	router.notify = (client, event) => notifications.push({ client, event });
	await router.handle("stable", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "stable", version: "1" }, capabilities: {} },
	});
	await router.handle("experimental", {
		id: 2,
		method: "initialize",
		params: { clientInfo: { name: "experimental", version: "1" }, capabilities: { experimentalApi: true } },
	});
	await router.handle("quiet", {
		id: 3,
		method: "initialize",
		params: {
			clientInfo: { name: "quiet", version: "1" },
			capabilities: { experimentalApi: true, optOutNotificationMethods: ["thread/started"] },
		},
	});
	const thread = {
		id: "replacement",
		sessionId: "replacement",
		forkedFromId: null,
		parentThreadId: "departed",
		preview: "Execute the approved plan",
		ephemeral: false,
		section: null,
		sectionEnteredAt: null,
		projectId: null,
		historyMode: "paginated",
		modelProvider: "openai-codex",
		model: "gpt-5.6-luna",
		reasoningEffort: "medium",
		createdAt: 1,
		updatedAt: 2,
		recencyAt: 2,
		status: { type: "idle" },
		path: "/tmp/replacement.jsonl",
		cwd: "/tmp/luna",
		cliVersion: "21.22.0",
		source: "cli",
		threadSource: null,
		agentNickname: null,
		agentRole: null,
		gitInfo: null,
		name: "xcsh Remote Luna",
		turns: [],
		futurePrivate: "must-not-leak",
	};
	const endpoint = { thread, call: async () => ({}) };
	router.registerSession(thread.id, endpoint);
	expect(notifications.map(value => value.client)).toEqual(["stable", "experimental"]);
	expect(notifications.every(value => value.event.method === "thread/started")).toBe(true);
	expect(Object.keys(notifications[0].event.params.thread)).toEqual([
		"id",
		"sessionId",
		"forkedFromId",
		"parentThreadId",
		"preview",
		"ephemeral",
		"section",
		"sectionEnteredAt",
		"projectId",
		"historyMode",
		"modelProvider",
		"model",
		"reasoningEffort",
		"createdAt",
		"updatedAt",
		"recencyAt",
		"status",
		"path",
		"cwd",
		"cliVersion",
		"source",
		"threadSource",
		"agentNickname",
		"agentRole",
		"gitInfo",
		"name",
		"turns",
	]);
	expect(Object.keys(notifications[1].event.params.thread)).toEqual([
		"id",
		"extra",
		"sessionId",
		"forkedFromId",
		"parentThreadId",
		"preview",
		"ephemeral",
		"section",
		"sectionEnteredAt",
		"projectId",
		"historyMode",
		"modelProvider",
		"model",
		"reasoningEffort",
		"createdAt",
		"updatedAt",
		"recencyAt",
		"status",
		"path",
		"cwd",
		"cliVersion",
		"source",
		"canAcceptDirectInput",
		"threadSource",
		"agentNickname",
		"agentRole",
		"gitInfo",
		"name",
		"turns",
	]);
	expect(notifications[1].event.params.thread).toMatchObject({
		extra: null,
		canAcceptDirectInput: true,
		name: "xcsh Remote Luna",
	});
	expect(notifications[1].event.params.thread).not.toHaveProperty("futurePrivate");
	router.registerSession(thread.id, endpoint);
	expect(notifications).toHaveLength(2);
	router.dispose();
});

test("phone discovery can list the empty native thread section collection", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "threadSection/list", params: {} })).toEqual({
		id: 2,
		result: { data: [], nextCursor: null },
	});
});

test("thread wire views gate experimental fields and never expose internal model metadata", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const turns = [{ id: "turn-1", status: "completed", items: [], error: null }];
	const thread = {
		id: "fixture-thread",
		sessionId: "fixture-thread",
		forkedFromId: null,
		parentThreadId: null,
		preview: "Fixture preview",
		ephemeral: false,
		section: null,
		sectionEnteredAt: null,
		projectId: null,
		historyMode: "paginated",
		modelProvider: "openai-codex",
		model: "gpt-6-astra",
		supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
		defaultReasoningEffort: "high",
		reasoningEffort: "high",
		createdAt: 1,
		updatedAt: 2,
		recencyAt: 2,
		status: { type: "idle" },
		path: "/tmp/fixture/session.jsonl",
		cwd: "/tmp/fixture",
		cliVersion: "21.22.0",
		source: "cli",
		threadSource: null,
		agentNickname: null,
		agentRole: null,
		gitInfo: null,
		name: "Fixture terminal",
		turns,
		futurePrivateField: "never-wire",
	};
	const original = structuredClone(thread);
	router.sessions.set(thread.id, {
		thread,
		call: async (_identity, method, params) => ({
			wrapper: method,
			thread: {
				...thread,
				turns: params.includeTurns === true || params.excludeTurns !== true ? turns : [],
			},
		}),
	});
	await router.handle("stable", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	await router.handle("experimental", {
		id: 2,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
	});
	const stableList = (await router.handle("stable", { id: 3, method: "thread/list", params: {} })) as any;
	const experimentalList = (await router.handle("experimental", {
		id: 4,
		method: "thread/list",
		params: {},
	})) as any;
	const stableRead = (await router.handle("stable", {
		id: 5,
		method: "thread/read",
		params: { threadId: thread.id, includeTurns: true },
	})) as any;
	const experimentalRead = (await router.handle("experimental", {
		id: 6,
		method: "thread/read",
		params: { threadId: thread.id, includeTurns: true },
	})) as any;
	const stableResume = (await router.handle("stable", {
		id: 7,
		method: "thread/resume",
		params: { threadId: thread.id, excludeTurns: false },
	})) as any;
	const experimentalResume = (await router.handle("experimental", {
		id: 8,
		method: "thread/resume",
		params: { threadId: thread.id, excludeTurns: false },
	})) as any;
	const stableKeys = [
		"id",
		"sessionId",
		"forkedFromId",
		"parentThreadId",
		"preview",
		"ephemeral",
		"section",
		"sectionEnteredAt",
		"projectId",
		"historyMode",
		"modelProvider",
		"model",
		"reasoningEffort",
		"createdAt",
		"updatedAt",
		"recencyAt",
		"status",
		"path",
		"cwd",
		"cliVersion",
		"source",
		"threadSource",
		"agentNickname",
		"agentRole",
		"gitInfo",
		"name",
		"turns",
	];
	const experimentalKeys = [...stableKeys];
	experimentalKeys.splice(1, 0, "extra");
	experimentalKeys.splice(experimentalKeys.indexOf("threadSource"), 0, "canAcceptDirectInput");
	const stableViews = [stableList.result.data[0], stableRead.result.thread, stableResume.result.thread];
	const experimentalViews = [
		experimentalList.result.data[0],
		experimentalRead.result.thread,
		experimentalResume.result.thread,
	];
	for (const value of stableViews) expect(Object.keys(value)).toEqual(stableKeys);
	for (const value of experimentalViews) expect(Object.keys(value)).toEqual(experimentalKeys);
	expect(experimentalList.result.data[0].canAcceptDirectInput).toBeNull();
	for (const value of experimentalViews.slice(1)) expect(value.canAcceptDirectInput).toBe(true);
	for (const value of [...stableViews, ...experimentalViews]) {
		expect(value).not.toHaveProperty("supportedReasoningEfforts");
		expect(value).not.toHaveProperty("defaultReasoningEffort");
		expect(value).not.toHaveProperty("futurePrivateField");
	}
	for (const response of [stableRead, experimentalRead]) expect(response.result.wrapper).toBe("thread/read");
	for (const response of [stableResume, experimentalResume]) expect(response.result.wrapper).toBe("thread/resume");
	for (const value of [...stableViews.slice(1), ...experimentalViews.slice(1)]) expect(value.turns).toEqual(turns);
	expect(thread).toEqual(original);
	const models = (await router.handle("stable", { id: 9, method: "model/list", params: {} })) as any;
	expect(models.result.data[0]).toMatchObject({
		supportedReasoningEfforts: thread.supportedReasoningEfforts,
		defaultReasoningEffort: thread.defaultReasoningEffort,
	});
	expect(
		await router.handle("experimental", { id: 10, method: "thread/fork", params: { threadId: thread.id } }),
	).toMatchObject({ error: { code: -32000 } });
});

test("phone-created thread lifecycle uses cwd precedence and remains visible beside one primary terminal", async () => {
	const notifications: Array<{ client: string; method: string; params: Record<string, unknown> }> = [];
	const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	const managed = new Map<string, any>();
	const endpoint = (id: string, cwd: string, forkedFromId: string | null = null) => ({
		thread: {
			id,
			sessionId: id,
			forkedFromId,
			cwd,
			model: "gpt-5.6-luna",
			modelProvider: "openai-codex",
			reasoningEffort: "medium",
			turns: [],
			createdAt: 1,
			updatedAt: 1,
		},
		call: async (_identity: string, method: string, params: Record<string, unknown>) => {
			calls.push({ method, params });
			return {
				thread: endpoint(id, cwd, forkedFromId).thread,
				model: "gpt-5.6-luna",
				modelProvider: "openai-codex",
				serviceTier: null,
				cwd,
				runtimeWorkspaceRoots: [cwd],
				instructionSources: [],
				approvalPolicy: "never",
				approvalsReviewer: "user",
				sandbox: { type: "dangerFullAccess" },
				activePermissionProfile: null,
				reasoningEffort: "medium",
				multiAgentMode: "explicitRequestOnly",
			};
		},
	});
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [...managed.values()].map(value => value.thread),
		start: async (params: Record<string, unknown>) => {
			const value = endpoint("managed-start", String(params.cwd));
			managed.set(value.thread.id, value);
			return value;
		},
		resume: async (threadId: string) => managed.get(threadId),
		read: async (threadId: string) => ({ thread: managed.get(threadId).thread }),
		fork: async (threadId: string, params: Record<string, unknown>) => {
			const value = endpoint("managed-fork", String(params.cwd), threadId);
			managed.set(value.thread.id, value);
			return value;
		},
		archive: async (threadId: string) => {
			managed.delete(threadId);
		},
		unarchive: async (threadId: string) => {
			const value = endpoint(threadId, "/tmp");
			managed.set(threadId, value);
			return value.thread;
		},
		delete: async (threadId: string) => {
			managed.delete(threadId);
		},
	};
	const router = new RemoteRouter("/tmp/xcsh", "21.29.0", lifecycle);
	router.notify = (client, event) => notifications.push({ client, ...event });
	router.registerSession("primary", endpoint("primary", "/tmp/primary"));
	router.registerSession("secondary", endpoint("secondary", "/tmp/secondary"));
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
	});
	await router.handle("observer", {
		id: 10,
		method: "initialize",
		params: { clientInfo: { name: "observer", version: "1" }, capabilities: { experimentalApi: true } },
	});

	const started = (await router.handle("phone", {
		id: 2,
		method: "thread/start",
		params: { cwd: "/tmp", model: "gpt-5.6-luna", effort: "medium" },
	})) as any;
	expect(started.result).toMatchObject({ thread: { id: "managed-start", cwd: "/tmp" } });
	expect(notifications).toEqual([]);
	await Bun.sleep(1);
	expect(notifications[0]).toMatchObject({ client: "phone", method: "thread/started" });
	expect(notifications.filter(value => value.method === "thread/started").map(value => value.client)).toEqual([
		"phone",
		"observer",
	]);

	const forked = (await router.handle("phone", {
		id: 3,
		method: "thread/fork",
		params: { threadId: "managed-start", excludeTurns: true },
	})) as any;
	expect(forked.result.thread).toMatchObject({ id: "managed-fork", forkedFromId: "managed-start" });
	await Bun.sleep(1);
	expect((await router.handle("phone", { id: 4, method: "thread/list", params: {} })) as any).toMatchObject({
		result: { data: [{ id: "primary" }, { id: "managed-start" }, { id: "managed-fork" }] },
	});
	expect(calls.filter(value => value.method === "thread/resume")).toHaveLength(2);

	expect(
		await router.handle("phone", { id: 5, method: "thread/archive", params: { threadId: "managed-fork" } }),
	).toEqual({ id: 5, result: {} });
	await Bun.sleep(1);
	expect(notifications.at(-1)).toMatchObject({ method: "thread/archived", params: { threadId: "managed-fork" } });
	const restored = (await router.handle("phone", {
		id: 6,
		method: "thread/unarchive",
		params: { threadId: "managed-fork" },
	})) as any;
	expect(restored.result.thread).toMatchObject({ id: "managed-fork" });
	expect(
		await router.handle("phone", { id: 7, method: "thread/delete", params: { threadId: "managed-fork" } }),
	).toEqual({ id: 7, result: {} });
	await Bun.sleep(1);
	expect(notifications.at(-1)).toMatchObject({ method: "thread/deleted", params: { threadId: "managed-fork" } });
	router.dispose();
});

test("thread fork hands the selected terminal history source to the managed lifecycle", async () => {
	const source = {
		id: "primary",
		sessionId: "primary",
		cwd: "/tmp",
		path: "/tmp/primary.jsonl",
		model: "gpt-5.6-luna",
		modelProvider: "openai-codex",
		turns: [],
	};
	let receivedSource: Record<string, unknown> | undefined;
	const sourceCalls: string[] = [];
	const fork = {
		...source,
		id: "fork",
		sessionId: "fork",
		forkedFromId: source.id,
		path: "/tmp/fork.jsonl",
	};
	const response = (thread: Record<string, unknown>) => ({
		thread,
		model: thread.model,
		modelProvider: thread.modelProvider,
		cwd: thread.cwd,
		approvalPolicy: "never",
		approvalsReviewer: "user",
		sandbox: { type: "dangerFullAccess" },
	});
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [],
		start: async () => ({ thread: fork, call: async () => response(fork) }),
		resume: async () => undefined,
		read: async () => ({ thread: source }),
		fork: async (_threadId: string, _params: Record<string, unknown>, selected?: Record<string, unknown>) => {
			receivedSource = selected;
			return { thread: fork, call: async () => response(fork) };
		},
		archive: async () => {},
		unarchive: async () => fork,
		delete: async () => {},
	};
	const router = new RemoteRouter("/tmp/xcsh", "21.29.0", lifecycle);
	router.registerSession(source.id, {
		thread: source,
		call: async (_identity, method) => {
			sourceCalls.push(method);
			return { thread: source };
		},
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(
		await router.handle("phone", { id: 2, method: "thread/fork", params: { threadId: source.id } }),
	).toMatchObject({ result: { thread: { id: fork.id, forkedFromId: source.id } } });
	expect(receivedSource).toBe(source);
	expect(sourceCalls).toEqual(["xcsh/thread/flush"]);
	router.dispose();
});

test("cold managed resume is single-flight and read does not load a worker", async () => {
	let resumes = 0;
	let reads = 0;
	const thread = {
		id: "cold",
		sessionId: "cold",
		cwd: "/tmp/cold",
		model: "gpt-5.6-luna",
		modelProvider: "openai-codex",
		turns: [],
	};
	const endpoint = {
		thread,
		call: async () => ({ thread, model: thread.model, modelProvider: thread.modelProvider, cwd: thread.cwd }),
	};
	let pending: Promise<typeof endpoint> | undefined;
	const lifecycle = {
		defaultCwd: "/tmp/default",
		list: () => [thread],
		start: async () => endpoint,
		fork: async () => endpoint,
		read: async () => {
			reads++;
			return { thread };
		},
		resume: async () => {
			pending ??= (async () => {
				resumes++;
				await Bun.sleep(5);
				return endpoint;
			})();
			return pending;
		},
		archive: async () => {},
		unarchive: async () => thread,
		delete: async () => {},
	};
	const router = new RemoteRouter("/tmp/xcsh", "21.29.0", lifecycle);
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "thread/read", params: { threadId: "cold" } })).toMatchObject({
		result: { thread: { id: "cold" } },
	});
	expect(reads).toBe(1);
	expect(resumes).toBe(0);
	await Promise.all([
		router.handle("phone", { id: 3, method: "thread/resume", params: { threadId: "cold" } }),
		router.handle("phone", { id: 4, method: "thread/resume", params: { threadId: "cold" } }),
	]);
	expect(resumes).toBe(1);
	router.dispose();
});

test("a new phone conversation can enter voice before its first turn", async () => {
	const methods: string[] = [];
	const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
	const managedThread = {
		id: "managed-voice",
		sessionId: "managed-voice",
		forkedFromId: null,
		parentThreadId: null,
		preview: "",
		ephemeral: false,
		section: null,
		sectionEnteredAt: null,
		projectId: null,
		historyMode: "paginated",
		modelProvider: "openai-codex",
		model: "gpt-5.6-luna",
		reasoningEffort: "medium",
		createdAt: 1,
		updatedAt: 1,
		recencyAt: 1,
		status: { type: "idle" },
		path: "/tmp/managed-voice.jsonl",
		cwd: "/tmp",
		cliVersion: "21.29.0",
		source: "appServer",
		threadSource: null,
		agentNickname: null,
		agentRole: null,
		gitInfo: null,
		name: null,
		turns: [],
	};
	let router!: RemoteRouter;
	const endpoint = {
		thread: managedThread,
		models: [
			{
				id: "gpt-5.6-luna",
				provider: "openai-codex",
				displayName: "Luna",
				description: "Fast",
				supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Medium" }],
				defaultReasoningEffort: "medium",
				inputModalities: ["text" as const],
			},
		],
		call: async (_identity: string, method: string) => {
			methods.push(method);
			if (method === "thread/resume")
				return {
					thread: managedThread,
					model: managedThread.model,
					modelProvider: managedThread.modelProvider,
					serviceTier: null,
					cwd: managedThread.cwd,
					instructionSources: [],
					approvalPolicy: "never",
					approvalsReviewer: "user",
					sandbox: { type: "dangerFullAccess" },
					reasoningEffort: "medium",
				};
			if (method === "thread/realtime/start") {
				router.publish({
					method: "thread/realtime/started",
					params: { threadId: managedThread.id, realtimeSessionId: "fixture-realtime", version: "v3" },
				});
				router.publish({
					method: "thread/realtime/sdp",
					params: { threadId: managedThread.id, sdp: "v=0\\r\\nfixture" },
				});
			}
			if (method === "thread/realtime/appendText") {
				router.publish({
					method: "turn/started",
					params: { threadId: managedThread.id, turn: { id: "managed-voice-turn", status: "inProgress" } },
				});
				router.publish({
					method: "turn/completed",
					params: { threadId: managedThread.id, turn: { id: "managed-voice-turn", status: "completed" } },
				});
			}
			return {};
		},
	};
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [managedThread],
		start: async () => endpoint,
		resume: async () => endpoint,
		read: async () => ({ thread: managedThread }),
		fork: async () => endpoint,
		archive: async () => {},
		unarchive: async () => managedThread,
		delete: async () => {},
	};
	router = new RemoteRouter("/tmp/xcsh", "21.29.0", lifecycle);
	router.notify = (_client, event) => notifications.push(event);
	router.registerSession("primary", {
		thread: { ...managedThread, id: "primary", sessionId: "primary" },
		models: endpoint.models,
		call: async () => ({}),
	});
	try {
		expect(
			await router.handle("phone", {
				id: 1,
				method: "initialize",
				params: { clientInfo: { name: "fixture-phone", version: "1" }, capabilities: { experimentalApi: true } },
			}),
		).toMatchObject({ result: { userAgent: "xcsh/21.29.0" } });
		expect(await router.handle("phone", { id: 2, method: "model/list", params: {} })).toMatchObject({
			result: { data: [{ id: "gpt-5.6-luna", inputModalities: ["text", "audio"] }] },
		});
		expect(await router.handle("phone", { id: 3, method: "thread/start", params: { cwd: "/tmp" } })).toMatchObject({
			result: { thread: { id: managedThread.id } },
		});
		expect(await router.handle("phone", { id: 4, method: "model/list", params: {} })).toMatchObject({
			result: { data: [{ id: "gpt-5.6-luna", defaultReasoningEffort: "medium" }] },
		});
		expect(
			await router.handle("phone", {
				id: 5,
				method: "thread/realtime/start",
				params: {
					threadId: managedThread.id,
					version: "v3",
					outputModality: "audio",
					transport: { type: "webrtc", sdp: "v=0\\r\\noffer" },
				},
			}),
		).toEqual({ id: 5, result: {} });
		expect(notifications.map(event => event.method)).toContain("thread/realtime/sdp");
		expect(
			await router.handle("phone", {
				id: 6,
				method: "thread/realtime/appendText",
				params: { threadId: managedThread.id, text: "delegate fixture work", role: "user" },
			}),
		).toEqual({ id: 6, result: {} });
		expect(notifications.map(event => event.method)).toEqual(
			expect.arrayContaining(["thread/realtime/started", "thread/realtime/sdp", "turn/started", "turn/completed"]),
		);
		expect(methods).not.toContain("turn/start");
		expect(methods).toEqual(["thread/resume", "thread/realtime/start", "thread/realtime/appendText"]);
	} finally {
		router.dispose();
	}
});

test("phone bootstrap metadata describes the attached live runtime", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	router.registerSession("alpha", {
		thread: { id: "alpha", cwd: "/tmp/alpha", model: "gpt-5.6-luna", modelProvider: "openai-codex" },
		call: async () => ({}),
	});
	router.registerSession("beta", {
		thread: { id: "beta", cwd: "/tmp/beta", model: "gpt-6-astra", modelProvider: "openai-codex" },
		call: async () => ({}),
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
	});
	const call = (method: string, params: Record<string, unknown> = {}) =>
		router.handle("phone", { id: method, method, params });
	expect(await call("config/read", { cwd: "/tmp/alpha", includeLayers: true })).toMatchObject({
		result: { config: { model: "gpt-5.6-luna", model_provider: "openai-codex" }, origins: {}, layers: [] },
	});
	expect(await call("config/read", { cwd: "/tmp/beta" })).toMatchObject({ result: { config: { model: null } } });
	expect(await call("configRequirements/read")).toMatchObject({ result: { requirements: null } });
	const collaborationModes = bootstrapReference.events.find(event => event.response === "collaborationMode/list")!;
	expect(await call("collaborationMode/list")).toEqual({
		id: "collaborationMode/list",
		result: { data: collaborationModes.data },
	});
	expect(await call("plugin/installed", { cwds: ["/tmp/alpha"] })).toMatchObject({
		result: { marketplaces: [], marketplaceLoadErrors: [] },
	});
	expect(await call("model/list")).toMatchObject({ result: { data: [{ id: "gpt-5.6-luna" }], nextCursor: null } });
	expect(await call("config/read", { cwd: "/unknown" })).toMatchObject({ result: { config: { model: null } } });
	expect(await call("thread/goal/get", { threadId: "missing" })).toMatchObject({ error: { code: -32602 } });
});

test("phone skill bootstrap exposes the live terminal catalog and acknowledges presentation roots", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const rootBootstrap = bootstrapReference.events.find(event => event.method === "skills/extraRoots/set")!;
	const notifications: unknown[] = [];
	router.notify = (client, event) => notifications.push({ client, event });
	router.sessions.set("alpha", {
		thread: { id: "alpha", cwd: "/tmp/alpha" },
		skills: [
			{
				name: "fixture-skill",
				description: "Fixture skill",
				path: "/tmp/skills/fixture-skill/SKILL.md",
				scope: "user",
				enabled: true,
				pluginId: null,
			},
		],
		skillErrors: [],
		call: async (_identity, method, params) => {
			if (method === "session/skills/read" && params.path === "/tmp/skills/fixture-skill/SKILL.md")
				return { dataBase64: "Zml4dHVyZQ==" };
			throw new Error("unexpected owner call");
		},
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(
		await router.handle("phone", {
			id: 2,
			method: "skills/extraRoots/set",
			params: {
				extraRoots: Array.from({ length: rootBootstrap.rootCount! }, (_, index) => `/tmp/skills-${index}`),
			},
		}),
	).toEqual({ id: 2, result: {} });
	expect(notifications).toEqual([{ client: "phone", event: { method: "skills/changed", params: {} } }]);
	expect(await router.handle("phone", { id: 3, method: "skills/list", params: { cwds: ["/tmp/alpha"] } })).toEqual({
		id: 3,
		result: {
			data: [
				{
					cwd: "/tmp/alpha",
					errors: [],
					skills: [
						{
							name: "fixture-skill",
							description: "Fixture skill",
							path: "/tmp/skills/fixture-skill/SKILL.md",
							scope: "user",
							enabled: true,
							pluginId: null,
						},
					],
				},
			],
		},
	});
	expect(
		await router.handle("phone", {
			id: 4,
			method: "fs/readFile",
			params: { path: "/tmp/skills/fixture-skill/SKILL.md" },
		}),
	).toEqual({ id: 4, result: { dataBase64: "Zml4dHVyZQ==" } });
	expect(
		await router.handle("phone", { id: 5, method: "fs/readFile", params: { path: "/tmp/private" } }),
	).toMatchObject({
		error: { code: -32602 },
	});
	expect(
		await router.handle("phone", { id: 6, method: "skills/extraRoots/set", params: { extraRoots: ["relative"] } }),
	).toMatchObject({ error: { code: -32602 } });
});

test("thread name changes are broadcast to initialized discovery clients", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const notifications: { client: string; method: string }[] = [];
	router.notify = (client, event) => notifications.push({ client, method: event.method });
	router.sessions.set("fixture", {
		thread: { id: "fixture", name: "Old" },
		call: async (_identity, method) => {
			if (method !== "thread/name/set") return {};
			router.sessions.get("fixture")!.thread.name = "New";
			router.publish({ method: "thread/name/updated", params: { threadId: "fixture", threadName: "New" } });
			return {};
		},
	});
	for (const client of ["renamer", "observer"])
		await router.handle(client, {
			id: `init-${client}`,
			method: "initialize",
			params: { clientInfo: { name: client, version: "1" } },
		});
	await router.handle("renamer", { id: 1, method: "thread/resume", params: { threadId: "fixture" } });
	expect(
		await router.handle("renamer", {
			id: 2,
			method: "thread/name/set",
			params: { threadId: "fixture", name: "New" },
		}),
	).toEqual({
		id: 2,
		result: {},
	});
	expect(notifications).toEqual([
		{ client: "renamer", method: "thread/name/updated" },
		{ client: "observer", method: "thread/name/updated" },
	]);
	router.dispose();
});

test("voice transition unsubscribe returns the pinned status and leaves the terminal alive", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "fixture");
	router.sessions.set("fixture", { thread: { id: "fixture" }, call: async () => ({}) });
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	await router.handle("phone", { id: 2, method: "thread/resume", params: { threadId: "fixture" } });
	for (const [threadId, status] of [
		["fixture", "unsubscribed"],
		["fixture", "notSubscribed"],
		["missing", "notLoaded"],
	]) {
		expect(await router.handle("phone", { id: status, method: "thread/unsubscribe", params: { threadId } })).toEqual({
			id: status,
			result: { status },
		});
	}
	expect(router.sessions.has("fixture")).toBe(true);
	expect(router.subscribed("phone", "fixture")).toBe(false);
	router.dispose();
});
