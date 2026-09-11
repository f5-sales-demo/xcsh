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
import listSchema from "./fixtures/ThreadListResponse.json";
import loadedListSchema from "./fixtures/ThreadLoadedListResponse.json";
import threadNameUpdatedSchema from "./fixtures/ThreadNameUpdatedNotification.json";
import readSchema from "./fixtures/ThreadReadResponse.json";
import resumeSchema from "./fixtures/ThreadResumeResponse.json";
import threadSetNameParamsSchema from "./fixtures/ThreadSetNameParams.json";
import threadSetNameResponseSchema from "./fixtures/ThreadSetNameResponse.json";

test("initialization and live thread payload match pinned upstream schemas", async () => {
	const ajv = new Ajv({ strict: false });
	for (const name of ["int32", "int64", "uint", "uint16", "uint32", "uint64"])
		ajv.addFormat(name, {
			type: "number",
			validate: (value: number) => Number.isSafeInteger(value) && (!name.startsWith("u") || value >= 0),
		});
	for (const [schema, response] of [
		[configSchema, configResponse({ model: "gpt-6-astra", modelProvider: "openai-codex" }, true)],
		[modelSchema, modelResponse([{ model: "gpt-6-astra" }])],
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
