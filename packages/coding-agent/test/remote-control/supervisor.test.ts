import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { LifecycleStore, type ProcessIdentity } from "../../src/remote-control/lifecycle-state";
import { RemoteSupervisor } from "../../src/remote-control/supervisor";

const cleanup: string[] = [];
afterEach(async () => {
	for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
});

const processRecord = (pid: number, generation: number): ProcessIdentity => ({
	pid,
	startTime: `start-${pid}`,
	executablePath: "/opt/xcsh/bin/xcsh",
	executableSha256: "a".repeat(64),
	generation,
});

test("concurrent reconciliation starts exactly one supervisor-owned host", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-concurrent-");
	cleanup.push(root);
	let spawns = 0;
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 4,
		spawnHost: async generation => processRecord(2000 + ++spawns, generation),
		probeHost: async () => true,
		isHostAlive: async () => true,
		stopHost: async () => {},
		sleep: async () => {},
	});
	expect(await Promise.all(Array.from({ length: 12 }, () => supervisor.ensureHost()))).toEqual(
		Array.from({ length: 12 }, () => true),
	);
	expect(spawns).toBe(1);
	expect((await supervisor.status()).hostState).toBe("running");
});

test("an exited host is replaced once and increments the restart count", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-replace-");
	cleanup.push(root);
	let spawns = 0;
	let alive = true;
	let stops = 0;
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 5,
		spawnHost: async generation => processRecord(3000 + ++spawns, generation),
		probeHost: async () => true,
		isHostAlive: async () => alive,
		stopHost: async () => {
			stops++;
		},
		sleep: async () => {},
		random: () => 0,
	});
	await supervisor.ensureHost();
	alive = false;
	expect(await supervisor.checkHost()).toBe("restarted");
	expect(spawns).toBe(2);
	expect(stops).toBe(1);
	expect((await supervisor.status()).restartCount).toBe(1);
});

test("three failed health probes replace the child", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-health-");
	cleanup.push(root);
	let spawns = 0;
	const probes = [true, false, false, false, true];
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 6,
		spawnHost: async generation => processRecord(4000 + ++spawns, generation),
		probeHost: async () => probes.shift() ?? true,
		isHostAlive: async () => true,
		stopHost: async () => {},
		sleep: async () => {},
		random: () => 0,
	});
	await supervisor.ensureHost();
	expect(await supervisor.checkHost()).toBe("unhealthy");
	expect(await supervisor.checkHost()).toBe("unhealthy");
	expect(await supervisor.checkHost()).toBe("restarted");
	expect(spawns).toBe(2);
});

test("five startup failures enter a non-spawning degraded state until explicit reset", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-degraded-");
	cleanup.push(root);
	let spawns = 0;
	let healthy = false;
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 7,
		spawnHost: async generation => processRecord(5000 + ++spawns, generation),
		probeHost: async () => healthy,
		isHostAlive: async () => true,
		stopHost: async () => {},
		sleep: async () => {},
		startupTimeoutMs: 0,
	});
	for (let attempt = 0; attempt < 5; attempt++) expect(await supervisor.ensureHost()).toBe(false);
	expect((await supervisor.status()).supervisorState).toBe("degraded");
	expect(await supervisor.ensureHost()).toBe(false);
	expect(spawns).toBe(5);
	healthy = true;
	await supervisor.reset(8);
	expect(await supervisor.ensureHost()).toBe(true);
	expect(spawns).toBe(6);
	expect((await supervisor.status()).degradedReason).toBeNull();
});

test("a persisted degraded breaker stays open across supervisor replacement", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-persisted-degraded-");
	cleanup.push(root);
	let spawns = 0;
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 7,
		initialSnapshot: {
			generation: 7,
			restartCount: 5,
			supervisorState: "degraded",
			hostState: "unhealthy",
			startupManager: "systemd-user",
			degradedReason: "host process exited",
		},
		spawnHost: async generation => processRecord(5500 + ++spawns, generation),
		probeHost: async () => true,
		isHostAlive: async () => true,
		stopHost: async () => {},
		sleep: async () => {},
	});
	expect(await supervisor.ensureHost()).toBe(false);
	expect(spawns).toBe(0);
	await supervisor.reset(8);
	expect(await supervisor.ensureHost()).toBe(true);
	expect(spawns).toBe(1);
});

test("a replacement supervisor adopts only a verified surviving host", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-adopt-");
	cleanup.push(root);
	const existing = processRecord(5750, 11);
	let spawns = 0;
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 11,
		initialHost: existing,
		spawnHost: async generation => processRecord(5750 + ++spawns, generation),
		probeHost: async () => true,
		isHostAlive: async record => record === existing,
		stopHost: async () => {},
		sleep: async () => {},
	});
	expect(await supervisor.ensureHost()).toBe(true);
	expect(spawns).toBe(0);
});

test("intentional shutdown drains and leaves both processes stopped", async () => {
	const root = await mkdtemp("/tmp/xcsh-supervisor-stop-");
	cleanup.push(root);
	let stops = 0;
	const supervisor = new RemoteSupervisor({
		store: new LifecycleStore(root),
		generation: 9,
		spawnHost: async generation => processRecord(6001, generation),
		probeHost: async () => true,
		isHostAlive: async () => true,
		stopHost: async () => {
			stops++;
		},
		sleep: async () => {},
	});
	await supervisor.ensureHost();
	await supervisor.shutdown();
	expect(stops).toBe(1);
	expect(await new LifecycleStore(root).readRuntime("host")).toBeUndefined();
	expect(await supervisor.status()).toMatchObject({ supervisorState: "stopped", hostState: "stopped" });
});
