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
	expect(await router.handle("phone", null)).toMatchObject({ error: { code: -32600 } });
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(
		await router.handle("phone", { id: 2, method: "thread/realtime/unsupported", params: { threadId: "fixture" } }),
	).toMatchObject({ error: { code: -32601 } });
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
		params: { clientInfo: { name: "fixture", version: "1" } },
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
	expect(await call("collaborationMode/list")).toMatchObject({ result: { data: [] } });
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
				extraRoots: Array.from(
					{ length: bootstrapReference.events[0].rootCount! },
					(_, index) => `/tmp/skills-${index}`,
				),
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
