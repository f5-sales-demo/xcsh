#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@f5-sales-demo/pi-utils";
import {
	type LifecycleCampaign,
	LifecycleController,
	type LifecycleHost,
	type LifecycleReceipt,
	type LifecycleRuntime,
	lifecycleRuntimeProcessIds,
} from "../src/remote-control/lifecycle-uat-controller";
import { verifyTraceArtifactProvenance } from "../src/remote-control/trace-assembler";
import { replaceSystemdVoiceService } from "../src/remote-control/voice-uat-systemd";
import { inspectLifecycleWorkers } from "./lifecycle-worker-inspection";

const options = new Map<string, string>();
const operation = process.argv[2];
for (let i = 3; i < process.argv.length; i += 2) {
	if (!process.argv[i].startsWith("--") || process.argv[i + 1] === undefined)
		throw new Error("Options require --name value");
	options.set(process.argv[i].slice(2), process.argv[i + 1]);
}
function required(name: string): string {
	const value = options.get(name);
	if (!value) throw new Error(`Missing --${name}`);
	return value;
}
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, "utf8")) as T;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function command(args: string[]): Promise<string> {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code) throw new Error(`${args[0]} failed (${code}): ${err.slice(0, 300)}`);
	return out;
}
const directory = required("campaign-dir");
const unit = options.get("unit") ?? "xcsh-uat.service";
if (unit !== "xcsh-uat.service") throw new Error("This prototype adapter owns only xcsh-uat.service");
const configuration = options.get("configuration") ?? join(directory, "runtime-config.json");
async function configurationDigest(): Promise<string> {
	const p = await properties();
	const state = await command(["systemctl", "--user", "cat", unit]);
	const config = await readFile(configuration, "utf8");
	return digest(JSON.stringify({ unit: state, execStart: p.ExecStart, config }));
}
async function properties(): Promise<Record<string, string>> {
	return Object.fromEntries(
		(
			await command([
				"systemctl",
				"--user",
				"show",
				unit,
				"-p",
				"MainPID,InvocationID,ExecStart,NRestarts,ActiveState,SubState",
			])
		)
			.trim()
			.split("\n")
			.map(line => {
				const at = line.indexOf("=");
				return [line.slice(0, at), line.slice(at + 1)];
			}),
	);
}
const host: LifecycleHost = {
	async verifyArtifact(candidate) {
		try {
			return (
				(await verifyTraceArtifactProvenance(candidate.executable, candidate.commit)).artifactSha256 ===
				candidate.sha256
			);
		} catch {
			return false;
		}
	},
	async inspect(): Promise<LifecycleRuntime> {
		const p = await properties();
		const pid = Number(p.MainPID);
		if (!pid)
			return {
				executable: "",
				sha256: "",
				supervisorPid: 0,
				childPid: 0,
				invocation: p.InvocationID ?? "",
				configSha256: await configurationDigest(),
				argumentsSha256: digest(p.ExecStart ?? ""),
				restarts: Number(p.NRestarts ?? 0),
				unexpectedProcesses: [],
			};
		const executable = await readlink(`/proc/${pid}/exe`);
		const processes = (await command(["ps", "-eo", "uid,pid,ppid,comm"]))
			.trim()
			.split("\n")
			.slice(1)
			.map(line => line.trim().split(/\s+/));
		const rows = await Promise.all(
			processes
				.filter(row => Number(row[0]) === process.getuid?.())
				.map(async row => ({
					uid: Number(row[0]),
					pid: Number(row[1]),
					ppid: Number(row[2]),
					executable: await readlink(`/proc/${row[1]}/exe`).catch(() => ""),
				})),
		);
		const sha256 = digest(await readFile(`/proc/${pid}/exe`));
		const workers = await inspectLifecycleWorkers(
			rows,
			process.getuid!(),
			{ executable, sha256 },
			join(getAgentDir(), "remote-control"),
		);
		const { childPid, unexpectedProcesses } = lifecycleRuntimeProcessIds(
			rows,
			process.getuid!(),
			pid,
			executable,
			workers,
		);
		return {
			executable,
			sha256,
			supervisorPid: pid,
			childPid,
			invocation: p.InvocationID,
			configSha256: await configurationDigest(),
			argumentsSha256: digest(p.ExecStart),
			restarts: Number(p.NRestarts),
			unexpectedProcesses,
			workers,
		};
	},
	async replace(candidate) {
		const dropIn = join(process.env.HOME!, ".config/systemd/user", `${unit}.d`);
		await mkdir(dropIn, { recursive: true, mode: 0o700 });
		const previous = await host.inspect();
		if (previous.supervisorPid) await command([previous.executable, "remote-control", "quiesce"]);
		await writeFile(
			join(dropIn, "candidate.conf"),
			`[Service]\nExecStart=\nExecStart=${candidate.executable} remote-control supervisor\nExecStop=\nExecStop=${candidate.executable} remote-control quiesce\n`,
			{ mode: 0o600 },
		);
		await command(["systemctl", "--user", "daemon-reload"]);
		await replaceSystemdVoiceService({
			unit,
			quiesceExecutable: candidate.executable,
			properties,
			command,
			wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
		});
	},
};
const controller = new LifecycleController(directory, host);
let result: unknown;
switch (operation) {
	case "prepare":
		await controller.prepare(await json<LifecycleCampaign>(required("manifest")));
		result = await controller.status();
		break;
	case "preflight":
		result = await controller.preflight();
		break;
	case "start-case": {
		const cycle = Number(options.get("cycle") ?? "0");
		if (![0, 1, 2].includes(cycle)) throw new Error("Cycle must be 0, 1 or 2");
		result = {
			attemptId: await controller.startCase(
				required("case"),
				await json(required("identities")),
				cycle as 0 | 1 | 2,
			),
		};
		break;
	}
	case "finish-case":
		result = { failures: await controller.finishCase() };
		break;
	case "import-human": {
		const file = required("file");
		await controller.importHuman(await json(file), file, options.get("attempt"));
		result = await controller.status();
		break;
	}
	case "import-gate": {
		const gate = required("gate"),
			outcome = required("outcome");
		if (gate !== "unit" && gate !== "installed") throw new Error("Gate must be unit or installed");
		if (outcome !== "pass" && outcome !== "fail") throw new Error("Outcome must be pass or fail");
		await controller.recordGate(gate, required("file"), outcome, options.get("attempt"));
		result = await controller.status();
		break;
	}
	case "import-receipt": {
		await controller.receipt(await json<LifecycleReceipt>(required("receipt")), required("file"));
		result = await controller.status();
		break;
	}
	case "analyze":
		result = { failures: await controller.analyze(options.get("attempt")) };
		break;
	case "replay":
		result = await controller.replay(required("reference"), required("candidate"), options.get("attempt"));
		break;
	case "status":
		result = await controller.status();
		break;
	case "resume":
		result = await controller.resume();
		break;
	case "invalidate":
		await controller.invalidate(required("reason"));
		result = await controller.status();
		break;
	case "replace":
		await controller.replace();
		result = await controller.status();
		break;
	case "finalize":
		result = { bundle: await controller.finalize() };
		break;
	default:
		throw new Error(
			"Use prepare, preflight, start-case, finish-case, import-human, import-gate, import-receipt, analyze, replay, status, resume, invalidate, replace or finalize",
		);
}
console.log(JSON.stringify(result, null, 2));
