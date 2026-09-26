#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	mkdir,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalWarningFingerprint, exportRemoteRealtimeDiagnostics } from "../src/remote-control/voice-diagnostics";
import { type VoiceCandidate, VoiceUatController, type VoiceUatHost } from "../src/remote-control/voice-uat-controller";
import { replaceSystemdVoiceService } from "../src/remote-control/voice-uat-systemd";

const unit = "xcsh-remote-control.service";
const dropInDirectory = join(process.env.HOME ?? "", ".config/systemd/user", `${unit}.d`);
const taskDropIn = join(dropInDirectory, "zz-issue-4406-voice-uat.conf");
const matrix = [
	"A01",
	"A02",
	"A03",
	"A04",
	"A05",
	"A06",
	"B01",
	"B02",
	"B03",
	"B04",
	"B05",
	"C01",
	"C02",
	"C03",
	"C04",
	"C05",
	"C06",
	"C07",
	"D01",
	"D02",
	"D03",
] as const;

function options(argv: string[]): { operation: string; values: Map<string, string> } {
	const [operation = "", ...rest] = argv;
	const values = new Map<string, string>();
	for (let index = 0; index < rest.length; index += 2) {
		if (!rest[index]?.startsWith("--") || rest[index + 1] == null) throw new Error(`Invalid option: ${rest[index]}`);
		values.set(rest[index].slice(2), rest[index + 1]);
	}
	return { operation, values };
}
function required(values: Map<string, string>, key: string): string {
	const value = values.get(key);
	if (!value) throw new Error(`Missing --${key}`);
	return value;
}
async function command(argv: string[]): Promise<string> {
	const child = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exit] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exit !== 0) throw new Error(`${argv[0]} failed (${exit}): ${stderr.trim()}`);
	return stdout;
}
const sha256 = async (file: string) =>
	createHash("sha256")
		.update(await readFile(file))
		.digest("hex");
