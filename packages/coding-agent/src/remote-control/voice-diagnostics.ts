/** Content-free, crash-safe evidence primitives for physical Realtime voice UAT. */
import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const stages = new Set(["starting", "connected", "reconnecting", "closed", "failed"]);
const counters = ["eventCount", "reconnectAttempts", "queuePressure", "droppedFrames"] as const;

export interface VoiceResourceSample {
	atUnixMs: number;
	rssBytes: number;
	fileDescriptors: number;
	sockets: number;
}
export interface VoiceCheckpoint {
	revision: number;
	writtenAtUnixMs: number;
	eventCount: number;
	reconnectAttempts: number;
	queuePressure: number;
	droppedFrames: number;
	stageTimingsMs: Record<string, number>;
	resources: Omit<VoiceResourceSample, "atUnixMs">;
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
	return (
		counters.every(key => nonnegative(value[key])) &&
		Object.values(value.stageTimingsMs).every(nonnegative) &&
		["rssBytes", "fileDescriptors", "sockets"].every(key => nonnegative(resources[key]))
	);
}
function validCheckpoint(value: unknown): value is VoiceCheckpoint {
	if (!validInput(value) || !isRecord(value)) return false;
	const checkpoint = value as unknown as VoiceCheckpoint;
	return Number.isInteger(checkpoint.revision) && checkpoint.revision > 0 && nonnegative(checkpoint.writtenAtUnixMs);
}

/** Atomic revisioned checkpoints preserve the last safe state after process death. */
export class CheckpointStore {
	constructor(private readonly file: string) {}
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

const exportKeys = ["kind", "stage", ...counters] as const;
/** Construct allowlisted diagnostics; do not sanitize arbitrary realtime session content. */
export function exportRemoteRealtimeDiagnostics(entries: readonly unknown[]): Array<Record<string, string | number>> {
	const seen = new Set<string>(),
		output: Array<Record<string, string | number>> = [];
	for (const entry of entries) {
		if (
			!isRecord(entry) ||
			entry.kind !== "remote-realtime" ||
			typeof entry.stage !== "string" ||
			!stages.has(entry.stage)
		)
			continue;
		const row: Record<string, string | number> = { kind: "remote-realtime", stage: entry.stage };
		for (const key of counters) if (nonnegative(entry[key])) row[key] = entry[key] as number;
		const fingerprint = JSON.stringify(exportKeys.map(key => row[key] ?? null));
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
	expiresAtUnixMs: number;
}
export interface VoiceUatAnalysisInput {
	captureFiles: readonly string[];
	journal: readonly { atUnixMs: number; message: string; fingerprint?: string }[];
	resources: readonly VoiceResourceSample[];
	allowlist: readonly WarningAllowlist[];
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
		value.expiresAtUnixMs > now
	);
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
	const trends: Record<string, number> = {};
	for (const field of ["rssBytes", "fileDescriptors", "sockets"] as const) {
		const values = input.resources.map(sample => sample[field]),
			growth = values.length > 1 ? values.at(-1)! - values[0]! : 0;
		trends[field] = growth;
		if (values.length > 1 && growth > 0 && values.at(-1)! > values[0]! * 2) failures.add(`resource-growth:${field}`);
	}
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
