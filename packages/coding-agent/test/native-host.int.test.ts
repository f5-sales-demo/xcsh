/**
 * Integration test: `xcsh chrome-host` native-messaging relay.
 *
 * Chrome launches `chrome-host` as its native-messaging host. Before relaying it
 * must ENSURE a detached `xcsh manager` is running: if the manager control socket
 * is absent/unreachable it spawns one (detached, long-lived) and connects. This
 * test spawns the host with a temp `XCSH_MANAGER_SOCK`, writes an NM-encoded
 * `provision` frame to its stdin, and asserts the manager socket APPEARS — proof
 * the host auto-spawned the manager.
 *
 * The spawned manager is DETACHED (it outlives the host on purpose), so killing
 * the host does NOT reap it. afterEach discovers the manager via `lsof` on the
 * temp socket and kills it, then removes the temp dir.
 */
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { encodeNm } from "../src/browser/native-messaging";

let host: import("bun").Subprocess | undefined;
let dir = "";
let sock = "";

/** PIDs from `pgrep <args>`. Excludes this test process. */
async function pgrep(...args: string[]): Promise<number[]> {
	try {
		const out = await new Response(Bun.spawn(["pgrep", ...args]).stdout).text();
		return out
			.trim()
			.split("\n")
			.map(s => Number(s.trim()))
			.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid);
	} catch {
		return []; // pgrep unavailable / no match
	}
}

/** PIDs holding the temp unix socket open (the detached manager). */
async function managerPids(target: string): Promise<number[]> {
	try {
		const out = await new Response(Bun.spawn(["lsof", "-t", target]).stdout).text();
		return out
			.trim()
			.split("\n")
			.map(s => Number(s.trim()))
			.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid);
	} catch {
		return [];
	}
}

function killPid(pid: number): void {
	try {
		process.kill(pid);
	} catch {
		/* already gone */
	}
}

afterEach(async () => {
	host?.kill();
	host = undefined;
	// The manager is DETACHED; killing the host doesn't reap it, and killing the
	// manager doesn't reap the worker it spawned. The worker blocks forever, so it
	// stays a LIVE CHILD of the manager until we kill the manager — poll the manager
	// for that child (cheap pgrep, no port scan), kill the worker, then the manager.
	// The socket-appears assertion can win BEFORE the worker is spawned, so poll
	// briefly; the manager is about to die and won't respawn, so this is race-free.
	if (sock && fs.existsSync(sock)) {
		const mgrs = await managerPids(sock);
		for (let i = 0; i < 100; i++) {
			const workers = (await Promise.all(mgrs.map(m => pgrep("-P", String(m))))).flat();
			if (workers.length > 0) {
				for (const w of workers) killPid(w);
				break;
			}
			await Bun.sleep(100);
		}
		for (const m of mgrs) killPid(m);
	}
	if (dir) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
	dir = "";
	sock = "";
}, 30_000);

test("chrome-host ensures the manager and relays a provision frame", async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-nmh-"));
	sock = path.join(dir, "manager.sock");
	host = Bun.spawn(["bun", "src/cli.ts", "chrome-host"], {
		cwd: process.cwd(),
		env: { ...process.env, XCSH_MANAGER_SOCK: sock },
		stdin: "pipe",
		stdout: "ignore",
		stderr: "ignore",
	});

	const stdin = host.stdin as import("bun").FileSink;
	stdin.write(encodeNm({ type: "provision", sessionId: "tab-1", tenant: "example-corp" }));
	stdin.flush();

	let up = false;
	for (let i = 0; i < 50; i++) {
		if (fs.existsSync(sock)) {
			up = true;
			break;
		}
		await Bun.sleep(100);
	}
	expect(up).toBe(true); // manager auto-spawned by the host
}, 30_000);
