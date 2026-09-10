/** Production-package integration check; all product processes run inside a Codex-absent container. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream } from "node:fs";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PtySession } from "@f5-sales-demo/pi-natives";
import { connectPeer, type LocalPeer } from "../../src/remote-control/ipc";

const [binaryArg, outputArg, image = "ubuntu:24.04"] = process.argv.slice(2);
assert(binaryArg && outputArg, "Usage: bun check.ts <compiled-xcsh> <new-evidence-directory> [local-image]");
const binary = await realpath(binaryArg);
const output = resolve(outputArg);
const provider = resolve(import.meta.dir, "provider.ts");
const container = `xcsh-package-3818-${crypto.randomUUID()}`;
const checked: { description: string; elapsedMs: number }[] = [];
const started = Date.now();
const terminals: Terminal[] = [];
let peer: LocalPeer | undefined;
let host: ReturnType<typeof Bun.spawn> | undefined;
let requestId = 0;
let containerStarted = false;
let report: Record<string, unknown> | undefined;
let hostIndex = 0;
const events: unknown[] = [];
const passed = (description: string) => {
	checked.push({ description, elapsedMs: Date.now() - started });
	console.log(`PASS ${description}`);
};
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function run(command: string[]): Promise<string> {
	const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	assert.equal(code, 0, `${command[0]} failed: ${stderr}`);
	return stdout.trim();
}
const docker = (...args: string[]) => run(["docker", "exec", container, ...args]);
async function waitFor<T>(probe: () => Promise<T>, description: string, timeoutMs = 35_000): Promise<NonNullable<T>> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const result = await probe();
		if (result) return result as NonNullable<T>;
		await Bun.sleep(100);
	}
	throw new Error(`Timed out: ${description}`);
}
class Terminal {
	pty = new PtySession();
	closed = false;
	settled = false;
	finished: ReturnType<PtySession["start"]>;
	constructor(label: string, resume?: string) {
		const lower = label.toLowerCase();
		const log = `${output}/${lower}${resume ? "-resume" : ""}.terminal.log`;
		const command = [
			"docker",
			"exec",
			"-it",
			"--workdir",
			`/fixture/${lower}`,
			container,
			"env",
			`XCSH_PACKAGE_SESSION_NAME=Package ${label}`,
			"TERM=xterm-256color",
			"xcsh",
			"--extension",
			"/provider.ts",
			"--no-extensions",
			"--no-mcp",
			"--no-lsp",
			"--no-skills",
			"--no-memories",
			"--tools",
			"read,write",
			...(resume ? ["--resume", resume] : ["--model", "package-fixture/model"]),
		];
		this.finished = this.pty.start(
			{ command: command.map(quote).join(" "), cwd: output, cols: 120, rows: 40, timeoutMs: 180_000 },
			(error, chunk) => appendFileSync(log, error ? String(error) : chunk, { mode: 0o600 }),
		);
		void this.finished.then(
			() => {
				this.settled = true;
			},
			() => {
				this.settled = true;
			},
		);
	}
	async close(): Promise<void> {
		if (this.closed) return;
		if (!this.settled) this.pty.write("/quit\r");
		const result = await this.finished;
		assert.equal(result.exitCode, 0, "TUI exited unsuccessfully; inspect its terminal log");
		assert.equal(result.timedOut, false);
		this.closed = true;
	}
}
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
	assert(peer);
	const reply = (await peer.call("protocol", { request: { id: ++requestId, method, params } })) as any;
	assert.equal(reply.error, undefined, JSON.stringify(reply.error));
	return reply.result;
}
async function connect(): Promise<void> {
	await waitFor(async () => {
		try {
			peer = await connectPeer(`${output}/agent/remote-control/host.sock`);
			return true;
		} catch (error) {
			if (!["ENOENT", "ECONNREFUSED"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
			assert(host?.exitCode === null, "Fixture host exited before connecting");
			return false;
		}
	}, "host socket");
	peer!.handle = async (method, params) => {
		assert.equal(method, "protocol/event");
		events.push(params.event);
		return {};
	};
	await rpc("initialize", {
		clientInfo: { name: "package-check", version: "1" },
		capabilities: { experimentalApi: true },
	});
}
async function startHost(): Promise<void> {
	hostIndex++;
	host = Bun.spawn(
		["docker", "exec", container, "/bin/sh", "-c", "echo $$ > /fixture/host.pid; exec xcsh remote-control host"],
		{
			stdout: Bun.file(`${output}/host-${hostIndex}.log`),
			stderr: Bun.file(`${output}/host-${hostIndex}-error.log`),
		},
	);
	await connect();
}
async function stopHost(): Promise<void> {
	await peer!.call("stop", {});
	peer!.close();
	peer = undefined;
	assert.equal(await host!.exited, 0);
}
async function crashHost(): Promise<void> {
	await docker("/bin/sh", "-c", "kill -9 $(cat /fixture/host.pid)");
	peer?.close();
	peer = undefined;
	assert.notEqual(await host!.exited, 0);
}
async function threads(): Promise<any[]> {
	for (const terminal of terminals) assert(terminal.closed || !terminal.settled, "TUI exited; inspect terminal logs");
	return (await rpc("thread/list")).data;
}
const history = async (threadId: string): Promise<any[]> =>
	(await rpc("thread/read", { threadId, includeTurns: true })).thread.turns;
async function digest(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

await mkdir(output, { mode: 0o700 });
for (const name of ["alpha", "beta", "home", "agent/remote-control"])
	await mkdir(`${output}/${name}`, { mode: 0o700, recursive: true });
try {
	await run([
		"docker",
		"run",
		"--pull",
		"never",
		"--rm",
		"-d",
		"--name",
		container,
		"--network",
		"none",
		"--read-only",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--user",
		`${process.getuid!()}:${process.getgid!()}`,
		"--tmpfs",
		"/tmp:rw,nosuid,nodev",
		"--mount",
		`type=bind,src=${output}/home,dst=/home/ubuntu`,
		"--mount",
		`type=bind,src=${binary},dst=/usr/local/bin/xcsh,readonly`,
		"--mount",
		`type=bind,src=${provider},dst=/provider.ts,readonly`,
		"--mount",
		`type=bind,src=${output},dst=/fixture`,
		"--env",
		"PI_CODING_AGENT_DIR=/fixture/agent",
		"--workdir",
		"/fixture",
		image,
		"/bin/sleep",
		"infinity",
	]);
	containerStarted = true;
	await docker("/bin/sh", "-c", "! command -v codex && ! command -v bun && test ! -e /fixture/node_modules");
	passed("Codex, standalone Bun and project dependencies absent");
	const version = await docker("xcsh", "--version");
	assert.deepEqual(JSON.parse(await docker("xcsh", "remote-control", "status", "--json")), {
		enabled: false,
		relay: "stopped",
		liveSessions: 0,
	});
	passed("packaged status defaults off");
	// Fake enrollment exercises local IPC only. Container networking is disabled.
	await writeFile(
		`${output}/agent/remote-control/host.json`,
		JSON.stringify({
			enabled: true,
			name: "xcsh package fixture",
			installationId: "package-fixture",
			enrollment: {
				server_id: "fixture-server",
				environment_id: "fixture-environment",
				remote_control_token: "fixture-only",
				expires_at: "2100-01-01T00:00:00Z",
			},
		}),
		{ mode: 0o600 },
	);
	await startHost();
	terminals.push(new Terminal("Alpha"), new Terminal("Beta"));
	const loaded = await waitFor(async () => {
		const value = await threads();
		return value.length === 2 ? value : undefined;
	}, "two real packaged TUIs");
	const owners = new Map(loaded.map(item => [item.name, item]));
	assert.deepEqual([...owners.keys()].sort(), ["Package Alpha", "Package Beta"]);
	assert.notEqual(owners.get("Package Alpha").id, owners.get("Package Beta").id);
	for (const [name, item] of owners) {
		assert.equal(item.cwd, `/fixture/${name.split(" ").at(-1)!.toLowerCase()}`);
		await rpc("thread/resume", { threadId: item.id });
	}
	passed("two named top-level TUIs discovered with distinct identities and working directories");
	const accepted: { params: Record<string, unknown>; turnId: string }[] = [];
	for (const label of ["Alpha", "Beta"]) {
		const threadId = owners.get(`Package ${label}`).id;
		const params = {
			threadId,
			clientUserMessageId: `fixture-${label}`,
			input: [{ type: "text", text: `Write PACKAGE-${label.toUpperCase()} and read it back.` }],
		};
		accepted.push({ params, turnId: (await rpc("turn/start", params)).turn.id });
		const done = await waitFor(async () => {
			const turns = await history(threadId);
			return turns.at(-1)?.status === "completed" ? turns : undefined;
		}, `${label} tool completion`);
		assert.equal(
			await Bun.file(`${output}/${label.toLowerCase()}/package-check.txt`).text(),
			`PACKAGE-${label.toUpperCase()}`,
		);
		assert.equal(done.length, 1);
		const toolItems = done[0].items.filter(
			(item: any) => item.type === "dynamicToolCall" || item.type === "fileChange",
		);
		assert.equal(toolItems.length, 2);
		assert.deepEqual(
			toolItems.map((item: any) => item.type),
			["fileChange", "dynamicToolCall"],
		);
		assert(
			toolItems.every((item: any) => item.status === "completed"),
			JSON.stringify(toolItems),
		);
		assert.deepEqual(toolItems[0].changes, [
			{
				path: `/fixture/${label.toLowerCase()}/package-check.txt`,
				kind: { type: "add" },
				diff: `PACKAGE-${label.toUpperCase()}`,
			},
		]);
		assert.equal(toolItems[1].tool, "read");
		assert.equal(toolItems[1].success, true);
		assert.deepEqual(toolItems[1].contentItems, [{ type: "inputText", text: `PACKAGE-${label.toUpperCase()}` }]);
		await writeFile(`${output}/${label.toLowerCase()}.history.json`, JSON.stringify(done, null, 2), { mode: 0o600 });
	}
	passed("remote prompts execute real write/read tools in the correct TUI and persist completed history");
	const renamedThreadId = owners.get("Package Beta").id;
	await rpc("thread/name/set", { threadId: renamedThreadId, name: "  Package Beta Renamed  " });
	assert.equal((await threads()).find(item => item.id === renamedThreadId)?.name, "Package Beta Renamed");
	assert(
		events.some(
			(event: any) =>
				event.method === "thread/name/updated" &&
				event.params?.threadId === renamedThreadId &&
				event.params?.threadName === "Package Beta Renamed",
		),
	);
	passed("remote thread naming updates live discovery and emits the pinned notification");
	await stopHost();
	await startHost();
	await waitFor(async () => (await threads()).length === 2, "surviving owners after host restart");
	assert.equal((await threads()).find(item => item.id === renamedThreadId)?.name, "Package Beta Renamed");
	for (const { params, turnId } of accepted) {
		assert.equal((await rpc("turn/start", params)).turn.id, turnId);
		assert.equal((await history(String(params.threadId))).length, 1);
	}
	passed("host restart preserves owners/history and stable request replay does not execute twice");
	const crashThreadId = owners.get("Package Beta").id;
	const crashParams = {
		threadId: crashThreadId,
		clientUserMessageId: "fixture-crash",
		input: [{ type: "text", text: "Write PACKAGE-CRASH and read it back." }],
	};
	const acceptedCrash = await rpc("turn/start", crashParams);
	await waitFor(async () => {
		const turns = await history(crashThreadId);
		return turns.some((turn: any) => turn.id === acceptedCrash.turn.id && turn.status === "inProgress");
	}, "active turn before abrupt host loss");
	await crashHost();
	await startHost();
	await waitFor(async () => (await threads()).length === 2, "owners after abrupt host loss");
	const completedCrash = await waitFor(async () => {
		const turns = await history(crashThreadId);
		return turns
			.filter((turn: any) =>
				turn.items.some(
					(item: any) => item.type === "userMessage" && item.content?.[0]?.text?.includes("PACKAGE-CRASH"),
				),
			)
			.at(-1)?.status === "completed"
			? turns
			: undefined;
	}, "active terminal turn after abrupt host loss");
	const retriedCrash = await rpc("turn/start", crashParams);
	assert.equal(retriedCrash.turn.id, acceptedCrash.turn.id);
	assert.equal(completedCrash.at(-1).id, acceptedCrash.turn.id);
	assert.equal(
		completedCrash.filter((turn: any) =>
			turn.items.some(
				(item: any) => item.type === "userMessage" && item.content?.[0]?.text?.includes("PACKAGE-CRASH"),
			),
		).length,
		1,
	);
	assert.equal(await Bun.file(`${output}/beta/package-check.txt`).text(), "PACKAGE-CRASH");
	passed("abrupt packaged host loss preserves active terminal work and stable retry executes it once");
	await terminals[0].close();
	await waitFor(async () => (await threads()).length === 1, "closed terminal removed");
	const alphaId = owners.get("Package Alpha").id;
	terminals.push(new Terminal("Alpha", alphaId));
	await waitFor(async () => (await threads()).some(item => item.id === alphaId), "resumed owner identity");
	assert.equal((await history(alphaId)).length, 1);
	const resumed = await rpc("thread/resume", { threadId: alphaId });
	assert.equal(resumed.model, "model");
	assert.equal(resumed.modelProvider, "package-fixture");
	const retriedAfterTerminalRestart = await rpc("turn/start", accepted[0].params);
	assert.equal(retriedAfterTerminalRestart.turn.id, accepted[0].turnId);
	assert.equal((await history(alphaId)).length, 1);
	passed("compiled --resume preserves identity, model and durable exactly-once request replay");
	for (const terminal of terminals) await terminal.close();
	await waitFor(async () => (await threads()).length === 0, "all terminal exits removed");
	passed("terminal exit unregisters all owners");
	await stopHost();
	report = {
		binarySha256: await digest(binary),
		harnessSha256: await digest(import.meta.filename),
		providerSha256: await digest(provider),
		version,
		image,
		imageId: await run(["docker", "image", "inspect", image, "--format", "{{.Id}}"]),
		checks: checked,
		network: "none",
		enrollment: "synthetic",
		workModel: "package-fixture/model",
		phoneAcceptance: false,
	};
} finally {
	peer?.close();
	// Remove only the uniquely named container created by this invocation.
	const cleanup = Bun.spawn(["docker", "rm", "-f", container], { stdout: "ignore", stderr: "ignore" });
	const cleanupCode = await cleanup.exited;
	if (containerStarted) assert.equal(cleanupCode, 0, `Unable to remove fixture container ${container}`);
	await Promise.allSettled(terminals.map(terminal => terminal.finished));
	if (host) await host.exited;
}

assert(report);
passed("disposable test container and its processes removed");
await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
