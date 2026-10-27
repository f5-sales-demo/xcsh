import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stopLegacyHost } from "../../src/remote-control/control";
import { connectPeer } from "../../src/remote-control/ipc";
import { LifecycleStore } from "../../src/remote-control/lifecycle-state";

test("legacy host takeover falls back to stop when drain is unsupported", async () => {
	const calls: string[] = [];
	let closed = false;
	await stopLegacyHost(
		async () =>
			({
				call: async (method: string) => {
					calls.push(method);
					if (method === "drain")
						throw Object.assign(new Error("Unsupported local host method"), { code: -32601 });
					return {};
				},
				close: () => {
					closed = true;
				},
			}) as never,
	);
	expect(calls).toEqual(["drain", "stop"]);
	expect(closed).toBe(true);
});

test("legacy host takeover does not bypass a failed supported drain", async () => {
	const calls: string[] = [];
	await stopLegacyHost(
		async () =>
			({
				call: async (method: string) => {
					calls.push(method);
					throw new Error("Drain timed out");
				},
				close: () => {},
			}) as never,
	);
	expect(calls).toEqual(["drain"]);
});

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
	const environment = {
		...process.env,
		PI_CODING_AGENT_DIR: agentDir,
		XDG_CONFIG_HOME: join(agentDir, "config"),
		XDG_RUNTIME_DIR: join(agentDir, "runtime"),
		DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(agentDir, "runtime", "bus")}`,
	};
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
}, 60_000);

test("real supervisor quiesce stops durable workers before acknowledging an enabled host shutdown", async () => {
	const agentDir = await mkdtemp("/tmp/xcsh-supervisor-quiesce-");
	const root = join(agentDir, "remote-control");
	await mkdir(root, { recursive: true, mode: 0o700 });
	await writeFile(
		join(root, "host.json"),
		JSON.stringify({
			enabled: true,
			name: "fixture",
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
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agentDir,
		XDG_CONFIG_HOME: join(agentDir, "config"),
		XDG_RUNTIME_DIR: join(agentDir, "runtime"),
		DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(agentDir, "runtime", "bus")}`,
	};
	// Shutdown qualification needs a worker, independent of ambient model discovery.
	await writeFile(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				"fixture-provider": {
					baseUrl: "http://127.0.0.1:1/v1",
					api: "openai-completions",
					auth: "none",
					models: [
						{
							id: "fixture-quiesce",
							name: "Fixture quiesce",
							reasoning: true,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128_000,
							maxTokens: 8_192,
						},
					],
				},
			},
		}),
		{ mode: 0o600 },
	);
	const cwd = join(import.meta.dir, "../..");
	const supervisor = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", "supervisor"], {
		cwd,
		env,
		stdout: "ignore",
		stderr: "ignore",
	});
	const store = new LifecycleStore(root);
	let workerPid: number | undefined;
	let peer: Awaited<ReturnType<typeof connectPeer>> | undefined;
	try {
		for (let i = 0; i < 200 && !(await store.readRuntime("host")); i++) await Bun.sleep(25);
		for (let attempt = 0; attempt < 200; attempt++) {
			try {
				peer = await connectPeer(join(root, "host.sock"));
				break;
			} catch {
				if (attempt === 199) throw new Error("Fixture host socket did not become ready");
				await Bun.sleep(25);
			}
		}
		expect(peer).toBeDefined();
		if (!peer) throw new Error("Fixture host socket is unavailable");
		peer.handle = async () => ({});
		const request = async (method: string, params: Record<string, unknown>) => {
			const response = (await peer!.call("protocol", { request: { id: crypto.randomUUID(), method, params } })) as {
				error?: unknown;
				result?: { thread?: { id: string } };
			};
			expect(response.error).toBeUndefined();
			return response.result;
		};
		await request("initialize", {
			clientInfo: { name: "fixture", version: "1" },
			capabilities: { experimentalApi: true },
		});
		const started = await request("thread/start", {
			cwd: agentDir,
			model: "fixture-quiesce",
			modelProvider: "fixture-provider",
			effort: "high",
		});
		expect(started?.thread?.id).toBeString();
		const catalog = await Bun.file(join(root, "sessions.json")).json();
		workerPid = catalog.threads[0].workerProcess.pid;
		expect(() => process.kill(workerPid!, 0)).not.toThrow();
		peer.close();
		peer = undefined;
		const quiesce = Bun.spawn([process.execPath, "src/cli.ts", "remote-control", "quiesce", "--json"], {
			cwd,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await quiesce.exited).toBe(0);
		expect(JSON.parse(await new Response(quiesce.stdout).text())).toEqual({ stopped: true });
		expect(await supervisor.exited).toBe(0);
		expect(() => process.kill(workerPid!, 0)).toThrow();
		expect(await store.readRuntime("host")).toBeUndefined();
		expect((await Bun.file(join(root, "host.json")).json()).enabled).toBe(true);
		const saved = await Bun.file(join(root, "sessions.json")).json();
		expect(saved.threads[0].id).toBe(started?.thread?.id);
		expect(saved.threads[0].workerProcess).toBeNull();
		expect(saved.threads[0].workerSocket).toBeNull();
	} finally {
		peer?.close();
		if (supervisor.exitCode === null) supervisor.kill("SIGKILL");
		const host = await store.readRuntime("host");
		if (host)
			try {
				process.kill(host.pid, "SIGKILL");
			} catch {}
		if (workerPid)
			try {
				process.kill(workerPid, "SIGKILL");
			} catch {}
		await rm(agentDir, { recursive: true, force: true });
	}
}, 30_000);
