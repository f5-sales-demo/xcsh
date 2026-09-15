import { expect, test } from "bun:test";
import Ajv from "ajv";
import { configResponse, modelResponse } from "../../src/remote-control/metadata";
import { RemoteRouter } from "../../src/remote-control/router";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import configSchema from "./fixtures/ConfigReadResponse.json";
import fsReadFileSchema from "./fixtures/FsReadFileResponse.json";
import initializeParamsSchema from "./fixtures/InitializeParams.json";
import initializeSchema from "./fixtures/InitializeResponse.json";
import modelSchema from "./fixtures/ModelListResponse.json";
import permissionProfileListParamsSchema from "./fixtures/PermissionProfileListParams.json";
import permissionProfileListSchema from "./fixtures/PermissionProfileListResponse.json";
import skillsListSchema from "./fixtures/SkillsListResponse.json";
import threadArchivedNotificationSchema from "./fixtures/ThreadArchivedNotification.json";
import threadArchiveParamsSchema from "./fixtures/ThreadArchiveParams.json";
import threadArchiveResponseSchema from "./fixtures/ThreadArchiveResponse.json";
import threadCompactStartParamsSchema from "./fixtures/ThreadCompactStartParams.json";
import threadCompactStartResponseSchema from "./fixtures/ThreadCompactStartResponse.json";
import threadDeletedNotificationSchema from "./fixtures/ThreadDeletedNotification.json";
import threadDeleteParamsSchema from "./fixtures/ThreadDeleteParams.json";
import threadDeleteResponseSchema from "./fixtures/ThreadDeleteResponse.json";
import threadForkParamsSchema from "./fixtures/ThreadForkParams.json";
import threadForkResponseSchema from "./fixtures/ThreadForkResponse.json";
import listSchema from "./fixtures/ThreadListResponse.json";
import loadedListSchema from "./fixtures/ThreadLoadedListResponse.json";
import threadNameUpdatedSchema from "./fixtures/ThreadNameUpdatedNotification.json";
import readSchema from "./fixtures/ThreadReadResponse.json";
import resumeSchema from "./fixtures/ThreadResumeResponse.json";
import threadRevertedNotificationSchema from "./fixtures/ThreadRevertedNotification.json";
import threadRevertParamsSchema from "./fixtures/ThreadRevertParams.json";
import threadRevertResponseSchema from "./fixtures/ThreadRevertResponse.json";
import threadSetNameParamsSchema from "./fixtures/ThreadSetNameParams.json";
import threadSetNameResponseSchema from "./fixtures/ThreadSetNameResponse.json";
import threadStartedSchema from "./fixtures/ThreadStartedNotification.json";
import threadStartParamsSchema from "./fixtures/ThreadStartParams.json";
import threadStartResponseSchema from "./fixtures/ThreadStartResponse.json";
import threadUnarchivedNotificationSchema from "./fixtures/ThreadUnarchivedNotification.json";
import threadUnarchiveParamsSchema from "./fixtures/ThreadUnarchiveParams.json";
import threadUnarchiveResponseSchema from "./fixtures/ThreadUnarchiveResponse.json";

function protocolAjv(): Ajv {
	const ajv = new Ajv({ strict: false });
	for (const name of ["int32", "int64", "uint", "uint16", "uint32", "uint64"])
		ajv.addFormat(name, {
			type: "number",
			validate: (value: number) => Number.isSafeInteger(value) && (!name.startsWith("u") || value >= 0),
		});
	return ajv;
}

