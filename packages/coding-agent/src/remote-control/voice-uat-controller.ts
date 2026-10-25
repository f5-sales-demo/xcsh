import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	analyzeVoiceReplayBeforeClose,
	analyzeVoiceTranscriptEvidence,
	analyzeVoiceUat,
	createVoiceScenario,
	exportVoiceTranscriptEvidence,
	type VoiceAcceptancePolicy,
	VoiceRunLedger,
	type VoiceRunLedgerValue,
	type VoiceTranscriptEvidence,
	type VoiceUatAnalysis,
	type VoiceUatAnalysisInput,
	voiceAcceptancePolicy,
	voiceAttemptAcceptanceFailures,
	type WarningAllowlist,
} from "./voice-diagnostics";

export interface VoiceCandidate {
	commit: string;
	version: string;
	sha256: string;
	executable: string;
	releaseTag?: string | null;
	channel?: string;
}

export function voiceCandidateArtifactPath(runDirectory: string, commit: string): string {
	if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Candidate commit is invalid");
	return join(runDirectory, "candidates", commit, "xcsh-linux-x64");
}
export interface VoiceServiceBaseline {
	unit: string;
	dropIns: Record<string, string>;
	hashes: Record<string, string>;
	runtime?: {
		executable: string;
		commit: string | null;
		version: string;
		sha256: string;
		pid: number;
		invocationId: string;
		health: Record<string, unknown>;
	};
}
export interface VoiceRowCollection {
	evidenceFiles: string[];
	findings: string[];
	receipts: string[];
	analysis: VoiceUatAnalysisInput;
	analysisResult?: VoiceUatAnalysis;
}
export interface VoiceUatHost {
	activeVoiceCall(directory?: string): Promise<boolean>;
	verifyCandidateArtifact(candidate: VoiceCandidate): Promise<boolean>;
	captureBaseline(): Promise<VoiceServiceBaseline>;
	installCandidate(candidate: VoiceCandidate): Promise<void>;
	setCaptureEnvironment(
		directory: string,
		scenario: string,
		correlationSalt: string,
		expectedReconnect: boolean,
	): Promise<void>;
	startResourceSampling(directory: string): Promise<void>;
	stopResourceSampling(directory: string): Promise<void>;
	inspectRowActivity(directory: string): Promise<{
		callActivityAtUnixMs?: number;
		sessionReadyAtUnixMs?: number;
		closedAtUnixMs?: number;
	}>;
	clearCaptureEnvironment(): Promise<void>;
	restart(): Promise<void>;
	verifyCandidate(candidate: VoiceCandidate): Promise<boolean>;
	restore(baseline: VoiceServiceBaseline): Promise<void>;
	verifyBaseline(baseline: VoiceServiceBaseline): Promise<boolean>;
	journalAnchor(): Promise<string>;
	collectRow(directory: string, anchor: string): Promise<VoiceRowCollection>;
}
interface ControllerState {
	schemaVersion: 1 | 2 | 3;
	acceptancePolicy?: VoiceAcceptancePolicy;
	revision: number;
	phase: "prepared" | "deployed" | "capturing" | "ready" | "finalized" | "restored";
	candidate: VoiceCandidate;
	baseline: VoiceServiceBaseline;
	activeRow?: { id: string; directory: string; journalAnchor: string; startedAtUnixMs: number };
	publishedArtifactReceipt?: {
		commit: string;
		version: string;
		sha256: string;
		releaseTag: string;
		channel: string;
		verifiedAtUnixMs: number;
		receiptSha256: string;
	};
}
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export function activeVoiceCallFromStatus(status: Record<string, unknown>): boolean {
	const activeVoiceSessions = status.activeVoiceSessions;
	if (typeof activeVoiceSessions === "number" && Number.isSafeInteger(activeVoiceSessions) && activeVoiceSessions >= 0)
		return activeVoiceSessions > 0;
	return Number(status.liveSessions ?? 0) > 0;
}

