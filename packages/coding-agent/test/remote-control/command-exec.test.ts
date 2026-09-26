import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readlink, rm, stat } from "node:fs/promises";
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

test("read-only command accepts an existing selected project before any terminal starts", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-selected-"));
	const selected = join(root, "private-project");
	await mkdir(selected, { mode: 0o700 });
	const lifecycle = { defaultCwd: root, list: () => [] } as unknown as RemoteThreadLifecycle;
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture", lifecycle);
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	router.notify = (_client, event) => events.push(event);
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
					cwd: selected,
					command: ["/bin/sh", "-c", `printf '%s' "$@"`, "probe", "ready"],
					processId: "selected-probe",
					streamStdoutStderr: true,
					timeoutMs: 20_000,
					outputBytesCap: 16,
					sandboxPolicy: { type: "readOnly", networkAccess: false },
				},
			}),
		).toEqual({ id: 2, result: { exitCode: 0, stdout: "", stderr: "" } });
		expect(Buffer.from(String(events[0].params.deltaBase64), "base64").toString("utf8")).toBe("ready");
		expect(
			await router.handle("phone", {
				id: 3,
				method: "command/exec",
				params: {
					cwd: join(root, "missing-project"),
					command: ["/bin/sh", "-c", `printf '%s' "$@"`, "probe", "ready"],
					processId: "missing-probe",
					streamStdoutStderr: true,
					timeoutMs: 20_000,
					outputBytesCap: 16,
					sandboxPolicy: { type: "readOnly", networkAccess: false },
				},
			}),
		).toMatchObject({ error: { code: -32602 } });
	} finally {
		router.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

const workspaceSandboxAvailable =
	process.platform === "linux" &&
	spawnSync(
		"systemd-run",
		["--user", "--quiet", "--wait", "--pipe", "--collect", "--", "sudo", "-n", "/usr/bin/bwrap", "--version"],
		{ encoding: "utf8" },
	).status === 0;

test.skipIf(!workspaceSandboxAvailable)(
	"selected-folder workspace command can write only inside its isolated project",
	async () => {
		const root = await mkdtemp(join(process.env.XCSH_WORKSPACE_TEST_ROOT ?? tmpdir(), "xcsh-phone-workspace-"));
		const selected = join(root, "project");
		const outside = join(root, "outside");
		await mkdir(selected);
		const router = new RemoteRouter(join(root, ".xcsh"), "fixture");
		const events: Array<{ method: string; params: Record<string, unknown> }> = [];
		router.notify = (_client, event) => events.push(event);
		const policy = {
			type: "workspaceWrite",
			writableRoots: [] as string[],
			networkAccess: false,
			excludeTmpdirEnvVar: false,
			excludeSlashTmp: false,
		};
		const command = (script: string, target: string) => [
			"/bin/bash",
			"--noprofile",
			"--norc",
			"-c",
			"--",
			`printf '\\0'; exec "$@"`,
			"xcsh-phone-command",
			"/bin/bash",
			"-lc",
			script,
			"_",
			target,
		];
		const request = (id: number, script: string, target: string) => ({
			id,
			method: "command/exec",
			params: {
				cwd: selected,
				command: command(script, target),
				env: { BASH_ENV: null, ENV: null },
				processId: `workspace-${id}`,
				streamStdoutStderr: true,
				timeoutMs: 20_000,
				outputBytesCap: 1_000_001,
				sandboxPolicy: policy,
			},
		});
		try {
			await router.handle("phone", {
				id: 1,
				method: "initialize",
				params: { clientInfo: { name: "fixture", version: "1" } },
			});
			const inside = join(selected, "created");
			expect(await router.handle("phone", request(2, 'printf ok > "$1"; printf done', inside))).toEqual({
				id: 2,
				result: { exitCode: 0, stdout: "", stderr: "" },
			});
			expect((await stat(inside)).isFile()).toBe(true);
			expect(events.at(-1)?.method).toBe("command/exec/outputDelta");
			expect(Buffer.from(String(events.at(-1)?.params.deltaBase64), "base64").toString()).toBe("\0done");
			const hostNetwork = await readlink("/proc/self/ns/net");
			expect(await router.handle("phone", request(6, "readlink /proc/self/ns/net", inside))).toMatchObject({
				result: { exitCode: 0 },
			});
			expect(Buffer.from(String(events.at(-1)?.params.deltaBase64), "base64").toString()).not.toContain(hostNetwork);
			expect(
				await router.handle(
					"phone",
					request(
						7,
						"if systemctl --user show-environment >/dev/null 2>&1; then printf exposed; else printf isolated; fi",
						inside,
					),
				),
			).toMatchObject({ result: { exitCode: 0 } });
			expect(Buffer.from(String(events.at(-1)?.params.deltaBase64), "base64").toString()).toBe("\0isolated");
			const largeScript = "printf compact".padEnd(13_793, " ");
			const largeRequest = request(8, largeScript, inside);
			largeRequest.params.command.push("one", "two", "three", "four", "five", "six");
			expect(largeRequest.params.command).toHaveLength(18);
			expect(await router.handle("phone", largeRequest)).toMatchObject({ result: { exitCode: 0 } });
			expect(Buffer.from(String(events.at(-1)?.params.deltaBase64), "base64").toString()).toBe("\0compact");
			const outsideAttempt = await router.handle("phone", request(3, 'printf blocked > "$1"', outside));
			expect(outsideAttempt).toMatchObject({
				id: 3,
				result: { exitCode: expect.any(Number) },
			});
			expect((outsideAttempt as { result: { exitCode: number } }).result.exitCode).not.toBe(0);
			expect(
				await stat(outside).then(
					() => true,
					() => false,
				),
			).toBe(false);
			const networkAttempt = request(4, 'printf blocked > "$1"', inside);
			networkAttempt.params.sandboxPolicy = { ...policy, networkAccess: true };
			expect(await router.handle("phone", networkAttempt)).toMatchObject({ error: { code: -32602 } });
			const extraRootAttempt = request(5, 'printf blocked > "$1"', outside);
			extraRootAttempt.params.sandboxPolicy = { ...policy, writableRoots: [outside] };
			expect(await router.handle("phone", extraRootAttempt)).toMatchObject({ error: { code: -32602 } });
		} finally {
			router.dispose();
			await rm(root, { recursive: true, force: true });
		}
	},
);

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

test("folderless streamed workspace setup allocates a host-owned project without running the phone script", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-phone-projectless-"));
	const marker = join(root, "must-not-exist");
	const lifecycle = { defaultCwd: root, list: () => [] } as unknown as RemoteThreadLifecycle;
	const router = new RemoteRouter(join(root, ".xcsh"), "fixture", lifecycle);
	const events: Array<{ method: string; params: Record<string, unknown> }> = [];
	router.notify = (_client, event) => events.push(event);
	const request = (id: number, env: Record<string, unknown>) => ({
		id,
		method: "command/exec",
		params: {
			cwd: "/",
			command: [
				"/bin/sh",
				"-c",
				`printf '\\0'; exec "$@"`,
				"xcsh-projectless-test",
				"/bin/sh",
				"-lc",
				`touch ${marker}`.padEnd(737, " "),
			],
			env,
			processId: `projectless-${id}`,
			streamStdoutStderr: true,
			timeoutMs: 20_000,
			outputBytesCap: 4097,
			sandboxPolicy: {
				type: "workspaceWrite",
				writableRoots: [root],
				networkAccess: true,
				excludeTmpdirEnvVar: false,
				excludeSlashTmp: false,
			},
		},
	});
	try {
		await router.handle("phone", {
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "fixture", version: "1" } },
		});
		expect(
			await router.handle("phone", request(2, { BASH_ENV: null, ENV: null, CODEX_PROJECTLESS_ROOT: root })),
		).toEqual({ id: 2, result: { exitCode: 0, stdout: "", stderr: "" } });
		expect(events).toHaveLength(1);
		const path = Buffer.from(String(events[0].params.deltaBase64), "base64").toString();
		expect(path).toStartWith(`\0${root}/`);
		expect(path.endsWith("/new-realtime-voice-chat-1")).toBe(true);
		expect((await stat(path.slice(1))).isDirectory()).toBe(true);
		expect(
			await stat(marker).then(
				() => true,
				() => false,
			),
		).toBe(false);
		expect(await router.handle("phone", request(3, { BASH_ENV: null, ENV: null }))).toMatchObject({
			error: { code: -32602 },
		});
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
