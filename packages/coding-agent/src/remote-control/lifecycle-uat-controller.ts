import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { compareProtocolTraces } from "./trace";
import type { VoiceCandidate } from "./voice-uat-controller";

export type LifecycleGate = "unit" | "installed" | "reference" | "physical";
export type LifecycleIdentities = Record<string, string>;
export interface LifecycleWorkerRuntime {
	threadId: string;
	pid: number;
	startTime: string;
	executable: string;
	sha256: string;
	socket: string;
	socketInode: string;
}
export interface LifecycleRuntime {
	executable: string;
	sha256: string;
	supervisorPid: number;
	childPid: number;
	invocation: string;
	configSha256: string;
	argumentsSha256: string;
	restarts: number;
	unexpectedProcesses: number[];
	workers?: LifecycleWorkerRuntime[];
}
export interface LifecycleCase {
	schemaVersion: 1;
	id: string;
	dependencies: string[];
	startingState: string;
	fixture: string;
	action: string;
	expectedTransition: string;
	identities: string[];
	gates: LifecycleGate[];
	requiredReceipts: string[];
	expectedMethods: string[];
	timeoutMs: number;
	cleanup: string;
	explanation: string;
	required: boolean;
	runtime: "running" | "absent" | "transition";
	voice?: boolean;
	minimumUserMessages?: number;
	minimumAssistantMessages?: number;
}
export interface LifecycleControl {
	label: string;
	screen: string;
	available: boolean;
	referenceBehavior: string;
	methods: string[];
	caseIds: string[];
}
export interface LifecycleCampaign {
	schemaVersion: 1;
	id: string;
	createdAtUnixMs: number;
	candidate: VoiceCandidate;
	reference: {
		tag: string;
		commit: string;
		packageSha256: string;
		schemaSha256: string;
		qualified: boolean;
		artifactSha256?: string;
	};
	phoneBuild: string;
	cases: LifecycleCase[];
	controls: LifecycleControl[];
	catalogFrozen: boolean;
	coreCaseIds: string[];
	coreRepeats: 2;
}
export interface LifecycleArtifact {
	path: string;
	sha256: string;
	kind: "capture" | "unit" | "reference" | "human" | "receipt";
}
export interface LifecycleReceipt {
	schemaVersion: 1;
	campaignId: string;
	attemptId: string;
	caseId: string;
	candidateCommit: string;
	binarySha256: string;
	name: string;
	outcome: "pass" | "fail";
	artifactSha256: string;
}
export interface LifecycleGateResult {
	gate: LifecycleGate;
	outcome: "pass" | "fail";
	artifactSha256: string;
}
export interface LifecycleAttempt {
	schemaVersion: 1;
	id: string;
	campaignId: string;
	caseId: string;
	cycle: 0 | 1 | 2;
	startedAtUnixMs: number;
	finishedAtUnixMs?: number;
	candidate: VoiceCandidate;
	identities: LifecycleIdentities;
	startRuntime: LifecycleRuntime;
	endRuntime?: LifecycleRuntime;
	gates: LifecycleGateResult[];
	receipts: LifecycleReceipt[];
	artifacts: LifecycleArtifact[];
	findings: string[];
	human?: {
		phoneBuild: string;
		identities: LifecycleIdentities;
		outcome: "pass" | "fail";
		observedUi: string;
		connection?: "pass" | "fail";
		captions?: "pass" | "fail";
		heardAudio?: "pass" | "fail";
		transcriptComplete?: boolean;
		userMessages?: number;
		assistantMessages?: number;
		landingScreen?: string;
	};
}
export interface LifecycleHost {
	inspect(): Promise<LifecycleRuntime>;
	verifyArtifact(candidate: VoiceCandidate): Promise<boolean>;
	replace?(candidate: VoiceCandidate): Promise<void>;
}
type EventPayload =
	| { kind: "start"; attempt: LifecycleAttempt }
	| { kind: "finish"; attemptId: string; runtime: LifecycleRuntime; atUnixMs: number; findings: string[] }
	| { kind: "gate"; attemptId: string; result: LifecycleGateResult; artifact: LifecycleArtifact }
	| { kind: "receipt"; attemptId: string; receipt: LifecycleReceipt; artifact: LifecycleArtifact }
	| { kind: "human"; attemptId: string; human: NonNullable<LifecycleAttempt["human"]>; artifact: LifecycleArtifact }
	| { kind: "invalidate"; attemptId: string; reason: string; atUnixMs: number }
	| { kind: "replacement"; cycle: number; runtime: LifecycleRuntime; artifact: LifecycleArtifact };
