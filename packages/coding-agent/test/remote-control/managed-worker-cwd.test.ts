import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManagedRemoteSessions } from "../../src/remote-control/managed-sessions";

test("a real managed child starts in its declared workspace before reading workspace configuration", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-worker-cwd-"));
	const workspace = join(root, "workspace");
	const { mkdir } = await import("node:fs/promises");
	await mkdir(workspace);
	await writeFile(join(workspace, "workspace-setting.txt"), "workspace-environment");
	const modulePath = join(import.meta.dir, "../../src/remote-control/managed-worker.ts");
	const script = join(root, "worker-fixture.ts");
	await writeFile(
		script,
		`
import { startManagedSessionWorker } from ${JSON.stringify(modulePath)};
import { join } from "node:path";
const worker = await startManagedSessionWorker(process.argv.at(-1)!, {
  createRuntime: async (request) => ({
    endpoint: {
      thread: { id: "cwd-fixture", cwd: request.params.cwd, path: null, status: {type:"idle"} },
      call: async () => ({ cwd: process.cwd(), marker: await Bun.file(join(process.cwd(), "workspace-setting.txt")).text().catch(() => null) }),
    },
    close: async () => {},
  }),
});
process.once("SIGTERM", () => void worker.close());
await worker.finished;
`,
	);
	const managed = new ManagedRemoteSessions(join(root, "catalog"), workspace, {
		workerCommand: [process.execPath, script],
	});
	let id: string | undefined;
	try {
		const endpoint = await managed.start({ cwd: workspace, ephemeral: true });
		id = String(endpoint.thread.id);
		const observed = await endpoint.call("cwd-probe", "fixture/workspace", {});
		expect(observed).toEqual({ cwd: workspace, marker: "workspace-environment" });
	} finally {
		if (id) await managed.delete(id);
		await managed.close();
		const workerLog = await Bun.file(join(root, "catalog/workers.log"))
			.text()
			.catch(() => "no worker log");
		if (workerLog.trim()) console.error(workerLog);
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
