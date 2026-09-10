import { afterEach, expect, test } from "bun:test";
import { RemoteRouter } from "../../src/remote-control/router";

const routers: RemoteRouter[] = [];
afterEach(() => {
	for (const router of routers.splice(0)) router.dispose();
});
async function fixture(count = 3, experimental = true) {
	const router = new RemoteRouter("/tmp/xcsh", "fixture");
	routers.push(router);
	for (let i = 1; i <= count; i++) {
		const id = i.toString(16).padStart(16, "0");
		router.sessions.set(id, {
			thread: {
				id,
				createdAt: i,
				updatedAt: count - i,
				recencyAt: i * 2,
				cwd: `/tmp/discovery/${i % 2}`,
				name: `Terminal ${i}`,
				preview: `Context ${i}`,
				modelProvider: i % 2 ? "openai-codex" : "other",
				source: "cli",
				section: null,
				projectId: null,
				parentThreadId: null,
				turns: [{ id: "omit" }],
			},
			call: async () => {
				throw new Error("Discovery must not invoke the agent");
			},
		});
	}
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: experimental } },
	});
	const call = async (method: string, params: Record<string, unknown> = {}) =>
		(await router.handle("phone", { id: "reused-read", method, params })) as {
			result?: { data: any[]; nextCursor: string | null; backwardsCursor?: string | null };
			error?: { code: number; message: string };
		};
	const list = (params: Record<string, unknown> = {}) => call("thread/list", params);
	return { router, list, call, ids: [...router.sessions.keys()] };
}

test("discovery defaults to 25 and pages every permitted live session across providers", async () => {
	const f = await fixture(128);
	let result = (await f.list()).result!;
	expect(result.data).toHaveLength(25);
	const found: string[] = [];
	for (;;) {
		found.push(...result.data.map(thread => thread.id));
		expect(result.data.every(thread => thread.turns.length === 0)).toBe(true);
		if (result.nextCursor === null) break;
		result = (await f.list({ cursor: result.nextCursor })).result!;
	}
	expect(found).toEqual([...f.ids].reverse());
	expect(new Set(found).size).toBe(128);
});

test("discovery honors all timestamp sort keys and both directions", async () => {
	const f = await fixture();
	for (const [sortKey, expected] of [
		["created_at", [...f.ids].reverse()],
		["updated_at", f.ids],
		["recency_at", [...f.ids].reverse()],
	] as const) {
		expect((await f.list({ sortKey })).result?.data.map(t => t.id)).toEqual([...expected]);
		expect((await f.list({ sortKey, sortDirection: "asc" })).result?.data.map(t => t.id)).toEqual(
			[...expected].reverse(),
		);
	}
});

test("timestamp ties use stable ID ordering and reverse anchors include the whole anchor timestamp", async () => {
	const f = await fixture(4);
	for (const value of f.router.sessions.values()) value.thread.createdAt = 10;
	const first = (await f.list({ limit: 2 })).result!;
	expect(first.data.map(t => t.id)).toEqual(f.ids.slice(2).reverse());
	const next = (await f.list({ limit: 2, cursor: first.nextCursor })).result!;
	expect(next.data.map(t => t.id)).toEqual(f.ids.slice(0, 2).reverse());
	expect((await f.list({ cursor: first.backwardsCursor, sortDirection: "asc" })).result?.data.map(t => t.id)).toEqual(
		f.ids,
	);
	expect(next.nextCursor).toBeNull();
});

test("discovery cursors survive removed anchors and do not shift when a newer session joins", async () => {
	const f = await fixture(4);
	const first = (await f.list({ limit: 2 })).result!;
	f.router.sessions.delete(f.ids[2]);
	f.router.sessions.set("new", {
		thread: { id: "new", createdAt: 100, source: "cli" },
		call: async () => ({}),
	});
	expect((await f.list({ limit: 2, cursor: first.nextCursor })).result?.data.map(t => t.id)).toEqual(
		f.ids.slice(0, 2).reverse(),
	);
	expect((await f.list()).result?.data[0].id).toBe("new");
	expect(await f.list({ cursor: first.nextCursor, sortKey: "updated_at" })).toMatchObject({ error: { code: -32600 } });
});

test("discovery applies exact provider/source filters and normalized single or multiple working directories", async () => {
	const f = await fixture(4);
	const ids = async (params: Record<string, unknown>) => (await f.list(params)).result?.data.map(t => t.id);
	expect(await ids({ modelProviders: ["openai-codex"] })).toEqual([f.ids[2], f.ids[0]]);
	expect(await ids({ modelProviders: [] })).toEqual([...f.ids].reverse());
	expect(await ids({ sourceKinds: ["cli"] })).toEqual([...f.ids].reverse());
	expect(await ids({ sourceKinds: [] })).toEqual([...f.ids].reverse());
	for (const source of [
		"vscode",
		"exec",
		"appServer",
		"subAgent",
		"subAgentReview",
		"subAgentCompact",
		"subAgentThreadSpawn",
		"subAgentOther",
		"unknown",
	])
		expect(await ids({ sourceKinds: [source] })).toEqual([]);
	expect(await ids({ cwd: "/tmp/discovery/1/../0/" })).toEqual([f.ids[3], f.ids[1]]);
	expect(await ids({ cwd: ["/tmp/discovery/0", "/tmp/discovery/1"] })).toEqual([...f.ids].reverse());
	expect(await ids({ cwd: [] })).toEqual([]);
	expect(await ids({ cwd: ["/tmp/discovery/1"], modelProviders: ["other"] })).toEqual([]);
});