interface EventRecord {
	schemaVersion: 1;
	sequence: number;
	previousSha256: string;
	payload: EventPayload;
	sha256: string;
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const sha = (value: string) => /^[a-f0-9]{64}$/.test(value);
const commit = (value: string) => /^[a-f0-9]{40}$/.test(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function validateLifecycleCapture(
	rows: readonly Record<string, any>[],
	candidate: VoiceCandidate,
	methods: readonly string[],
	expectedIdentities: LifecycleIdentities = {},
): string[] {
	const failures = new Set<string>();
	const events = rows.slice(1, -1);
	if (
		rows[0]?.kind !== "manifest" ||
		rows[0]?.sourceCommit !== candidate.commit ||
		rows[0]?.artifactSha256 !== candidate.sha256
	)
		failures.add("capture-provenance");
	if (
		!events.length ||
		rows.at(-1)?.kind !== "footer" ||
		rows.at(-1)?.complete !== true ||
		rows.at(-1)?.events !== events.length
	)
		failures.add("incomplete-capture");
	if (events.some((row, index) => row.kind !== "event" || row.sequence !== index + 1))
		failures.add("capture-sequence");
	const fields: Record<string, string> = {
		client: "clientId",
		stream: "streamId",
		thread: "threadId",
		call: "callId",
	};
	for (const [name, field] of Object.entries(fields)) {
		const expected = expectedIdentities[name];
		if (!expected) continue;
		const values: unknown[] = [];
		const visit = (value: unknown) => {
			if (!value || typeof value !== "object") return;
			for (const [key, child] of Object.entries(value)) {
				if (key === field) values.push(child);
				else visit(child);
			}
		};
		for (const event of events) visit(event.message);
		if (
			!values.length ||
			values.some(value =>
				typeof value === "string" ? value !== expected : !value || (value as { $ref?: string }).$ref !== expected,
			)
		)
			failures.add(`capture-identity:${name}`);
	}
	const observed = events.map(row => row.message?.method ?? row.message?.message?.method ?? row.message?.type);
	let offset = -1;
	for (const method of methods) {
		offset = observed.indexOf(method, offset + 1);
		if (offset < 0) {
			failures.add(`missing-transition:${method}`);
			break;
		}
	}
	return [...failures];
}
export function lifecycleRuntimeProcessIds(
	rows: readonly { uid: number; pid: number; ppid: number; executable: string }[],
	uid: number,
	supervisorPid: number,
	executable: string,
	workers: readonly LifecycleWorkerRuntime[] = [],
): { childPid: number; unexpectedProcesses: number[] } {
	const children = rows.filter(row => row.uid === uid && row.ppid === supervisorPid && row.executable === executable);
	const childPid = children.length === 1 ? children[0].pid : 0;
	const workerPids = workers
		.filter(
			worker =>
				worker.executable === executable &&
				rows.some(row => row.uid === uid && row.pid === worker.pid && row.executable === executable),
		)
		.map(worker => worker.pid);
	const unexpectedProcesses = rows
		.filter(
			row =>
				row.uid === uid &&
				/(?:^|\/)xcsh(?:-linux-x64)?$/.test(row.executable) &&
				![supervisorPid, childPid, ...workerPids].includes(row.pid),
		)
		.map(row => row.pid);
	return { childPid, unexpectedProcesses };
}
function runtimeFailures(runtime: LifecycleRuntime, candidate: VoiceCandidate): string[] {
	const failures: string[] = [];
	if (runtime.executable !== candidate.executable || runtime.sha256 !== candidate.sha256)
		failures.push("runtime-provenance");
	if (
		!Number.isSafeInteger(runtime.supervisorPid) ||
		runtime.supervisorPid < 1 ||
		!Number.isSafeInteger(runtime.childPid) ||
		runtime.childPid < 1
	)
		failures.push("runtime-process-identity");
	if (!runtime.invocation || !sha(runtime.configSha256) || !sha(runtime.argumentsSha256))
		failures.push("runtime-configuration");
	if (runtime.restarts !== 0 || runtime.unexpectedProcesses.length) failures.push("unexpected-runtime");
	if (
		runtime.workers?.some(
			worker =>
				worker.executable !== candidate.executable ||
				worker.sha256 !== candidate.sha256 ||
				!Number.isSafeInteger(worker.pid) ||
				worker.pid < 1 ||
				!worker.threadId ||
				!/^\d+$/.test(worker.startTime) ||
				!isAbsolute(worker.socket) ||
				!/^\d+$/.test(worker.socketInode),
		) ||
		new Set(runtime.workers?.map(worker => worker.pid)).size !== (runtime.workers?.length ?? 0) ||
		new Set(runtime.workers?.map(worker => worker.threadId)).size !== (runtime.workers?.length ?? 0)
	)
		failures.push("worker-provenance");
	return failures;
}
function hostRuntimeChanged(before: LifecycleRuntime, after: LifecycleRuntime): boolean {
	// Historical receipts retain their original strict comparison policy.
	if (before.workers === undefined || after.workers === undefined) return !same(before, after);
	// Worker creation/unload is a lifecycle action; supervisor/relay replacement is not.
	const { workers: beforeWorkers = [], ...beforeHost } = before;
	const { workers: afterWorkers = [], ...afterHost } = after;
	if (!same(beforeHost, afterHost)) return true;
	return beforeWorkers.some(previous => {
		const current = afterWorkers.find(worker => worker.threadId === previous.threadId);
		return current !== undefined && !same(previous, current);
	});
}
export function lifecycleCaseFailures(
	campaign: LifecycleCampaign,
	definition: LifecycleCase,
	attempt: LifecycleAttempt,
): string[] {
	const failures = new Set(attempt.findings);
	if (!attempt.finishedAtUnixMs) failures.add("unfinished-attempt");
	if (
		attempt.campaignId !== campaign.id ||
		attempt.caseId !== definition.id ||
		!same(attempt.candidate, campaign.candidate)
	)
		failures.add("attempt-provenance");
	if (!campaign.catalogFrozen) failures.add("catalog-not-frozen");
	if (definition.gates.includes("reference") && !campaign.reference.qualified) failures.add("reference-unqualified");
	for (const name of definition.identities) if (!attempt.identities[name]) failures.add(`missing-identity:${name}`);
	if (attempt.identities.phoneBuild !== campaign.phoneBuild || !campaign.phoneBuild) failures.add("phone-build");
	if (definition.runtime === "running") {
		for (const reason of runtimeFailures(attempt.startRuntime, campaign.candidate)) failures.add(reason);
		if (attempt.endRuntime)
			for (const reason of runtimeFailures(attempt.endRuntime, campaign.candidate)) failures.add(reason);
		if (attempt.endRuntime && hostRuntimeChanged(attempt.startRuntime, attempt.endRuntime))
			failures.add("runtime-changed");
		const thread = attempt.identities.thread;
		if (
			thread &&
			attempt.startRuntime.workers?.some(worker => worker.threadId === thread) &&
			!attempt.endRuntime?.workers?.some(worker => worker.threadId === thread)
		)
			failures.add("worker-owner-lost");
	} else if (
		definition.runtime === "absent" &&
		(attempt.startRuntime.supervisorPid ||
			attempt.startRuntime.childPid ||
			attempt.startRuntime.unexpectedProcesses.length ||
			(attempt.startRuntime.workers?.length ?? 0))
	) {
		failures.add("runtime-not-absent");
	}
	for (const gate of definition.gates) {
		const results = attempt.gates.filter(result => result.gate === gate);
		if (!results.length) failures.add(`missing-gate:${gate}`);
		if (results.some(result => result.outcome !== "pass" || !sha(result.artifactSha256)))
			failures.add(`failed-gate:${gate}`);
	}
	for (const name of definition.requiredReceipts) {
		const receipts = attempt.receipts.filter(receipt => receipt.name === name);
		if (!receipts.length) failures.add(`missing-receipt:${name}`);
		if (
			receipts.some(
				r =>
					r.outcome !== "pass" ||
					r.campaignId !== campaign.id ||
					r.attemptId !== attempt.id ||
					r.caseId !== definition.id ||
					r.candidateCommit !== campaign.candidate.commit ||
					r.binarySha256 !== campaign.candidate.sha256 ||
					!sha(r.artifactSha256),
			)
		)
			failures.add(`invalid-receipt:${name}`);
	}
	if (definition.gates.includes("physical")) {
		const human = attempt.human;
		if (!human) failures.add("missing-human");
		else {
			if (human.outcome !== "pass" || !human.observedUi) failures.add("human-outcome");
			if (human.phoneBuild !== campaign.phoneBuild || !same(human.identities, attempt.identities))
				failures.add("human-identity");
			if (definition.voice) {
				for (const field of ["connection", "captions", "heardAudio"] as const)
					if (human[field] !== "pass") failures.add(`human-${field}`);
				if (!human.transcriptComplete) failures.add("human-transcript-incomplete");
				if ((human.userMessages ?? 0) < (definition.minimumUserMessages ?? 1)) failures.add("human-user-count");
				if ((human.assistantMessages ?? 0) < (definition.minimumAssistantMessages ?? 1))
					failures.add("human-assistant-count");
			}
		}
	}
	return [...failures];
}
function validateCampaign(value: LifecycleCampaign): void {
	if (
		value.schemaVersion !== 1 ||
		!/^[a-z0-9][a-z0-9-]{0,95}$/.test(value.id) ||
		!commit(value.candidate.commit) ||
		!sha(value.candidate.sha256) ||
		!isAbsolute(value.candidate.executable)
	)
		throw new Error("Invalid lifecycle campaign provenance");
	if (!commit(value.reference.commit) || !sha(value.reference.packageSha256) || !sha(value.reference.schemaSha256))
		throw new Error("Invalid reference provenance");
	if (value.coreRepeats !== 2 || !value.cases.length || !value.coreCaseIds.length)
		throw new Error("Invalid lifecycle acceptance policy");
	const ids = new Set(value.cases.map(c => c.id));
	if (ids.size !== value.cases.length) throw new Error("Duplicate lifecycle cases");
	for (const c of value.cases) {
		if (
			c.schemaVersion !== 1 ||
			!/^[A-Z][A-Z0-9-]{1,31}$/.test(c.id) ||
			!c.action ||
			!c.expectedTransition ||
			!c.startingState ||
			!c.fixture ||
			!c.cleanup ||
			!c.explanation ||
			c.timeoutMs < 1 ||
			!c.gates.length ||
			c.dependencies.some(id => !ids.has(id) || id === c.id)
		)
			throw new Error(`Invalid lifecycle case: ${c.id}`);
	}
	for (const id of value.coreCaseIds) if (!ids.has(id)) throw new Error(`Unknown core case: ${id}`);
	if (
		value.catalogFrozen &&
		(!value.phoneBuild ||
			!value.controls.length ||
			value.controls.some(
				c =>
					!c.label || !c.screen || !c.referenceBehavior || !c.caseIds.length || c.caseIds.some(id => !ids.has(id)),
			))
	)
		throw new Error("Control inventory is incomplete");
}
export class LifecycleController {
	constructor(
		readonly directory: string,
		private readonly host: LifecycleHost,
	) {}
	async #locked<T>(operation: () => Promise<T>): Promise<T> {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		const lock = join(this.directory, ".lock");
		try {
			await writeFile(lock, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
		} catch {
			throw new Error("Lifecycle controller has another writer; inspect its exact lock owner");
		}
		try {
			return await operation();
		} finally {
			const { unlink } = await import("node:fs/promises");
			await unlink(lock);
		}
	}
	async prepare(campaign: LifecycleCampaign): Promise<void> {
		validateCampaign(campaign);
		if (!(await this.host.verifyArtifact(campaign.candidate)))
			throw new Error("Candidate artifact verification failed");
		await this.#locked(async () => {
			const bytes = `${JSON.stringify(campaign, null, 2)}\n`;
			await writeFile(join(this.directory, "campaign.json"), bytes, { flag: "wx", mode: 0o600 });
			await writeFile(join(this.directory, "campaign.sha256"), hash(bytes), { flag: "wx", mode: 0o600 });
			await writeFile(join(this.directory, "events.jsonl"), "", { flag: "wx", mode: 0o600 });
			await chmod(this.directory, 0o700);
			await this.#checkpoint();
		});
	}
	async #read(): Promise<{ campaign: LifecycleCampaign; events: EventRecord[]; attempts: LifecycleAttempt[] }> {
		const bytes = await readFile(join(this.directory, "campaign.json"), "utf8");
		if (hash(bytes) !== (await readFile(join(this.directory, "campaign.sha256"), "utf8")))
			throw new Error("Campaign integrity mismatch");
		const campaign = JSON.parse(bytes) as LifecycleCampaign;
		validateCampaign(campaign);
		const log = await readFile(join(this.directory, "events.jsonl"), "utf8");
		if (log && !log.endsWith("\n")) throw new Error("Incomplete lifecycle event log");
		const events = log
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line) as EventRecord);
		let previous = hash(bytes);
		const attempts: LifecycleAttempt[] = [];
		for (const [index, e] of events.entries()) {
			const { sha256: digest, ...record } = e;
			if (
				e.schemaVersion !== 1 ||
				e.sequence !== index + 1 ||
				e.previousSha256 !== previous ||
				hash(JSON.stringify(record)) !== digest
			)
				throw new Error("Lifecycle event integrity mismatch");
			previous = digest;
			const payload = e.payload;
			if (payload.kind === "replacement") continue;
			if (payload.kind === "start") {
				if (attempts.some(a => a.id === payload.attempt.id) || attempts.some(a => !a.finishedAtUnixMs))
					throw new Error("Invalid lifecycle attempt ordering");
				attempts.push(structuredClone(payload.attempt));
				continue;
			}
			const a = attempts.find(a => a.id === payload.attemptId);
			if (!a) throw new Error("Lifecycle event references an absent attempt");
			if (payload.kind === "finish") {
				a.finishedAtUnixMs = payload.atUnixMs;
				a.endRuntime = payload.runtime;
				a.findings.push(...payload.findings);
			}
			if (payload.kind === "invalidate") {
				a.findings.push(payload.reason);
				a.finishedAtUnixMs ??= payload.atUnixMs;
			}
			if (payload.kind === "gate") {
				a.gates.push(payload.result);
				a.artifacts.push(payload.artifact);
			}
			if (payload.kind === "receipt") {
				a.receipts.push(payload.receipt);
				a.artifacts.push(payload.artifact);
			}
			if (payload.kind === "human") {
				if (a.human) throw new Error("Physical outcomes cannot be rewritten");
				a.human = payload.human;
				a.gates.push({ gate: "physical", outcome: payload.human.outcome, artifactSha256: payload.artifact.sha256 });
				a.artifacts.push(payload.artifact);
			}
		}
		return { campaign, events, attempts };
	}
	async #append(payload: EventPayload): Promise<void> {
		const { events } = await this.#read();
		const previousSha256 = events.at(-1)?.sha256 ?? (await readFile(join(this.directory, "campaign.sha256"), "utf8"));
		const record = { schemaVersion: 1 as const, sequence: events.length + 1, previousSha256, payload };
		await writeFile(
			join(this.directory, "events.jsonl"),
			`${JSON.stringify({ ...record, sha256: hash(JSON.stringify(record)) })}\n`,
			{ flag: "a", mode: 0o600 },
		);
		await this.#checkpoint();
	}
	async #artifact(attemptId: string, kind: LifecycleArtifact["kind"], source: string): Promise<LifecycleArtifact> {
		const bytes = await readFile(source);
		const digest = hash(bytes);
		const directory = join(this.directory, "artifacts", attemptId);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const path = join(directory, `${kind}-${digest}`);
		await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
		return { path: relative(this.directory, path), sha256: digest, kind };
	}
	async #attempt(id?: string): Promise<LifecycleAttempt> {
		const { attempts } = await this.#read();
		const a = id ? attempts.find(a => a.id === id) : attempts.at(-1);
		if (!a) throw new Error("No lifecycle attempt");
		return a;
	}
	async preflight(): Promise<LifecycleRuntime> {
		const { campaign } = await this.#read();
		const runtime = await this.host.inspect();
		const failures = runtimeFailures(runtime, campaign.candidate);
		if (!(await this.host.verifyArtifact(campaign.candidate))) failures.push("artifact-provenance");
		if (failures.length) throw new Error(`Lifecycle preflight failed: ${failures.join(",")}`);
		return runtime;
	}
	async startCase(id: string, identities: LifecycleIdentities, cycle: 0 | 1 | 2 = 0): Promise<string> {
		return this.#locked(async () => {
			const { campaign, attempts } = await this.#read();
			const definition = campaign.cases.find(c => c.id === id);
			if (!definition) throw new Error(`Unknown lifecycle case: ${id}`);
			if (attempts.some(a => !a.finishedAtUnixMs)) throw new Error("A lifecycle attempt is active");
			for (const dependency of definition.dependencies) {
				const previous = attempts.filter(a => a.caseId === dependency && a.cycle === cycle).at(-1);
				const spec = campaign.cases.find(c => c.id === dependency)!;
				if (!previous || (await this.#failures(campaign, spec, previous)).length)
					throw new Error(`Dependency ${dependency} must pass`);
			}
			for (const name of definition.identities) if (!identities[name]) throw new Error(`Missing identity: ${name}`);
			if (identities.phoneBuild !== campaign.phoneBuild) throw new Error("Phone build mismatch");
			if (cycle > 0) {
				const index = campaign.coreCaseIds.indexOf(id);
				if (index < 0) throw new Error("Core sequence contains only frozen core cases");
				for (const previousId of campaign.coreCaseIds.slice(0, index)) {
					const previous = attempts.filter(a => a.caseId === previousId && a.cycle === cycle).at(-1);
					if (
						!previous ||
						(await this.#failures(campaign, campaign.cases.find(c => c.id === previousId)!, previous)).length
					)
						throw new Error(`Core sequence requires ${previousId} before ${id}`);
				}
			}
			const runtime = definition.runtime === "running" ? await this.preflight() : await this.host.inspect();
			const attempt: LifecycleAttempt = {
				schemaVersion: 1,
				id: randomUUID(),
				campaignId: campaign.id,
				caseId: id,
				cycle,
				startedAtUnixMs: Date.now(),
				candidate: campaign.candidate,
				identities,
				startRuntime: runtime,
				gates: [],
				receipts: [],
				artifacts: [],
				findings: [],
			};
			await this.#append({ kind: "start", attempt });
			return attempt.id;
		});
	}
	async finishCase(): Promise<string[]> {
		return this.#locked(async () => {
			const a = await this.#attempt();
			if (a.finishedAtUnixMs) throw new Error("Lifecycle attempt is already finished");
			const { campaign } = await this.#read();
			const definition = campaign.cases.find(c => c.id === a.caseId)!;
			const endRuntime = await this.host.inspect();
			const findings: string[] = [];
			if (definition.runtime === "running") {
				if (hostRuntimeChanged(a.startRuntime, endRuntime)) findings.push("runtime-changed");
				findings.push(...runtimeFailures(endRuntime, campaign.candidate));
				const expectedThread = a.identities.thread;
				if (
					expectedThread &&
					a.startRuntime.workers?.some(worker => worker.threadId === expectedThread) &&
					!endRuntime.workers?.some(worker => worker.threadId === expectedThread)
				)
					findings.push("worker-owner-lost");
			}
			if (Date.now() - a.startedAtUnixMs > definition.timeoutMs) findings.push("case-timeout");
			await this.#append({ kind: "finish", attemptId: a.id, runtime: endRuntime, atUnixMs: Date.now(), findings });
			return this.analyze(a.id);
		});
	}
	async recordGate(
		gate: "unit" | "installed",
		source: string,
		outcome: "pass" | "fail",
		attemptId?: string,
	): Promise<void> {
		await this.#locked(async () => {
			const a = await this.#attempt(attemptId);
			const { campaign } = await this.#read();
			const definition = campaign.cases.find(c => c.id === a.caseId)!;
			if (gate === "unit") {
				const evidence = JSON.parse(await readFile(source, "utf8"));
				if (
					evidence.campaignId !== campaign.id ||
					evidence.attemptId !== a.id ||
					evidence.caseId !== a.caseId ||
					evidence.candidateCommit !== campaign.candidate.commit ||
					evidence.binarySha256 !== campaign.candidate.sha256 ||
					!Array.isArray(evidence.command) ||
					!evidence.command.length ||
					!sha(evidence.outputSha256)
				)
					throw new Error("Unit evidence binding mismatch");
				if (evidence.exitCode !== 0) outcome = "fail";
			}
			const artifact = await this.#artifact(a.id, gate === "unit" ? "unit" : "capture", source);
			if (gate === "installed") {
				const rows = (await readFile(source, "utf8"))
					.trim()
					.split("\n")
					.map(line => JSON.parse(line));
				if (validateLifecycleCapture(rows, campaign.candidate, definition.expectedMethods, a.identities).length)
					outcome = "fail";
			}
			await this.#append({
				kind: "gate",
				attemptId: a.id,
				result: { gate, outcome, artifactSha256: artifact.sha256 },
				artifact,
			});
		});
	}
	async receipt(receipt: LifecycleReceipt, source: string): Promise<void> {
		await this.#locked(async () => {
			const a = await this.#attempt(receipt.attemptId);
			const evidence = JSON.parse(await readFile(source, "utf8"));
			if (
				evidence.campaignId !== receipt.campaignId ||
				evidence.attemptId !== a.id ||
				evidence.caseId !== a.caseId ||
				evidence.name !== receipt.name ||
				evidence.outcome !== receipt.outcome
			)
				throw new Error("Receipt evidence binding mismatch");
			const artifact = await this.#artifact(a.id, "receipt", source);
			if (artifact.sha256 !== receipt.artifactSha256) throw new Error("Receipt artifact mismatch");
			await this.#append({ kind: "receipt", attemptId: a.id, receipt, artifact });
		});
	}
	async importHuman(human: NonNullable<LifecycleAttempt["human"]>, source: string, attemptId?: string): Promise<void> {
		await this.#locked(async () => {
			const a = await this.#attempt(attemptId);
			if (a.human) throw new Error("Physical outcomes cannot be rewritten");
			const { campaign } = await this.#read();
			if (human.phoneBuild !== campaign.phoneBuild || !same(human.identities, a.identities))
				throw new Error("Human identity mismatch");
			if (!same(JSON.parse(await readFile(source, "utf8")), human))
				throw new Error("Human evidence contents mismatch");
			const artifact = await this.#artifact(a.id, "human", source);
			await this.#append({ kind: "human", attemptId: a.id, human, artifact });
		});
	}
	async replay(
		reference: string,
		candidate: string,
		attemptId?: string,
	): Promise<ReturnType<typeof compareProtocolTraces>> {
		return this.#locked(async () => {
			const a = await this.#attempt(attemptId);
			const { campaign } = await this.#read();
			const read = async (p: string) =>
				(await readFile(p, "utf8"))
					.trim()
					.split("\n")
					.map(line => JSON.parse(line));
			const [r, c] = await Promise.all([read(reference), read(candidate)]);
			const result = compareProtocolTraces(r, c);
			const referenceArtifact = await this.#artifact(a.id, "capture", reference);
			const candidateArtifact = await this.#artifact(a.id, "capture", candidate);
			const evidenceArtifacts = [referenceArtifact, candidateArtifact];
			const provenance =
				r[0]?.sourceCommit === campaign.reference.commit &&
				r[0]?.artifactSha256 === (campaign.reference.artifactSha256 ?? campaign.reference.packageSha256) &&
				r[0]?.source === "codex" &&
				c[0]?.source === "xcsh" &&
				!validateLifecycleCapture(c, campaign.candidate, []).length;
			const comparison = join(this.directory, `.comparison-${a.id}.json`);
			await writeFile(comparison, `${JSON.stringify({ ...result, provenance })}\n`, { mode: 0o600 });
			const artifact = await this.#artifact(a.id, "reference", comparison);
			for (const capture of evidenceArtifacts)
				await this.#append({
					kind: "gate",
					attemptId: a.id,
					result: {
						gate: "reference",
						outcome: result.complete && provenance && campaign.reference.qualified ? "pass" : "fail",
						artifactSha256: capture.sha256,
					},
					artifact: capture,
				});
			await this.#append({
				kind: "gate",
				attemptId: a.id,
				result: {
					gate: "reference",
					outcome: result.complete && provenance && campaign.reference.qualified ? "pass" : "fail",
					artifactSha256: artifact.sha256,
				},
				artifact,
			});
			return result;
		});
	}
	async invalidate(reason: string): Promise<void> {
		if (!/^[a-z0-9][a-z0-9:-]{0,159}$/.test(reason)) throw new Error("Invalid content-free finding");
		await this.#locked(async () => {
			const a = await this.#attempt();
			await this.#append({ kind: "invalidate", attemptId: a.id, reason, atUnixMs: Date.now() });
		});
	}
	async #failures(campaign: LifecycleCampaign, definition: LifecycleCase, a: LifecycleAttempt): Promise<string[]> {
		const failures = new Set(lifecycleCaseFailures(campaign, definition, a));
		const hashes = new Set(a.artifacts.map(f => f.sha256));
		for (const gate of a.gates) if (!hashes.has(gate.artifactSha256)) failures.add(`unbound-gate:${gate.gate}`);
		for (const receipt of a.receipts)
			if (!hashes.has(receipt.artifactSha256)) failures.add(`unbound-receipt:${receipt.name}`);
		for (const artifact of a.artifacts) {
			if (
				isAbsolute(artifact.path) ||
				relative(this.directory, join(this.directory, artifact.path)).startsWith("..")
			) {
				failures.add("artifact-path");
				continue;
			}
			try {
				if (hash(await readFile(join(this.directory, artifact.path))) !== artifact.sha256)
					failures.add("artifact-integrity");
			} catch {
				failures.add("artifact-missing");
			}
		}
		return [...failures];
	}
	async analyze(attemptId?: string): Promise<string[]> {
		const a = await this.#attempt(attemptId);
		const { campaign } = await this.#read();
		return this.#failures(campaign, campaign.cases.find(c => c.id === a.caseId)!, a);
	}
	async status() {
		const { campaign, attempts, events } = await this.#read();
		const cases: Record<string, "pending" | "failed" | "passed"> = {};
		const core: Record<string, boolean> = {};
		for (const c of campaign.cases) {
			const a = attempts.filter(a => a.caseId === c.id && a.cycle === 0).at(-1);
			cases[c.id] = !a ? "pending" : (await this.#failures(campaign, c, a)).length ? "failed" : "passed";
		}
		for (const cycle of [1, 2])
			for (const id of campaign.coreCaseIds) {
				const a = attempts.filter(a => a.caseId === id && a.cycle === cycle).at(-1);
				core[`${cycle}:${id}`] =
					!!a && !(await this.#failures(campaign, campaign.cases.find(c => c.id === id)!, a)).length;
			}
		const replacements = events.filter(e => e.payload.kind === "replacement");
		const replacementIdentities = new Set(
			replacements.map(e =>
				e.payload.kind === "replacement"
					? `${e.payload.runtime.supervisorPid}:${e.payload.runtime.invocation}`
					: "",
			),
		);
		let replacementIntegrity = replacements.length >= 5 && replacementIdentities.size === replacements.length;
		for (const e of replacements)
			if (e.payload.kind === "replacement") {
				try {
					replacementIntegrity &&=
						hash(await readFile(join(this.directory, e.payload.artifact.path))) === e.payload.artifact.sha256 &&
						runtimeFailures(e.payload.runtime, campaign.candidate).length === 0;
				} catch {
					replacementIntegrity = false;
				}
			}
		const complete =
			campaign.catalogFrozen &&
			campaign.reference.qualified &&
			campaign.cases.filter(c => c.required).every(c => cases[c.id] === "passed") &&
			Object.values(core).every(Boolean) &&
			replacementIntegrity;
		return {
			campaignId: campaign.id,
			candidate: campaign.candidate,
			complete,
			cases,
			core,
			attempts: attempts.length,
			activeAttempt: attempts.find(a => !a.finishedAtUnixMs)?.id ?? null,
			lastAttempt: attempts.at(-1)?.id ?? null,
		};
	}
	async #checkpoint(): Promise<void> {
		const state = await this.status();
		await writeFile(
			join(this.directory, "resume.json"),
			`${JSON.stringify({ schemaVersion: 1, ...state, nextPermittedAction: state.activeAttempt ? "finish-case-or-invalidate" : "resolve-next-case-dependencies" }, null, 2)}\n`,
			{ mode: 0o600 },
		);
	}
	async resume() {
		await this.#checkpoint();
		return this.status();
	}
	async replace(): Promise<void> {
		await this.#locked(async () => {
			const { campaign, attempts, events } = await this.#read();
			if (attempts.some(a => !a.finishedAtUnixMs)) throw new Error("Replacement would interrupt an active case");
			if (!this.host.replace) throw new Error("Replacement is unavailable");
			if (!(await this.host.verifyArtifact(campaign.candidate)))
				throw new Error("Candidate artifact verification failed");
			await this.host.replace(campaign.candidate);
			let runtime: LifecycleRuntime | undefined;
			for (let retry = 0; retry < 60; retry++) {
				try {
					runtime = await this.preflight();
					break;
				} catch (error) {
					if (retry === 59) throw error;
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			}
			if (!runtime) throw new Error("Replacement readiness failed");
			const cycle = events.filter(e => e.payload.kind === "replacement").length + 1;
			const file = join(this.directory, `.replacement-${cycle}.json`);
			await writeFile(file, `${JSON.stringify(runtime)}\n`, { mode: 0o600 });
			const artifact = await this.#artifact(`replacement-${cycle}`, "receipt", file);
			await this.#append({ kind: "replacement", cycle, runtime, artifact });
		});
	}
	async finalize(): Promise<string> {
		return this.#locked(async () => {
			const status = await this.status();
			if (!status.complete) throw new Error("Lifecycle campaign is incomplete");
			await this.preflight();
			const { campaign, attempts } = await this.#read();
			const safe = {
				schemaVersion: 1,
				campaignId: campaign.id,
				candidate: {
					commit: campaign.candidate.commit,
					sha256: campaign.candidate.sha256,
					version: campaign.candidate.version,
				},
				reference: campaign.reference,
				cases: status.cases,
				core: status.core,
				attempts: attempts.map(a => ({
					id: a.id,
					caseId: a.caseId,
					cycle: a.cycle,
					gates: a.gates,
					receipts: a.receipts.map(r => ({ name: r.name, outcome: r.outcome, artifactSha256: r.artifactSha256 })),
					artifacts: a.artifacts.map(f => ({ kind: f.kind, sha256: f.sha256 })),
					identities: Object.fromEntries(
						Object.entries(a.identities).map(([key, value]) => [key, { $ref: hash(value).slice(0, 24) }]),
					),
				})),
			};
			const file = join(this.directory, "sanitized-bundle.json");
			const bytes = `${JSON.stringify(safe, null, 2)}\n`;
			await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
			await writeFile(`${file}.sha256`, hash(bytes), { flag: "wx", mode: 0o600 });
			return file;
		});
	}
}
