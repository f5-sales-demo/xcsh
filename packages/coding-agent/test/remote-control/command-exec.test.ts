import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteRouter, type RemoteThreadLifecycle } from "../../src/remote-control/router";

test("phone read-only printf probe streams argv without executing it", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-printf-"));
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture");
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	router.notify = (_client, event) => events.push(event);
	router.registerSession("primary", {
		thread: { id: "primary", cwd: root, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		const response = await router.handle("phone", {
			id: 2,
			method: "command/exec",
			params: {
				cwd: "/",
				command: ["/bin/sh", "-c", `printf '%s\\n' "$@"`, "xcsh-phone-probe", "/bin/sh", "-lc", "cd /tmp && pwd"],
				processId: "probe-1",
				streamStdoutStderr: true,
				timeoutMs: 20_000,
				outputBytesCap: 4097,
				sandboxPolicy: { type: "readOnly", networkAccess: false },
			},
		});
		expect(response).toEqual({ id: 2, result: { exitCode: 0, stdout: "", stderr: "" } });
		expect(events.map(event => event.method)).toEqual(["command/exec/outputDelta"]);
		expect(events[0].params).toMatchObject({ processId: "probe-1", stream: "stdout", capReached: false });
		expect(Buffer.from(String(events[0].params.deltaBase64), "base64").toString("utf8")).toBe(
			"/bin/sh\n-lc\ncd /tmp && pwd\n",
		);
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("phone read-only printf probe uses the configured workspace without a live terminal", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-printf-cold-"));
	const lifecycle = {
		defaultCwd: root,
		list: () => [],
	} as unknown as RemoteThreadLifecycle;
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture", lifecycle);
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	router.notify = (_client, event) => events.push(event);
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		const response = await router.handle("phone", {
			id: 2,
			method: "command/exec",
			params: {
				cwd: "/",
				command: ["/bin/sh", "-c", `printf '%s\\n' "$@"`, "xcsh-phone-probe", "/bin/sh", "-lc", "cd /tmp && pwd"],
				processId: "probe-1",
				streamStdoutStderr: true,
				timeoutMs: 20_000,
				outputBytesCap: 4097,
				sandboxPolicy: { type: "readOnly", networkAccess: false },
			},
		});
		expect(response).toEqual({ id: 2, result: { exitCode: 0, stdout: "", stderr: "" } });
		expect(events.map(event => event.method)).toEqual(["command/exec/outputDelta"]);
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("read-only printf probe accepts quoted punctuation and ignores unrelated environment overrides", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-printf-quoted-"));
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture");
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	router.notify = (_client, event) => events.push(event);
	router.registerSession("primary", {
		thread: { id: "primary", cwd: root, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(
			await router.handle("phone", {
				id: 2,
				method: "command/exec",
				params: {
					cwd: "/",
					command: ["/bin/sh", "-c", `printf '>&|;%s' "$@"`, "probe", "argument"],
					processId: "probe-1",
					streamStdoutStderr: true,
					timeoutMs: 20_000,
					outputBytesCap: 5,
					env: { PHONE_CONTEXT: "ignored", PWD: "/unrelated" },
					sandboxPolicy: { type: "readOnly", networkAccess: false },
				},
			}),
		).toEqual({ id: 2, result: { exitCode: 0, stdout: "", stderr: "" } });
		expect(events[0].params.capReached).toBe(true);
		expect(Buffer.from(String(events[0].params.deltaBase64), "base64").toString("utf8")).toBe(">&|;a");
		for (const [outputBytesCap, expected, capReached] of [
			[null, ">&|;argument", false],
			[0, "", true],
		] as const) {
			const processId = `probe-${String(outputBytesCap)}`;
			expect(
				await router.handle("phone", {
					id: processId,
					method: "command/exec",
					params: {
						cwd: "/",
						command: ["/bin/sh", "-c", `printf '>&|;%s' "$@"`, "probe", "argument"],
						processId,
						streamStdoutStderr: true,
						timeoutMs: 20_000,
						outputBytesCap,
						sandboxPolicy: { type: "readOnly", networkAccess: false },
					},
				}),
			).toEqual({ id: processId, result: { exitCode: 0, stdout: "", stderr: "" } });
			const event = events.at(-1)!;
			expect(event.params.capReached).toBe(capReached);
			expect(Buffer.from(String(event.params.deltaBase64), "base64").toString("utf8")).toBe(expected);
		}
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("read-only printf probe rejects shell operators before spawning", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-printf-reject-"));
	const marker = join(root, "must-not-exist");
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture");
	router.registerSession("primary", {
		thread: { id: "primary", cwd: root, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(
			await router.handle("phone", {
				id: 2,
				method: "command/exec",
				params: {
					cwd: "/",
					command: ["/bin/sh", "-c", `printf ok; touch ${marker}`, "probe"],
					processId: "probe-1",
					streamStdoutStderr: true,
					timeoutMs: 20_000,
					outputBytesCap: 4097,
					sandboxPolicy: { type: "readOnly", networkAccess: false },
				},
			}),
		).toMatchObject({ error: { code: -32602 } });
		expect(
			await stat(marker).then(
				() => true,
				() => false,
			),
		).toBe(false);
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("phone command/exec workspace setup returns a buffered result under the xcsh root", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-command-"));
	const workspaceRoot = join(root, "Documents", "xcsh");
	await mkdir(workspaceRoot, { recursive: true });
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture");
	router.registerSession("primary", {
		thread: { id: "primary", cwd: workspaceRoot, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(
			await router.handle("phone", {
				id: "read-only",
				method: "command/exec",
				params: {
					cwd: "/",
					command: [
						"/bin/sh",
						"-lc",
						'target="$PWD/Documents/""Codex""/2026-09-25/new-realtime-voice-chat-1"; mkdir -p "$target"; printf %s "$target"',
					],
					processId: null,
					streamStdoutStderr: false,
					timeoutMs: 20_000,
					outputBytesCap: 4096,
					sandboxPolicy: { type: "readOnly", networkAccess: false },
				},
			}),
		).toMatchObject({ error: { code: -32602 } });
		const response = await router.handle("phone", {
			id: 2,
			method: "command/exec",
			params: {
				cwd: "/",
				command: [
					"/bin/sh",
					"-lc",
					'target="$PWD/Documents/""Codex""/2026-09-25/new-realtime-voice-chat-1"; mkdir -p "$target"; printf %s "$target"',
				],
				env: {},
				processId: null,
				streamStdoutStderr: false,
				timeoutMs: 20_000,
				outputBytesCap: 4096,
				sandboxPolicy: {
					type: "workspaceWrite",
					writableRoots: [],
					networkAccess: false,
					excludeTmpdirEnvVar: false,
					excludeSlashTmp: false,
				},
			},
		});
		expect(response).toEqual({ id: 2, result: { exitCode: 0, stdout: expect.any(String), stderr: "" } });
		const path = (response as { result: { stdout: string } }).result.stdout;
		expect(path).toStartWith(`${workspaceRoot}/`);
		expect(path.endsWith("/new-realtime-voice-chat-1")).toBe(true);
		expect((await stat(path)).isDirectory()).toBe(true);
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

test("command/exec rejects arbitrary shell requests without executing them", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-command-reject-"));
	const marker = join(root, "must-not-exist");
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture");
	router.registerSession("primary", {
		thread: { id: "primary", cwd: root, turns: [], updatedAt: 1 },
		call: async () => ({}),
	});
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(
			await router.handle("phone", {
				id: 2,
				method: "command/exec",
				params: {
					cwd: "/",
					command: ["/bin/sh", "-lc", `touch ${marker}`],
					processId: null,
					streamStdoutStderr: false,
					timeoutMs: 20_000,
					outputBytesCap: 4096,
					sandboxPolicy: {
						type: "workspaceWrite",
						writableRoots: [],
						networkAccess: false,
						excludeTmpdirEnvVar: false,
						excludeSlashTmp: false,
					},
				},
			}),
		).toMatchObject({ error: { code: -32602 } });
		expect(
			await stat(marker).then(
				() => true,
				() => false,
			),
		).toBe(false);
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});
