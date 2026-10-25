/** Content-free, crash-safe evidence primitives for physical Realtime voice UAT. */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const stages = new Set(["starting", "connected", "reconnecting", "closed", "failed"]);
const counters = ["eventCount", "reconnectAttempts", "queuePressure", "droppedFrames"] as const;

export interface VoiceResourceSample {
	atUnixMs: number;
	rssBytes: number;
	fileDescriptors: number;
	sockets: number;
	phase?: "preflight" | "active" | "post-close";
	pid?: number;
	processState?: string;
	invocationId?: string;
}
export interface VoiceCheckpoint {
	revision: number;
	writtenAtUnixMs: number;
	eventCount: number;
	reconnectAttempts: number;
	queuePressure: number;
	droppedFrames: number;
	unexpectedReconnects?: number;
	inboundQueueBytes?: number;
	outboundQueueBytes?: number;
	inboundQueueHighWaterBytes?: number;
	outboundQueueHighWaterBytes?: number;
	rejectedEventClasses?: Record<string, number>;
	eventDispositions?: Record<string, number>;
	stageTimingsMs: Record<string, number>;
	delegation?: { active: boolean; pending: number; supersededExecutions: number };
	resources: Omit<VoiceResourceSample, "atUnixMs">;
	process?: { pid: number; state: string; invocationId?: string };
	lifecycle?: "starting" | "connected" | "reconnecting" | "closed" | "failed";
}
export type VoiceCheckpointInput = Omit<VoiceCheckpoint, "revision" | "writtenAtUnixMs">;
const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value) && value >= 0;
function validInput(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.stageTimingsMs) || !isRecord(value.resources)) return false;
	const resources = value.resources as Record<string, unknown>;
	const optionalCounters = [
		"unexpectedReconnects",
		"inboundQueueBytes",
		"outboundQueueBytes",
		"inboundQueueHighWaterBytes",
		"outboundQueueHighWaterBytes",
	] as const;
	return (
		counters.every(key => nonnegative(value[key])) &&
		optionalCounters.every(key => value[key] == null || nonnegative(value[key])) &&
		Object.values(value.stageTimingsMs).every(nonnegative) &&
		["rssBytes", "fileDescriptors", "sockets"].every(key => nonnegative(resources[key])) &&
		(value.rejectedEventClasses == null ||
			(isRecord(value.rejectedEventClasses) && Object.values(value.rejectedEventClasses).every(nonnegative)))
	);
}
function validCheckpoint(value: unknown): value is VoiceCheckpoint {
	if (!validInput(value) || !isRecord(value)) return false;
	const checkpoint = value as unknown as VoiceCheckpoint;
	return Number.isInteger(checkpoint.revision) && checkpoint.revision > 0 && nonnegative(checkpoint.writtenAtUnixMs);
}

/** Atomic revisioned checkpoints preserve the last safe state after process death. */
export class CheckpointStore {
	constructor(private readonly file: string) {
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		chmodSync(dirname(file), 0o700);
	}
	read(): VoiceCheckpoint | undefined {
		try {
			const value: unknown = JSON.parse(readFileSync(this.file, "utf8"));
			return validCheckpoint(value) ? value : undefined;
		} catch {
			return;
		}
	}
	write(input: VoiceCheckpointInput): VoiceCheckpoint {
		if (!validInput(input)) throw new Error("Invalid voice diagnostic checkpoint");
		const checkpoint: VoiceCheckpoint = {
			...input,
			revision: (this.read()?.revision ?? 0) + 1,
			writtenAtUnixMs: Date.now(),
		};
		const temporary = `${this.file}.${process.pid}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(checkpoint)}\n`, { mode: 0o600, flag: "w" });
		renameSync(temporary, this.file);
		return checkpoint;
	}
}

export interface VoiceRuntimeResourceSnapshot extends Omit<VoiceResourceSample, "atUnixMs"> {
	processState: string;
}
export interface VoiceDiagnosticRuntimeOptions {
	checkpointFile: string;
	now?: () => number;
	record?: (record: Record<string, unknown>) => void | Promise<void>;
	resources?: () => VoiceRuntimeResourceSnapshot;
}
function sampleProcessResources(): VoiceRuntimeResourceSnapshot {
	let fileDescriptors = 0;
	let sockets = 0;
	try {
		const descriptors = readdirSync("/proc/self/fd");
		fileDescriptors = descriptors.length;
		for (const descriptor of descriptors)
			try {
				if (readlinkSync(`/proc/self/fd/${descriptor}`).startsWith("socket:[")) sockets++;
			} catch {}
	} catch {}
	return {
		rssBytes: process.memoryUsage.rss(),
		fileDescriptors,
		sockets,
		processState: "running",
		...(process.env.INVOCATION_ID ? { invocationId: process.env.INVOCATION_ID } : {}),
	};
}

