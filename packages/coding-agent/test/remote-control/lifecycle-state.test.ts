import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CrashLoopBreaker,
	drainWithDeadline,
	LifecycleStore,
	matchesProcessIdentity,
	type ProcessIdentity,
	withLifecycleLock,
} from "../../src/remote-control/lifecycle-state";
import { renderSystemdUserService, SystemdUserManager } from "../../src/remote-control/startup-manager";

const cleanup: string[] = [];
afterEach(async () => {
	for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});

const identity = (overrides: Partial<ProcessIdentity> = {}): ProcessIdentity => ({
	pid: 1200,
	startTime: "123456",
	executablePath: "/opt/xcsh/bin/xcsh",
	executableSha256: "a".repeat(64),
	generation: 7,
	...overrides,
});

test("lifecycle records are atomic, owner-only, and corrupt records recover safely", async () => {
	const root = await mkdtemp("/tmp/xcsh-lifecycle-state-");
	cleanup.push(root);
	const store = new LifecycleStore(root);
	await store.writeRuntime("supervisor", identity());
	expect(await store.readRuntime("supervisor")).toEqual(identity());
	expect((await stat(root)).mode & 0o777).toBe(0o700);
	expect((await stat(join(root, "supervisor.json"))).mode & 0o777).toBe(0o600);

	await writeFile(join(root, "host-process.json"), "not-json", { mode: 0o600 });
	expect(await store.readRuntime("host")).toBeUndefined();
	expect(await Bun.file(join(root, "host-process.json")).exists()).toBe(false);
});

test("a failed lifecycle transition restores the exact previous snapshot", async () => {
	const root = await mkdtemp("/tmp/xcsh-lifecycle-transition-");
	cleanup.push(root);
	const store = new LifecycleStore(root);
	const previous = {
		generation: 7,
		restartCount: 3,
		supervisorState: "running" as const,
		hostState: "running" as const,
		startupManager: "systemd-user" as const,
		degradedReason: null,
	};
	const next = { ...previous, generation: 8, supervisorState: "starting" as const };
	await store.writeSnapshot(previous);
	await expect(
		store.transitionSnapshot(next, async () => {
			expect(await store.readSnapshot()).toEqual(next);
			throw new Error("fixture startup failure");
		}),
	).rejects.toThrow("fixture startup failure");
	expect(await store.readSnapshot()).toEqual(previous);
});

test("stale, reused, and executable-mismatched PIDs never match a recorded process", () => {
	const record = identity();
	expect(matchesProcessIdentity(record, identity())).toBe(true);
	expect(matchesProcessIdentity(record, undefined)).toBe(false);
	expect(matchesProcessIdentity(record, identity({ startTime: "654321" }))).toBe(false);
	expect(matchesProcessIdentity(record, identity({ executablePath: "/tmp/other" }))).toBe(false);
	expect(matchesProcessIdentity(record, identity({ executableSha256: "b".repeat(64) }))).toBe(false);
	expect(matchesProcessIdentity(record, identity({ generation: 8 }))).toBe(false);
});

test("concurrent lifecycle commands serialize through one owner-only lock", async () => {
	const root = await mkdtemp("/tmp/xcsh-lifecycle-lock-");
	cleanup.push(root);
	let active = 0;
	let maximum = 0;
	let completed = 0;
	await Promise.all(
		Array.from({ length: 16 }, () =>
			withLifecycleLock(root, async () => {
				maximum = Math.max(maximum, ++active);
				await Bun.sleep(2);
				active--;
				completed++;
			}),
		),
	);
	expect(maximum).toBe(1);
	expect(completed).toBe(16);
});

test("an old corrupt owner record cannot permanently wedge the lifecycle lock", async () => {
	const root = await mkdtemp("/tmp/xcsh-lifecycle-corrupt-lock-");
	cleanup.push(root);
	const lock = join(root, "lifecycle.lock");
	await mkdir(lock, { mode: 0o700 });
	await writeFile(join(lock, "owner.json"), "not-json", { mode: 0o600 });
	const old = new Date(Date.now() - 10_000);
	await utimes(lock, old, old);
	expect(await withLifecycleLock(root, async () => "recovered", 250)).toBe("recovered");
});

test("five failures in five minutes open the breaker until an explicit reset", () => {
	let now = 1_000;
	const breaker = new CrashLoopBreaker(() => now);
	for (let attempt = 0; attempt < 4; attempt++) {
		expect(breaker.recordFailure(`failure-${attempt}`)).toBe(false);
		now += 1_000;
	}
	expect(breaker.recordFailure("failure-4")).toBe(true);
	expect(breaker.degradedReason).toBe("failure-4");
	breaker.recordHealthy();
	expect(breaker.isOpen).toBe(true);
	breaker.reset();
	expect(breaker.isOpen).toBe(false);
	expect(breaker.degradedReason).toBeNull();
});

test("graceful drain waits for work and force termination is bounded", async () => {
	let pending = 1;
	let forced = 0;
	setTimeout(() => {
		pending = 0;
	}, 10);
	expect(
		await drainWithDeadline(
			() => pending,
			async () => {
				forced++;
			},
			100,
			2,
		),
	).toBe("drained");
	expect(forced).toBe(0);

	pending = 1;
	expect(
		await drainWithDeadline(
			() => pending,
			async () => {
				forced++;
			},
			5,
			1,
		),
	).toBe("forced");
	expect(forced).toBe(1);
});

test("the systemd user service contains no credentials and restarts only the supervisor", () => {
	const unit = renderSystemdUserService({
		executablePath: "/opt/xcsh/bin/xcsh",
		arguments: ["remote-control", "supervisor"],
	});
	expect(unit).toContain("ExecStart=/opt/xcsh/bin/xcsh remote-control supervisor");
	expect(unit).toContain("Restart=on-failure");
	expect(unit).toContain("KillMode=mixed");
	expect(unit).toContain("TimeoutStopSec=85s");
	expect(unit).toContain("WantedBy=default.target");
	expect(unit).not.toContain("token");
	expect(unit).not.toContain("credential");
});

test("systemd reconciliation enables reboot startup and intentional disable persists", async () => {
	const config = await mkdtemp("/tmp/xcsh-systemd-user-");
	cleanup.push(config);
	const commands: string[][] = [];
	const manager = new SystemdUserManager(config, "/opt/xcsh/bin/xcsh", [], async args => {
		commands.push(args);
		return { code: 0, stdout: "" };
	});
	await manager.enable();
	expect(commands).toEqual([["daemon-reload"], ["enable", "--now", "xcsh-remote-control.service"]]);
	expect(await readFile(manager.unitPath, "utf8")).toContain("ExecStart=/opt/xcsh/bin/xcsh remote-control supervisor");
	expect((await stat(manager.unitPath)).mode & 0o777).toBe(0o600);
	await manager.restart();
	expect(commands.slice(-3)).toEqual([
		["daemon-reload"],
		["enable", "xcsh-remote-control.service"],
		["restart", "xcsh-remote-control.service"],
	]);
	await manager.disable();
	expect(commands.at(-1)).toEqual(["disable", "--now", "xcsh-remote-control.service"]);
});
