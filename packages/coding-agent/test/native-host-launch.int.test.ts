/**
 * Integration test: the REAL Chrome launch seam.
 *
 * `native-host.int.test.ts` proves the relay by running `bun src/cli.ts
 * chrome-host` directly — but that BYPASSES the manifest, which is exactly the
 * seam that was broken (Chrome can't select a subcommand, and ignores `args`).
 *
 * This test installs the manifest+wrapper via the real `installNativeHost`, then
 * LAUNCHES the host the way Chrome does: it execs the manifest's `path` (the
 * generated wrapper) with the calling extension's origin as argv — NOT by naming
 * `chrome-host`. It then writes an NM `provision` frame to stdin and asserts the
 * manager control socket APPEARS, proving the wrapper actually reached the relay
 * which ensured the manager. This fails if `path` points at the bare binary.
 */
import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { encodeNm } from "../src/browser/native-messaging";
import { nativeHostLaunchCommand } from "../src/cli/chrome-cli";
import { installNativeHost } from "../src/services/native-host-install";

let host: import("bun").Subprocess | undefined;
let dir = "";
let sock = "";

async function pgrep(...args: string[]): Promise<number[]> {
	try {
		const out = await new Response(Bun.spawn(["pgrep", ...args]).stdout).text();
		return out
			.trim()
			.split("\n")
			.map(s => Number(s.trim()))
			.filter(n => Number.isInteger(n) && n > 0 && n !== process.pid);
	} catch {
		return [];
	}
}

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
	// The manager is DETACHED and its worker blocks forever; discover both via the
	// temp socket and reap them (mirrors native-host.int.test.ts).
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

test("Chrome-style launch of the installed wrapper reaches the relay and ensures the manager", async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-nmh-launch-"));
	const home = path.join(dir, "home");
	sock = path.join(dir, "manager.sock");

	// Resolve the DEV launch prefix (bun + abs entry script) deterministically —
	// force resolveXcshBin to null so we exercise the `bun src/cli.ts` fallback
	// regardless of whether a compiled `xcsh` happens to be on PATH.
	const launchCommand = nativeHostLaunchCommand(
		[process.execPath, path.resolve("src/cli.ts")],
		process.execPath,
		() => null,
	);
	const manifestPath = installNativeHost({
		launchCommand,
		extensionIds: ["klajkjdoehjidngligegnpknogmjjhkc"],
		home,
		platform: process.platform,
	});
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { path: string };

	// Launch EXACTLY as Chrome does: exec the manifest `path` (the wrapper) with
	// the calling extension origin as the first argument — never naming chrome-host.
	host = Bun.spawn([manifest.path, "chrome-extension://klajkjdoehjidngligegnpknogmjjhkc/"], {
		cwd: process.cwd(),
		env: { ...process.env, XCSH_MANAGER_SOCK: sock },
		stdin: "pipe",
		stdout: "ignore",
		stderr: "ignore",
	});

	const stdin = host.stdin as import("bun").FileSink;
	stdin.write(encodeNm({ type: "provision", tenantKey: "example-corp|staging" }));
	stdin.flush();

	let up = false;
	for (let i = 0; i < 50; i++) {
		if (fs.existsSync(sock)) {
			up = true;
			break;
		}
		await Bun.sleep(100);
	}
	expect(up).toBe(true); // wrapper → chrome-host → ensured manager (real Chrome path)
}, 30_000);