async function atomicWrite(file: string, contents: string, mode = 0o600): Promise<void> {
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, contents, { mode });
	await rename(temporary, file);
}
async function status(): Promise<Record<string, unknown>> {
	return JSON.parse(await command(["/home/robin/.local/bin/xcsh", "remote-control", "status", "--json"])) as Record<
		string,
		unknown
	>;
}
async function systemdProperties(): Promise<Record<string, string>> {
	const output = await command([
		"systemctl",
		"--user",
		"show",
		unit,
		"--property=MainPID,InvocationID,ExecStart,FragmentPath,DropInPaths,ActiveState,SubState",
	]);
	return Object.fromEntries(
		output
			.trim()
			.split("\n")
			.map(line => line.split(/=(.*)/s).slice(0, 2)),
	);
}
class SystemdVoiceUatHost implements VoiceUatHost {
	constructor(private readonly runDirectory: string) {}
	async activeVoiceCall(): Promise<boolean> {
		return Number((await status()).liveSessions ?? 0) > 0;
	}
	async captureBaseline() {
		const properties = await systemdProperties();
		const fragment = properties.FragmentPath;
		if (!fragment) throw new Error("Voice service fragment path is unavailable");
		const paths = properties.DropInPaths?.split(" ").filter(Boolean) ?? [];
		const unitBytes = await readFile(fragment, "utf8");
		const dropIns: Record<string, string> = Object.fromEntries(
			await Promise.all(paths.map(async path => [path, await readFile(path, "utf8")] as const)),
		);
		const hashes: Record<string, string> = { [fragment]: createHash("sha256").update(unitBytes).digest("hex") };
		for (const [path, bytes] of Object.entries(dropIns))
			hashes[path] = createHash("sha256").update(bytes).digest("hex");
		const pid = Number(properties.MainPID);
		const executable = await realpath(`/proc/${pid}/exe`);
		let commit: string | null = null;
		try {
			const provenance = JSON.parse(await readFile(join(dirname(executable), "provenance.json"), "utf8")) as Record<
				string,
				unknown
			>;
			const value = provenance.sourceCommit ?? provenance.commit;
			if (typeof value === "string" && /^[a-f0-9]{40}$/.test(value)) commit = value;
		} catch {}
		const health = await status();
		return {
			unit: JSON.stringify({ path: fragment, bytes: unitBytes }),
			dropIns,
			hashes,
			runtime: {
				executable,
				commit,
				version: (await command([executable, "--version"])).trim(),
				sha256: await sha256(executable),
				pid,
				invocationId: properties.InvocationID,
				health,
			},
		};
	}
	async installCandidate(candidate: VoiceCandidate): Promise<void> {
		await mkdir(dropInDirectory, { recursive: true, mode: 0o700 });
		await atomicWrite(
			taskDropIn,
			`[Service]\nExecStart=\nExecStart=${candidate.executable} remote-control supervisor\nExecStop=\nExecStop=${candidate.executable} remote-control quiesce\n`,
		);
		await command(["systemctl", "--user", "daemon-reload"]);
	}
	async setCaptureEnvironment(directory: string, scenario: string, salt: string, expectedReconnect: boolean) {
		await command([
			"systemctl",
			"--user",
			"set-environment",
			`XCSH_REMOTE_TRACE_DIRECTORY=${directory}`,
			`XCSH_REMOTE_TRACE_SCENARIO=${scenario.toLowerCase()}`,
			`XCSH_REMOTE_TRACE_SALT=${salt}`,
			`XCSH_VOICE_UAT_DIRECTORY=${directory}`,
			`XCSH_VOICE_EXPECTED_RECONNECT=${expectedReconnect ? "1" : "0"}`,
		]);
		await writeFile(join(directory, ".sample"), "", { mode: 0o600 });
		const child = Bun.spawn([process.execPath, import.meta.path, "__sample", "--directory", directory], {
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			detached: true,
		});
		await writeFile(join(directory, "sampler.pid"), `${child.pid}\n`, { mode: 0o600 });
		child.unref();
	}
	async clearCaptureEnvironment() {
		await command([
			"systemctl",
			"--user",
			"unset-environment",
			"XCSH_REMOTE_TRACE_DIRECTORY",
			"XCSH_REMOTE_TRACE_SCENARIO",
			"XCSH_REMOTE_TRACE_SALT",
			"XCSH_VOICE_UAT_DIRECTORY",
			"XCSH_VOICE_EXPECTED_RECONNECT",
		]);
	}
	async restart() {
		const state = JSON.parse(await readFile(join(this.runDirectory, "controller.json"), "utf8")) as {
			candidate: VoiceCandidate;
		};
		await replaceSystemdVoiceService({
			unit,
			quiesceExecutable: state.candidate.executable,
			properties: systemdProperties,
			command,
			wait: Bun.sleep,
		});
	}
	async verifyCandidate(candidate: VoiceCandidate): Promise<boolean> {
		const properties = await systemdProperties();
		if (properties.ActiveState !== "active" || properties.SubState !== "running") return false;
		const pid = Number(properties.MainPID);
		if (!Number.isInteger(pid) || pid < 1 || !properties.InvocationID) return false;
		if ((await realpath(`/proc/${pid}/exe`)) !== (await realpath(candidate.executable))) return false;
		if ((await sha256(candidate.executable)) !== candidate.sha256) return false;
		const version = await command([candidate.executable, "--version"]);
		if (!version.includes(candidate.version.replace(/^v/, ""))) return false;
		const live = await status();
		return live.relay === "connected" && live.supervisorState === "running" && live.hostState === "running";
	}
	async restore(baseline: Awaited<ReturnType<VoiceUatHost["captureBaseline"]>>) {
		const parsed = JSON.parse(baseline.unit) as { path: string; bytes: string };
		await atomicWrite(parsed.path, parsed.bytes);
		for (const [path, bytes] of Object.entries(baseline.dropIns)) await atomicWrite(path, bytes);
		if (!(taskDropIn in baseline.dropIns)) await rm(taskDropIn, { force: true });
		await command(["systemctl", "--user", "daemon-reload"]);
	}
	async journalAnchor(): Promise<string> {
		const output = await command(["journalctl", "--user", "-u", unit, "-n", "0", "--show-cursor"]);
		const match = output.match(/-- cursor: (.+)/);
		if (!match) throw new Error("Unable to anchor the systemd journal");
		return match[1];
	}
	async collectRow(directory: string, anchor: string) {
		await rm(join(directory, ".sample"), { force: true });
		try {
			const pid = Number((await readFile(join(directory, "sampler.pid"), "utf8")).trim());
			if (Number.isInteger(pid) && pid > 1) process.kill(pid, "SIGTERM");
		} catch {}
		const journal = await command([
			"journalctl",
			"--user",
			"-u",
			unit,
			`--after-cursor=${anchor}`,
			"--output=json",
			"--no-pager",
		]);
		const journalFile = join(directory, "journal.jsonl");
		await writeFile(journalFile, journal, { mode: 0o600 });
		const evidenceFiles = (await readdir(directory))
			.filter(name => name.endsWith(".jsonl") || name.endsWith(".json"))
			.map(name => join(directory, name));
		const findings: string[] = [];
		for (const line of journal.trim().split("\n").filter(Boolean)) {
			const row = JSON.parse(line) as Record<string, unknown>;
			const priority = Number(row.PRIORITY);
			if (priority <= 4 || /exit-code|control group|killed process/i.test(String(row.MESSAGE ?? ""))) {
				const fingerprint = canonicalWarningFingerprint({
					source: "journal",
					unit,
					priority,
					message: String(row.MESSAGE ?? ""),
					exitStatus: null,
					stage: "row",
					candidateSha: (JSON.parse(await readFile(join(this.runDirectory, "controller.json"), "utf8")) as any)
						.candidate.commit,
				});
				findings.push(fingerprint.value);
			}
		}
		return { evidenceFiles, findings: [...new Set(findings)], receipts: ["post-close-60s"] };
	}
}

