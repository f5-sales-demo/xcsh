import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteRouter } from "../../src/remote-control/router";

test("phone reads bounded workspace file bytes while outside paths remain denied", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-file-read-"));
	const router = new RemoteRouter(join(root, "agent"), "fixture");
	router.registerSession("primary", {
		thread: { id: "primary", cwd: root, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	await router.handle("phone", {
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "fixture", version: "1" } },
	});
	const call = (path: string) => router.handle("phone", { id: 2, method: "fs/readFile", params: { path } });
	try {
		const bytes = Buffer.from([0, 255, 10, 65]);
		await writeFile(join(root, "file"), bytes);
		expect(await call(join(root, "file"))).toEqual({ id: 2, result: { dataBase64: bytes.toString("base64") } });
		expect(await call("/etc/passwd")).toMatchObject({ error: { code: -32602 } });
		await symlink("/etc/passwd", join(root, "escape"));
		expect(await call(join(root, "escape"))).toMatchObject({ error: { code: -32602 } });
		expect(await call(root)).toHaveProperty("error");
		await writeFile(join(root, "large"), Buffer.alloc(2 * 1024 * 1024 + 1));
		expect(await call(join(root, "large"))).toHaveProperty("error");
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
