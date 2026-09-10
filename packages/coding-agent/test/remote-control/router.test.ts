import { expect, test } from "bun:test";
import { RemoteRouter } from "../../src/remote-control/router";

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
		await router.handle("phone", { id: 2, method: "thread/realtime/start", params: { threadId: "fixture" } }),
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

test("phone can clear its empty extra skill roots without changing terminal skills", async () => {
	const router = new RemoteRouter("/tmp/xcsh", "21.22.0");
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	expect(await router.handle("phone", { id: 2, method: "skills/extraRoots/set", params: { extraRoots: [] } })).toEqual(
		{ id: 2, result: {} },
	);
	expect(
		await router.handle("phone", {
			id: 3,
			method: "skills/extraRoots/set",
			params: { extraRoots: ["/tmp/new-skills"] },
		}),
	).toMatchObject({ error: { code: -32602 } });
});
