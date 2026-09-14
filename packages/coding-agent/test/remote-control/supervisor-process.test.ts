import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LifecycleStore } from "../../src/remote-control/lifecycle-state";

test("the real supervisor replaces a killed host once and an intentional disable keeps it stopped", async () => {
	const agentDir = await mkdtemp("/tmp/xcsh-supervisor-process-");
	const root = join(agentDir, "remote-control");
	await mkdir(root, { recursive: true, mode: 0o700 });
	await writeFile(
		join(root, "host.json"),
		JSON.stringify({
			enabled: true,
			name: "xcsh supervisor fixture",
			installationId: "fixture-installation",
			enrollment: {
				server_id: "fixture-server",
				environment_id: "fixture-environment",
				remote_control_token: "fixture-token",
				expires_at: "2999-01-01T00:00:00.000Z",
			},
		}),
		{ mode: 0o600 },
	);
	const environment = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
	const supervisor = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", "supervisor"], {
		cwd: join(import.meta.dir, "../.."),
		env: environment,
		stdout: "ignore",
		stderr: "ignore",
	});
	const store = new LifecycleStore(root);
	const status = async () => {
		const child = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", "status", "--json"], {
			cwd: join(import.meta.dir, "../.."),
			env: environment,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return code === 0 ? JSON.parse(stdout) : undefined;
	};
	try {
		let first = await store.readRuntime("host");
		for (let attempt = 0; !first && attempt < 200; attempt++) {
			await Bun.sleep(25);
			first = await store.readRuntime("host");
		}
		expect(first).toBeDefined();
		let running = await status();
		for (
			let attempt = 0;
			(running?.hostState !== "running" || running?.supervisorState !== "running") && attempt < 100;
			attempt++
		) {
			await Bun.sleep(25);
			running = await status();
		}
		expect(running).toMatchObject({
			enabled: true,
			supervisorState: "running",
			hostState: "running",
			generation: 1,
		});
		const contender = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", "supervisor"], {
			cwd: join(import.meta.dir, "../.."),
			env: environment,
			stdout: "ignore",
			stderr: "ignore",
		});
		expect(await contender.exited).not.toBe(0);
		expect((await store.readRuntime("supervisor"))?.pid).toBe(supervisor.pid);

		process.kill(first!.pid, "SIGKILL");
		let replacement = await store.readRuntime("host");
		for (let attempt = 0; (!replacement || replacement.pid === first!.pid) && attempt < 200; attempt++) {
			await Bun.sleep(25);
			replacement = await store.readRuntime("host");
		}
		expect(replacement).toBeDefined();
		expect(replacement?.pid).not.toBe(first!.pid);
		expect((await store.readSnapshot())?.restartCount).toBe(1);

		const disable = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", "disable", "--json"], {
			cwd: join(import.meta.dir, "../.."),
			env: environment,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await disable.exited).toBe(0);
		expect(JSON.parse(await new Response(disable.stdout).text())).toEqual({ enabled: false });
		expect(await supervisor.exited).toBe(0);
		await Bun.sleep(100);
		expect(await store.readRuntime("host")).toBeUndefined();
		expect(await status()).toMatchObject({ enabled: false, hostState: "stopped", supervisorState: "stopped" });
	} finally {
		if (supervisor.exitCode === null) supervisor.kill("SIGKILL");
		const host = await store.readRuntime("host");
		if (host) {
			try {
				process.kill(host.pid, "SIGKILL");
			} catch {}
		}
		await rm(agentDir, { recursive: true, force: true });
	}
}, 20_000);