export function latestVoiceResourcePhase(
	checkpoints: readonly { writtenAtUnixMs: number; lifecycle?: string }[],
): "preflight" | "active" | "post-close" {
	const latest = checkpoints
		.filter(checkpoint => Number.isFinite(checkpoint.writtenAtUnixMs))
		.reduce<(typeof checkpoints)[number] | undefined>(
			(current, checkpoint) =>
				current == null || checkpoint.writtenAtUnixMs > current.writtenAtUnixMs ? checkpoint : current,
			undefined,
		);
	if (latest?.lifecycle === "closed" || latest?.lifecycle === "failed") return "post-close";
	if (latest?.lifecycle === "connected" || latest?.lifecycle === "reconnecting") return "active";
	return "preflight";
}

export function voiceRowRequirements(id: string): NonNullable<VoiceUatAnalysisInput["requirements"]> {
	const minimumEventCounts: Record<string, number> = {
		"session.started": 1,
		"session.close": 1,
		closed: 1,
	};
	if (id === "B01") Object.assign(minimumEventCounts, { "input_transcript.added": 1, "turn.done": 1 });
	if (id === "B02") Object.assign(minimumEventCounts, { "turn.done": 2, "session.output_audio.delta": 1 });
	if (id === "B03") minimumEventCounts["turn.done"] = 6;
	if (id === "B04")
		Object.assign(minimumEventCounts, {
			"delegation.created": 1,
			"delegation.context.append": 1,
			"delegation.context.appended": 1,
		});
	if (id === "B05")
		Object.assign(minimumEventCounts, {
			"delegation.created": 2,
			"delegation.context.append": 1,
			"delegation.context.appended": 1,
		});
	if (id === "C05") minimumEventCounts.error = 1;
	if (id === "D01") minimumEventCounts["turn.done"] = 20;
	if (["C06", "C07"].includes(id)) {
		minimumEventCounts["session.started"] = 2;
		minimumEventCounts["session.close"] = 2;
		minimumEventCounts.closed = 2;
	}
	if (id === "D03") {
		minimumEventCounts["session.started"] = 2;
		minimumEventCounts.closed = 2;
	}
	return {
		minimumEventCounts,
		...(["C02", "C03", "C04"].includes(id) ? { minimumReconnects: 1 } : {}),
		...(["C06", "C07", "D03"].includes(id) ? { minimumCaptures: 2 } : {}),
		...(id === "D02" ? { minimumDurationMs: 55 * 60_000 } : {}),
		...(id === "D03" ? { minimumDurationMs: 60 * 60_000 } : {}),
		...(id === "C05" ? { expectedRuntimeFailure: true } : {}),
		...(id === "C07" ? { expectedProcessExits: 1 } : {}),
	};
}

export type RowWatchdogState =
	| { state: "waiting-for-call" }
	| { state: "waiting-for-session" }
	| { state: "running" }
	| { state: "closed" }
	| { state: "close-call" }
	| { state: "failed"; finding: "session-ready-timeout" | "row-timeout" };
export function evaluateRowWatchdog(
	id: string,
	input: {
		now: number;
		callActivityAtUnixMs?: number;
		sessionReadyAtUnixMs?: number;
		closedAtUnixMs?: number;
	},
): RowWatchdogState {
	if (input.callActivityAtUnixMs == null) return { state: "waiting-for-call" };
	const elapsed = input.now - input.callActivityAtUnixMs;
	if (input.sessionReadyAtUnixMs == null)
		return elapsed > 120_000
			? { state: "failed", finding: "session-ready-timeout" }
			: { state: "waiting-for-session" };
	if (input.closedAtUnixMs != null) return { state: "closed" };
	if (id === "D02") {
		if (elapsed > 59.5 * 60_000) return { state: "failed", finding: "row-timeout" };
		if (elapsed >= 55 * 60_000) return { state: "close-call" };
		return { state: "running" };
	}
	const limit = id === "D01" ? 45 * 60_000 : id === "D03" ? 61.5 * 60_000 : 30 * 60_000;
	return elapsed > limit ? { state: "failed", finding: "row-timeout" } : { state: "running" };
}

/**
 * Persistent coordinator for one immutable candidate. Correlation salts live
 * only in memory long enough to enter the service manager environment.
 */
