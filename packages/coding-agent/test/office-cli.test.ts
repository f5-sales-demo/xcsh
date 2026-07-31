import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OfficePaneUnavailableError } from "../src/browser/office-pane-server";
import {
	type OfficeServeDeps,
	officeWefDirs,
	removeStaleWefManifests,
	runOfficeCommand,
	startOfficeServe,
} from "../src/cli/office-cli";

/** A supersede seam that records it ran and reports nothing stale (no-op). */
function noopSupersede() {
	const calls: Array<number | undefined> = [];
	const fn: OfficeServeDeps["supersedeStaleServe"] = async port => {
		calls.push(port);
		return { superseded: false };
	};
	return { fn, calls };
}

function fakePaneServer() {
	const state = { stopped: false };
	return {
		state,
		server: {
			port: 8444,
			url: "https://127-0-0-1.local-ip.sh:8444",
			taskpaneUrl: "https://127-0-0-1.local-ip.sh:8444/taskpane.html",
			trusted: true,
			stop: () => {
				state.stopped = true;
			},
		},
	};
}

describe("startOfficeServe", () => {
	test("starts BOTH the pane server and the chat bridge; dispose tears down both", async () => {
		const pane = fakePaneServer();
		const chat = { disposed: false };
		const supersede = noopSupersede();
		const deps: OfficeServeDeps = {
			getOfficePaneDir: (async () => "/fixture/pane/dist") as OfficeServeDeps["getOfficePaneDir"],
			startOfficePaneServer: (async () => pane.server) as OfficeServeDeps["startOfficePaneServer"],
			startHeadlessChatBridge: (async () => ({
				bridge: { port: 19222, wssPort: 19322 },
				dispose: async () => {
					chat.disposed = true;
				},
			})) as unknown as OfficeServeDeps["startHeadlessChatBridge"],
			supersedeStaleServe: supersede.fn,
		};

		const handle = await startOfficeServe(deps);
		expect(handle.server).toBe(pane.server);
		expect(handle.chat).not.toBeNull();
		// A stale serve is always stepped down before binding the pane.
		expect(supersede.calls).toEqual([8444]);

		await handle.dispose();
		expect(chat.disposed).toBe(true);
		expect(pane.state.stopped).toBe(true);
	});

	test("a bridge-start failure is NON-fatal: the pane still serves (chat=null), dispose still stops the pane", async () => {
		const pane = fakePaneServer();
		const deps: OfficeServeDeps = {
			getOfficePaneDir: (async () => "/fixture/pane/dist") as OfficeServeDeps["getOfficePaneDir"],
			startOfficePaneServer: (async () => pane.server) as OfficeServeDeps["startOfficePaneServer"],
			startHeadlessChatBridge: (async () => {
				throw new Error("bridge boom");
			}) as unknown as OfficeServeDeps["startHeadlessChatBridge"],
			supersedeStaleServe: noopSupersede().fn,
		};

		const handle = await startOfficeServe(deps);
		expect(handle.server).toBe(pane.server);
		expect(handle.chat).toBeNull();

		await handle.dispose();
		expect(pane.state.stopped).toBe(true);
	});

	test("a supersede failure (foreign holder on :8444) propagates — serve does NOT bind over a stranger", async () => {
		const pane = fakePaneServer();
		let paneStarted = false;
		const deps: OfficeServeDeps = {
			getOfficePaneDir: (async () => "/fixture/pane/dist") as OfficeServeDeps["getOfficePaneDir"],
			startOfficePaneServer: (async () => {
				paneStarted = true;
				return pane.server;
			}) as OfficeServeDeps["startOfficePaneServer"],
			startHeadlessChatBridge: (async () => ({
				bridge: { port: 19222, wssPort: 19322 },
				dispose: async () => {},
			})) as unknown as OfficeServeDeps["startHeadlessChatBridge"],
			supersedeStaleServe: (async () => {
				throw new Error("Port 8444 is held by PID 4321, which isn't an xcsh office serve.");
			}) as OfficeServeDeps["supersedeStaleServe"],
		};

		await expect(startOfficeServe(deps)).rejects.toThrow(/isn't an xcsh office serve/);
		expect(paneStarted).toBe(false);
	});

	/**
	 * Prove we can serve BEFORE killing what is already serving.
	 *
	 * `supersedeStaleServe` SIGTERMs a running `office serve` so the new one can take :8444. Checking
	 * pane availability after that means an npm-installed xcsh — which has no pane at all — stops the
	 * operator's working brew-installed pane and then exits with nothing in its place. Refusing loudly
	 * is only an improvement if it refuses before it breaks something.
	 */
	test("does not supersede a running serve when it has no pane to replace it with", async () => {
		const calls: string[] = [];
		const deps: OfficeServeDeps = {
			getOfficePaneDir: (async () => {
				throw new OfficePaneUnavailableError("no pane in this install", "packaged");
			}) as OfficeServeDeps["getOfficePaneDir"],
			supersedeStaleServe: (async () => {
				calls.push("supersede");
				return { superseded: false };
			}) as unknown as OfficeServeDeps["supersedeStaleServe"],
			startOfficePaneServer: (async () => {
				calls.push("start");
				throw new Error("unreachable");
			}) as OfficeServeDeps["startOfficePaneServer"],
			startHeadlessChatBridge: (async () => ({
				bridge: { port: 1, wssPort: 2 },
				dispose: async () => {},
			})) as unknown as OfficeServeDeps["startHeadlessChatBridge"],
		};

		await expect(startOfficeServe(deps)).rejects.toThrow(OfficePaneUnavailableError);
		expect(calls).toEqual([]);
	});
});

describe("office sideload idempotency (wef manifest cleanup)", () => {
	const ID = "6d3b8a41-2f5c-4e7a-9b0d-1c2e3f4a5b6c";
	let home = "";
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-wef-"));
	});
	afterEach(() => {
		if (home) fs.rmSync(home, { recursive: true, force: true });
	});

	test("officeWefDirs covers Excel/PowerPoint/Word wef folders under the home container store", () => {
		const dirs = officeWefDirs(home);
		expect(dirs).toHaveLength(3);
		expect(dirs.some(d => d.includes("com.microsoft.Excel"))).toBe(true);
		expect(dirs.some(d => d.includes("com.microsoft.Powerpoint"))).toBe(true);
		expect(dirs.some(d => d.includes("com.microsoft.Word"))).toBe(true);
		expect(dirs.every(d => d.endsWith(path.join("Data", "Documents", "wef")))).toBe(true);
	});

	test("removes a stale <id>.manifest.json from a container's wef and reports it", () => {
		const wef = officeWefDirs(home).find(d => d.includes("com.microsoft.Powerpoint"));
		if (!wef) throw new Error("no powerpoint wef dir");
		fs.mkdirSync(wef, { recursive: true });
		const stale = path.join(wef, `${ID}.manifest.json`);
		fs.writeFileSync(stale, "{}");

		const removed = removeStaleWefManifests(ID, home);
		expect(removed).toContain(stale);
		expect(fs.existsSync(stale)).toBe(false);
	});

	test("no-op (no throw, nothing removed) when the link and container dirs are absent", () => {
		expect(removeStaleWefManifests(ID, home)).toEqual([]);
	});

	test("leaves a DIFFERENT add-in's manifest link untouched", () => {
		const wef = officeWefDirs(home).find(d => d.includes("com.microsoft.Word"));
		if (!wef) throw new Error("no word wef dir");
		fs.mkdirSync(wef, { recursive: true });
		const other = path.join(wef, "aaaaaaaa-0000-0000-0000-000000000000.manifest.json");
		fs.writeFileSync(other, "{}");

		removeStaleWefManifests(ID, home);
		expect(fs.existsSync(other)).toBe(true);
	});
});

