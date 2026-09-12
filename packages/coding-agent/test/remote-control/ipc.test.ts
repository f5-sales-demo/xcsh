import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectPeer, listenLocal } from "../../src/remote-control/ipc";

test("private Unix socket round trip and disconnect reject pending requests", async () => {
	const dir = await mkdtemp(join(tmpdir(), "xcsh-remote-test-"));
	const path = join(dir, "host.sock");
	const server = await listenLocal(path, peer => {
		peer.handle = async (method, params) => (method === "echo" ? params : new Promise(() => {}));
	});
	const peer = await connectPeer(path);
	try {
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(await peer.call("echo", { text: "fixture" })).toEqual({ text: "fixture" });
		const pending = peer.call("wait", {});
		peer.close();
		await expect(pending).rejects.toThrow("Local remote connection closed");
	} finally {
		peer.close();
		await new Promise<void>(resolve => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	}
});
