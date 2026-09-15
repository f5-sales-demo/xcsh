import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ManagedRemoteSessions, type ManagedSessionRuntimeRequest } from "../../src/remote-control/managed-sessions";
import { SessionManager } from "../../src/session/session-manager";

function runtimeFactory(counters: { creates: number; closes: number }) {
	return async (request: ManagedSessionRuntimeRequest) => {
		counters.creates++;
		await Bun.sleep(5);
		const id = request.record?.id ?? (request.kind === "fork" ? "forked" : "started");
		const cwd = String(request.params.cwd);
		const thread = {
			id,
			sessionId: id,
			forkedFromId: request.source?.id ?? null,
			cwd,
			path: join(cwd, `2026-09-14T00-00-00-000Z_${id}.jsonl`),
			ephemeral: request.params.ephemeral === true,
			model: "gpt-5.6-luna",
			modelProvider: "openai-codex",
			reasoningEffort: "medium",
			createdAt: 1,
			updatedAt: 1,
			status: { type: "idle" },
			turns: [],
		};
		return {
			endpoint: {
				thread,
				call: async () => ({ thread, model: thread.model, modelProvider: thread.modelProvider, cwd }),
			},
			close: async () => {
				counters.closes++;
			},
		};
	};
}

const cliPath = resolve(import.meta.dir, "../../src/cli.ts");

test("managed catalog persists durable metadata and cold resume is single-flight", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-"));
	const counters = { creates: 0, closes: 0 };
	try {
		const first = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: runtimeFactory(counters),
			sessionsRoot: "/tmp",
		}).initialize();
		await first.start({ cwd: "/tmp" });
		expect(first.list()).toHaveLength(1);
		await first.close();
		const second = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: runtimeFactory(counters),
			sessionsRoot: "/tmp",
		}).initialize();
		expect(second.list()).toMatchObject([{ id: "started", cwd: "/tmp", status: { type: "notLoaded" } }]);
		const [left, right] = await Promise.all([second.resume("started"), second.resume("started")]);
		expect(left).toBe(right);
		expect(counters.creates).toBe(2);
		await second.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("ephemeral threads are never restored and idle unsubscribed runtimes unload", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-"));
	const counters = { creates: 0, closes: 0 };
	try {
		const first = await new ManagedRemoteSessions(root, "/tmp", {
			idleMs: 5,
			createRuntime: runtimeFactory(counters),
			sessionsRoot: "/tmp",
		}).initialize();
		await first.start({ cwd: "/tmp", ephemeral: true });
		await Bun.sleep(20);
		expect(counters.closes).toBe(1);
		await first.close();
		const second = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: runtimeFactory(counters),
			sessionsRoot: "/tmp",
		}).initialize();
		expect(second.list()).toEqual([]);
		await second.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("cold reads, archive, unarchive and delete preserve exact durable files", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-files-"));
	const cwd = await mkdtemp(join(tmpdir(), "xcsh-managed-cwd-"));
	try {
		const sessionDir = join(root, "durable");
		const manager = SessionManager.create(cwd, sessionDir);
		manager.appendMessage({ role: "user", content: [{ type: "text", text: "fixture" }], timestamp: 1 });
		await manager.ensureOnDisk();
		await manager.flush();
		const path = manager.getSessionFile()!;
		const artifactDir = path.slice(0, -6);
		await mkdir(artifactDir, { recursive: true });
		await writeFile(join(artifactDir, "fixture.txt"), "fixture");
		const thread = {
			id: manager.getSessionId(),
			sessionId: manager.getSessionId(),
			cwd,
			path,
			ephemeral: false,
			model: "gpt-5.6-luna",
			modelProvider: "openai-codex",
			reasoningEffort: "medium",
			createdAt: 1,
			updatedAt: 1,
			status: { type: "idle" },
			turns: [],
		};
		const initial = await new ManagedRemoteSessions(root, cwd, {
			createRuntime: async () => ({ endpoint: { thread, call: async () => ({ thread }) }, close: async () => {} }),
			sessionsRoot: root,
		}).initialize();
		await initial.start({ cwd });
		await initial.close();
		const sessions = await new ManagedRemoteSessions(root, cwd, { sessionsRoot: root }).initialize();
		const read = (await sessions.read(thread.id, { includeTurns: true })) as any;
		expect(read.thread.turns).toHaveLength(1);
		await sessions.archive(thread.id);
		expect(sessions.counts()).toEqual({ total: 0, loaded: 0, archived: 1 });
		const archived = sessions.list()[0] as any;
		expect(archived).toMatchObject({ id: thread.id, archived: true, status: { type: "notLoaded" } });
		expect((await stat(String(archived.path))).isFile()).toBe(true);
		expect((await stat(String(archived.path).slice(0, -6))).isDirectory()).toBe(true);
		const archivedRead = (await sessions.read(thread.id, { includeTurns: true })) as any;
		expect(archivedRead.thread).toMatchObject({ id: thread.id, archived: true });
		expect(archivedRead.thread.turns).toHaveLength(1);

		const restored = await sessions.unarchive(thread.id);
		expect(restored).toMatchObject({ id: thread.id, archived: false, path });
		expect((await stat(path)).isFile()).toBe(true);
		await sessions.delete(thread.id);
		expect(sessions.list()).toEqual([]);
		expect(await Bun.file(path).exists()).toBe(false);
		await sessions.close();
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(cwd, { recursive: true, force: true });
	}
});

