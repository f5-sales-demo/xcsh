import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	analyzeVoiceUat,
	createVoiceScenario,
	exportRemoteRealtimeDiagnostics,
	VoiceRunLedger,
	type VoiceUatAnalysis,
} from "./voice-diagnostics";

export interface VoiceCandidate {
	commit: string;
	version: string;
	sha256: string;
	executable: string;
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
}
export interface VoiceUatHost {
	activeVoiceCall(): Promise<boolean>;
	captureBaseline(): Promise<VoiceServiceBaseline>;
	installCandidate(candidate: VoiceCandidate): Promise<void>;
	setCaptureEnvironment(
		directory: string,
		scenario: string,
		correlationSalt: string,
		expectedReconnect: boolean,
	): Promise<void>;
	clearCaptureEnvironment(): Promise<void>;
	restart(): Promise<void>;
	verifyCandidate(candidate: VoiceCandidate): Promise<boolean>;
	restore(baseline: VoiceServiceBaseline): Promise<void>;
	journalAnchor(): Promise<string>;
	collectRow(directory: string, anchor: string): Promise<VoiceRowCollection>;
}
interface ControllerState {
	schemaVersion: 1;
	revision: number;
	phase: "prepared" | "deployed" | "capturing" | "ready" | "finalized" | "restored";
	candidate: VoiceCandidate;
	baseline: VoiceServiceBaseline;
	activeRow?: { id: string; directory: string; journalAnchor: string; startedAtUnixMs: number };
}
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

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
		return JSON.parse(await readFile(this.#stateFile, "utf8")) as ControllerState;
	}
	async #write(state: ControllerState): Promise<void> {
		const value = { ...state, revision: state.revision + 1 };
		const temporary = `${this.#stateFile}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, this.#stateFile);
	}
	async prepare(candidate: VoiceCandidate, taskIds: readonly string[]): Promise<void> {
		if (!/^[a-f0-9]{40}$/.test(candidate.commit) || !/^[a-f0-9]{64}$/.test(candidate.sha256))
			throw new Error("Candidate provenance is incomplete");
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		await chmod(this.directory, 0o700);
		const baseline = await this.host.captureBaseline();
		await writeFile(join(this.directory, "baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`, {
			mode: 0o600,
		});
		await this.#ledger.initialize(candidate.commit, taskIds);
		await this.#write({ schemaVersion: 1, revision: 0, phase: "prepared", candidate, baseline });
	}
	async deploy(): Promise<void> {
		const state = await this.#read();
		if (await this.host.activeVoiceCall()) throw new Error("Refusing to deploy during an active voice call");
		try {
			await this.host.installCandidate(state.candidate);
			await this.host.restart();
			if (!(await this.host.verifyCandidate(state.candidate)))
				throw new Error("Candidate verification failed after deployment");
			await this.#write({ ...state, phase: "deployed" });
		} catch (error) {
			await this.host.restore(state.baseline);
			await this.host.restart();
			throw error;
		}
	}
	async startRow(id: string, expectedReconnect: boolean): Promise<void> {
		const state = await this.#read();
		if (state.activeRow) throw new Error(`Voice UAT row ${state.activeRow.id} is already active`);
		if (await this.host.activeVoiceCall()) throw new Error("Refusing to start a row during an active voice call");
		const scenario = await createVoiceScenario(join(this.directory, "rows"), id.toLowerCase());
		const anchor = await this.host.journalAnchor();
		await this.host.setCaptureEnvironment(scenario.directory, id, scenario.correlationSalt, expectedReconnect);
		try {
			await this.host.restart();
			if (!(await this.host.verifyCandidate(state.candidate)))
				throw new Error("Candidate verification failed at row start");
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
			await this.host.clearCaptureEnvironment();
			await this.host.restore(state.baseline);
			await this.host.restart();
			throw error;
		}
	}
	async finishRow(
		id: string,
		humanOutcomes: { connection: boolean; caption: boolean; heardAudio: boolean },
	): Promise<VoiceRowCollection> {
		const state = await this.#read();
		if (state.activeRow?.id !== id) throw new Error(`Voice UAT row ${id} is not active`);
		if (await this.host.activeVoiceCall()) throw new Error("Close the voice call before finishing its evidence");
		await this.wait(60_000);
		const collection = await this.host.collectRow(state.activeRow.directory, state.activeRow.journalAnchor);
		const evidenceHashes: string[] = [];
		for (const file of collection.evidenceFiles)
			evidenceHashes.push(
				createHash("sha256")
					.update(await readFile(file))
					.digest("hex"),
			);
		const passed = collection.findings.length === 0 && Object.values(humanOutcomes).every(Boolean);
		await this.#ledger.update(id, {
			state: passed ? "passed" : "blocked",
			evidenceHashes,
			findings: collection.findings,
			receipts: collection.receipts,
			humanOutcomes,
		});
		await this.host.clearCaptureEnvironment();
		await this.#write({ ...state, phase: "ready", activeRow: undefined });
		return collection;
	}
	async analyze(input: Parameters<typeof analyzeVoiceUat>[0]): Promise<VoiceUatAnalysis> {
		return analyzeVoiceUat(input);
	}
	async repair(id: string, finding: string, repair: string): Promise<void> {
		const ledger = await this.#ledger.read();
		const task = ledger?.tasks[id];
		if (!task) throw new Error(`Unknown voice UAT task: ${id}`);
		await this.#ledger.update(id, {
			...task,
			state: "blocked",
			findings: [...new Set([...task.findings, finding])],
			repairs: [...task.repairs, repair],
		});
	}
	async finalize(entries: readonly unknown[]): Promise<string> {
		const state = await this.#read();
		const output = join(this.directory, "sanitized-evidence.json");
		const rows = exportRemoteRealtimeDiagnostics(entries);
		await writeFile(
			output,
			`${JSON.stringify(
				{
					schemaVersion: 1,
					candidate: {
						commit: state.candidate.commit,
						version: state.candidate.version,
						sha256: state.candidate.sha256,
					},
					records: rows,
				},
				null,
				2,
			)}\n`,
			{ mode: 0o600 },
		);
		await this.#write({ ...state, phase: "finalized", activeRow: undefined });
		return basename(output);
	}
	async restore(): Promise<void> {
		const state = await this.#read();
		if (await this.host.activeVoiceCall()) throw new Error("Refusing to restore during an active voice call");
		await this.host.clearCaptureEnvironment();
		await this.host.restore(state.baseline);
		await this.host.restart();
		await this.#write({ ...state, phase: "restored", activeRow: undefined });
	}
}
