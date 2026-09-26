import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteRouter } from "../../src/remote-control/router";

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