/**
 * `office sideload` used to REGISTER the add-in and exit. The pane's working folder —
 * which is what its file tools and shell are confined to — comes from whatever
 * `office serve` was launched from, so registering alone left the operator with a
 * pane pointed at some other directory, or none at all. Sideloading now serves too,
 * from the current folder, and blocks; `serve` remains available on its own.
 */
describe("office sideload starts the server from the current folder", () => {
	function seams() {
		const order: string[] = [];
		let releaseServe = (): void => {};
		const serveBlocked = new Promise<void>(resolve => {
			releaseServe = resolve;
		});
		return {
			order,
			releaseServe,
			deps: {
				sideload: async (app: string) => {
					order.push(`sideload:${app}`);
				},
				serve: async () => {
					order.push("serve");
					await serveBlocked;
					order.push("serve:done");
				},
			},
		};
	}

	test("registers the add-in FIRST, then serves", async () => {
		// Order matters: serve blocks forever, so registering after it would never run.
		const s = seams();
		const run = runOfficeCommand({ action: "sideload", app: "excel" }, s.deps);
		await Bun.sleep(5);
		expect(s.order).toEqual(["sideload:excel", "serve"]);
		s.releaseServe();
		await run;
		expect(s.order).toEqual(["sideload:excel", "serve", "serve:done"]);
	});

	test("blocks in serve rather than returning once the add-in is registered", async () => {
		const s = seams();
		let settled = false;
		void runOfficeCommand({ action: "sideload", app: "word" }, s.deps).then(() => {
			settled = true;
		});
		await Bun.sleep(20);
		expect(settled).toBe(false);
		s.releaseServe();
		await Bun.sleep(5);
		expect(settled).toBe(true);
	});

	test("defaults to excel when no app is given", async () => {
		const s = seams();
		const run = runOfficeCommand({ action: "sideload" }, s.deps);
		await Bun.sleep(5);
		expect(s.order[0]).toBe("sideload:excel");
		s.releaseServe();
		await run;
	});

	test("`serve` on its own still serves and does not sideload", async () => {
		const s = seams();
		const run = runOfficeCommand({ action: "serve" }, s.deps);
		await Bun.sleep(5);
		expect(s.order).toEqual(["serve"]);
		s.releaseServe();
		await run;
	});
});