export class VoiceUatController {
	readonly #stateFile: string;
	readonly #ledger: VoiceRunLedger;
	constructor(
		private readonly directory: string,
		private readonly host: VoiceUatHost,
		private readonly wait: (milliseconds: number) => Promise<void> = sleep,
	) {
		this.#stateFile = join(directory, "controller.json");
		this.#ledger = new VoiceRunLedger(join(directory, "ledger.json"));
	}
	async #read(): Promise<ControllerState> {
		const state = JSON.parse(await readFile(this.#stateFile, "utf8")) as ControllerState;
		if (![1, 2, 3].includes(state.schemaVersion)) throw new Error("Unsupported voice controller schema");
		const policy = voiceAcceptancePolicy(state.schemaVersion === 3 ? state.acceptancePolicy : "strict");
		const ledger = await this.#ledger.read();
		if (
			state.schemaVersion === 3 &&
			(!state.acceptancePolicy || !ledger?.acceptancePolicy || ledger.schemaVersion !== 3)
		)
			throw new Error("Voice UAT acceptance policy binding is missing");
		if (
			ledger &&
			(voiceAcceptancePolicy(ledger.acceptancePolicy) !== policy ||
				ledger.candidate.commit !== state.candidate.commit ||
				ledger.candidate.binarySha256 !== state.candidate.sha256)
		)
			throw new Error("Voice UAT ledger policy or candidate mismatch");
		for (const task of Object.values(ledger?.tasks ?? {}))
			for (const attempt of task.attempts)
				if (
					(ledger?.schemaVersion === 3 && !attempt.acceptancePolicy) ||
					voiceAcceptancePolicy(attempt.acceptancePolicy) !== policy
				)
					throw new Error("Voice UAT attempt policy mismatch");
		return state;
	}
	async #readCurrent(): Promise<ControllerState> {
		const state = await this.#read();
		if (state.schemaVersion !== 3) throw new Error("Historical voice UAT evidence requires a separate run");
		return state;
	}

