import { afterEach, expect, test } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import Ajv from "ajv";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import itemsSchema from "./fixtures/ThreadItemsListResponse.json";
import turnsSchema from "./fixtures/ThreadTurnsListResponse.json";

const sessions: RemoteSession[] = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});
function fixture(id = "history", count = 3) {
	const messages: AgentMessage[] = [];
	const append = (index: number) => {
		messages.push(
			{ role: "user", content: `request ${index}`, timestamp: index * 1000 },
			...(["progress", "result"] as const).map(
				text =>
					({
						role: "assistant",
						content: [{ type: "text", text: `${text} ${index}` }],
						stopReason: "stop",
						timestamp: index * 1000 + 1,
					}) as AgentMessage,
			),
		);
	};
	for (let i = 1; i <= count; i++) append(i);
	const remote = new RemoteSession({
		sessionId: id,
		messages,
		sessionManager: { getCwd: () => "/tmp" },
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	sessions.push(remote);
	let request = 0;
	const page = (kind: "turns" | "items", params: Record<string, unknown> = {}) =>
		remote.call(`page-${++request}`, `thread/${kind}/list`, { threadId: id, ...params }) as Promise<{
			data: Array<{
				id: string;
				itemsView: string;
				items: Record<string, unknown>[];
				turnId: string;
				item: { id: string };
			}>;
			nextCursor: string | null;
			backwardsCursor: string | null;
		}>;
	return { remote, page, append };
}

test("pinned history defaults: descending summary turns, ascending items, 25 rows", async () => {
	const { page } = fixture("history", 30);
	const turns = await page("turns");
	expect(turns.data).toHaveLength(25);
	expect(turns.data[0]).toMatchObject({ id: "history-turn-30", itemsView: "summary" });
	expect(turns.data[0].items.map(item => item.id)).toEqual(["history-item-87", "history-item-89"]);
	const items = await page("items");
	expect(items.data).toHaveLength(25);
	expect(items.data[0].item.id).toBe("history-item-0");
});

test("turn and item pages match the unmodified pinned response schemas", async () => {
	const { page } = fixture();
	const ajv = new Ajv({ strict: false });
	for (const name of ["int32", "int64", "uint", "uint16", "uint32", "uint64"])
		ajv.addFormat(name, {
			type: "number",
			validate: (value: number) => Number.isSafeInteger(value) && (!name.startsWith("u") || value >= 0),
		});
	const turns = ajv.compile(turnsSchema);
	const items = ajv.compile(itemsSchema);
	for (const itemsView of ["summary", "full", "notLoaded"])
		expect(turns(await page("turns", { itemsView })), JSON.stringify(turns.errors)).toBe(true);
	expect(items(await page("items")), JSON.stringify(items.errors)).toBe(true);
});

test("rejoining a live session with a reused RPC identity returns current history", async () => {
	const { remote, append } = fixture();
	const resume = () =>
		remote.call("resume-retry", "thread/resume", { threadId: "history", initialTurnsPage: { limit: 1 } }) as Promise<{
			thread: { turns: unknown[] };
			initialTurnsPage: { data: { id: string }[] };
		}>;
	expect((await resume()).thread.turns).toHaveLength(3);
	append(4);
	const next = await resume();
	expect(next.thread.turns).toHaveLength(4);
	expect(next.initialTurnsPage.data[0].id).toBe("history-turn-4");
});

test("item pages respect turn filters and do not bleed into other turns", async () => {
	const { page } = fixture();
	const first = await page("items", { turnId: "history-turn-2", limit: 2 });
	expect(first.data.map(row => row.item.id)).toEqual(["history-item-3", "history-item-4"]);
	const second = await page("items", { turnId: "history-turn-2", limit: 2, cursor: first.nextCursor });
	expect(second.data.map(row => row.item.id)).toEqual(["history-item-5"]);
	expect(second.nextCursor).toBeNull();
	expect((await page("items", { turnId: "missing" })).data).toEqual([]);
});

test.each(["turns", "items"] as const)("%s cursors resume exclusively and reverse inclusively", async kind => {
	const { page } = fixture();
	const first = await page(kind, { limit: 2, sortDirection: "asc" });
	const second = await page(kind, { limit: 2, sortDirection: "asc", cursor: first.nextCursor });
	const key = (row: (typeof first.data)[number]) => (kind === "turns" ? row.id : row.item.id);
	expect(second.data.map(key).some(id => first.data.map(key).includes(id))).toBe(false);
	const reversed = await page(kind, { limit: 2, sortDirection: "desc", cursor: second.backwardsCursor });
	expect(reversed.data.map(key)).toEqual([key(second.data[0]), key(first.data[1])]);
});

test("cursors are scoped to thread, collection and turn filter", async () => {
	const a = fixture("a");
	const b = fixture("b");
	const { nextCursor } = await a.page("items", { limit: 1 });
	for (const run of [
		() => b.page("items", { cursor: nextCursor }),
		() => a.page("turns", { cursor: nextCursor }),
		() => a.page("items", { cursor: nextCursor, turnId: "a-turn-1" }),
	])
		await expect(run()).rejects.toMatchObject({ code: -32602 });
});

test("summary and unloaded views preserve full history for later hydration", async () => {
	const { page } = fixture();
	expect((await page("turns", { itemsView: "summary" })).data[0].items).toHaveLength(2);
	expect((await page("turns", { itemsView: "notLoaded" })).data[0]).toMatchObject({
		items: [],
		itemsView: "notLoaded",
	});
	expect((await page("turns", { itemsView: "full" })).data[0].items).toHaveLength(3);
	await expect(page("turns", { itemsView: "unknown" })).rejects.toMatchObject({ code: -32602 });
});

test("history limits match pinned u32 parsing and clamping", async () => {
	const { page } = fixture("history", 110);
	for (const kind of ["turns", "items"] as const) {
		expect((await page(kind, { limit: 0 })).data).toHaveLength(1);
		expect((await page(kind, { limit: 1000 })).data).toHaveLength(100);
		for (const limit of [-1, 1.5, "2", false, 4294967296])
			await expect(page(kind, { limit })).rejects.toMatchObject({ code: -32602 });
	}
});

test("malformed history options return explicit protocol errors", async () => {
	const { page } = fixture();
	for (const cursor of ["invalid", "{}", [], 1, "x".repeat(9000)])
		await expect(page("items", { cursor })).rejects.toMatchObject({ code: -32602 });
	await expect(page("items", { turnId: 1 })).rejects.toMatchObject({ code: -32602 });
	await expect(page("items", { sortDirection: "sideways" })).rejects.toMatchObject({ code: -32602 });
});

test("resume backwards cursors anchor the latest row and catch appended history", async () => {
	const { remote, page, append } = fixture();
	const resumed = (await remote.call("resume", "thread/resume", { threadId: "history", excludeTurns: true })) as {
		turnsBackwardsCursor: string;
		itemsBackwardsCursor: string;
	};
	append(4);
	expect(
		(await page("turns", { cursor: resumed.turnsBackwardsCursor, sortDirection: "asc" })).data.map(row => row.id),
	).toEqual(["history-turn-3", "history-turn-4"]);
	expect((await page("items", { cursor: resumed.itemsBackwardsCursor })).data.map(row => row.item.id)).toEqual([
		"history-item-8",
		"history-item-9",
		"history-item-10",
		"history-item-11",
	]);
});

test("read-only request identities can be reused without returning stale history or consuming mutation dedup capacity", async () => {
	const { remote, append, page } = fixture();
	const read = () =>
		remote.call("read", "thread/read", { threadId: "history", includeTurns: true }) as Promise<{
			thread: { turns: unknown[] };
		}>;
	expect((await read()).thread.turns).toHaveLength(3);
	append(4);
	expect((await read()).thread.turns).toHaveLength(4);
	for (let i = 0; i < 4100; i++) await page("turns", { itemsView: "notLoaded" });
	expect((await read()).thread.turns).toHaveLength(4);
});
