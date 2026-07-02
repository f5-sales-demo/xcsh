/**
 * Integration test: `xcsh manager` control-socket server.
 *
 * Spawns a REAL manager subprocess (`bun src/cli.ts manager`) with a temp unix
 * control socket, sends a `provision` NDJSON frame over that socket, then proves
 * the manager spawned a REAL `xcsh worker` by probing the bridge port range for a
 * `hello_ack` advertising the provisioned tenant. Finally sends `release` and
 * proves the worker is reaped (the port goes silent).
 *
 * The worker's tenant advertisement flows: manager → XCSH_SESSION_TENANT env →
 * worker's contextless `sessionInfoForWorker()` → `hello_ack.tenant`.
 */
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { probe } from "./helpers/bridge-probe";

let mgr: import("bun").Subprocess | undefined;
let sock = "";

afterEach(() => {
	mgr?.kill();
	mgr = undefined;
	if (sock) {
		try {
			fs.rmSync(sock, { force: true });
		} catch {
			/* best effort */
		}
	}
});

/** Send one NDJSON control frame over the manager's unix socket. */
async function send(msg: unknown): Promise<void> {
	const c = await Bun.connect({ unix: sock, socket: { data() {} } });
	c.write(`${JSON.stringify(msg)}\n`);
	await Bun.sleep(50);
	c.end();
}

// Workers are assigned the LOWEST free range port (19222 up); the T4 worker test
// pins 19239, so polling the low end of the range avoids colliding with it.
const RANGE = [19222, 19223, 19224, 19225];

/** Poll the range for a hello_ack advertising `tenant`. */
async function findTenant(tenant: string, tries: number): Promise<number | null> {
	for (let i = 0; i < tries; i++) {
		for (const p of RANGE) {
			try {
				const ack = await probe(p);
				if (ack.tenant === tenant) return p;
			} catch {
				/* worker not up yet on this port */
			}
		}
		await Bun.sleep(250);
	}
	return null;
}

test("provision spawns a worker advertising the tenant; release reaps it", async () => {
	sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-mgr-")), "manager.sock");
	mgr = Bun.spawn(["bun", "src/cli.ts", "manager"], {
		cwd: process.cwd(),
		env: { ...process.env, XCSH_MANAGER_SOCK: sock },
		stdout: "ignore",
		stderr: "ignore",
	});

	// Wait for the manager to bind its control socket.
	for (let i = 0; i < 60 && !fs.existsSync(sock); i++) await Bun.sleep(100);
	expect(fs.existsSync(sock)).toBe(true);

	await send({ type: "provision", tenantKey: "acme|staging" });

	const port = await findTenant("acme", 80);
	expect(port).not.toBeNull();

	// Release should reap the worker: the port stops answering the handshake.
	await send({ type: "release", tenantKey: "acme|staging" });
	let stillUp = true;
	for (let i = 0; i < 40; i++) {
		try {
			await probe(port as number);
		} catch {
			stillUp = false;
			break;
		}
		await Bun.sleep(250);
	}
	expect(stillUp).toBe(false);
}, 60_000);
