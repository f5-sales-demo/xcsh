import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import Ajv from "ajv";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";
import type { Notification } from "../../src/remote-control/session";

import closedSchema from "./fixtures/ThreadClosedNotification.json";

const validClosed = new Ajv({ strict: false }).compile(closedSchema);
const question = {
	id: "question-a",
	method: "item/tool/requestUserInput",
	params: { threadId: "thread-a", turnId: "turn-a", itemId: "item-a", questions: [] },
};
async function fixture() {
	const dir = await mkdtemp("/tmp/xcsh-interaction-teardown-");
	const host = await startLocalHost(`${dir}/host.sock`, "fixture");
	const owner = await connectPeer(`${dir}/host.sock`);
	const phone = await connectPeer(`${dir}/host.sock`);
	const events: Notification[] = [];
	const calls: unknown[] = [];
	owner.handle = async (_method, params) => {
		calls.push(params);
		return {};
	};
	phone.handle = async (_method, params) => {
		events.push(params.event as Notification);
		return {};
	};
	const waitFor = async (predicate: () => boolean) => {
		const deadline = Date.now() + 1000;
		while (!predicate() && Date.now() < deadline) await Bun.sleep(5);
		expect(predicate()).toBe(true);
	};
	await owner.call("register", { thread: { id: "thread-a" }, requests: [question] });
	await phone.call("protocol", {
		request: {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" }, capabilities: { experimentalApi: true } },
		},
	});
	await phone.call("protocol", { request: { id: 2, method: "thread/resume", params: { threadId: "thread-a" } } });
	await waitFor(() => events.length === 1);
	return {
		path: `${dir}/host.sock`,
		host,
		owner,
		phone,
		events,
		calls,
		waitFor,
		cleanup: async () => {
			owner.close();
			phone.close();
			await host.close();
			await rm(dir, { recursive: true, force: true });
		},
	};
}

test.each(["unregister", "disconnect", "replacement"])(
	"owner %s retires the phone question and closes its old thread",
	async operation => {
		const f = await fixture();
		try {
			if (operation === "unregister") await f.owner.call("unregister", {});
			else if (operation === "disconnect") f.owner.close();
			else await f.owner.call("register", { thread: { id: "thread-b" } });
			await f.waitFor(() => f.events.some(event => event.method === "thread/closed"));
			expect(f.events.slice(1)).toEqual([
				{ method: "serverRequest/resolved", params: { threadId: "thread-a", requestId: "question-a" } },
				{ method: "thread/closed", params: { threadId: "thread-a" } },
			]);
			expect(validClosed(f.events.at(-1)!.params), JSON.stringify(validClosed.errors)).toBe(true);
			expect(f.host.router.sessions.has("thread-a")).toBe(false);
			await f.phone.call("protocol", { request: { id: "question-a", result: { answers: {} } } });
			expect(f.calls).toHaveLength(1);
		} finally {
			await f.cleanup();
		}
	},
);

test("heartbeat snapshots recover missed opening and resolution without cancelling active questions", async () => {
	const f = await fixture();
	try {
		await f.owner.call("register", { thread: { id: "thread-a", name: "Renamed" }, requests: [question] });
		expect(f.events).toHaveLength(1);
		await f.owner.call("register", { thread: { id: "thread-a" }, requests: [] });
		await f.waitFor(() => f.events.length === 2);
		expect(f.events[1].method).toBe("serverRequest/resolved");
		const next = { ...question, id: "question-b" };
		await f.owner.call("register", { thread: { id: "thread-a" }, requests: [next] });
		await f.waitFor(() => f.events.length === 3);
		expect(f.events[2]).toEqual(next);
		expect(f.events.some(event => event.method === "thread/closed")).toBe(false);
	} finally {
		await f.cleanup();
	}
});

test("a rejected replacement preserves the current owner and its pending phone question", async () => {
	const f = await fixture();
	const other = await connectPeer(f.path);
	try {
		const second = { ...question, id: "question-b", params: { ...question.params, threadId: "thread-b" } };
		await other.call("register", { thread: { id: "thread-b" }, requests: [second] });
		await expect(
			f.owner.call("register", {
				thread: { id: "thread-c" },
				requests: [{ ...second, params: { ...second.params, threadId: "thread-c" } }],
			}),
		).rejects.toMatchObject({ code: -32602 });
		expect(f.host.router.sessions.has("thread-a")).toBe(true);
		expect(f.host.router.sessions.has("thread-b")).toBe(true);
		expect(f.host.router.sessions.has("thread-c")).toBe(false);
		await f.phone.call("protocol", { request: { id: "question-a", result: { answers: {} } } });
		expect(f.calls).toHaveLength(2);
		expect(f.events).toEqual([question]);
	} finally {
		other.close();
		await f.cleanup();
	}
});