test("discovery title search is a literal case-sensitive substring over names and previews", async () => {
	const f = await fixture();
	f.router.sessions.get(f.ids[0])!.thread.name = "literal %_ terminal";
	for (const [searchTerm, expected] of [
		["Terminal 2", [f.ids[1]]],
		["Context 3", [f.ids[2]]],
		["terminal 2", []],
		["%_", [f.ids[0]]],
		["", [...f.ids].reverse()],
	] as const)
		expect((await f.list({ searchTerm })).result?.data.map(t => t.id)).toEqual([...expected]);
});

test("live-only discovery handles archives and absent sections, projects and spawned descendants explicitly", async () => {
	const f = await fixture();
	for (const params of [
		{ archived: true },
		{ sectionId: "missing" },
		{ parentThreadId: "parent" },
		{ ancestorThreadId: "ancestor" },
	])
		expect((await f.list(params)).result?.data).toEqual([]);
	expect(
		(await f.list({ sectionId: null, projectId: null, archived: false, useStateDbOnly: true })).result?.data,
	).toHaveLength(3);
	expect(await f.list({ projectId: "123456789012" })).toMatchObject({ error: { code: -32602 } });
	expect(await f.list({ parentThreadId: "a", ancestorThreadId: "b" })).toMatchObject({ error: { code: -32600 } });
	expect(await f.list({ sortKey: "section_position" })).toMatchObject({ error: { code: -32600 } });
	expect((await f.list({ sortKey: "section_position", sectionId: "missing" })).result?.data).toEqual([]);
});

test("experimental discovery filters require the capability even for an explicit null project filter", async () => {
	const f = await fixture(1, false);
	for (const params of [
		{ projectId: null },
		{ projectId: "123456789012" },
		{ parentThreadId: "p" },
		{ ancestorThreadId: "p" },
	])
		expect(await f.list(params)).toMatchObject({ error: { code: -32600 } });
	expect((await f.list({ parentThreadId: null, ancestorThreadId: null })).result?.data).toHaveLength(1);
});

test("discovery validates optional field types and pinned unsigned/clamped limits", async () => {
	const f = await fixture(128);
	expect((await f.list({ limit: 0 })).result?.data).toHaveLength(1);
	expect((await f.list({ limit: 1000 })).result?.data).toHaveLength(100);
	for (const params of [
		{ limit: -1 },
		{ limit: 1.5 },
		{ limit: false },
		{ limit: "2" },
		{ limit: 4294967296 },
		{ sortKey: "invalid" },
		{ sortDirection: "invalid" },
		{ archived: "true" },
		{ useStateDbOnly: null },
		{ cwd: 1 },
		{ cwd: [1] },
		{ modelProviders: "other" },
		{ modelProviders: [1] },
		{ sourceKinds: ["bad"] },
		{ sourceKinds: true },
		{ searchTerm: 1 },
		{ sectionId: false },
		{ projectId: 123456789012 },
		{ parentThreadId: [] },
		{ ancestorThreadId: {} },
	])
		expect(await f.list(params), JSON.stringify(params)).toMatchObject({ error: { code: -32602 } });
	for (const cursor of ["broken", "{}", "null", "x".repeat(9000)])
		expect(await f.list({ cursor })).toMatchObject({
			error: { code: -32600, message: "Invalid thread list cursor" },
		});
	for (const cursor of [[], 1]) expect(await f.list({ cursor })).toMatchObject({ error: { code: -32602 } });
});

test("loaded discovery sorts IDs and pages after a departed anchor without dropping the next session", async () => {
	const f = await fixture(4);
	const last = f.router.sessions.get(f.ids[0])!;
	f.router.sessions.delete(f.ids[0]);
	f.router.sessions.set(f.ids[0], last);
	const first = (await f.call("thread/loaded/list", { limit: 2 })).result!;
	expect(first).toEqual({ data: f.ids.slice(0, 2), nextCursor: f.ids[1] });
	f.router.sessions.delete(f.ids[1]);
	expect((await f.call("thread/loaded/list", { limit: 2, cursor: first.nextCursor })).result).toEqual({
		data: f.ids.slice(2),
		nextCursor: null,
	});
	expect((await f.call("thread/loaded/list")).result?.data).toEqual([f.ids[0], ...f.ids.slice(2)]);
	expect((await f.call("thread/loaded/list", { limit: 0 })).result?.data).toHaveLength(1);
	for (const limit of [-1, 0.5, "1", false, 4294967296])
		expect(await f.call("thread/loaded/list", { limit })).toMatchObject({ error: { code: -32602 } });
	for (const cursor of [[], 1])
		expect(await f.call("thread/loaded/list", { cursor })).toMatchObject({ error: { code: -32602 } });
	expect(await f.call("thread/loaded/list", { cursor: "x".repeat(9000) })).toMatchObject({ error: { code: -32600 } });
});