test("initialization and live thread payload match pinned upstream schemas", async () => {
	const ajv = new Ajv({ strict: false });
	for (const name of ["int32", "int64", "uint", "uint16", "uint32", "uint64"])
		ajv.addFormat(name, {
			type: "number",
			validate: (value: number) => Number.isSafeInteger(value) && (!name.startsWith("u") || value >= 0),
		});
	for (const [schema, response] of [
		[configSchema, configResponse({ model: "gpt-6-astra", modelProvider: "openai-codex" }, true)],
		[
			modelSchema,
			modelResponse(
				[{ model: "gpt-6-astra" }],
				[
					{
						id: "gpt-6-astra",
						provider: "openai-codex",
						displayName: "GPT-6 Astra",
						description: "Maximum capability",
						supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }],
						defaultReasoningEffort: "high",
						inputModalities: ["text", "image"],
					},
				],
			),
		],
		[permissionProfileListSchema, { data: [], nextCursor: null }],
	] as const) {
		const validate = ajv.compile(schema);
		expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
	}
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const initializeParams = {
		clientInfo: { name: "fixture", title: "Fixture phone", version: "1" },
		capabilities: {
			experimentalApi: true,
			optOutNotificationMethods: ["thread/started", "unknown/notification"],
		},
	};
	const validInitializeParams = ajv.compile(initializeParamsSchema);
	expect(validInitializeParams(initializeParams), JSON.stringify(validInitializeParams.errors)).toBe(true);
	const validPermissionProfileListParams = ajv.compile(permissionProfileListParamsSchema);
	expect(
		validPermissionProfileListParams({ cursor: "0", limit: 0, cwd: "/tmp" }),
		JSON.stringify(validPermissionProfileListParams.errors),
	).toBe(true);
	const initialized = (await router.handle("fixture", {
		id: 1,
		method: "initialize",
		params: initializeParams,
	})) as { result: unknown };
	const validInit = ajv.compile(initializeSchema);
	expect(validInit(initialized.result), JSON.stringify(validInit.errors)).toBe(true);
	const remote = new RemoteSession({
		sessionId: "fixture",
		sessionName: "Fixture",
		messages: [],
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	try {
		const validList = ajv.compile(listSchema);
		router.sessions.set(remote.thread().id, {
			thread: remote.thread(),
			call: (identity, method, params) => remote.call(identity, method, params),
		});
		const response = (await router.handle("fixture", { id: 2, method: "thread/list" })) as { result: unknown };
		expect(validList(response.result), JSON.stringify(validList.errors)).toBe(true);
		const loaded = (await router.handle("fixture", { id: 3, method: "thread/loaded/list" })) as { result: unknown };
		const validLoaded = ajv.compile(loadedListSchema);
		expect(validLoaded(loaded.result), JSON.stringify(validLoaded.errors)).toBe(true);
		const read = (await router.handle("fixture", {
			id: 4,
			method: "thread/read",
			params: { threadId: "fixture", includeTurns: true },
		})) as { result: unknown };
		const validRead = ajv.compile(readSchema);
		expect(validRead(read.result), JSON.stringify(validRead.errors)).toBe(true);
		const resumed = (await router.handle("fixture", {
			id: 5,
			method: "thread/resume",
			params: { threadId: "fixture", excludeTurns: false },
		})) as { result: unknown };
		const validResume = ajv.compile(resumeSchema);
		expect(validResume(resumed.result), JSON.stringify(validResume.errors)).toBe(true);
	} finally {
		remote.dispose();
		router.dispose();
	}
});

test("a registered model catalog does not reintroduce a historical thread model", () => {
	const response = modelResponse(
		[{ model: "gpt-5.4", supportedReasoningEfforts: [] }],
		[
			{
				id: "gpt-5.6-luna",
				provider: "openai-codex",
				displayName: "GPT-5.6 Luna",
				description: "Fast responses",
				supportedReasoningEfforts: [],
				defaultReasoningEffort: "none",
				inputModalities: ["text"],
			},
		],
	);
	expect(response.data.map(model => model.id)).toEqual(["gpt-5.6-luna"]);
});

test("a live replacement thread notification matches the pinned upstream schema", async () => {
	const ajv = new Ajv({ strict: false });
	for (const name of ["int32", "int64", "uint", "uint16", "uint32", "uint64"])
		ajv.addFormat(name, {
			type: "number",
			validate: (value: number) => Number.isSafeInteger(value) && (!name.startsWith("u") || value >= 0),
		});
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	const notifications: any[] = [];
	router.notify = (_client, event) => notifications.push(event);
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
	});
	const remote = new RemoteSession({
		sessionId: "replacement",
		sessionName: "xcsh Remote Luna",
		messages: [],
		model: { id: "gpt-5.6-luna", provider: "openai-codex" },
		sessionManager: { getCwd: () => "/tmp/luna" },
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	try {
		router.registerSession("replacement", { thread: remote.thread(), call: async () => ({}) });
		const started = notifications.find(event => event.method === "thread/started");
		expect(started).toBeDefined();
		const validate = ajv.compile(threadStartedSchema);
		expect(validate(started.params), JSON.stringify(validate.errors)).toBe(true);
	} finally {
		remote.dispose();
		router.dispose();
	}
});

