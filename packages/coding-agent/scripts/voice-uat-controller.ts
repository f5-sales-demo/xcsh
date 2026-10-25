#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	appendFile,
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
import { basename, dirname, join } from "node:path";
import { verifyTraceArtifactProvenance } from "../src/remote-control/trace-assembler";
import {
	analyzeVoiceReplayBeforeClose,
	canonicalWarningFingerprint,
	type VoiceCheckpoint,
	type VoiceTranscriptEvidence,
	voiceAcceptancePolicy,
} from "../src/remote-control/voice-diagnostics";
import {
	activeVoiceCallFromStatus,
	latestVoiceResourcePhase,
	type VoiceCandidate,
	VoiceUatController,
	type VoiceUatHost,
	voiceCandidateArtifactPath,
} from "../src/remote-control/voice-uat-controller";
import { replaceSystemdVoiceService, withSignalSafeRecovery } from "../src/remote-control/voice-uat-systemd";

const unit = "xcsh-remote-control.service";
const installedXcsh = join(process.env.HOME ?? "", ".local/bin/xcsh");
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
function transcriptEvidence(values: Map<string, string>): VoiceTranscriptEvidence | undefined {
	const keys = ["durable-user-segments", "durable-assistant-segments", "transcript-visibility", "transcript-complete"];
	const supplied = keys.filter(key => values.has(key));
	if (!supplied.length) return;
	if (supplied.length !== keys.length)
		throw new Error(
			"Supply both durable segment counts, transcript visibility, and --transcript-complete true|false together",
		);
	const durableUserSegments = Number(required(values, "durable-user-segments"));
	const durableAssistantSegments = Number(required(values, "durable-assistant-segments"));
	if (
		!Number.isSafeInteger(durableUserSegments) ||
		durableUserSegments < 0 ||
		!Number.isSafeInteger(durableAssistantSegments) ||
		durableAssistantSegments < 0
	)
		throw new Error("Durable transcript segment counts must be non-negative integers");
	const visibility = required(values, "transcript-visibility");
	if (
		!new Set(["live-visible", "session-list-selectable", "reopen-only", "durable-absent", "not-visible"]).has(
			visibility,
		)
	)
		throw new Error(
			"Transcript visibility must be live-visible, session-list-selectable, reopen-only, durable-absent, or not-visible",
		);
	const complete = required(values, "transcript-complete");
	if (complete !== "true" && complete !== "false") throw new Error("Transcript completeness must be true or false");
	return {
		schemaVersion: 1,
		visibility: visibility as import("../src/remote-control/voice-diagnostics").VoiceTranscriptOutcome,
		transcriptComplete: complete === "true",
		durableUserSegments,
		durableAssistantSegments,
	};
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
	return JSON.parse(await command([installedXcsh, "remote-control", "status", "--json"])) as Record<string, unknown>;
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
	async activeVoiceCall(directory?: string): Promise<boolean> {
		if (directory) {
			let completed = 0;
			let incomplete = 0;
			for (const name of await readdir(directory).catch(() => [])) {
				if (!/^voice-.*\.jsonl$/.test(name)) continue;
				try {
					const rows = (await readFile(join(directory, name), "utf8"))
						.trim()
						.split("\n")
						.filter(Boolean)
						.map(line => JSON.parse(line) as Record<string, unknown>);
					const footer = rows.at(-1);
					if (
						footer?.kind === "footer" &&
						footer.complete === true &&
						rows.some(
							row =>
								row.kind === "event" && (row.message as Record<string, unknown> | undefined)?.type === "closed",
						)
					)
						completed++;
					else incomplete++;
				} catch {
					incomplete++;
				}
			}
			if (incomplete === 0 && completed > 0) return false;
		}
		return activeVoiceCallFromStatus(await status());
	}
	async verifyCandidateArtifact(candidate: VoiceCandidate): Promise<boolean> {
		try {
			const provenance = await verifyTraceArtifactProvenance(candidate.executable, candidate.commit);
			if (provenance.artifactSha256 !== candidate.sha256) return false;
			return (await command([candidate.executable, "--version"])).includes(candidate.version.replace(/^v/, ""));
		} catch {
			return false;
		}
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
		if (!commit) {
			const pathCommit = basename(dirname(executable));
			if (/^[a-f0-9]{40}$/.test(pathCommit)) {
				await verifyTraceArtifactProvenance(executable, pathCommit);
				commit = pathCommit;
			}
		}
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
	}
	async startResourceSampling(directory: string) {
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
	async stopResourceSampling(directory: string) {
		await rm(join(directory, ".sample"), { force: true });
		try {
			const pid = Number((await readFile(join(directory, "sampler.pid"), "utf8")).trim());
			if (Number.isInteger(pid) && pid > 1) process.kill(pid, "SIGTERM");
		} catch {}
	}
	async inspectRowActivity(directory: string) {
		let callActivityAtUnixMs: number | undefined;
		let sessionReadyAtUnixMs: number | undefined;
		let closedAtUnixMs: number | undefined;
		for (const name of await readdir(directory).catch(() => [])) {
			if (!/^voice-.*\.jsonl$/.test(name)) continue;
			let startedAtUnixMs = 0;
			try {
				for (const line of (await readFile(join(directory, name), "utf8")).split("\n").filter(Boolean)) {
					const row = JSON.parse(line) as Record<string, unknown>;
					if (row.kind === "manifest" && typeof row.startedAtUnixMs === "number")
						startedAtUnixMs = row.startedAtUnixMs;
					if (row.kind !== "event") continue;
					const message = row.message as Record<string, unknown> | undefined;
					const type = typeof message?.type === "string" ? message.type : "";
					const method = typeof message?.method === "string" ? message.method : "";
					const atUnixMs =
						typeof row.atUnixMs === "number"
							? row.atUnixMs
							: startedAtUnixMs + (typeof row.elapsedMs === "number" ? row.elapsedMs : 0);
					if (
						callActivityAtUnixMs == null &&
						(method === "thread/realtime/start" || /^(session|turn|input_|output_|delegation\.)/.test(type))
					)
						callActivityAtUnixMs = atUnixMs;
					if (type === "session.started" || type === "session.created") sessionReadyAtUnixMs ??= atUnixMs;
					if (type === "session.closed" || type === "closed" || method === "thread/realtime/closed")
						closedAtUnixMs = atUnixMs;
				}
			} catch {}
		}
		return { callActivityAtUnixMs, sessionReadyAtUnixMs, closedAtUnixMs };
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
	async verifyBaseline(baseline: Awaited<ReturnType<VoiceUatHost["captureBaseline"]>>) {
		try {
			for (const [path, expected] of Object.entries(baseline.hashes))
				if ((await sha256(path)) !== expected) return false;
			if (!(taskDropIn in baseline.dropIns)) {
				try {
					await stat(taskDropIn);
					return false;
				} catch {}
			}
			if (!baseline.runtime) return true;
			const properties = await systemdProperties();
			if (properties.ActiveState !== "active" || properties.SubState !== "running") return false;
			const pid = Number(properties.MainPID);
			if (!Number.isInteger(pid) || pid < 1 || !properties.InvocationID) return false;
			if ((await realpath(`/proc/${pid}/exe`)) !== (await realpath(baseline.runtime.executable))) return false;
			if ((await sha256(baseline.runtime.executable)) !== baseline.runtime.sha256) return false;
			if ((await command([baseline.runtime.executable, "--version"])).trim() !== baseline.runtime.version)
				return false;
			if (baseline.runtime.commit) {
				const provenance = await verifyTraceArtifactProvenance(
					baseline.runtime.executable,
					baseline.runtime.commit,
				);
				if (provenance.artifactSha256 !== baseline.runtime.sha256) return false;
			}
			const health = await status();
			for (const key of ["relay", "supervisorState", "hostState"])
				if (baseline.runtime.health[key] != null && health[key] !== baseline.runtime.health[key]) return false;
			return true;
		} catch {
			return false;
		}
	}
	async journalAnchor(): Promise<string> {
		const output = await command(["journalctl", "--user", "-u", unit, "-n", "0", "--show-cursor"]);
		const match = output.match(/-- cursor: (.+)/);
		if (!match) throw new Error("Unable to anchor the systemd journal");
		return match[1];
	}
	async collectRow(directory: string, anchor: string) {
		await this.stopResourceSampling(directory);
		const journalFile = join(directory, "journal.jsonl");
		const journal = anchor
			? await command([
					"journalctl",
					"--user",
					"-u",
					unit,
					`--after-cursor=${anchor}`,
					"--output=json",
					"--no-pager",
				])
			: await readFile(journalFile, "utf8").catch(() => "");
		if (anchor) await writeFile(journalFile, journal, { mode: 0o600 });
		const evidenceFiles = (await readdir(directory))
			.filter(name => name.endsWith(".jsonl") || name.endsWith(".json"))
			.map(name => join(directory, name));
		const captureFiles = evidenceFiles.filter(file => /^voice-.*\.jsonl$/.test(file.split("/").at(-1) ?? ""));
		const protocolFiles = evidenceFiles.filter(file => /^host-.*\.jsonl$/.test(file.split("/").at(-1) ?? ""));
		const checkpoints: VoiceCheckpoint[] = [];
		for (const file of evidenceFiles.filter(file => file.endsWith(".checkpoint.json")))
			try {
				const checkpoint = JSON.parse(await readFile(file, "utf8")) as Partial<VoiceCheckpoint>;
				if (
					Number.isInteger(checkpoint.revision) &&
					typeof checkpoint.writtenAtUnixMs === "number" &&
					typeof checkpoint.eventCount === "number" &&
					typeof checkpoint.reconnectAttempts === "number" &&
					typeof checkpoint.queuePressure === "number" &&
					typeof checkpoint.droppedFrames === "number" &&
					checkpoint.stageTimingsMs != null &&
					checkpoint.resources != null
				)
					checkpoints.push(checkpoint as VoiceCheckpoint);
			} catch {}
		const connectedAt = Math.min(
			...checkpoints
				.filter(row => row.lifecycle === "connected" && typeof row.writtenAtUnixMs === "number")
				.map(row => Number(row.writtenAtUnixMs)),
		);
		const closedAt = Math.max(
			...checkpoints
				.filter(
					row => ["closed", "failed"].includes(String(row.lifecycle)) && typeof row.writtenAtUnixMs === "number",
				)
				.map(row => Number(row.writtenAtUnixMs)),
		);
		const resources: Array<{
			atUnixMs: number;
			rssBytes: number;
			fileDescriptors: number;
			sockets: number;
			phase: "preflight" | "active" | "post-close";
			pid?: number;
			processState?: string;
			invocationId?: string;
		}> = [];
		const resourceFile = join(directory, "resources.jsonl");
		try {
			for (const line of (await readFile(resourceFile, "utf8")).trim().split("\n").filter(Boolean)) {
				const row = JSON.parse(line) as Record<string, unknown>;
				if (
					typeof row.atUnixMs !== "number" ||
					typeof row.rssBytes !== "number" ||
					typeof row.fileDescriptors !== "number" ||
					typeof row.sockets !== "number"
				)
					continue;
				resources.push({
					atUnixMs: row.atUnixMs,
					rssBytes: row.rssBytes,
					fileDescriptors: row.fileDescriptors,
					sockets: row.sockets,
					phase: ["preflight", "active", "post-close"].includes(String(row.phase))
						? (row.phase as "preflight" | "active" | "post-close")
						: Number.isFinite(closedAt) && row.atUnixMs >= closedAt
							? "post-close"
							: Number.isFinite(connectedAt) && row.atUnixMs >= connectedAt
								? "active"
								: "preflight",
					...(typeof row.pid === "number" ? { pid: row.pid } : {}),
					...(typeof row.processState === "string" ? { processState: row.processState } : {}),
					...(typeof row.invocationId === "string" ? { invocationId: row.invocationId } : {}),
				});
			}
		} catch {}
		const journalRows: Array<{ atUnixMs: number; message: string; fingerprint?: string }> = [];
		const processExits: Array<{ exitStatus: number | null; signal: string | null; expected: boolean }> = [];
		const rowId = basename(directory)
			.match(/^([a-d]\d{2})(?:-|$)/i)?.[1]
			?.toUpperCase();
		const candidateSha = (
			JSON.parse(await readFile(join(this.runDirectory, "controller.json"), "utf8")) as {
				candidate: VoiceCandidate;
			}
		).candidate.sha256;
		const stageAt = (atUnixMs: number) =>
			[...resources]
				.filter(sample => sample.atUnixMs <= atUnixMs)
				.sort((left, right) => right.atUnixMs - left.atUnixMs)[0]?.phase ?? "row";
		for (const line of journal.trim().split("\n").filter(Boolean)) {
			const row = JSON.parse(line) as Record<string, unknown>;
			const priority = Number(row.PRIORITY);
			if (priority <= 4 || /exit-code|control group|killed process/i.test(String(row.MESSAGE ?? ""))) {
				const atUnixMs = Number(row.__REALTIME_TIMESTAMP ?? 0) / 1000;
				const exitStatus = Number.isFinite(Number(row.EXIT_STATUS)) ? Number(row.EXIT_STATUS) : null;
				const fingerprint = canonicalWarningFingerprint({
					source: String(row.SYSLOG_IDENTIFIER ?? row._COMM ?? "journal"),
					unit: String(row._SYSTEMD_USER_UNIT ?? unit),
					priority: Number.isFinite(priority) ? priority : 4,
					message: String(row.MESSAGE ?? ""),
					exitStatus,
					stage: stageAt(atUnixMs),
					candidateSha,
				});
				journalRows.push({
					atUnixMs,
					message: String(row.MESSAGE ?? ""),
					fingerprint: fingerprint.value,
				});
			}
			if (row.EXIT_CODE != null || row.EXIT_STATUS != null) {
				const signal = row.EXIT_CODE === "killed" ? String(row.EXIT_STATUS ?? "unknown") : null;
				processExits.push({
					exitStatus: Number.isFinite(Number(row.EXIT_STATUS)) ? Number(row.EXIT_STATUS) : null,
					signal,
					expected: rowId === "C07" && signal != null,
				});
			}
		}
		const correlationGaps: string[] = [];
		let sessionStarted = false;
		let gracefulClose = false;
		for (const file of captureFiles)
			try {
				for (const line of (await readFile(file, "utf8")).trim().split("\n").filter(Boolean)) {
					const row = JSON.parse(line) as Record<string, unknown>;
					const type = (row.message as Record<string, unknown> | undefined)?.type;
					if (type === "session.started") sessionStarted = true;
					if (type === "session.close" || type === "closed") gracefulClose = true;
				}
			} catch {}
		if (!sessionStarted) correlationGaps.push("session.started");
		if (!gracefulClose) correlationGaps.push("graceful-close");
		const preflight = resources.filter(sample => sample.phase === "preflight").length;
		const postClose = resources.filter(sample => sample.phase === "post-close").length;
		const phaseSpan = (phase: "preflight" | "post-close") => {
			const samples = resources
				.filter(sample => sample.phase === phase)
				.sort((left, right) => left.atUnixMs - right.atUnixMs);
			return samples.length < 2 ? 0 : samples.at(-1)!.atUnixMs - samples[0].atUnixMs;
		};
		const stageTimings = checkpoints.flatMap(row =>
			row.stageTimingsMs && typeof row.stageTimingsMs === "object"
				? Object.entries(row.stageTimingsMs as Record<string, unknown>)
						.filter((entry): entry is [string, number] => typeof entry[1] === "number")
						.map(([stage, elapsedMs]) => ({ stage, elapsedMs, baselineMs: elapsedMs }))
				: [],
		);
		return {
			evidenceFiles,
			findings: [],
			receipts: [
				...(postClose >= 3 && phaseSpan("post-close") >= 50_000 ? ["post-close-60s"] : []),
				...(preflight >= 3 && phaseSpan("preflight") >= 18_000 ? ["preflight-3x10s"] : []),
				...((await analyzeVoiceReplayBeforeClose(protocolFiles)).length === 0 ? ["replay-before-close"] : []),
			],
			analysis: {
				captureFiles,
				protocolFiles,
				journal: journalRows,
				resources,
				allowlist: [],
				checkpoints,
				correlationGaps,
				stageTimings,
				processExits,
			},
		};
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
			const checkpoints: Array<{ writtenAtUnixMs: number; lifecycle?: string }> = [];
			for (const name of (await readdir(directory)).filter(name => name.endsWith(".checkpoint.json"))) {
				try {
					const checkpoint = JSON.parse(await readFile(join(directory, name), "utf8")) as Record<string, unknown>;
					if (typeof checkpoint.writtenAtUnixMs === "number")
						checkpoints.push({
							writtenAtUnixMs: checkpoint.writtenAtUnixMs,
							...(typeof checkpoint.lifecycle === "string" ? { lifecycle: checkpoint.lifecycle } : {}),
						});
				} catch {}
			}
			const phase = latestVoiceResourcePhase(checkpoints);
			await appendFile(
				output,
				`${JSON.stringify({ kind: "resourceDiagnostic", stage: phase, phase, atUnixMs: Date.now(), rssBytes: rssKiB * 1024, fileDescriptors: descriptors.length, sockets, processState: properties.SubState, pid, invocationId: properties.InvocationID })}\n`,
				{ mode: 0o600 },
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
			"voice-uat-controller <prepare|deploy|start-row|watch-row|finish-row|import-human-outcomes|classify-warning|recover-row|status|render-checklist|analyze|repair|finalize|verify-published|restore> --run-dir PATH ...; prepare --acceptance-policy strict|session-list-selectable-v1; transcript evidence --durable-user-segments N --durable-assistant-segments N --transcript-visibility live-visible|session-list-selectable|reopen-only|durable-absent|not-visible --transcript-complete true|false",
		);
		return;
	}
	const runDirectory = required(parsed.values, "run-dir");
	const host = new SystemdVoiceUatHost(runDirectory);
	const controller = new VoiceUatController(runDirectory, host);
	if (parsed.operation !== "prepare" && parsed.values.has("acceptance-policy")) {
		const requested = voiceAcceptancePolicy(parsed.values.get("acceptance-policy"));
		const bound = voiceAcceptancePolicy((await controller.status()).state.acceptancePolicy);
		if (requested !== bound) throw new Error("Voice UAT acceptance policy mismatch");
	}
	if (parsed.operation === "prepare") {
		const policy = voiceAcceptancePolicy(parsed.values.get("acceptance-policy"));
		const source = required(parsed.values, "binary");
		const commit = required(parsed.values, "commit");
		const executable = voiceCandidateArtifactPath(runDirectory, commit);
		const destinationDirectory = dirname(executable);
		await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
		await copyFile(source, executable, constants.COPYFILE_EXCL);
		await chmod(executable, 0o500);
		const candidate: VoiceCandidate = {
			commit,
			version: required(parsed.values, "version"),
			sha256: await sha256(executable),
			executable,
			releaseTag: parsed.values.get("release-tag") ?? null,
			channel: parsed.values.get("channel") ?? "feature",
		};
		await controller.prepare(candidate, matrix, policy);
	} else if (parsed.operation === "deploy")
		await withSignalSafeRecovery(
			signal => controller.deploy(signal),
			() => controller.restore(),
		);
	else if (parsed.operation === "start-row")
		await controller.startRow(required(parsed.values, "row"), parsed.values.get("expected-reconnect") === "true");
	else if (parsed.operation === "watch-row")
		console.log(JSON.stringify(await controller.watchRow(required(parsed.values, "row")), null, 2));
	else if (parsed.operation === "finish-row") {
		const outcomeKeys = ["connection", "caption", "heard-audio"];
		const supplied = outcomeKeys.filter(key => parsed.values.has(key));
		if (supplied.length > 0 && supplied.length !== outcomeKeys.length)
			throw new Error("Supply all human outcomes or import them after capture");
		const outcomes = supplied.length
			? {
					connection: required(parsed.values, "connection") === "pass",
					caption: required(parsed.values, "caption") === "pass",
					heardAudio: required(parsed.values, "heard-audio") === "pass",
				}
			: undefined;
		console.log(
			JSON.stringify(
				await controller.finishRow(required(parsed.values, "row"), outcomes, transcriptEvidence(parsed.values)),
				null,
				2,
			),
		);
	} else if (parsed.operation === "import-human-outcomes")
		await controller.importHumanOutcomes(
			required(parsed.values, "row"),
			{
				connection: required(parsed.values, "connection") === "pass",
				caption: required(parsed.values, "caption") === "pass",
				heardAudio: required(parsed.values, "heard-audio") === "pass",
			},
			transcriptEvidence(parsed.values),
		);
	else if (parsed.operation === "classify-warning") {
		const ledger = (await controller.status()).ledger;
		const classifiedAtUnixMs = Date.now();
		await controller.classifyWarning({
			fingerprint: required(parsed.values, "fingerprint"),
			evidence: required(parsed.values, "evidence"),
			owner: required(parsed.values, "owner"),
			issue: required(parsed.values, "issue"),
			artifactRange: required(parsed.values, "artifact-range"),
			candidateSha256: ledger.candidate.binarySha256,
			classifiedAtUnixMs,
			...(parsed.values.has("remediation") ? { remediation: required(parsed.values, "remediation") } : {}),
			...(parsed.values.has("benign-rationale")
				? { benignRationale: required(parsed.values, "benign-rationale") }
				: {}),
			expiresAtUnixMs: Number(parsed.values.get("expires-at-ms") ?? classifiedAtUnixMs + 30 * 24 * 60 * 60 * 1000),
		});
	} else if (parsed.operation === "recover-row")
		console.log(
			JSON.stringify(
				await controller.recoverRow(
					required(parsed.values, "row"),
					required(parsed.values, "reason"),
					parsed.values.get("state") === "invalidated" ? "invalidated" : "interrupted",
				),
				null,
				2,
			),
		);
	else if (parsed.operation === "status") console.log(JSON.stringify(await controller.status(), null, 2));
	else if (parsed.operation === "render-checklist") console.log(await controller.renderChecklist());
	else if (parsed.operation === "repair")
		await controller.repair(
			required(parsed.values, "row"),
			required(parsed.values, "finding"),
			required(parsed.values, "repair"),
		);
	else if (parsed.operation === "analyze") {
		const row = required(parsed.values, "row");
		console.log(JSON.stringify(await controller.analyzeRow(row), null, 2));
	} else if (parsed.operation === "finalize") console.log(JSON.stringify(await controller.finalize(), null, 2));
	else if (parsed.operation === "verify-published") {
		const binary = required(parsed.values, "binary");
		console.log(
			JSON.stringify(
				await controller.verifyPublishedArtifact({
					commit: required(parsed.values, "commit"),
					version: required(parsed.values, "version"),
					sha256: await sha256(binary),
					executable: binary,
					releaseTag: required(parsed.values, "release-tag"),
					channel: parsed.values.get("channel") ?? "stable",
				}),
				null,
				2,
			),
		);
	} else if (parsed.operation === "restore") await controller.restore();
	else throw new Error(`Unknown operation: ${parsed.operation}`);
}
await main();
