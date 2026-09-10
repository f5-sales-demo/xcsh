import { afterEach, expect, test } from "bun:test";
import type { AssistantMessage } from "@f5-sales-demo/pi-ai";
import Ajv from "ajv";
import { RemoteRouter } from "../../src/remote-control/router";
import { RemoteSession, type SessionTarget } from "../../src/remote-control/session";
import { SessionManager } from "../../src/session/session-manager";
import wireShapes from "./fixtures/codex-0.153.4-timeline-wire-shapes.json";
import schema from "./fixtures/ThreadTimelineListResponse.json";

const sessions: RemoteSession[] = [];
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
});
interface Row {
	type: string;
	position: number;
	turnId?: string;
	item?: Record<string, unknown>;
}
interface Page {
	data: Row[];
	nextCursor: string | null;
	activeRealtimeSessionAtPageStart: string | null;
}
function fixture(id = "timeline", manager = SessionManager.inMemory("/tmp/timeline")) {
	const remote = new RemoteSession({
		sessionId: id,
		messages: [],
		sessionManager: manager,
		subscribe: () => () => {},
	} as unknown as SessionTarget);
	sessions.push(remote);
	const page = (params: Record<string, unknown> = {}) =>
		remote.call("reusable-read", "thread/timeline/list", { threadId: id, ...params }) as Promise<Page>;
	const voice = (item: unknown) => manager.appendCustomEntry("remote-realtime", { kind: "voiceTimeline", item });
	const assistant = (text: string | string[]) =>
		manager.appendMessage({
			role: "assistant",
			content: (typeof text === "string" ? [text] : text).map(text => ({ type: "text", text })),
			api: "openai-responses",
			model: "fixture",
			provider: "openai-codex",
			stopReason: "stop",
			timestamp: Date.now(),
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		} as AssistantMessage);
	return { remote, manager, page, voice, assistant };
}
function mixed() {
	const f = fixture();
	f.manager.appendCustomEntry("remote-history", { kind: "turnStarted", id: "turn-one", startedAtMs: 1000 });
	f.manager.appendMessage({ role: "user", content: "work", timestamp: 1000 });
	f.voice({ type: "realtimeSessionStarted", id: "voice-start", realtimeSessionId: "voice-one" });
	f.voice({
		type: "transcriptSegment",
		id: "voice-transcript",
		realtimeSessionId: "voice-one",
		role: "user",
		text: "spoken request",
	});
	const agentId = f.assistant("progress");
	f.voice({
		type: "bemItemPromoted",
		id: "voice-promotion",
		realtimeSessionId: "voice-one",
		turnId: "turn-one",
		itemId: `timeline-item-${agentId}:0`,
		presentation: { type: "inlineMarkdown" },
	});
	f.assistant("result");
	f.voice({ type: "realtimeSessionClosed", id: "voice-end", realtimeSessionId: "voice-one", outcome: "ended" });
	f.manager.appendCustomEntry("remote-history", {
		kind: "turnCompleted",
		id: "turn-one",
		status: "completed",
		completedAtMs: 3000,
	});
	return f;
}

