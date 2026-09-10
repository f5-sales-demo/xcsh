import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalHost } from "../../src/remote-control/host";
import { connectPeer } from "../../src/remote-control/ipc";

test("host registers two live owners, routes into owner socket, and removes exited sessions", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-host-test-"));
	const path = join(dir, "host.sock");
	const host = await startLocalHost(path, "21.22.0");
	const a = await connectPeer(path);
	const b = await connectPeer(path);
	const control = await connectPeer(path);
	a.handle = async (method, params) => ({ method, owner: "a", params });
	try {
		await a.call("register", { thread: { id: "a", name: "A", updatedAt: 1, turns: [] } });
		await b.call("register", { thread: { id: "b", name: "B", updatedAt: 1, turns: [] } });
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