test("model and effort changes are durably reflected in the cold catalog", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-settings-"));
	const workerSocket = join(root, "workers", "settings.sock");
	const workerProcess = {
		pid: 123,
		startTime: "fixture-start",
		executablePath: "/fixture/xcsh",
		executableSha256: "a".repeat(64),
		generation: 0,
	};
	let publish: ((event: { method: string; params: Record<string, unknown> }) => void) | undefined;
	const thread = {
		id: "managed-settings",
		sessionId: "managed-settings",
		cwd: "/tmp",
		path: "/tmp/2026-09-14T00-00-00-000Z_managed-settings.jsonl",
		ephemeral: false,
		model: "gpt-5.6-luna",
		modelProvider: "openai-codex",
		reasoningEffort: "medium",
		createdAt: 1,
		updatedAt: 1,
		status: { type: "idle" },
		turns: [],
	};
	try {
		const first = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: async () => ({
				endpoint: { thread, call: async () => ({ thread }) },
				workerSocket,
				workerProcess,
				setPublisher: listener => {
					publish = listener;
				},
				close: async () => {},
			}),
			sessionsRoot: "/tmp",
		}).initialize();
		await first.start({ cwd: "/tmp" });
		Object.assign(thread, { model: "gpt-6-astra", reasoningEffort: "high" });
		publish?.({ method: "thread/settings/updated", params: { threadId: thread.id } });
		await first.close();
		const catalog = (await Bun.file(join(root, "sessions.json")).json()) as any;
		expect(catalog.threads[0]).toMatchObject({ workerSocket, workerProcess });

		const second = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: runtimeFactory({ creates: 0, closes: 0 }),
			sessionsRoot: "/tmp",
		}).initialize();
		expect(second.list()).toMatchObject([
			{ id: thread.id, model: "gpt-6-astra", reasoningEffort: "high", status: { type: "notLoaded" } },
		]);
		await second.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("the CLI worker keeps a durable session alive while the host-side catalog is replaced", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "xcsh-managed-process-"));
	const cwd = await mkdtemp(join(tmpdir(), "xcsh-managed-process-cwd-"));
	const root = join(agentDir, "remote-control");
	const processOptions = {
		workerCommand: [process.execPath, cliPath],
		workerEnv: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	};
	try {
		const first = await new ManagedRemoteSessions(root, cwd, processOptions).initialize();
		const started = await first.start({ cwd });
		const id = String(started.thread.id);
		expect(started.thread).toMatchObject({ id, cwd, ephemeral: false, source: "appServer" });
		const catalog = (await Bun.file(join(root, "sessions.json")).json()) as any;
		const workerPid = catalog.threads[0]?.workerProcess?.pid as number | undefined;
		expect(workerPid).toBeInteger();
		await first.close();
		expect(() => process.kill(workerPid!, 0)).not.toThrow();

		const replacement = await new ManagedRemoteSessions(root, cwd, processOptions).initialize();
		expect(replacement.list()).toMatchObject([{ id, status: { type: "notLoaded" } }]);
		const resumed = await replacement.resume(id);
		expect(resumed?.thread).toMatchObject({ id, cwd, source: "appServer" });
		expect(replacement.counts()).toEqual({ total: 1, loaded: 1, archived: 0 });
		await replacement.delete(id);
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				process.kill(workerPid!, 0);
				await Bun.sleep(10);
			} catch {
				break;
			}
		}
		expect(() => process.kill(workerPid!, 0)).toThrow();
		await replacement.close();
	} finally {
		await rm(agentDir, { recursive: true, force: true });
		await rm(cwd, { recursive: true, force: true });
	}
}, 30_000);

test("intentional shutdown stops a detached durable worker before it has been cold-loaded", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "xcsh-managed-disable-"));
	const cwd = await mkdtemp(join(tmpdir(), "xcsh-managed-disable-cwd-"));
	const root = join(agentDir, "remote-control");
	const processOptions = {
		workerCommand: [process.execPath, cliPath],
		workerEnv: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	};
	try {
		const first = await new ManagedRemoteSessions(root, cwd, processOptions).initialize();
		await first.start({ cwd });
		const catalog = (await Bun.file(join(root, "sessions.json")).json()) as any;
		const workerPid = catalog.threads[0]?.workerProcess?.pid as number | undefined;
		expect(workerPid).toBeInteger();
		await first.close();

		const disable = await new ManagedRemoteSessions(root, cwd, processOptions).initialize();
		await disable.close(true);
		for (let attempt = 0; attempt < 100; attempt++) {
			try {
				process.kill(workerPid!, 0);
				await Bun.sleep(10);
			} catch {
				break;
			}
		}
		expect(() => process.kill(workerPid!, 0)).toThrow();
	} finally {
		await rm(agentDir, { recursive: true, force: true });
		await rm(cwd, { recursive: true, force: true });
	}
}, 30_000);