test("pinned timeline pages newest-first but returns each page in chronological order with opening voice state", async () => {
	const f = mixed();
	expect(f.remote.thread().historyMode).toBe("paginated");
	const latest = await f.page({ limit: 3 });
	expect(latest.data.map(row => row.position)).toEqual([7, 8, 9]);
	expect(latest.activeRealtimeSessionAtPageStart).toBe("voice-one");
	const older = await f.page({ limit: 3, cursor: latest.nextCursor });
	expect(older.data.map(row => row.position)).toEqual([4, 5, 6]);
	expect(older.activeRealtimeSessionAtPageStart).toBe("voice-one");
	const oldest = await f.page({ limit: 3, cursor: older.nextCursor });
	expect(oldest.data.map(row => row.position)).toEqual([1, 2, 3]);
	expect(oldest.activeRealtimeSessionAtPageStart).toBeNull();
	expect(oldest.nextCursor).toBeNull();
	const all = await f.page({ limit: 100 });
	expect([...oldest.data, ...older.data, ...latest.data]).toEqual(all.data);
	// The pinned experimental export misses serde(rename_all_fields) on these
	// variants. Keep the original fixture intact; observed wire keys are camelCase.
	const corrected = structuredClone(schema);
	for (const variant of [
		...corrected.definitions.ThreadTimelineEntry.oneOf,
		...corrected.definitions.ThreadRealtimeItem.oneOf,
	]) {
		const properties = variant.properties as Record<string, unknown>;
		for (const [from, to] of Object.entries({
			turn_id: "turnId",
			started_at: "startedAt",
			completed_at: "completedAt",
			duration_ms: "durationMs",
			item_id: "itemId",
		})) {
			if (!(from in properties)) continue;
			properties[to] = properties[from];
			delete properties[from];
			const required = variant.required as string[];
			const index = required.indexOf(from);
			if (index >= 0) required[index] = to;
		}
	}
	for (const row of all.data) {
		const observed = wireShapes.shapes[row.type as keyof typeof wireShapes.shapes];
		if (observed) expect(Object.keys(row).sort()).toEqual(observed[0]);
	}
	const validate = new Ajv({ strict: false, validateFormats: false }).compile(corrected);
	expect(validate(all), JSON.stringify(validate.errors)).toBe(true);
	expect(all.data.filter(row => row.type === "item").map(row => row.item)).toEqual(f.remote.history()[0].items);
	expect(all.data.at(-1)).toMatchObject({
		type: "turnCompleted",
		status: "completed",
		startedAt: 1,
		completedAt: 3,
		durationMs: 2000,
	});
});

test("replayed voice facts update their original position without duplicating the timeline", async () => {
	const f = fixture();
	f.voice({ type: "realtimeSessionStarted", id: "start", realtimeSessionId: "voice" });
	f.voice({ type: "transcriptSegment", id: "text", realtimeSessionId: "voice", role: "user", text: "first" });
	f.voice({ type: "transcriptSegment", id: "text", realtimeSessionId: "voice", role: "user", text: "corrected" });
	const page = await f.page();
	expect(page.data).toHaveLength(2);
	expect(page.data[1]).toMatchObject({ position: 2, item: { id: "text", text: "corrected" } });
});

test("invalid stored voice facts return a sanitized error and extra fields are not forwarded", async () => {
	const f = fixture();
	const initial = f.voice({
		type: "realtimeSessionStarted",
		id: "start",
		realtimeSessionId: "voice",
		privateExtra: "fixture-only",
	});
	expect(JSON.stringify(await f.page())).not.toContain("privateExtra");
	for (const item of [
		null,
		[],
		42,
		{ type: "transcriptSegment", id: "text", realtimeSessionId: "voice", role: "invalid", text: "fixture-only" },
		{ type: "realtimeSessionClosed", id: "end", realtimeSessionId: "voice", outcome: "invalid" },
		{
			type: "bemItemPromoted",
			id: "promotion",
			realtimeSessionId: "voice",
			turnId: "t",
			itemId: "i",
			presentation: { type: "inlineVisualization", index: -1 },
		},
	]) {
		f.manager.branch(initial);
		f.voice(item);
		await expect(f.page()).rejects.toMatchObject({ code: -32000, message: "Invalid stored realtime history" });
	}
});

test("single-entry pages preserve boundaries and multiple items at shared positions", async () => {
	const f = fixture();
	f.manager.appendMessage({ role: "user", content: "legacy prompt", timestamp: 1000 });
	f.assistant(["first block", "second block"]);
	const all = await f.page({ limit: 100 });
	expect(all.data.map(row => row.type)).toEqual(["turnStarted", "item", "item", "item", "turnCompleted"]);
	const paged: Row[] = [];
	let cursor: string | null = null;
	do {
		const page = await f.page({ limit: 1, cursor });
		expect(page.data).toHaveLength(1);
		paged.unshift(...page.data);
		cursor = page.nextCursor;
	} while (cursor !== null);
	expect(paged).toEqual(all.data);
	expect(new Set(all.data.map(row => row.position)).size).toBe(2);
});

