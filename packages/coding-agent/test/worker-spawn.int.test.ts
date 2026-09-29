/**
 * Integration test: `xcsh worker` headless mode.
 *
 * Spawns a REAL worker subprocess (`bun src/cli.ts worker`), waits for its
 * extension bridge to bind the forced `XCSH_BRIDGE_PORT`, then performs the
 * `hello` / `hello_ack` handshake over a real WebSocket. The worker starts the
 * bridge WITH origin checking (mirroring main.ts), so the probe presents the
 * extension's `Origin` header — imported from the same source as the worker's
 * check so the two never drift.
 *
 * The load-bearing assertion is that a CONTEXTLESS worker still advertises its
 * tenant in `hello_ack`, derived from `XCSH_SESSION_TENANT` (`tenant|env`).
 */
import { afterEach, expect, test } from "bun:test";
import { CODING_AGENT_CLI } from "./helpers/cli-process";
import { contextlessCliFixture } from "./helpers/contextless-cli";
import { spawnWorkerProcess } from "./helpers/worker-process";

const contextless = contextlessCliFixture();

const workers: Awaited<ReturnType<typeof spawnWorkerProcess>>[] = [];
afterEach(async () => {
	await Promise.all(workers.splice(0).map(worker => worker.stop()));
});

async function startWorker(sessionId: string) {
	const worker = await spawnWorkerProcess([process.execPath, "--no-env-file", CODING_AGENT_CLI, "worker"], {
		cwd: contextless.cwd,
		env: {
			...process.env,
			...contextless.env,
			XCSH_BROWSER_PROVIDER: "extension",
			XCSH_SESSION_TENANT: "example-corp|staging",
			XCSH_SESSION_ID: sessionId,
			XCSH_API_URL: "",
		},
	});
	workers.push(worker);
	return worker;
}

test("xcsh worker binds the forced port and advertises its tenant via hello_ack", async () => {
	const worker = await startWorker("tab-probe");
	const ack = await worker.ready();

	expect(ack.type).toBe("hello_ack");
	// Contextless worker: tenant echoed from XCSH_SESSION_TENANT-derived session info.
	expect(ack.tenant).toBe("example-corp");
	// Worker echoes XCSH_SESSION_ID so the extension can correlate it to the provisioned tab.
	expect(ack.sessionId).toBe("tab-probe");
	// A contextless worker has no active context, so contextBound is false.
	expect(ack.contextBound).toBe(false);
}, 30_000);

test("concurrent contextless workers advertise their own sessions on independent ports", async () => {
	const pair = await Promise.all([startWorker("tab-first"), startWorker("tab-second")]);
	expect(pair[0].port).not.toBe(pair[1].port);
	const acknowledgments = await Promise.all(pair.map(worker => worker.ready()));
	for (const [index, ack] of acknowledgments.entries()) {
		expect(ack).toMatchObject({
			type: "hello_ack",
			tenant: "example-corp",
			contextBound: false,
			sessionId: index === 0 ? "tab-first" : "tab-second",
		});
	}
}, 30_000);