/** Per-process runtime state used by the UAT capture. It never stores session content. */
export class VoiceDiagnosticRuntime {
	readonly #store: CheckpointStore;
	readonly #cadence = new CheckpointCadence();
	readonly #now: () => number;
	readonly #record?: VoiceDiagnosticRuntimeOptions["record"];
	readonly #resources: () => VoiceRuntimeResourceSnapshot;
	readonly #startedAt: number;
	#timer: ReturnType<typeof setInterval>;
	#tail = Promise.resolve();
	#lifecycle: VoiceCheckpoint["lifecycle"] = "starting";
	#eventCount = 0;
	#reconnectAttempts = 0;
	#unexpectedReconnects = 0;
	#queuePressure = 0;
	#droppedFrames = 0;
	#inboundQueueBytes = 0;
	#outboundQueueBytes = 0;
	#inboundQueueHighWaterBytes = 0;
	#outboundQueueHighWaterBytes = 0;
	#rejectedEventClasses: Record<string, number> = {};
	#eventDispositions: Record<string, number> = {};
	#stageTimingsMs: Record<string, number> = {};
	#delegation = { active: false, pending: 0, supersededExecutions: 0 };
	#pressureSince: Partial<Record<"inbound" | "outbound", number>> = {};
	#pressureReported = new Set<string>();
	#closed = false;
	constructor(options: VoiceDiagnosticRuntimeOptions) {
		this.#store = new CheckpointStore(options.checkpointFile);
		this.#now = options.now ?? Date.now;
		this.#record = options.record;
		this.#resources = options.resources ?? sampleProcessResources;
		this.#startedAt = this.#now();
		this.#timer = setInterval(() => this.tick(), 30_000);
		this.#timer.unref?.();
	}
	#emit(record: Record<string, unknown>): void {
		if (!this.#record) return;
		this.#tail = this.#tail.then(() => this.#record!(record)).then(() => undefined);
	}
	#checkpoint(force = false): void {
		if (!force && !this.#cadence.shouldWrite(this.#eventCount, false, this.#now())) return;
		const sampled = this.#resources();
		const checkpoint = this.#store.write({
			eventCount: this.#eventCount,
			reconnectAttempts: this.#reconnectAttempts,
			unexpectedReconnects: this.#unexpectedReconnects,
			queuePressure: this.#queuePressure,
			droppedFrames: this.#droppedFrames,
			inboundQueueBytes: this.#inboundQueueBytes,
			outboundQueueBytes: this.#outboundQueueBytes,
			inboundQueueHighWaterBytes: this.#inboundQueueHighWaterBytes,
			outboundQueueHighWaterBytes: this.#outboundQueueHighWaterBytes,
			rejectedEventClasses: { ...this.#rejectedEventClasses },
			eventDispositions: { ...this.#eventDispositions },
			stageTimingsMs: { ...this.#stageTimingsMs },
			delegation: { ...this.#delegation },
			resources: {
				rssBytes: sampled.rssBytes,
				fileDescriptors: sampled.fileDescriptors,
				sockets: sampled.sockets,
			},
			process: {
				pid: process.pid,
				state: sampled.processState,
				...(typeof sampled.invocationId === "string" ? { invocationId: sampled.invocationId } : {}),
			},
			lifecycle: this.#lifecycle,
		});
		this.#emit({ kind: "voiceCheckpoint", ...checkpoint });
	}
	transition(lifecycle: NonNullable<VoiceCheckpoint["lifecycle"]>): void {
		this.#lifecycle = lifecycle;
		this.#cadence.shouldWrite(this.#eventCount, true, this.#now());
		this.#checkpoint(true);
	}
	event(_eventType: string, disposition: "handled" | "observed" | "rejected" = "handled", rejection?: string): void {
		this.#eventCount++;
		this.#eventDispositions[disposition] = (this.#eventDispositions[disposition] ?? 0) + 1;
		if (rejection) {
			this.#rejectedEventClasses[rejection] = (this.#rejectedEventClasses[rejection] ?? 0) + 1;
			if (rejection === "droppedFrame") this.#droppedFrames++;
		}
		this.#checkpoint();
	}
	queues(input: { inboundBytes: number; inboundLimit: number; outboundBytes: number; outboundLimit: number }): void {
		this.#inboundQueueBytes = input.inboundBytes;
		this.#outboundQueueBytes = input.outboundBytes;
		this.#inboundQueueHighWaterBytes = Math.max(this.#inboundQueueHighWaterBytes, input.inboundBytes);
		this.#outboundQueueHighWaterBytes = Math.max(this.#outboundQueueHighWaterBytes, input.outboundBytes);
		for (const direction of ["inbound", "outbound"] as const) {
			const bytes = direction === "inbound" ? input.inboundBytes : input.outboundBytes;
			const limit = direction === "inbound" ? input.inboundLimit : input.outboundLimit;
			const ratio = limit > 0 ? bytes / limit : 1;
			if (ratio < 0.75) {
				delete this.#pressureSince[direction];
				continue;
			}
			this.#pressureSince[direction] ??= this.#now();
			const sustained = this.#now() - this.#pressureSince[direction]! >= 30_000;
			const severity = bytes >= limit || sustained ? "failure" : "warning";
			const key = `${direction}:${severity}`;
			if (!this.#pressureReported.has(key)) {
				this.#pressureReported.add(key);
				this.#queuePressure++;
				this.#emit({ kind: "voiceUatFinding", severity, finding: "queue-pressure", direction, bytes, limit });
			}
		}
		this.#checkpoint();
	}
	reconnect(expected: boolean): void {
		this.#reconnectAttempts++;
		if (!expected) {
			this.#unexpectedReconnects++;
			this.#emit({ kind: "voiceUatFinding", severity: "failure", finding: "unexpected-reconnect" });
		}
		this.transition("reconnecting");
	}
	stage(name: string, elapsedMs: number): void {
		if (nonnegative(elapsedMs)) this.#stageTimingsMs[name] = elapsedMs;
		this.#checkpoint();
	}
	delegation(value: { active: boolean; pending: number; supersededExecutions: number }): void {
		this.#delegation = { ...value };
		this.#checkpoint();
	}
	tick(): void {
		if (!this.#closed) this.#checkpoint();
	}
	async close(lifecycle: "closed" | "failed" = "closed"): Promise<void> {
		if (this.#closed) return this.#tail;
		this.#closed = true;
		clearInterval(this.#timer);
		this.#stageTimingsMs.total = this.#now() - this.#startedAt;
		this.transition(lifecycle);
		await this.#tail;
	}
}

export function voiceDiagnosticRuntimeFromEnvironment(
	record?: VoiceDiagnosticRuntimeOptions["record"],
): VoiceDiagnosticRuntime | undefined {
	const directory = process.env.XCSH_VOICE_UAT_DIRECTORY;
	if (!directory) return;
	return new VoiceDiagnosticRuntime({
		checkpointFile: join(directory, `voice-${process.pid}-${randomBytes(6).toString("hex")}.checkpoint.json`),
		record,
	});
}

/** Checkpoint at lifecycle changes, every 100 events, or at least every 30 seconds. */
export class CheckpointCadence {
	#lastAt = 0;
	#lastEvents = 0;
	shouldWrite(eventCount: number, lifecycleChanged = false, now = Date.now()): boolean {
		if (lifecycleChanged || eventCount - this.#lastEvents >= 100 || now - this.#lastAt >= 30_000) {
			this.#lastAt = now;
			this.#lastEvents = eventCount;
			return true;
		}
		return false;
	}
}

function numberRecord(value: unknown): Record<string, number> | undefined {
	if (!isRecord(value)) return;
	const entries = Object.entries(value).filter(
		([key, item]) => /^[a-zA-Z0-9._/-]{1,128}$/.test(key) && nonnegative(item),
	);
	return Object.fromEntries(entries.map(([key, item]) => [key, item as number]));
}

/** Construct allowlisted diagnostics; do not sanitize arbitrary realtime session content. */
export function exportRemoteRealtimeDiagnostics(entries: readonly unknown[]): Array<Record<string, unknown>> {
	const seen = new Set<string>(),
		output: Array<Record<string, unknown>> = [];
	const allowlists: Record<string, readonly string[]> = {
		"remote-realtime": ["kind", "stage", ...counters],
		voiceDiagnostic: [
			"kind",
			"stage",
			"outcome",
			"elapsedMs",
			"connected",
			"failure",
			"httpStatus",
			"attempt",
			"eventType",
		],
		voicePolicyDiagnostic: ["kind", "policyVersion", "policySha256", "renderedInstructionsSha256", "outcome"],
		voiceRuntimeDiagnostic: ["kind", "runtimeContextSha256", "outcome"],
		delegationFailure: ["kind", "key", "failureClass", "outcome"],
		voiceAudioDiagnostic: ["kind", "frames", "samples", "signalFrames", "maxRms", "peak"],
		voiceEventDiagnostic: ["kind", "eventTypes", "dispositions", "rejections"],
		voiceCheckpoint: [
			"kind",
			"revision",
			"writtenAtUnixMs",
			"lifecycle",
			...counters,
			"unexpectedReconnects",
			"inboundQueueBytes",
			"outboundQueueBytes",
			"inboundQueueHighWaterBytes",
			"outboundQueueHighWaterBytes",
			"rejectedEventClasses",
			"eventDispositions",
			"stageTimingsMs",
			"delegation",
			"resources",
			"process",
		],
		lifecycleDiagnostic: ["kind", "stage", "state", "generation", "restartCount"],
		resourceDiagnostic: ["kind", "stage", "rssBytes", "fileDescriptors", "sockets", "processState"],
		processExitDiagnostic: ["kind", "stage", "exitStatus", "signal", "expected"],
	};
	for (const entry of entries) {
		if (!isRecord(entry) || typeof entry.kind !== "string") continue;
		const keys = allowlists[entry.kind];
		if (!keys) continue;
		if (entry.kind === "remote-realtime" && (typeof entry.stage !== "string" || !stages.has(entry.stage))) continue;
		const row: Record<string, unknown> = {};
		for (const key of keys) if (entry[key] !== undefined) row[key] = entry[key];
		if (entry.kind === "voiceAudioDiagnostic") {
			for (const key of keys.filter(key => key !== "kind"))
				if (typeof row[key] !== "number" || !Number.isSafeInteger(row[key]) || (row[key] as number) < 0)
					delete row[key];
		}
		if (["voicePolicyDiagnostic", "voiceRuntimeDiagnostic", "delegationFailure"].includes(entry.kind)) {
			for (const key of keys) {
				const value = row[key];
				if (key.endsWith("Sha256") || key === "key") {
					if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) delete row[key];
				} else if (key === "policyVersion") {
					if (typeof value !== "string" || !/^[0-9]{1,8}$/.test(value)) delete row[key];
				} else if (key === "outcome") {
					if (!["pending", "prepared", "acknowledged", "queued", "unresolved"].includes(String(value)))
						delete row[key];
				} else if (key === "failureClass") {
					if (!["execution", "transportProvider", "evidenceCollector"].includes(String(value))) delete row[key];
				}
			}
		}
		if (entry.kind === "voiceEventDiagnostic") {
			row.eventTypes = numberRecord(entry.eventTypes);
			row.dispositions = numberRecord(entry.dispositions);
			row.rejections = numberRecord(entry.rejections);
		}
		if (entry.kind === "voiceCheckpoint") {
			const rejectedEventClasses = numberRecord(entry.rejectedEventClasses);
			const eventDispositions = numberRecord(entry.eventDispositions);
			const stageTimingsMs = numberRecord(entry.stageTimingsMs);
			if (rejectedEventClasses) row.rejectedEventClasses = rejectedEventClasses;
			if (eventDispositions) row.eventDispositions = eventDispositions;
			if (stageTimingsMs) row.stageTimingsMs = stageTimingsMs;
			if (isRecord(entry.delegation))
				row.delegation = {
					active: entry.delegation.active === true,
					pending: nonnegative(entry.delegation.pending) ? entry.delegation.pending : 0,
					supersededExecutions: nonnegative(entry.delegation.supersededExecutions)
						? entry.delegation.supersededExecutions
						: 0,
				};
			if (isRecord(entry.resources))
				row.resources = {
					rssBytes: nonnegative(entry.resources.rssBytes) ? entry.resources.rssBytes : 0,
					fileDescriptors: nonnegative(entry.resources.fileDescriptors) ? entry.resources.fileDescriptors : 0,
					sockets: nonnegative(entry.resources.sockets) ? entry.resources.sockets : 0,
				};
			if (isRecord(entry.process))
				row.process = {
					pid: nonnegative(entry.process.pid) ? entry.process.pid : 0,
					state: typeof entry.process.state === "string" ? entry.process.state.slice(0, 32) : "unknown",
					...(typeof entry.process.invocationId === "string" &&
					/^[a-zA-Z0-9._-]{1,128}$/.test(entry.process.invocationId)
						? { invocationId: entry.process.invocationId }
						: {}),
				};
		}
		const fingerprint = JSON.stringify(row);
		if (!seen.has(fingerprint)) {
			seen.add(fingerprint);
			output.push(row);
		}
	}
	return output;
}

export interface VoiceScenario {
	directory: string;
	correlationSalt: string;
	manifest: { schemaVersion: 1; scenario: string; createdAtUnixMs: number };
}
export async function createVoiceScenario(parent: string, scenario: string): Promise<VoiceScenario> {
	if (!/^[a-z0-9-]{1,64}$/.test(scenario)) throw new Error("Invalid voice UAT scenario");
	await mkdir(parent, { recursive: true, mode: 0o700 });
	await chmod(parent, 0o700);
	const directory = join(parent, `${scenario}-${Date.now()}-${randomBytes(6).toString("hex")}`);
	await mkdir(directory, { mode: 0o700 });
	const manifest = { schemaVersion: 1 as const, scenario, createdAtUnixMs: Date.now() };
	await writeFile(join(directory, "manifest.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
	return { directory, correlationSalt: randomBytes(32).toString("hex"), manifest };
}

export interface WarningAllowlist {
	fingerprint: string;
	evidence: string;
	owner: string;
	issue: string;
	artifactRange: string;
	candidateSha256: string;
	classifiedAtUnixMs: number;
	remediation?: string;
	benignRationale?: string;
	expiresAtUnixMs: number;
}
export type VoiceAcceptancePolicy = "strict" | "session-list-selectable-v1";
export function voiceAcceptancePolicy(value: unknown = "strict"): VoiceAcceptancePolicy {
	if (value !== "strict" && value !== "session-list-selectable-v1") throw new Error("Invalid voice acceptance policy");
	return value;
}
export interface LegacyVoiceTranscriptEvidence {
	durableUserSegments: number;
	durableAssistantSegments: number;
	liveVisible: boolean;
	reopenVisible: boolean;
}
export type VoiceTranscriptOutcome =
	| "live-visible"
	| "session-list-selectable"
	| "reopen-only"
	| "durable-absent"
	| "not-visible";
export interface VersionedVoiceTranscriptEvidence {
	schemaVersion: 1;
	/** List selection requires immediate availability and complete history without an app or service restart. */
	visibility: VoiceTranscriptOutcome;
	durableUserSegments: number;
	durableAssistantSegments: number;
	transcriptComplete: boolean;
}
export type VoiceTranscriptEvidence = LegacyVoiceTranscriptEvidence | VersionedVoiceTranscriptEvidence;
export interface VoiceUatAnalysisInput {
	acceptancePolicy?: VoiceAcceptancePolicy;
	requireTranscriptEvidence?: boolean;
	captureFiles: readonly string[];
	protocolFiles?: readonly string[];
	journal: readonly { atUnixMs: number; message: string; fingerprint?: string }[];
	resources: readonly VoiceResourceSample[];
	allowlist: readonly WarningAllowlist[];
	checkpoints?: readonly VoiceCheckpoint[];
	correlationGaps?: readonly string[];
	humanOutcomes?: { connection: boolean; caption: boolean; heardAudio: boolean };
	transcriptEvidence?: VoiceTranscriptEvidence;
	stageTimings?: readonly { stage: string; elapsedMs: number; baselineMs: number }[];
	candidate?: { commit: string; binarySha256: string };
	processExits?: readonly { exitStatus: number | null; signal: string | null; expected: boolean }[];
	requirements?: {
		minimumEventCounts?: Readonly<Record<string, number>>;
		minimumDurationMs?: number;
		minimumCaptures?: number;
		minimumReconnects?: number;
		expectedRuntimeFailure?: boolean;
		expectedProcessExits?: number;
	};
}
export interface VoiceUatAnalysis {
	failures: string[];
	warnings: string[];
	trends: Record<string, number>;
	rows: Array<{ capture: string; events: number; complete: boolean }>;
	transcriptOutcome?: VoiceTranscriptOutcome;
}
export function analyzeVoiceTranscriptEvidence(
	input: VoiceTranscriptEvidence | undefined,
	policy: VoiceAcceptancePolicy = "strict",
	requireVersioned = false,
): { outcome?: VoiceTranscriptOutcome; failures: string[] } {
	voiceAcceptancePolicy(policy);
	if (!input) return { failures: ["transcript-evidence-pending"] };
	if (
		!Number.isSafeInteger(input.durableUserSegments) ||
		input.durableUserSegments < 0 ||
		!Number.isSafeInteger(input.durableAssistantSegments) ||
		input.durableAssistantSegments < 0
	)
		return { failures: ["invalid-transcript-evidence"] };
	const versioned = "schemaVersion" in input;
	if (versioned) {
		if (
			input.schemaVersion !== 1 ||
			typeof input.transcriptComplete !== "boolean" ||
			!["live-visible", "session-list-selectable", "reopen-only", "durable-absent", "not-visible"].includes(
				input.visibility,
			) ||
			"liveVisible" in input ||
			"reopenVisible" in input
		)
			return { failures: ["invalid-transcript-evidence"] };
	} else if (
		requireVersioned ||
		policy !== "strict" ||
		typeof input.liveVisible !== "boolean" ||
		typeof input.reopenVisible !== "boolean"
	)
		return { failures: ["invalid-transcript-evidence"] };
	const outcome = versioned
		? input.visibility
		: input.liveVisible
			? "live-visible"
			: input.reopenVisible
				? "reopen-only"
				: "not-visible";
	const durableSegments = input.durableUserSegments + input.durableAssistantSegments;
	if (!Number.isSafeInteger(durableSegments)) return { failures: ["invalid-transcript-evidence"] };
	if (durableSegments === 0)
		return {
			outcome: "durable-absent",
			failures: [
				"durable-transcript-absent",
				...(["live-visible", "session-list-selectable", "reopen-only"].includes(outcome) ||
				(versioned && input.transcriptComplete)
					? ["inconsistent-transcript-evidence"]
					: []),
			],
		};
	const failures: string[] = [];
	if (outcome === "durable-absent") failures.push("inconsistent-transcript-evidence");
	if (
		versioned &&
		(!input.transcriptComplete || input.durableUserSegments === 0 || input.durableAssistantSegments === 0)
	)
		failures.push("transcript-incomplete");
	if (outcome === "reopen-only") failures.push("transcript-visible-only-after-reopen");
	else if (outcome === "not-visible") failures.push("transcript-not-visible");
	else if (outcome === "session-list-selectable" && policy !== "session-list-selectable-v1")
		failures.push("transcript-visibility-not-accepted");
	return { outcome, failures };
}

/** Inspect only method ordering, never transcript or audio payloads. */
export async function analyzeVoiceReplayBeforeClose(files: readonly string[]): Promise<string[]> {
	let closes = 0;
	for (const file of files) {
		const rows = parseCapture(await readFile(file, "utf8"));
		if (!rows) return ["replay-before-close-missing"];
		const completed = new Set<string>();
		const closed = new Set<string>();
		for (const row of rows) {
			if (row.kind !== "event" || !isRecord(row.message)) continue;
			const method = row.message.method;
			if (method !== "turn/completed" && method !== "thread/realtime/closed" && method !== "thread/realtime/started")
				continue;
			const params = isRecord(row.message.params) ? row.message.params : undefined;
			const thread = params?.threadId;
			if (typeof thread !== "string" && !(isRecord(thread) && typeof thread.$ref === "string"))
				return ["replay-before-close-missing"];
			const key = JSON.stringify(thread);
			if (method === "thread/realtime/started") {
				closed.delete(key);
				completed.delete(key);
			} else if (method === "turn/completed") {
				if (closed.has(key)) return ["replay-after-close"];
				completed.add(key);
			} else {
				closes++;
				if (!completed.has(key)) return ["replay-before-close-missing"];
				completed.delete(key);
				closed.add(key);
			}
		}
	}
	return closes ? [] : ["replay-before-close-missing"];
}

/** Content-free projection of caller-provided evidence. */
export function exportVoiceTranscriptEvidence(input: VoiceTranscriptEvidence | undefined) {
	if (
		!input ||
		!Number.isSafeInteger(input.durableUserSegments) ||
		input.durableUserSegments < 0 ||
		!Number.isSafeInteger(input.durableAssistantSegments) ||
		input.durableAssistantSegments < 0
	)
		return undefined;
	if (
		"schemaVersion" in input &&
		(input.schemaVersion !== 1 ||
			typeof input.transcriptComplete !== "boolean" ||
			!["live-visible", "session-list-selectable", "reopen-only", "durable-absent", "not-visible"].includes(
				input.visibility,
			))
	)
		return undefined;
	if (
		!("schemaVersion" in input) &&
		(typeof input.liveVisible !== "boolean" || typeof input.reopenVisible !== "boolean")
	)
		return undefined;
	if ("schemaVersion" in input)
		return {
			schemaVersion: input.schemaVersion,
			visibility: input.visibility,
			durableUserSegments: input.durableUserSegments,
			durableAssistantSegments: input.durableAssistantSegments,
			transcriptComplete: input.transcriptComplete,
		};
	return {
		durableUserSegments: input.durableUserSegments,
		durableAssistantSegments: input.durableAssistantSegments,
		liveVisible: input.liveVisible,
		reopenVisible: input.reopenVisible,
	};
}
function validAllowlist(value: WarningAllowlist, now: number, candidateSha256?: string): boolean {
	return (
		/^[^\s]{1,128}$/.test(value.fingerprint) &&
		Boolean(value.evidence) &&
		Boolean(value.owner) &&
		/^#\d+$/.test(value.issue) &&
		Boolean(value.artifactRange) &&
		/^[a-f0-9]{64}$/.test(value.candidateSha256) &&
		(candidateSha256 == null || value.candidateSha256 === candidateSha256) &&
		Boolean(value.remediation || value.benignRationale) &&
		value.expiresAtUnixMs > now &&
		value.expiresAtUnixMs <= value.classifiedAtUnixMs + 30 * 24 * 60 * 60 * 1000
	);
}

export interface WarningFingerprintInput {
	source: string;
	unit: string;
	priority: number;
	message: string;
	exitStatus: number | null;
	stage: string;
	candidateSha: string;
}
export function canonicalWarningFingerprint(input: WarningFingerprintInput): { value: string; template: string } {
	const template = input.message.replace(/\d+/g, "<n>").replace(/\s+/g, " ").trim();
	const canonical = JSON.stringify([
		input.source,
		input.unit,
		input.priority,
		template,
		input.exitStatus,
		input.stage,
		input.candidateSha,
	]);
	return { value: createHash("sha256").update(canonical).digest("hex"), template };
}
function parseCapture(text: string): Record<string, unknown>[] | undefined {
	try {
		const rows = text
			.trim()
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line));
		return rows.every(isRecord) ? rows : undefined;
	} catch {
		return;
	}
}

export type VoiceTaskState = "pending" | "running" | "blocked" | "passed" | "invalidated" | "interrupted";
export interface VoiceRunAttempt {
	acceptancePolicy?: VoiceAcceptancePolicy;
	attempt: number;
	candidateCommit: string;
	binarySha256: string;
	releaseTag: string | null;
	channel: string;
	startedAtUnixMs: number;
	finishedAtUnixMs?: number;
	state: VoiceTaskState;
	evidenceHashes: string[];
	findings: string[];
	repairs: string[];
	warningClassifications: string[];
	receipts: string[];
	humanOutcomes?: { connection: boolean; caption: boolean; heardAudio: boolean };
	transcriptEvidence?: VoiceTranscriptEvidence;
}
export interface VoiceRunTask {
	projectTaskId: string;
	state: VoiceTaskState;
	attempts: VoiceRunAttempt[];
}
export interface VoiceLedgerCandidate {
	commit: string;
	binarySha256: string;
	releaseTag: string | null;
	channel: string;
}
export interface VoiceRunLedgerValue {
	schemaVersion: 2 | 3;
	acceptancePolicy?: VoiceAcceptancePolicy;
	revision: number;
	candidate: VoiceLedgerCandidate;
	updatedAtUnixMs: number;
	timingBaselines: Record<string, number>;
	warningClassifications: WarningAllowlist[];
	tasks: Record<string, VoiceRunTask>;
}
export class VoiceRunLedger {
	constructor(private readonly file: string) {
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		chmodSync(dirname(file), 0o700);
	}
	async read(): Promise<VoiceRunLedgerValue | undefined> {
		try {
			const value = JSON.parse(await readFile(this.file, "utf8")) as
				| VoiceRunLedgerValue
				| {
						schemaVersion: 1;
						revision: number;
						candidateSha: string;
						updatedAtUnixMs: number;
						tasks: Record<
							string,
							{
								state: VoiceTaskState;
								attempts: number;
								evidenceHashes: string[];
								findings: string[];
								repairs: string[];
								receipts: string[];
								humanOutcomes?: VoiceRunAttempt["humanOutcomes"];
							}
						>;
				  };
			if (![1, 2, 3].includes(value.schemaVersion)) throw new Error("Unsupported voice ledger schema");
			if (value.schemaVersion !== 1)
				return {
					...value,
					timingBaselines: value.timingBaselines ?? {},
					warningClassifications: value.warningClassifications ?? [],
				};
			const candidate = {
				commit: value.candidateSha,
				binarySha256: "",
				releaseTag: null,
				channel: "legacy",
			};
			return {
				schemaVersion: 2,
				revision: value.revision,
				candidate,
				updatedAtUnixMs: value.updatedAtUnixMs,
				timingBaselines: {},
				warningClassifications: [],
				tasks: Object.fromEntries(
					Object.entries(value.tasks).map(([id, task]) => [
						id,
						{
							projectTaskId: id,
							state: task.state,
							attempts:
								task.attempts > 0
									? [
											{
												attempt: task.attempts,
												candidateCommit: value.candidateSha,
												binarySha256: "",
												releaseTag: null,
												channel: "legacy",
												startedAtUnixMs: value.updatedAtUnixMs,
												state: task.state,
												evidenceHashes: task.evidenceHashes,
												findings: task.findings,
												repairs: task.repairs,
												warningClassifications: [],
												receipts: task.receipts,
												...(task.humanOutcomes ? { humanOutcomes: task.humanOutcomes } : {}),
											},
										]
									: [],
						},
					]),
				),
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
	}
	async #write(value: VoiceRunLedgerValue): Promise<void> {
		if (value.schemaVersion !== 3)
			throw new Error("Historical voice UAT ledger is read-only; prepare a separate run");
		const temporary = `${this.file}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		renameSync(temporary, this.file);
	}
	async bindCandidate(candidate: VoiceLedgerCandidate): Promise<VoiceRunLedgerValue> {
		const current = await this.read();
		if (!current) throw new Error("Voice UAT ledger is missing");
		if (current.candidate.commit !== candidate.commit)
			throw new Error("Voice UAT ledger candidate does not match controller state");
		if (current.candidate.binarySha256 && current.candidate.binarySha256 !== candidate.binarySha256)
			throw new Error("Voice UAT ledger binary does not match controller state");
		const value: VoiceRunLedgerValue = {
			...current,
			revision: current.revision + 1,
			updatedAtUnixMs: Date.now(),
			timingBaselines: {},
			warningClassifications: current.warningClassifications.filter(
				classification => classification.candidateSha256 === candidate.binarySha256,
			),
			candidate,
			tasks: Object.fromEntries(
				Object.entries(current.tasks).map(([id, task]) => [
					id,
					{
						...task,
						attempts: task.attempts.map(attempt => ({
							...attempt,
							binarySha256: attempt.binarySha256 || candidate.binarySha256,
							releaseTag: attempt.releaseTag ?? candidate.releaseTag,
							channel: attempt.channel === "legacy" ? candidate.channel : attempt.channel,
						})),
					},
				]),
			),
		};
		await this.#write(value);
		return value;
	}
	async setTimingBaselines(values: Record<string, number>): Promise<VoiceRunLedgerValue> {
		const current = await this.read();
		if (!current) throw new Error("Voice UAT ledger is missing");
		const timingBaselines = { ...current.timingBaselines };
		for (const [stage, elapsedMs] of Object.entries(values))
			if (timingBaselines[stage] == null && nonnegative(elapsedMs)) timingBaselines[stage] = elapsedMs;
		const value = {
			...current,
			revision: current.revision + 1,
			updatedAtUnixMs: Date.now(),
			timingBaselines,
		};
		await this.#write(value);
		return value;
	}
	async classifyWarning(classification: WarningAllowlist): Promise<VoiceRunLedgerValue> {
		const current = await this.read();
		if (!current) throw new Error("Voice UAT ledger is missing");
		if (classification.candidateSha256 !== current.candidate.binarySha256)
			throw new Error("Warning classification candidate does not match the ledger");
		if (!validAllowlist(classification, Date.now(), current.candidate.binarySha256))
			throw new Error("Warning classification is incomplete or has an invalid expiry");
		const warningClassifications = current.warningClassifications.filter(
			item => item.fingerprint !== classification.fingerprint,
		);
		warningClassifications.push(classification);
		const value = {
			...current,
			revision: current.revision + 1,
			updatedAtUnixMs: Date.now(),
			warningClassifications,
		};
		await this.#write(value);
		return value;
	}
	async initialize(
		candidate: VoiceLedgerCandidate,
		taskIds: readonly string[],
		policy: VoiceAcceptancePolicy = "strict",
	): Promise<VoiceRunLedgerValue> {
		voiceAcceptancePolicy(policy);
		if (!/^[a-f0-9]{40}$/.test(candidate.commit) || !/^[a-f0-9]{64}$/.test(candidate.binarySha256))
			throw new Error("Invalid candidate provenance");
		if (!taskIds.length || new Set(taskIds).size !== taskIds.length) throw new Error("Invalid task IDs");
		const current = await this.read();
		if (current && voiceAcceptancePolicy(current.acceptancePolicy) !== policy)
			throw new Error("Voice UAT acceptance policy mismatch");
		if (current?.schemaVersion === 2) throw new Error("Historical voice UAT ledger requires a separate run");
		const ids = [...new Set([...(current ? Object.keys(current.tasks) : []), ...taskIds])];
		const now = Date.now();
		const candidateChanged = Boolean(
			current &&
				(current.candidate.commit !== candidate.commit ||
					current.candidate.binarySha256 !== candidate.binarySha256),
		);
		const value: VoiceRunLedgerValue = {
			schemaVersion: 3,
			acceptancePolicy: policy,
			revision: (current?.revision ?? 0) + 1,
			candidate,
			updatedAtUnixMs: now,
			timingBaselines: {},
			warningClassifications: [],
			tasks: Object.fromEntries(
				ids.map(id => {
					const prior = current?.tasks[id];
					const attempts = [...(prior?.attempts ?? [])];
					const latest = attempts.at(-1);
					if (candidateChanged)
						for (let index = 0; index < attempts.length; index++) {
							const attempt = attempts[index];
							if (!attempt || attempt.state === "invalidated" || attempt.state === "interrupted") continue;
							attempts[index] = {
								...attempt,
								state: "invalidated",
								finishedAtUnixMs: attempt.finishedAtUnixMs ?? now,
								findings: [...new Set([...attempt.findings, "candidate-replaced"])],
							};
						}
					else if (latest?.state === "running")
						attempts[attempts.length - 1] = {
							...latest,
							state: "invalidated",
							finishedAtUnixMs: now,
							findings: [...new Set([...latest.findings, "candidate-replaced"])],
						};
					return [id, { projectTaskId: prior?.projectTaskId ?? id, state: "pending", attempts }];
				}),
			),
		};
		await this.#write(value);
		return value;
	}
	async update(
		id: string,
		patch: Partial<
			Omit<VoiceRunAttempt, "attempt" | "candidateCommit" | "binarySha256" | "releaseTag" | "channel">
		> & {
			state: VoiceTaskState;
		},
	): Promise<VoiceRunLedgerValue> {
		const current = await this.read();
		if (!current?.tasks[id]) throw new Error(`Unknown voice UAT task: ${id}`);
		const task = current.tasks[id];
		const attempts = [...task.attempts];
		let next: VoiceRunAttempt;
		if (patch.state === "running") {
			if (attempts.at(-1)?.state === "running") throw new Error(`Voice UAT task ${id} is already running`);
			next = {
				attempt: attempts.length + 1,
				acceptancePolicy: voiceAcceptancePolicy(current.acceptancePolicy),
				candidateCommit: current.candidate.commit,
				binarySha256: current.candidate.binarySha256,
				releaseTag: current.candidate.releaseTag,
				channel: current.candidate.channel,
				startedAtUnixMs: Date.now(),
				evidenceHashes: [],
				findings: [],
				repairs: [],
				warningClassifications: [],
				receipts: [],
				...patch,
				state: "running",
			};
			attempts.push(next);
		} else {
			const active = attempts.at(-1);
			if (!active) throw new Error(`Voice UAT task ${id} has no attempt`);
			next = {
				...active,
				...patch,
				finishedAtUnixMs: Date.now(),
			};
			attempts[attempts.length - 1] = next;
		}
		if (voiceAcceptancePolicy(next.acceptancePolicy) !== voiceAcceptancePolicy(current.acceptancePolicy))
			throw new Error("Voice UAT attempt acceptance policy mismatch");
		if (
			next.state === "passed" &&
			voiceAttemptAcceptanceFailures(next, voiceAcceptancePolicy(current.acceptancePolicy)).length
		)
			throw new Error("A voice UAT row cannot pass without complete evidence, human outcomes, and zero findings");

		const value: VoiceRunLedgerValue = {
			...current,
			revision: current.revision + 1,
			updatedAtUnixMs: Date.now(),
			tasks: { ...current.tasks, [id]: { ...task, state: next.state, attempts } },
		};
		await this.#write(value);
		return value;
	}
}

export function voiceAttemptAcceptanceFailures(attempt: VoiceRunAttempt, policy: VoiceAcceptancePolicy): string[] {
	const failures = [...attempt.findings];
	if (voiceAcceptancePolicy(attempt.acceptancePolicy) !== policy) failures.push("acceptance-policy-mismatch");
	if (!attempt.evidenceHashes.length) failures.push("evidence-missing");
	for (const receipt of [
		"preflight-3x10s",
		"post-close-60s",
		...(attempt.acceptancePolicy ? ["replay-before-close"] : []),
	])
		if (!attempt.receipts.includes(receipt)) failures.push(`receipt-missing:${receipt}`);
	if (
		!attempt.humanOutcomes ||
		[attempt.humanOutcomes.connection, attempt.humanOutcomes.caption, attempt.humanOutcomes.heardAudio].some(
			value => value !== true,
		)
	)
		failures.push("human-outcomes-pending");
	failures.push(
		...analyzeVoiceTranscriptEvidence(attempt.transcriptEvidence, policy, Boolean(attempt.acceptancePolicy)).failures,
	);
	return [...new Set(failures)];
}

/** Deterministically classify metadata only; journal message text is not exported. */
export async function analyzeVoiceUat(input: VoiceUatAnalysisInput): Promise<VoiceUatAnalysis> {
	const failures = new Set<string>(),
		warnings = new Set<string>(),
		rows: VoiceUatAnalysis["rows"] = [];
	const eventCounts = new Map<string, number>();
	let maximumDurationMs = 0;
	let checkpointSeen = Boolean(input.checkpoints?.length);
	let maximumReconnects = 0;
	let runtimeFailed = false;
	let delegationsCreated = 0;
	let delegationContextReturns = 0;
	let successfulBackingTurns = 0;
	const observeEvents = (events: Record<string, unknown>[]): string[] => {
		const messageTypes: string[] = [];
		for (const event of events) {
			const message = isRecord(event.message) ? event.message : undefined;
			const type = typeof message?.type === "string" ? message.type : undefined;
			const method = typeof message?.method === "string" ? message.method : undefined;
			const eventName = type ?? method;
			if (type) messageTypes.push(type);
			if (eventName) eventCounts.set(eventName, (eventCounts.get(eventName) ?? 0) + 1);
			if (type === "delegation.created") delegationsCreated++;
			if (type === "delegation.context.appended") delegationContextReturns++;
			if (method === "thread/realtime/error" && !input.requirements?.expectedRuntimeFailure)
				failures.add("realtime-error");
			if (method === "turn/completed") {
				const params = isRecord(message?.params) ? message.params : undefined;
				const turn = isRecord(params?.turn) ? params.turn : undefined;
				if (turn?.status === "completed") successfulBackingTurns++;
				if (turn?.status === "failed" && !input.requirements?.expectedRuntimeFailure)
					failures.add("backing-turn-failed");
			}
		}
		return messageTypes;
	};
	for (const checkpoint of input.checkpoints ?? []) {
		if (!Number.isInteger(checkpoint.revision) || checkpoint.revision <= 0)
			failures.add("invalid-checkpoint-revision");
		maximumReconnects = Math.max(maximumReconnects, checkpoint.reconnectAttempts);
		if (checkpoint.droppedFrames > 0) failures.add("dropped-frame");
		if ((checkpoint.unexpectedReconnects ?? 0) > 0) failures.add("unexpected-reconnect");
		if (checkpoint.queuePressure > 0) failures.add("queue-pressure");
		if (checkpoint.lifecycle === "failed") {
			runtimeFailed = true;
			if (!input.requirements?.expectedRuntimeFailure) failures.add("runtime-failed");
		}
		if ((checkpoint.delegation?.supersededExecutions ?? 0) > 0) failures.add("superseded-execution");
		if (
			checkpoint.lifecycle === "closed" &&
			(checkpoint.delegation?.active || (checkpoint.delegation?.pending ?? 0) > 0)
		)
			failures.add("delegation-incomplete-at-close");
	}
	for (const file of input.captureFiles) {
		const parsed = parseCapture(await readFile(file, "utf8"));
		if (!parsed) {
			failures.add("malformed-capture");
			continue;
		}
		const events = parsed.filter(row => row.kind === "event"),
			manifest = parsed.find(row => row.kind === "manifest"),
			footer = parsed.at(-1);
		const complete = footer?.kind === "footer" && footer.complete === true && footer.events === events.length;
		rows.push({ capture: basename(file), events: events.length, complete });
		if (!complete) failures.add("incomplete-capture");
		if (input.candidate) {
			if (manifest?.sourceCommit !== input.candidate.commit) failures.add("candidate-mismatch:commit");
			if (manifest?.artifactSha256 !== input.candidate.binarySha256) failures.add("candidate-mismatch:binary");
		}
		let expectedSequence = 1;
		for (const event of events) {
			if (event.sequence !== expectedSequence) {
				failures.add("non-monotonic-event-sequence");
				break;
			}
			expectedSequence++;
		}
		const messageTypes = observeEvents(events);
		for (const event of events)
			if (nonnegative(event.elapsedMs)) maximumDurationMs = Math.max(maximumDurationMs, event.elapsedMs);
		const startedIndex = events.findIndex(
			event => isRecord(event.message) && event.message.type === "session.started",
		);
		if (
			startedIndex > 0 &&
			events.slice(0, startedIndex).some(event => {
				const type =
					isRecord(event.message) && typeof event.message.type === "string" ? event.message.type : undefined;
				if (!type || ["session.created", "session.updated"].includes(type)) return false;
				return !(type === "open" && event.layer === "connection" && event.direction === "in");
			})
		)
			failures.add("lifecycle-order:session.started");
		const closeIndex = messageTypes.indexOf("session.close");
		const closedIndex = messageTypes.findIndex(type => type === "session.closed" || type === "closed");
		if (closedIndex >= 0 && (closeIndex < 0 || closeIndex > closedIndex))
			failures.add("lifecycle-order:session.close");
		if (parsed.some(row => row.kind === "checkpoint")) checkpointSeen = true;
		let captureCheckpointRevision = 0;
		for (const row of parsed) {
			if (row.kind !== "checkpoint" && row.kind !== "voiceCheckpoint") continue;
			if (nonnegative(row.revision)) {
				if (!Number.isInteger(row.revision) || row.revision <= captureCheckpointRevision)
					failures.add("non-monotonic-checkpoint-revision");
				captureCheckpointRevision = row.revision;
			}
			if (nonnegative(row.droppedFrames) && row.droppedFrames > 0) failures.add("dropped-frame");
			if (nonnegative(row.unexpectedReconnects) && row.unexpectedReconnects > 0)
				failures.add("unexpected-reconnect");
			if (nonnegative(row.queuePressure) && row.queuePressure > 0) failures.add("queue-pressure");
			if (isRecord(row.rejectedEventClasses))
				for (const [name, count] of Object.entries(row.rejectedEventClasses))
					if (nonnegative(count) && count > 0) failures.add(`rejected-event:${name}`);
		}
	}
	for (const file of input.protocolFiles ?? []) {
		const parsed = parseCapture(await readFile(file, "utf8"));
		if (!parsed) {
			failures.add("malformed-protocol-capture");
			continue;
		}
		const manifest = parsed.find(row => row.kind === "manifest");
		if (input.candidate) {
			if (manifest?.sourceCommit !== input.candidate.commit) failures.add("candidate-mismatch:commit");
			if (manifest?.artifactSha256 !== input.candidate.binarySha256) failures.add("candidate-mismatch:binary");
		}
		const events = parsed.filter(row => row.kind === "event");
		let previousSequence = 0;
		const requestMethods = new Map<string, string>();
		for (const event of events) {
			if (!Number.isInteger(event.sequence) || Number(event.sequence) <= previousSequence) {
				failures.add("non-monotonic-event-sequence");
				break;
			}
			previousSequence = Number(event.sequence);
			const message = isRecord(event.message) ? event.message : undefined;
			const id = message?.id;
			const requestId =
				typeof id === "string" || typeof id === "number"
					? `${typeof id}:${String(id)}`
					: isRecord(id) && typeof id.$ref === "string"
						? `ref:${id.$ref}`
						: undefined;
			if (requestId && typeof message?.method === "string") requestMethods.set(requestId, message.method);
			if (requestId && isRecord(message?.error) && !input.requirements?.expectedRuntimeFailure)
				failures.add(`rpc-error:${requestMethods.get(requestId) ?? "unmatched"}`);
		}
		observeEvents(events);
	}
	if (delegationsCreated > 0 && successfulBackingTurns === 0) failures.add("delegation-no-successful-backing-turn");
	if (delegationsCreated > 0 && delegationContextReturns === 0) failures.add("delegation-context-return-missing");
	if (input.requirements) {
		if (input.requirements.expectedRuntimeFailure && !runtimeFailed) failures.add("correlation-gap:runtime-failure");
		for (const [type, minimum] of Object.entries(input.requirements.minimumEventCounts ?? {}))
			if ((eventCounts.get(type) ?? 0) < minimum) failures.add(`correlation-gap:event:${type}`);
		if ((input.requirements.minimumDurationMs ?? 0) > maximumDurationMs) failures.add("correlation-gap:duration");
		if ((input.requirements.minimumCaptures ?? 0) > rows.length) failures.add("correlation-gap:captures");
		if ((input.requirements.minimumReconnects ?? 0) > maximumReconnects) failures.add("correlation-gap:reconnect");
	}
	const expectedProcessExits = (input.processExits ?? []).filter(exit => exit.expected).length;
	if (
		input.requirements?.expectedProcessExits != null &&
		expectedProcessExits !== input.requirements.expectedProcessExits
	)
		failures.add("correlation-gap:process-exit");
	for (const exit of input.processExits ?? [])
		if (!exit.expected && (exit.exitStatus !== 0 || exit.signal != null)) failures.add("unexpected-process-exit");
	const allowed = new Map(input.allowlist.map(item => [item.fingerprint, item]));
	for (const journal of input.journal) {
		if (!journal.fingerprint) {
			failures.add("unclassified-journal-warning");
			continue;
		}
		const item = allowed.get(journal.fingerprint);
		if (!item) failures.add(`unclassified-warning:${journal.fingerprint}`);
		else if (!validAllowlist(item, Date.now(), input.candidate?.binarySha256))
			failures.add(`expired-allowlist:${journal.fingerprint}`);
		else warnings.add(journal.fingerprint);
	}
	if (input.journal.length && !checkpointSeen) failures.add("journal-without-checkpoint");
	for (const gap of input.correlationGaps ?? []) failures.add(`correlation-gap:${gap}`);
	let transcriptOutcome: VoiceTranscriptOutcome | undefined;
	if (input.transcriptEvidence || input.requireTranscriptEvidence || input.acceptancePolicy) {
		const transcript = analyzeVoiceTranscriptEvidence(
			input.transcriptEvidence,
			input.acceptancePolicy,
			Boolean(input.requireTranscriptEvidence),
		);
		transcriptOutcome = transcript.outcome;
		for (const failure of transcript.failures) failures.add(failure);
	}
	if (input.requireTranscriptEvidence && !input.humanOutcomes) failures.add("human-outcomes-pending");
	if (input.humanOutcomes)
		for (const [name, passed] of Object.entries(input.humanOutcomes))
			if (!passed) failures.add(`human-outcome:${name}`);
	const median = (values: number[]) => {
		const sorted = [...values].sort((left, right) => left - right);
		const middle = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	};
	const trends: Record<string, number> = {};
	const preflight = input.resources.filter(sample => sample.phase === "preflight");
	const postClose = input.resources.filter(sample => sample.phase === "post-close");
	if (preflight.length < 3) failures.add("insufficient-resource-samples:preflight");
	if (postClose.length < 3) failures.add("insufficient-resource-samples:post-close");
	for (const [phase, samples] of [
		["preflight", preflight],
		["post-close", postClose],
	] as const) {
		const ordered = [...samples].sort((left, right) => left.atUnixMs - right.atUnixMs);
		if (
			ordered.length >= 3 &&
			ordered.slice(1).some((sample, index) => sample.atUnixMs - ordered[index].atUnixMs < 9_000)
		)
			failures.add(`resource-sample-cadence:${phase}`);
	}
	const invocationIds = new Set(input.resources.map(sample => sample.invocationId).filter(Boolean));
	if (invocationIds.size > 1) failures.add("invocation-continuity");
	for (const field of ["rssBytes", "fileDescriptors", "sockets"] as const) {
		const values = input.resources.map(sample => sample[field]);
		const baseline =
			preflight.length >= 3 ? median(preflight.slice(-3).map(sample => sample[field])) : (values[0] ?? 0);
		const final =
			postClose.length >= 3 ? median(postClose.slice(-3).map(sample => sample[field])) : (values.at(-1) ?? baseline);
		const growth = final - baseline;
		trends[field] = growth;
		if (field === "rssBytes") {
			if (preflight.length >= 3 && postClose.length >= 3 && growth >= 64 * 1024 * 1024 && final >= baseline * 1.2)
				failures.add("resource-growth:rssBytes");
			else if (!preflight.length && values.length > 1 && growth > 0 && final > baseline * 2)
				failures.add("resource-growth:rssBytes");
		} else if (
			preflight.length >= 3 &&
			postClose.length >= 3 &&
			postClose.slice(-3).every(sample => sample[field] > baseline)
		)
			failures.add(`resource-retained:${field}`);
		else if (!preflight.length && values.length > 1 && growth > 0 && final > baseline * 2)
			failures.add(`resource-growth:${field}`);
	}
	const timings = new Map<string, { overTwice: number; overTriple: boolean }>();
	for (const timing of input.stageTimings ?? []) {
		if (!(timing.baselineMs > 0) || !nonnegative(timing.elapsedMs)) continue;
		const current = timings.get(timing.stage) ?? { overTwice: 0, overTriple: false };
		if (timing.elapsedMs > timing.baselineMs * 2) current.overTwice++;
		if (timing.elapsedMs > timing.baselineMs * 3) current.overTriple = true;
		timings.set(timing.stage, current);
	}
	for (const [stage, timing] of timings)
		if (timing.overTriple || timing.overTwice >= 3) failures.add(`stage-timing:${stage}`);
	return {
		failures: [...failures].sort(),
		warnings: [...warnings].sort(),
		trends,
		rows,
		...(transcriptOutcome ? { transcriptOutcome } : {}),
	};
}

export interface UatServiceControl {
	activeVoiceCall(): Promise<boolean>;
	readDropIn(): Promise<string | undefined>;
	writeDropIn(contents: string): Promise<void>;
	restart(): Promise<void>;
	health(): Promise<boolean>;
}
/** Preflight, activate one managed drop-in, verify health, and restore it on any failure. */
export async function withVoiceUatDropIn<T>(
	control: UatServiceControl,
	contents: string,
	run: () => Promise<T>,
): Promise<T> {
	if (await control.activeVoiceCall()) throw new Error("Refusing to restart during an active voice call");
	const previous = await control.readDropIn();
	await control.writeDropIn(contents);
	try {
		await control.restart();
		if (!(await control.health())) throw new Error("Voice UAT service health check failed");
		return await run();
	} catch (error) {
		await control.writeDropIn(previous ?? "");
		await control.restart();
		throw error;
	}
}