test("a branch's opening voice state excludes closure on an unselected sibling", async () => {
	const f = mixed();
	const beforeClose = f.manager.getBranch()[6].id;
	f.manager.branch(beforeClose);
	f.assistant("branch result");
	const latest = await f.page({ limit: 1 });
	expect(latest.activeRealtimeSessionAtPageStart).toBe("voice-one");
	expect(JSON.stringify(await f.page({ limit: 100 }))).not.toContain("voice-end");
	const resumed = fixture("timeline", f.manager);
	expect(await resumed.page({ limit: 1 })).toEqual(latest);
});

test("timeline cursors remain stable through appends and compaction, and reject other threads or lost branch anchors", async () => {
	const f = mixed();
	const first = await f.page({ limit: 2 });
	const older = await f.page({ limit: 2, cursor: first.nextCursor });
	f.manager.appendCompaction("summary", undefined, f.manager.getBranch()[1].id, 10000);
	f.voice({ type: "realtimeSessionStarted", id: "next-start", realtimeSessionId: "voice-two" });
	expect(await f.page({ limit: 2, cursor: first.nextCursor })).toEqual(older);
	expect((await f.page({ limit: 1 })).data[0].item?.id).toBe("next-start");
	await expect(fixture("other").page({ cursor: first.nextCursor })).rejects.toMatchObject({ code: -32600 });
	f.manager.branch(f.manager.getBranch()[0].id);
	await expect(f.page({ cursor: first.nextCursor })).rejects.toMatchObject({ code: -32600 });
});

test("voice-only history stays separate from ordinary turns and reports empty/page-start state correctly", async () => {
	const f = fixture();
	expect(await f.page()).toEqual({ data: [], nextCursor: null, activeRealtimeSessionAtPageStart: null });
	f.voice({ type: "realtimeSessionStarted", id: "start", realtimeSessionId: "voice" });
	f.voice({ type: "transcriptSegment", id: "text", realtimeSessionId: "voice", role: "assistant", text: "hello" });
	f.voice({ type: "realtimeSessionClosed", id: "end", realtimeSessionId: "voice", outcome: "ended" });
	expect(f.remote.history()).toEqual([]);
	expect((await f.page({ limit: 1 })).activeRealtimeSessionAtPageStart).toBe("voice");
	f.manager.appendCustomEntry("remote-history", { kind: "turnStarted", id: "after", startedAtMs: 5000 });
	expect((await f.page({ limit: 1 })).activeRealtimeSessionAtPageStart).toBeNull();
});

test("timeline input validation and pinned page-size defaults", async () => {
	const f = fixture();
	for (let i = 0; i < 110; i++)
		f.voice({
			type: "transcriptSegment",
			id: `segment-${i}`,
			realtimeSessionId: "voice",
			role: "user",
			text: "fixture",
		});
	expect((await f.page()).data).toHaveLength(25);
	expect((await f.page({ limit: 0 })).data).toHaveLength(1);
	expect((await f.page({ limit: 1000 })).data).toHaveLength(100);
	for (const limit of [-1, 1.5, false, "2", 4294967296])
		await expect(f.page({ limit })).rejects.toMatchObject({ code: -32602 });
	for (const cursor of ["invalid", "{}", "null", [], 1, "x".repeat(9000)])
		await expect(f.page({ cursor })).rejects.toMatchObject({ code: -32600 });
});

test("timeline routing requires experimental capability on the requesting connection", async () => {
	const f = mixed();
	const router = new RemoteRouter("/tmp", "fixture");
	router.sessions.set("timeline", { thread: f.remote.thread(), call: (...args) => f.remote.call(...args) });
	try {
		for (const client of ["stable", "experimental"])
			await router.handle(client, {
				id: 1,
				method: "initialize",
				params: {
					clientInfo: { name: client, version: "1" },
					capabilities: { experimentalApi: client === "experimental" },
				},
			});
		const input = { id: 2, method: "thread/timeline/list", params: { threadId: "timeline", limit: 1 } };
		expect(await router.handle("stable", input)).toMatchObject({ error: { code: -32600 } });
		expect(await router.handle("experimental", input)).toMatchObject({
			result: { data: [{ type: "turnCompleted" }] },
		});
		router.close("experimental");
		await router.handle("experimental", {
			id: 3,
			method: "initialize",
			params: { clientInfo: { name: "rejoined", version: "1" } },
		});
		expect(await router.handle("experimental", input)).toMatchObject({ error: { code: -32600 } });
	} finally {
		router.dispose();
	}
});