test("actual settings notification matches the pinned thread settings contract", async () => {
	const schema = (await import("./fixtures/ThreadSettingsUpdatedNotification.json")).default;
	const validate = new Ajv({ strict: false }).compile(schema);
	let effort = "medium";
	const remote = new RemoteSession({
		sessionId: "fixture",
		messages: [],
		model: { id: "gpt-6-astra", provider: "openai-codex" },
		get thinkingLevel() {
			return effort;
		},
		setThinkingLevel: (next: string) => {
			effort = next;
		},
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	const events: any[] = [];
	remote.subscribe(event => events.push(event));
	try {
		await remote.call("settings-fixture", "thread/settings/update", { threadId: "fixture", effort: "high" });
		expect(events).toHaveLength(1);
		expect(validate(events[0].params), JSON.stringify(validate.errors)).toBe(true);
		expect(events[0].params.threadSettings.effort).toBe("high");
	} finally {
		remote.dispose();
	}
});

test("phone skill catalog and file payload match pinned upstream schemas", async () => {
	const ajv = new Ajv({ strict: false });
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	router.sessions.set("fixture", {
		thread: { id: "fixture", cwd: "/tmp/project" },
		skills: [
			{
				name: "fixture",
				description: "Fixture",
				path: "/tmp/skills/fixture/SKILL.md",
				scope: "repo",
				enabled: true,
				pluginId: null,
			},
		],
		skillErrors: [],
		call: async () => ({ dataBase64: "Zml4dHVyZQ==" }),
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	try {
		const listed = (await router.handle("phone", {
			id: 2,
			method: "skills/list",
			params: { cwds: ["/tmp/project"] },
		})) as { result: unknown };
		const validList = ajv.compile(skillsListSchema);
		expect(validList(listed.result), JSON.stringify(validList.errors)).toBe(true);
		const read = (await router.handle("phone", {
			id: 3,
			method: "fs/readFile",
			params: { path: "/tmp/skills/fixture/SKILL.md" },
		})) as { result: unknown };
		const validRead = ajv.compile(fsReadFileSchema);
		expect(validRead(read.result), JSON.stringify(validRead.errors)).toBe(true);
	} finally {
		router.dispose();
	}
});

test("actual rename request, response and notification match pinned schemas", async () => {
	const ajv = new Ajv({ strict: false });
	let name = "Fixture";
	const target = {
		sessionId: "fixture",
		get sessionName() {
			return name;
		},
		messages: [],
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
		setSessionName: async (value: string) => {
			name = value;
			return true;
		},
	} as unknown as SessionTarget;
	const remote = new RemoteSession(target);
	const events: any[] = [];
	remote.subscribe(event => events.push(event));
	try {
		const params = { threadId: "fixture", name: "Renamed" };
		const validParams = ajv.compile(threadSetNameParamsSchema);
		expect(validParams(params), JSON.stringify(validParams.errors)).toBe(true);
		const result = await remote.call("rename-schema", "thread/name/set", params);
		const validResponse = ajv.compile(threadSetNameResponseSchema);
		expect(validResponse(result), JSON.stringify(validResponse.errors)).toBe(true);
		const validNotification = ajv.compile(threadNameUpdatedSchema);
		expect(validNotification(events[0].params), JSON.stringify(validNotification.errors)).toBe(true);
	} finally {
		remote.dispose();
	}
});

test("managed lifecycle requests, responses and notifications match pinned 0.153.4 schemas", async () => {
	const ajv = protocolAjv();
	const validate = (schema: object, value: unknown) => {
		const compiled = ajv.compile(schema);
		expect(compiled(value), JSON.stringify(compiled.errors)).toBe(true);
	};
	const records = new Map<string, Record<string, unknown>>();
	const thread = (id: string, forkedFromId: string | null = null): Record<string, unknown> => ({
		id,
		sessionId: id,
		forkedFromId,
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
		path: `/tmp/${id}.jsonl`,
		cwd: "/tmp",
		cliVersion: "21.29.0",
		source: "appServer",
		threadSource: null,
		agentNickname: null,
		agentRole: null,
		gitInfo: null,
		name: null,
		turns: [],
	});
	const endpoint = (value: Record<string, unknown>) => ({
		thread: value,
		call: async () => ({
			thread: value,
			model: value.model,
			modelProvider: value.modelProvider,
			serviceTier: null,
			cwd: value.cwd,
			instructionSources: [],
			approvalPolicy: "never",
			approvalsReviewer: "user",
			sandbox: { type: "dangerFullAccess" },
			reasoningEffort: value.reasoningEffort,
		}),
	});
	const lifecycle = {
		defaultCwd: "/tmp",
		list: () => [...records.values()],
		start: async () => {
			const value = thread("schema-start");
			records.set(String(value.id), value);
			return endpoint(value);
		},
		resume: async (threadId: string) => {
			const value = records.get(threadId);
			return value ? endpoint(value) : undefined;
		},
		read: async (threadId: string) => ({ thread: records.get(threadId) }),
		fork: async (threadId: string) => {
			const value = thread("schema-fork", threadId);
			records.set(String(value.id), value);
			return endpoint(value);
		},
		archive: async (threadId: string) => {
			Object.assign(records.get(threadId)!, { archived: true });
		},
		unarchive: async (threadId: string) => {
			Object.assign(records.get(threadId)!, { archived: false });
			return records.get(threadId)!;
		},
		delete: async (threadId: string) => {
			records.delete(threadId);
		},
	};
	const router = new RemoteRouter("/tmp/xcsh", "21.29.0", lifecycle);
	const notifications: Array<{ method: string; params: Record<string, unknown> }> = [];
	router.notify = (_client, event) => notifications.push(event);
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		});
		const startParams = { cwd: "/tmp", ephemeral: false, model: "gpt-5.6-luna" };
		validate(threadStartParamsSchema, startParams);
		const started = (await router.handle("phone", { id: 2, method: "thread/start", params: startParams })) as any;
		validate(threadStartResponseSchema, started.result);

		const forkParams = { threadId: "schema-start", excludeTurns: false };
		validate(threadForkParamsSchema, forkParams);
		const forked = (await router.handle("phone", { id: 3, method: "thread/fork", params: forkParams })) as any;
		validate(threadForkResponseSchema, forked.result);

		const archiveParams = { threadId: "schema-fork" };
		validate(threadArchiveParamsSchema, archiveParams);
		const archived = (await router.handle("phone", {
			id: 4,
			method: "thread/archive",
			params: archiveParams,
		})) as any;
		validate(threadArchiveResponseSchema, archived.result);
		await Bun.sleep(1);
		validate(
			threadArchivedNotificationSchema,
			notifications.find(event => event.method === "thread/archived")?.params,
		);

		validate(threadUnarchiveParamsSchema, archiveParams);
		const unarchived = (await router.handle("phone", {
			id: 5,
			method: "thread/unarchive",
			params: archiveParams,
		})) as any;
		validate(threadUnarchiveResponseSchema, unarchived.result);
		await Bun.sleep(1);
		validate(
			threadUnarchivedNotificationSchema,
			notifications.find(event => event.method === "thread/unarchived")?.params,
		);

		validate(threadDeleteParamsSchema, archiveParams);
		const deleted = (await router.handle("phone", { id: 6, method: "thread/delete", params: archiveParams })) as any;
		validate(threadDeleteResponseSchema, deleted.result);
		await Bun.sleep(1);
		validate(threadDeletedNotificationSchema, notifications.find(event => event.method === "thread/deleted")?.params);
	} finally {
		router.dispose();
	}
});

test("compaction and revert match pinned 0.153.4 schemas", async () => {
	const ajv = protocolAjv();
	const validate = (schema: object, value: unknown) => {
		const compiled = ajv.compile(schema);
		expect(compiled(value), JSON.stringify(compiled.errors)).toBe(true);
	};
	const entries = [
		{
			type: "message",
			id: "schema-user",
			parentId: null,
			timestamp: "2026-09-14T00:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "fixture" }], timestamp: 1 },
		},
	] as any[];
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	const remote = new RemoteSession({
		sessionId: "schema-managed",
		sessionFile: "/tmp/schema-managed.jsonl",
		messages: [],
		isStreaming: false,
		sessionManager: {
			getCwd: () => "/tmp",
			getBranch: () => entries,
			flush: async () => {},
		},
		subscribe: () => () => {},
		compact: async () => {},
		navigateTree: async () => ({ cancelled: false }),
		abort: async () => {},
	} as unknown as SessionTarget);
	remote.subscribe(event => events.push(event));
	try {
		const compactParams = { threadId: "schema-managed" };
		validate(threadCompactStartParamsSchema, compactParams);
		validate(threadCompactStartResponseSchema, await remote.call("compact", "thread/compact/start", compactParams));
		const revertParams = { threadId: "schema-managed", beforeTurnId: "schema-managed-turn-schema-user" };
		validate(threadRevertParamsSchema, revertParams);
		validate(threadRevertResponseSchema, await remote.call("revert", "thread/revert", revertParams));
		await Bun.sleep(1);
		validate(threadRevertedNotificationSchema, events.find(event => event.method === "thread/reverted")?.params);
		expect(Object.keys(events.find(event => event.method === "thread/reverted")!.params)).toEqual(["threadId"]);
	} finally {
		remote.dispose();
	}
});
