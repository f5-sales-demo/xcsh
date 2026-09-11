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
	expect(await router.handle("phone", { id: 6, method: "thread/start" })).toMatchObject({ error: { code: -32601 } });
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
	).toMatchObject({ error: { code: -32601 } });
});

test("phone bootstrap metadata describes the attached live runtime", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	router.sessions.set("alpha", {
		thread: { id: "alpha", cwd: "/tmp/alpha", model: "gpt-5.6-luna", modelProvider: "openai-codex" },
		call: async () => ({}),
	});
	router.sessions.set("beta", {
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
	expect(await call("config/read", { cwd: "/tmp/beta" })).toMatchObject({
		result: { config: { model: "gpt-6-astra" } },
	});
	expect(await call("configRequirements/read")).toMatchObject({ result: { requirements: null } });
	const collaborationModes = bootstrapReference.events.find(event => event.response === "collaborationMode/list")!;
	expect(await call("collaborationMode/list")).toEqual({
		id: "collaborationMode/list",
		result: { data: collaborationModes.data },
	});
	expect(await call("plugin/installed", { cwds: ["/tmp/alpha"] })).toMatchObject({
		result: { marketplaces: [], marketplaceLoadErrors: [] },
	});
	expect(await call("model/list")).toMatchObject({
		result: { data: [{ id: "gpt-5.6-luna" }, { id: "gpt-6-astra" }], nextCursor: null },
	});
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