async function sample(directory: string): Promise<void> {
	const output = join(directory, "resources.jsonl");
	while (true) {
		try {
			await stat(join(directory, ".sample"));
		} catch {
			return;
		}
		try {
			const properties = await systemdProperties();
			const pid = Number(properties.MainPID);
			const descriptors = await readdir(`/proc/${pid}/fd`);
			let sockets = 0;
			for (const descriptor of descriptors)
				try {
					if ((await readlink(`/proc/${pid}/fd/${descriptor}`)).startsWith("socket:[")) sockets++;
				} catch {}
			const statusText = await readFile(`/proc/${pid}/status`, "utf8");
			const rssKiB = Number(statusText.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0);
			await Bun.write(
				Bun.file(output),
				`${await Bun.file(output)
					.text()
					.catch(
						() => "",
					)}${JSON.stringify({ kind: "resourceDiagnostic", atUnixMs: Date.now(), rssBytes: rssKiB * 1024, fileDescriptors: descriptors.length, sockets, processState: properties.SubState, pid, invocationId: properties.InvocationID })}\n`,
			);
			await chmod(output, 0o600);
		} catch {}
		await Bun.sleep(10_000);
	}
}

async function main(): Promise<void> {
	const parsed = options(process.argv.slice(2));
	if (parsed.operation === "__sample") return sample(required(parsed.values, "directory"));
	if (parsed.operation === "help" || parsed.operation === "--help" || !parsed.operation) {
		console.log(
			"voice-uat-controller <prepare|deploy|start-row|finish-row|analyze|repair|finalize|restore> --run-dir PATH ...",
		);
		return;
	}
	const runDirectory = required(parsed.values, "run-dir");
	const host = new SystemdVoiceUatHost(runDirectory);
	const controller = new VoiceUatController(runDirectory, host);
	if (parsed.operation === "prepare") {
		const source = required(parsed.values, "binary");
		const destinationDirectory = join(runDirectory, "candidate");
		await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
		const executable = join(destinationDirectory, "xcsh-linux-x64");
		await copyFile(source, executable);
		await chmod(executable, 0o500);
		const candidate: VoiceCandidate = {
			commit: required(parsed.values, "commit"),
			version: required(parsed.values, "version"),
			sha256: await sha256(executable),
			executable,
		};
		await controller.prepare(candidate, matrix);
	} else if (parsed.operation === "deploy") await controller.deploy();
	else if (parsed.operation === "start-row")
		await controller.startRow(required(parsed.values, "row"), parsed.values.get("expected-reconnect") === "true");
	else if (parsed.operation === "finish-row")
		await controller.finishRow(required(parsed.values, "row"), {
			connection: required(parsed.values, "connection") === "pass",
			caption: required(parsed.values, "caption") === "pass",
			heardAudio: required(parsed.values, "heard-audio") === "pass",
		});
	else if (parsed.operation === "repair")
		await controller.repair(
			required(parsed.values, "row"),
			required(parsed.values, "finding"),
			required(parsed.values, "repair"),
		);
	else if (parsed.operation === "analyze") {
		const row = required(parsed.values, "row");
		const directories = (await readdir(join(runDirectory, "rows"), { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && entry.name.startsWith(row.toLowerCase()))
			.map(entry => join(runDirectory, "rows", entry.name));
		const captureFiles = (
			await Promise.all(
				directories.map(async directory =>
					(
						await readdir(directory)
					)
						.filter(name => name.endsWith(".jsonl") && name !== "journal.jsonl" && name !== "resources.jsonl")
						.map(name => join(directory, name)),
				),
			)
		).flat();
		console.log(
			JSON.stringify(await controller.analyze({ captureFiles, journal: [], resources: [], allowlist: [] }), null, 2),
		);
	} else if (parsed.operation === "finalize") {
		const entries: unknown[] = [];
		for (const directory of (await readdir(join(runDirectory, "rows"), { withFileTypes: true })).filter(entry =>
			entry.isDirectory(),
		)) {
			for (const name of await readdir(join(runDirectory, "rows", directory.name))) {
				if (!name.endsWith(".jsonl")) continue;
				for (const line of (await readFile(join(runDirectory, "rows", directory.name, name), "utf8"))
					.split("\n")
					.filter(Boolean))
					try {
						entries.push(JSON.parse(line));
					} catch {}
			}
		}
		console.log(await controller.finalize(exportRemoteRealtimeDiagnostics(entries)));
	} else if (parsed.operation === "restore") await controller.restore();
	else throw new Error(`Unknown operation: ${parsed.operation}`);
}
await main();