	async #write(state: ControllerState): Promise<void> {
		const value = { ...state, revision: state.revision + 1 };
		const temporary = `${this.#stateFile}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, this.#stateFile);
	}
	async #verify(candidate: VoiceCandidate): Promise<boolean> {
		for (let attempt = 0; attempt < 20; attempt++) {
			if (await this.host.verifyCandidate(candidate)) return true;
			if (attempt < 19) await this.wait(500);
		}
		return false;
	}
	async #restoreBaseline(baseline: VoiceServiceBaseline): Promise<void> {
		await this.host.restore(baseline);
		await this.host.restart();
		if (!(await this.host.verifyBaseline(baseline)))
			throw new Error("Exact baseline verification failed after recovery");
	}
	async prepare(
		candidate: VoiceCandidate,
		taskIds: readonly string[],
		policy: VoiceAcceptancePolicy = "strict",
	): Promise<void> {
		voiceAcceptancePolicy(policy);
		if (!/^[a-f0-9]{40}$/.test(candidate.commit) || !/^[a-f0-9]{64}$/.test(candidate.sha256))
			throw new Error("Candidate provenance is incomplete");
		if (!(await this.host.verifyCandidateArtifact(candidate)))
			throw new Error("Candidate provenance does not match the immutable artifact");
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await chmod(this.directory, 0o700);
		let existing: ControllerState | undefined;
		try {
			existing = await this.#read();
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (existing && voiceAcceptancePolicy(existing.acceptancePolicy) !== policy)
			throw new Error("Voice UAT acceptance policy mismatch");
		if (existing && existing.schemaVersion !== 3)
			throw new Error("Historical voice UAT policy requires a separate run");
		if (existing?.activeRow) throw new Error(`Voice UAT row ${existing.activeRow.id} is still active`);
		const baseline = existing?.baseline ?? (await this.host.captureBaseline());
		await writeFile(join(this.directory, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`, {
			mode: 0o600,
		});
		await this.#ledger.initialize(
			{
				commit: candidate.commit,
				binarySha256: candidate.sha256,
				releaseTag: candidate.releaseTag ?? null,
				channel: candidate.channel ?? "feature",
			},
			taskIds,
			policy,
		);
		await this.#write({
			schemaVersion: 3,
			acceptancePolicy: policy,
			revision: 0,
			phase: "prepared",
			candidate,
			baseline,
		});
	}
	async deploy(signal?: AbortSignal): Promise<void> {
		const state = await this.#readCurrent();
		if (await this.host.activeVoiceCall()) throw new Error("Refusing to deploy during an active voice call");
		const checkInterrupted = () => {
			if (signal?.aborted)
				throw signal.reason instanceof Error ? signal.reason : new Error("Deployment interrupted");
		};
		try {
			checkInterrupted();
			await this.host.installCandidate(state.candidate);
			checkInterrupted();
			await this.host.restart();
			checkInterrupted();
			if (!(await this.#verify(state.candidate))) throw new Error("Candidate verification failed after deployment");
			checkInterrupted();
			await this.#write({ ...state, phase: "deployed" });
		} catch (error) {
			if (signal?.aborted) throw error;
			try {
				await this.#restoreBaseline(state.baseline);
			} catch (recovery) {
				throw new AggregateError([error, recovery], "Candidate deployment and exact baseline recovery failed");
			}
			throw error;
		}
	}
	async startRow(id: string, expectedReconnect: boolean): Promise<void> {
		const state = await this.#readCurrent();
		if (state.activeRow) throw new Error(`Voice UAT row ${state.activeRow.id} is already active`);
		if (await this.host.activeVoiceCall()) throw new Error("Refusing to start a row during an active voice call");
		const ledger = await this.#ledger.read();
		if (!ledger?.tasks[id]) throw new Error(`Unknown voice UAT task: ${id}`);
		const ordered = Object.keys(ledger.tasks);
		for (const previous of ordered.slice(0, ordered.indexOf(id)))
			if (
				ledger.tasks[previous].state !== "passed" ||
				!ledger.tasks[previous].attempts.at(-1) ||
				voiceAttemptAcceptanceFailures(
					ledger.tasks[previous].attempts.at(-1)!,
					voiceAcceptancePolicy(state.acceptancePolicy),
				).length ||
				ledger.tasks[previous].attempts.at(-1)!.candidateCommit !== state.candidate.commit ||
				ledger.tasks[previous].attempts.at(-1)!.binarySha256 !== state.candidate.sha256
			)
				throw new Error(`Voice UAT task ${previous} must pass before ${id}`);
		const scenario = await createVoiceScenario(join(this.directory, "rows"), id.toLowerCase());
		let anchor = "";
		await this.host.setCaptureEnvironment(scenario.directory, id, scenario.correlationSalt, expectedReconnect);
		try {
			await this.host.restart();
			if (!(await this.#verify(state.candidate))) throw new Error("Candidate verification failed at row start");
			// Exclude the intentional row-start replacement from the row's warning
			// and process-exit evidence. Everything after this cursor is in-row.
			anchor = await this.host.journalAnchor();
			await this.host.startResourceSampling(scenario.directory);
			await this.wait(20_000);
			await this.#ledger.update(id, {
				state: "running",
				evidenceHashes: [],
				findings: [],
				repairs: [],
				receipts: [],
			});
			await this.#write({
				...state,
				phase: "capturing",
				activeRow: { id, directory: scenario.directory, journalAnchor: anchor, startedAtUnixMs: Date.now() },
			});
		} catch (error) {
			await this.host.stopResourceSampling(scenario.directory);
			await this.host.clearCaptureEnvironment();
			await this.#restoreBaseline(state.baseline);
			throw error;
		}
	}
	async watchRow(id: string, now: () => number = Date.now, pollMilliseconds = 1_000): Promise<RowWatchdogState> {
		while (true) {
			const state = await this.#read();
			if (state.activeRow?.id !== id) throw new Error(`Voice UAT row ${id} is not active`);
			const decision = evaluateRowWatchdog(id, {
				now: now(),
				...(await this.host.inspectRowActivity(state.activeRow.directory)),
			});
			if (decision.state === "failed") {
				const ledger = await this.#ledger.read();
				const attempt = ledger?.tasks[id]?.attempts.at(-1);
				if (!attempt) throw new Error(`Voice UAT task ${id} has no active attempt`);
				await this.#ledger.update(id, {
					...attempt,
					state: "blocked",
					findings: [...new Set([...attempt.findings, `watchdog:${decision.finding}`])],
				});
				return decision;
			}
			if (decision.state === "close-call" || decision.state === "closed") return decision;
			await this.wait(pollMilliseconds);
		}
	}
	async finishRow(
		id: string,
		humanOutcomes?: { connection: boolean; caption: boolean; heardAudio: boolean },
		transcriptEvidence?: VoiceTranscriptEvidence,
	): Promise<VoiceRowCollection> {
		const state = await this.#readCurrent();
		if (state.activeRow?.id !== id) throw new Error(`Voice UAT row ${id} is not active`);
		if (await this.host.activeVoiceCall(state.activeRow.directory))
			throw new Error("Close the voice call before finishing its evidence");
		await this.wait(60_000);
		const collection = await this.host.collectRow(state.activeRow.directory, state.activeRow.journalAnchor);
		const ledger = await this.#ledger.read();
		if (!ledger) throw new Error("Voice UAT ledger is missing");
		const analysisResult = await this.#analyzeCollection(
			id,
			collection,
			state,
			ledger,
			humanOutcomes,
			transcriptEvidence,
		);
		const evidenceHashes = await this.#preserveEvidence(state.activeRow.directory, collection.evidenceFiles);
		const findings = [
			...new Set([
				...collection.findings,
				...analysisResult.failures,
				...["preflight-3x10s", "post-close-60s", "replay-before-close"]
					.filter(receipt => !collection.receipts.includes(receipt))
					.map(receipt => `receipt-missing:${receipt}`),
				...(humanOutcomes ? [] : ["human-outcomes-pending"]),
			]),
		];
		const passed = findings.length === 0 && humanOutcomes != null && Object.values(humanOutcomes).every(Boolean);
		await this.#ledger.update(id, {
			state: passed ? "passed" : "blocked",
			evidenceHashes,
			findings,
			receipts: collection.receipts,
			warningClassifications: analysisResult.warnings,
			...(humanOutcomes ? { humanOutcomes } : {}),
			...(transcriptEvidence ? { transcriptEvidence } : {}),
		});
		if (analysisResult.failures.length === 0)
			await this.#ledger.setTimingBaselines(
				Object.fromEntries(
					(collection.analysis.stageTimings ?? []).map(timing => [timing.stage, timing.elapsedMs]),
				),
			);
		await this.host.clearCaptureEnvironment();
		await this.#write({ ...state, phase: "ready", activeRow: undefined });
		return { ...collection, analysisResult };
	}
	async #analyzeCollection(
		id: string,
		collection: VoiceRowCollection,
		state: ControllerState,
		ledger: VoiceRunLedgerValue,
		humanOutcomes?: { connection: boolean; caption: boolean; heardAudio: boolean },
		transcriptEvidence?: VoiceTranscriptEvidence,
	): Promise<VoiceUatAnalysis> {
		const result = await analyzeVoiceUat({
			...collection.analysis,
			acceptancePolicy: voiceAcceptancePolicy(state.acceptancePolicy),
			requireTranscriptEvidence: state.schemaVersion === 3,
			allowlist: ledger.warningClassifications,
			candidate: { commit: state.candidate.commit, binarySha256: state.candidate.sha256 },
			...(humanOutcomes ? { humanOutcomes } : {}),
			...(transcriptEvidence ? { transcriptEvidence } : {}),
			requirements: voiceRowRequirements(id),
			stageTimings: (collection.analysis.stageTimings ?? []).map(timing => ({
				...timing,
				baselineMs: ledger.timingBaselines[timing.stage] ?? timing.elapsedMs,
			})),
		});
		const ordering = await analyzeVoiceReplayBeforeClose(collection.analysis.protocolFiles ?? []);
		result.failures = [
			...new Set([
				...result.failures,
				...(state.schemaVersion === 3 ? ordering : []),
				...["preflight-3x10s", "post-close-60s", ...(state.schemaVersion === 3 ? ["replay-before-close"] : [])]
					.filter(receipt => !collection.receipts.includes(receipt))
					.map(receipt => `receipt-missing:${receipt}`),
				...(!humanOutcomes ? ["human-outcomes-pending"] : []),
			]),
		];
		return result;
	}
	async analyzeRow(id: string): Promise<VoiceRowCollection> {
		const state = await this.#read();
		if (state.activeRow)
			throw new Error(`Finish or recover active row ${state.activeRow.id} before analyzing evidence`);
		const ledger = await this.#ledger.read();
		const task = ledger?.tasks[id];
		if (!ledger || !task) throw new Error(`Unknown voice UAT task: ${id}`);
		const directories = (await readdir(join(this.directory, "rows"), { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && entry.name.startsWith(id.toLowerCase()))
			.map(entry => join(this.directory, "rows", entry.name))
			.sort();
		const directory = directories.at(-1);
		if (!directory) throw new Error(`Voice UAT task ${id} has no collected evidence`);
		const collection = await this.host.collectRow(directory, "");
		const analysisResult = await this.#analyzeCollection(
			id,
			collection,
			state,
			ledger,
			task.attempts.at(-1)?.humanOutcomes,
			task.attempts.at(-1)?.transcriptEvidence,
		);
		return { ...collection, analysisResult };
	}
	async importHumanOutcomes(
		id: string,
		humanOutcomes: { connection: boolean; caption: boolean; heardAudio: boolean },
		transcriptEvidence?: VoiceTranscriptEvidence,
	): Promise<void> {
		const state = await this.#readCurrent();
		if (state.activeRow) throw new Error("Finish the local capture before importing human outcomes");
		const ledger = await this.#ledger.read();
		const attempt = ledger?.tasks[id]?.attempts.at(-1);
		if (!attempt || !["blocked", "passed"].includes(attempt.state))
			throw new Error(`Voice UAT task ${id} has no completed capture`);
		const findings = attempt.findings.filter(
			finding => finding !== "human-outcomes-pending" && finding !== "transcript-evidence-pending",
		);
		for (const [name, passed] of Object.entries(humanOutcomes))
			if (passed !== true) findings.push(`human-outcome:${name}`);
		const evidence = transcriptEvidence ?? attempt.transcriptEvidence;
		findings.push(
			...analyzeVoiceTranscriptEvidence(evidence, voiceAcceptancePolicy(state.acceptancePolicy), true).failures,
		);
		const next = {
			...attempt,
			findings: [...new Set(findings)],
			humanOutcomes,
			...(evidence ? { transcriptEvidence: evidence } : {}),
		};
		next.findings = voiceAttemptAcceptanceFailures(next, voiceAcceptancePolicy(state.acceptancePolicy));
		await this.#ledger.update(id, { ...next, state: next.findings.length === 0 ? "passed" : "blocked" });
	}
	async classifyWarning(classification: WarningAllowlist): Promise<void> {
		await this.#ledger.classifyWarning(classification);
	}
	async #preserveEvidence(directory: string, files: readonly string[]): Promise<string[]> {
		const preserved = join(directory, `preserved-${Date.now()}`);
		await mkdir(preserved, { recursive: false, mode: 0o700 });
		const hashes: string[] = [];
		for (const file of files) {
			const destination = join(preserved, basename(file));
			await copyFile(file, destination);
			await chmod(destination, 0o600);
			hashes.push(
				createHash("sha256")
					.update(await readFile(destination))
					.digest("hex"),
			);
		}
		return hashes;
	}
	async recoverRow(
		id: string,
		reason: string,
		stateName: "invalidated" | "interrupted" = "interrupted",
	): Promise<VoiceRowCollection> {
		const state = await this.#readCurrent();
		if (state.activeRow?.id !== id) throw new Error(`Voice UAT row ${id} is not active`);
		if (await this.host.activeVoiceCall(state.activeRow.directory))
			throw new Error("Refusing to recover while an active voice call remains");
		await this.#ledger.bindCandidate({
			commit: state.candidate.commit,
			binarySha256: state.candidate.sha256,
			releaseTag: state.candidate.releaseTag ?? null,
			channel: state.candidate.channel ?? "feature",
		});
		const collection = await this.host.collectRow(state.activeRow.directory, state.activeRow.journalAnchor);
		const analysisResult = await analyzeVoiceUat({
			...collection.analysis,
			candidate: { commit: state.candidate.commit, binarySha256: state.candidate.sha256 },
			requirements: voiceRowRequirements(id),
		});
		const evidenceHashes = await this.#preserveEvidence(state.activeRow.directory, collection.evidenceFiles);
		await this.#ledger.update(id, {
			state: stateName,
			evidenceHashes,
			findings: [...new Set([reason, ...collection.findings, ...analysisResult.failures])],
			receipts: [...collection.receipts, "recovery-preserved"],
		});
		await this.host.clearCaptureEnvironment();
		await this.#write({ ...state, phase: "ready", activeRow: undefined });
		return { ...collection, analysisResult };
	}
	async status() {
		const state = await this.#read();
		const ledger = await this.#ledger.read();
		if (!ledger) throw new Error("Voice UAT ledger is missing");
		return { state, ledger };
	}
	async renderChecklist(): Promise<string> {
		const { ledger } = await this.status();
		return Object.entries(ledger.tasks)
			.map(([id, task]) => `- [${task.state === "passed" ? "x" : " "}] ${id} (${task.state})`)
			.join("\n");
	}
	async verifyPublishedArtifact(candidate: VoiceCandidate): Promise<{
		verified: true;
		commit: string;
		version: string;
		sha256: string;
		releaseTag: string;
		channel: string;
		verifiedAtUnixMs: number;
		receiptFile: string;
		receiptSha256: string;
	}> {
		if (!candidate.releaseTag || !/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(candidate.releaseTag))
			throw new Error("Published artifact release tag is missing or invalid");
		const tagVersion = candidate.releaseTag.replace(/^v/, "");
		const binaryVersion = candidate.version.replace(/^xcsh\//, "").replace(/^v/, "");
		if (tagVersion !== binaryVersion) throw new Error("Published artifact version does not match its release tag");
		if (!(await this.host.verifyCandidateArtifact(candidate)))
			throw new Error("Published artifact provenance verification failed");
		const verifiedAtUnixMs = Date.now();
		const receiptFile = "published-artifact-receipt.json";
		const receipt = {
			schemaVersion: 1,
			commit: candidate.commit,
			version: candidate.version,
			artifactSha256: candidate.sha256,
			releaseTag: candidate.releaseTag,
			channel: candidate.channel ?? "stable",
			verifiedAtUnixMs,
		};
		const contents = `${JSON.stringify(receipt, null, 2)}\n`;
		await writeFile(join(this.directory, receiptFile), contents, { mode: 0o600 });
		const receiptSha256 = createHash("sha256").update(contents).digest("hex");
		const state = await this.#read();
		await this.#write({
			...state,
			publishedArtifactReceipt: {
				commit: candidate.commit,
				version: candidate.version,
				sha256: candidate.sha256,
				releaseTag: candidate.releaseTag,
				channel: candidate.channel ?? "stable",
				verifiedAtUnixMs,
				receiptSha256,
			},
		});
		return {
			verified: true,
			commit: candidate.commit,
			version: candidate.version,
			sha256: candidate.sha256,
			releaseTag: candidate.releaseTag,
			channel: candidate.channel ?? "stable",
			verifiedAtUnixMs,
			receiptFile,
			receiptSha256,
		};
	}
	async analyze(input: Parameters<typeof analyzeVoiceUat>[0]): Promise<VoiceUatAnalysis> {
		const state = await this.#read();
		if (input.acceptancePolicy && input.acceptancePolicy !== voiceAcceptancePolicy(state.acceptancePolicy))
			throw new Error("Voice UAT analysis policy mismatch");
		return analyzeVoiceUat({
			...input,
			acceptancePolicy: voiceAcceptancePolicy(state.acceptancePolicy),
			requireTranscriptEvidence: true,
		});
	}
	async repair(id: string, finding: string, repair: string): Promise<void> {
		const ledger = await this.#ledger.read();
		const task = ledger?.tasks[id];
		if (!task) throw new Error(`Unknown voice UAT task: ${id}`);
		const attempt = task.attempts.at(-1);
		if (!attempt) throw new Error(`Voice UAT task ${id} has no attempt`);
		await this.#ledger.update(id, {
			...attempt,
			state: "blocked",
			findings: [...new Set([...attempt.findings, finding])],
			repairs: [...attempt.repairs, repair],
		});
	}
	async finalize(): Promise<{ file: string; sha256: string }> {
		const state = await this.#readCurrent();
		const ledger = await this.#ledger.read();
		if (!ledger) throw new Error("Voice UAT ledger is missing");
		if (state.activeRow) throw new Error("Finish the active row before finalizing");
		const incomplete = Object.entries(ledger.tasks).filter(([, task]) => {
			const attempt = task.attempts.at(-1);
			return (
				task.state !== "passed" ||
				!attempt ||
				attempt.state !== "passed" ||
				attempt.candidateCommit !== state.candidate.commit ||
				attempt.binarySha256 !== state.candidate.sha256 ||
				voiceAttemptAcceptanceFailures(attempt, voiceAcceptancePolicy(state.acceptancePolicy)).length > 0
			);
		});
		if (incomplete.length)
			throw new Error(`Voice UAT tasks are not passed: ${incomplete.map(([id]) => id).join(", ")}`);
		const output = join(this.directory, "sanitized-evidence.json");
		const publicReference = (value: string) =>
			/^#\d+$/.test(value) || /^https:\/\/github\.com\/f5-sales-demo\/[a-z0-9._-]+\/(issues|pull)\/\d+$/.test(value);
		const bundle = {
			schemaVersion: 3,
			acceptancePolicy: voiceAcceptancePolicy(state.acceptancePolicy),
			candidate: {
				commit: state.candidate.commit,
				version: state.candidate.version,
				sha256: state.candidate.sha256,
				releaseTag: state.candidate.releaseTag ?? null,
				channel: state.candidate.channel ?? "feature",
			},
			timingBaselines: ledger.timingBaselines,
			warningClassifications: ledger.warningClassifications.map(classification => ({
				fingerprint: classification.fingerprint,
				owner: classification.owner,
				issue: classification.issue,
				artifactRange: classification.artifactRange,
				expiresAtUnixMs: classification.expiresAtUnixMs,
				...(classification.remediation && publicReference(classification.remediation)
					? { remediation: classification.remediation }
					: {}),
			})),
			...(state.publishedArtifactReceipt ? { publishedArtifact: state.publishedArtifactReceipt } : {}),
			tasks: Object.fromEntries(
				Object.entries(ledger.tasks).map(([id, task]) => [
					id,
					{
						projectTaskId: task.projectTaskId,
						state: task.state,
						attempts: task.attempts.map(attempt => ({
							attempt: attempt.attempt,
							acceptancePolicy: attempt.acceptancePolicy ?? "strict",
							transcriptEvidence: exportVoiceTranscriptEvidence(attempt.transcriptEvidence),
							transcriptOutcome: analyzeVoiceTranscriptEvidence(
								attempt.transcriptEvidence,
								attempt.acceptancePolicy,
							).outcome,
							candidateCommit: attempt.candidateCommit,
							binarySha256: attempt.binarySha256,
							releaseTag: attempt.releaseTag,
							channel: attempt.channel,
							startedAtUnixMs: attempt.startedAtUnixMs,
							finishedAtUnixMs: attempt.finishedAtUnixMs,
							state: attempt.state,
							evidenceHashes: attempt.evidenceHashes,
							findings: attempt.findings,
							repairs: attempt.repairs.filter(publicReference),
							warningClassifications: attempt.warningClassifications,
							receipts: attempt.receipts,
							humanOutcomes: attempt.humanOutcomes,
						})),
					},
				]),
			),
		};
		const contents = `${JSON.stringify(bundle, null, 2)}\n`;
		await writeFile(output, contents, { mode: 0o600 });
		await this.#write({ ...state, phase: "finalized", activeRow: undefined });
		return { file: basename(output), sha256: createHash("sha256").update(contents).digest("hex") };
	}
	async restore(): Promise<void> {
		const state = await this.#read();
		if (await this.host.activeVoiceCall()) throw new Error("Refusing to restore during an active voice call");
		await this.host.clearCaptureEnvironment();
		await this.#restoreBaseline(state.baseline);
		await this.#write({ ...state, phase: "restored", activeRow: undefined });
	}
}