test("a crashed loaded worker is evicted and one replacement resumes its durable thread", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-crash-"));
	let closeWorker: (() => void) | undefined;
	let creates = 0;
	const detached: string[] = [];
	try {
		const sessions = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: async request => {
				creates++;
				const id = request.record?.id ?? "managed-crash";
				const thread = {
					id,
					sessionId: id,
					cwd: "/tmp",
					path: "/tmp/managed-crash.jsonl",
					ephemeral: false,
					model: "gpt-5.6-luna",
					modelProvider: "openai-codex",
					reasoningEffort: "medium",
					createdAt: 1,
					updatedAt: 1,
					status: { type: "idle" },
					turns: [],
				};
				return {
					endpoint: { thread, call: async () => ({ thread }) },
					setClosed: listener => {
						closeWorker = listener;
					},
					close: async () => {},
				};
			},
		}).initialize();
		(sessions as any).detached = (threadId: string) => detached.push(threadId);
		const started = await sessions.start({ cwd: "/tmp" });
		closeWorker?.();
		expect(detached).toEqual([String(started.thread.id)]);
		const [left, right] = await Promise.all([
			sessions.resume(String(started.thread.id)),
			sessions.resume(String(started.thread.id)),
		]);
		expect(left).toBe(right);
		expect(creates).toBe(2);
		await sessions.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("managed replay waits until the router has registered the endpoint", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-replay-"));
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	try {
		const sessions = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: async () => {
				const thread = {
					id: "managed-replay",
					sessionId: "managed-replay",
					cwd: "/tmp",
					path: "/tmp/2026-09-14T00-00-00-000Z_managed-replay.jsonl",
					ephemeral: false,
					model: "gpt-5.6-luna",
					modelProvider: "openai-codex",
					reasoningEffort: "medium",
					createdAt: 1,
					updatedAt: 1,
					status: { type: "idle" },
					turns: [],
				};
				return {
					endpoint: { thread, call: async () => ({ thread }) },
					setPublisher: publish =>
						publish({ method: "thread/name/updated", params: { threadId: thread.id, threadName: "replayed" } }),
					close: async () => {},
				};
			},
			sessionsRoot: "/tmp",
		}).initialize();
		sessions.publish = event => events.push(event);
		const started = await sessions.start({ cwd: "/tmp" });
		expect(events).toEqual([]);
		(sessions as any).activate(String(started.thread.id));
		expect(events).toEqual([
			{ method: "thread/name/updated", params: { threadId: "managed-replay", threadName: "replayed" } },
		]);
		await sessions.close();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("host replacement detaches durable workers while intentional shutdown terminates them", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-close-"));
	const terminations: boolean[] = [];
	try {
		const replacement = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: async request => {
				const runtime = await runtimeFactory({ creates: 0, closes: 0 })(request);
				return { ...runtime, close: async terminate => void terminations.push(terminate === true) };
			},
			sessionsRoot: "/tmp",
		}).initialize();
		await replacement.start({ cwd: "/tmp" });
		await replacement.close();
		expect(terminations).toEqual([false]);

		const disable = await new ManagedRemoteSessions(root, "/tmp", {
			createRuntime: async request => {
				const runtime = await runtimeFactory({ creates: 0, closes: 0 })(request);
				return { ...runtime, close: async terminate => void terminations.push(terminate === true) };
			},
			sessionsRoot: "/tmp",
		}).initialize();
		await disable.resume("started");
		await disable.close(true);
		expect(terminations).toEqual([false, true]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a corrupt catalog cannot point session or worker operations outside managed roots", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-managed-corrupt-"));
	try {
		await writeFile(
			join(root, "sessions.json"),
			JSON.stringify({
				version: 1,
				threads: [
					{
						id: "outside",
						path: "/tmp/outside.jsonl",
						originalPath: "/tmp/outside.jsonl",
						cwd: "/tmp",
						archived: false,
						ephemeral: false,
						createdAt: 1,
						updatedAt: 1,
						model: null,
						modelProvider: "openai-codex",
						reasoningEffort: null,
						name: null,
						forkedFromId: null,
						workerSocket: "/tmp/outside.sock",
					},
				],
			}),
		);
		await expect(new ManagedRemoteSessions(root, "/tmp").initialize()).rejects.toThrow(
			"Invalid remote session catalog",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
