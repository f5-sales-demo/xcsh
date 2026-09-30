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
	stageTimingsMs: Record<string, number>;
	delegation?: { active: boolean; pending: number; supersededExecutions: number };
	resources: Omit<VoiceResourceSample, "atUnixMs">;
	process?: { pid: number; state: string };
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
	return { rssBytes: process.memoryUsage.rss(), fileDescriptors, sockets, processState: "running" };
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
			stageTimingsMs: { ...this.#stageTimingsMs },
			delegation: { ...this.#delegation },
			resources: {
				rssBytes: sampled.rssBytes,
				fileDescriptors: sampled.fileDescriptors,
				sockets: sampled.sockets,
			},
			process: { pid: process.pid, state: sampled.processState },
			lifecycle: this.#lifecycle,
		});
		this.#emit({ kind: "voiceCheckpoint", ...checkpoint });
	}
	transition(lifecycle: NonNullable<VoiceCheckpoint["lifecycle"]>): void {
		this.#lifecycle = lifecycle;
		this.#cadence.shouldWrite(this.#eventCount, true, this.#now());
		this.#checkpoint(true);
	}
	event(_eventType: string, rejection?: string): void {
		this.#eventCount++;
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
		voiceEventDiagnostic: ["kind", "eventTypes", "rejections"],
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
	remediation?: string;
	benignRationale?: string;
	expiresAtUnixMs: number;
}
export interface VoiceUatAnalysisInput {
	captureFiles: readonly string[];
	journal: readonly { atUnixMs: number; message: string; fingerprint?: string }[];
	resources: readonly VoiceResourceSample[];
	allowlist: readonly WarningAllowlist[];
	correlationGaps?: readonly string[];
	humanOutcomes?: { connection: boolean; caption: boolean; heardAudio: boolean };
	stageTimings?: readonly { stage: string; elapsedMs: number; baselineMs: number }[];
}
export interface VoiceUatAnalysis {
	failures: string[];
	warnings: string[];
	trends: Record<string, number>;
	rows: Array<{ capture: string; events: number; complete: boolean }>;
}
function validAllowlist(value: WarningAllowlist, now: number): boolean {
	return (
		/^[^\s]{1,128}$/.test(value.fingerprint) &&
		Boolean(value.evidence) &&
		Boolean(value.owner) &&
		/^#\d+$/.test(value.issue) &&
		Boolean(value.artifactRange) &&
		Boolean(value.remediation || value.benignRationale) &&
		value.expiresAtUnixMs > now
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

export type VoiceTaskState = "pending" | "running" | "blocked" | "passed";
export interface VoiceRunTask {
	state: VoiceTaskState;
	attempts: number;
	evidenceHashes: string[];
	findings: string[];
	repairs: string[];
	receipts: string[];
	humanOutcomes?: { connection: boolean; caption: boolean; heardAudio: boolean };
}
export interface VoiceRunLedgerValue {
	schemaVersion: 1;
	revision: number;
	candidateSha: string;
	updatedAtUnixMs: number;
	tasks: Record<string, VoiceRunTask>;
}
export class VoiceRunLedger {
	constructor(private readonly file: string) {
		mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
		chmodSync(dirname(file), 0o700);
	}
	async read(): Promise<VoiceRunLedgerValue | undefined> {
		try {
			return JSON.parse(await readFile(this.file, "utf8")) as VoiceRunLedgerValue;
		} catch {
			return;
		}
	}
	async #write(value: VoiceRunLedgerValue): Promise<void> {
		const temporary = `${this.file}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		renameSync(temporary, this.file);
	}
	async initialize(candidateSha: string, taskIds: readonly string[]): Promise<VoiceRunLedgerValue> {
		if (!/^[a-f0-9]{40}$/.test(candidateSha)) throw new Error("Invalid candidate SHA");
		if (!taskIds.length || new Set(taskIds).size !== taskIds.length) throw new Error("Invalid task IDs");
		const value: VoiceRunLedgerValue = {
			schemaVersion: 1,
			revision: 1,
			candidateSha,
			updatedAtUnixMs: Date.now(),
			tasks: Object.fromEntries(
				taskIds.map(id => [
					id,
					{ state: "pending", attempts: 0, evidenceHashes: [], findings: [], repairs: [], receipts: [] },
				]),
			),
		};
		await this.#write(value);
		return value;
	}
	async update(id: string, patch: Partial<VoiceRunTask> & { state: VoiceTaskState }): Promise<VoiceRunLedgerValue> {
		const current = await this.read();
		if (!current?.tasks[id]) throw new Error(`Unknown voice UAT task: ${id}`);
		const next = { ...current.tasks[id], ...patch };
		if (
			next.state === "passed" &&
			(!next.evidenceHashes.length ||
				next.findings.length ||
				!next.receipts.includes("post-close-60s") ||
				!next.humanOutcomes ||
				!Object.values(next.humanOutcomes).every(Boolean))
		)
			throw new Error("A voice UAT row cannot pass without complete evidence, human outcomes, and zero findings");
		if (next.state === "running" && current.tasks[id].state !== "running") next.attempts++;
		const value: VoiceRunLedgerValue = {
			...current,
			revision: current.revision + 1,
			updatedAtUnixMs: Date.now(),
			tasks: { ...current.tasks, [id]: next },
		};
		await this.#write(value);
		return value;
	}
}

/** Deterministically classify metadata only; journal message text is not exported. */
export async function analyzeVoiceUat(input: VoiceUatAnalysisInput): Promise<VoiceUatAnalysis> {
	const failures = new Set<string>(),
		warnings = new Set<string>(),
		rows: VoiceUatAnalysis["rows"] = [];
	let checkpointSeen = false;
	for (const file of input.captureFiles) {
		const parsed = parseCapture(await readFile(file, "utf8"));
		if (!parsed) {
			failures.add("malformed-capture");
			continue;
		}
		const events = parsed.filter(row => row.kind === "event"),
			footer = parsed.at(-1);
		const complete = footer?.kind === "footer" && footer.complete === true && footer.events === events.length;
		rows.push({ capture: basename(file), events: events.length, complete });
		if (!complete) failures.add("incomplete-capture");
		if (parsed.some(row => row.kind === "checkpoint")) checkpointSeen = true;
		for (const row of parsed) {
			if (row.kind !== "checkpoint" && row.kind !== "voiceCheckpoint") continue;
			if (nonnegative(row.droppedFrames) && row.droppedFrames > 0) failures.add("dropped-frame");
			if (nonnegative(row.unexpectedReconnects) && row.unexpectedReconnects > 0)
				failures.add("unexpected-reconnect");
			if (nonnegative(row.queuePressure) && row.queuePressure > 0) failures.add("queue-pressure");
			if (isRecord(row.rejectedEventClasses))
				for (const [name, count] of Object.entries(row.rejectedEventClasses))
					if (nonnegative(count) && count > 0) failures.add(`rejected-event:${name}`);
		}
	}
	const allowed = new Map(input.allowlist.map(item => [item.fingerprint, item]));
	for (const journal of input.journal) {
		if (!journal.fingerprint) {
			failures.add("unclassified-journal-warning");
			continue;
		}
		const item = allowed.get(journal.fingerprint);
		if (!item) failures.add(`unclassified-warning:${journal.fingerprint}`);
		else if (!validAllowlist(item, Date.now())) failures.add(`expired-allowlist:${journal.fingerprint}`);
		else warnings.add(journal.fingerprint);
	}
	if (input.journal.length && !checkpointSeen) failures.add("journal-without-checkpoint");
	for (const gap of input.correlationGaps ?? []) failures.add(`correlation-gap:${gap}`);
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
	return { failures: [...failures].sort(), warnings: [...warnings].sort(), trends, rows };
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
