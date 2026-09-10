import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";

test("heartbeat expiry removes a stale owner while retaining a refreshed owner", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-heartbeat-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "fixture");
	const stale = await connectPeer(path);
	const fresh = await connectPeer(path);
	let now = Date.now();
	const time = spyOn(Date, "now").mockImplementation(() => now);
	const closed = Promise.withResolvers<void>();
	stale.onClose = () => closed.resolve();
	try {
		await stale.call("register", { thread: { id: "stale" } });
		await fresh.call("register", { thread: { id: "fresh" } });
		now += 31_000;
		await fresh.call("register", { thread: { id: "fresh" } });
		await Promise.race([closed.promise, Bun.sleep(6000)]);
		expect(host.router.sessions.has("stale")).toBe(false);
		expect(host.router.sessions.has("fresh")).toBe(true);
	} finally {
		time.mockRestore();
		stale.close();
		fresh.close();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
}, 7500);

test("host registers two live owners, routes into owner socket, and removes exited sessions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-host-test-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0");
	const a = await connectPeer(path);
	const b = await connectPeer(path);
	const control = await connectPeer(path);
	a.handle = async (method, params) => ({ method, owner: "a", params });
	try {
		await a.call("register", { thread: { id: "a", name: "A", createdAt: 2, updatedAt: 1, turns: [] } });
		await b.call("register", { thread: { id: "b", name: "B", createdAt: 1, updatedAt: 1, turns: [] } });
		expect(await control.call("status", {})).toMatchObject({ liveSessions: 2 });
		const result = await host.router.sessions.get("a")?.call("r", "turn/start", { threadId: "a" });
		expect(result).toMatchObject({ owner: "a", params: { identity: "r" } });
		expect(
			await control.call("protocol", {
				request: { id: 1, method: "initialize", params: { clientInfo: { name: "fixture", version: "1" } } },
			}),
		).toMatchObject({ result: { userAgent: "xcsh/21.22.0" } });
		expect(await control.call("protocol", { request: { id: 2, method: "thread/list" } })).toMatchObject({
			result: { data: [{ id: "a" }, { id: "b" }] },
		});
		a.close();
		await Bun.sleep(10);
		expect(await control.call("status", {})).toMatchObject({ liveSessions: 1 });
	} finally {
		a.close();
		b.close();
		control.close();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("host sends standalone process exit back only to the requesting local protocol client", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-process-host-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0");
	const owner = await connectPeer(path);
	const phone = await connectPeer(path);
	const events: unknown[] = [];
	phone.handle = async (method, params) => {
		events.push({ method, params });
		return {};
	};
	try {
		await owner.call("register", { thread: { id: "fixture", cwd: dir } });
		await phone.call("protocol", {
			request: { id: 1, method: "initialize", params: { clientInfo: { name: "fixture", version: "1" } } },
		});
		expect(
			await phone.call("protocol", {
				request: {
					id: 2,
					method: "process/spawn",
					params: { processHandle: "fixture", cwd: dir, command: ["bash", "-c", "printf fixture"] },
				},
			}),
		).toMatchObject({ result: {} });
		const deadline = Date.now() + 2000;
		while (!events.length && Date.now() < deadline) await Bun.sleep(5);
		expect(events).toMatchObject([
			{
				method: "protocol/event",
				params: { event: { method: "process/exited", params: { exitCode: 0, stdout: "fixture" } } },
			},
		]);
	} finally {
		owner.close();
		phone.close();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("local phone discovery reaches all 128 owners and routes a late page to its sole executor", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-discovery-host-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "fixture");
	const owners: Awaited<ReturnType<typeof connectPeer>>[] = [];
	const phone = await connectPeer(path);
	const calls: string[] = [];
	try {
		for (let i = 0; i < 128; i++) {
			const owner = await connectPeer(path);
			owners.push(owner);
			const id = i.toString(16).padStart(16, "0");
			owner.handle = async (_method, params) => {
				calls.push(id);
				return { owner: id, method: params.method };
			};
			await owner.call("register", { thread: { id, createdAt: i, source: "cli" } });
		}
		await phone.call("protocol", {
			request: { id: 1, method: "initialize", params: { clientInfo: { name: "fixture", version: "1" } } },
		});
		const ids: string[] = [];
		let cursor: string | null = null;
		do {
			const response = (await phone.call("protocol", {
				request: { id: 2, method: "thread/list", params: { limit: 25, cursor } },
			})) as { result: { data: { id: string }[]; nextCursor: string | null } };
			ids.push(...response.result.data.map(thread => thread.id));
			cursor = response.result.nextCursor;
		} while (cursor);
		expect(ids).toHaveLength(128);
		expect(new Set(ids).size).toBe(128);
		expect(calls).toEqual([]);
		const threadId = ids[127];
		expect(
			await phone.call("protocol", {
				request: { id: 3, method: "thread/resume", params: { threadId } },
			}),
		).toMatchObject({ result: { owner: threadId, method: "thread/resume" } });
		expect(calls).toEqual([threadId]);
	} finally {
		for (const owner of owners) owner.close();
		phone.close();
		await host.close();
		await rm(dir, { recursive: true, force: true });
	}
});