/**
 * The command boundary turns an absent pane into advice, and leaves everything else alone.
 *
 * The published npm form of xcsh carries `office` with no pane bundle, so any action can legitimately
 * find nothing to work with. That is a fact about the install rather than a defect, and it earns a
 * remedy and a non-zero exit — not the uncaught ENOENT with an internal path that 19.103.3 produced.
 *
 * The second test is the important half. Catching broadly here would swallow the next real failure,
 * which is precisely how the silent 404 survived in the first place.
 */
describe("runOfficeCommand and an unavailable pane", () => {
	// Restores a NUMBER, never `undefined`. Assigning undefined to process.exitCode is a no-op in Bun,
	// so an earlier version of this helper left the 1 that runOfficeCommand sets in place — and since
	// bun test honours the process's exit code, the whole suite exited 1 while reporting "0 fail". CI
	// caught it; locally the file passed and only its status disagreed.
	const withExitCode = async (fn: () => Promise<void>): Promise<number | undefined> => {
		const before = process.exitCode ?? 0;
		process.exitCode = 0;
		try {
			await fn();
			return process.exitCode;
		} finally {
			process.exitCode = before;
		}
	};

	test("reports the remedy and exits non-zero instead of throwing", async () => {
		const said: string[] = [];
		const error = console.error;
		console.error = (...parts: unknown[]) => {
			said.push(parts.join(" "));
		};
		try {
			const code = await withExitCode(async () => {
				await runOfficeCommand(
					{ action: "serve" },
					{
						sideload: async () => {},
						serve: async () => {
							throw new OfficePaneUnavailableError("no pane here, install the binary", "packaged");
						},
					},
				);
			});
			expect(code).toBe(1);
			expect(said.join(" ")).toContain("no pane here, install the binary");
		} finally {
			console.error = error;
		}
	});

	test("rethrows anything that is not an unavailable pane", async () => {
		await expect(
			runOfficeCommand(
				{ action: "serve" },
				{
					sideload: async () => {},
					serve: async () => {
						throw new Error("a real defect, with a stack worth keeping");
					},
				},
			),
		).rejects.toThrow(/a real defect/);
	});
});
