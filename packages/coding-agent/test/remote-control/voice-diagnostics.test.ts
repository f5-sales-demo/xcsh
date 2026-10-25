import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeVoiceReplayBeforeClose,
	analyzeVoiceTranscriptEvidence,
	analyzeVoiceUat,
	CheckpointStore,
	canonicalWarningFingerprint,
	createVoiceScenario,
	exportRemoteRealtimeDiagnostics,
	VoiceDiagnosticRuntime,
	VoiceRunLedger,
	type WarningAllowlist,
} from "../../src/remote-control/voice-diagnostics";

test("checkpoints recover monotonically after a process death without session content", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-diagnostics-"));
	try {
		const store = new CheckpointStore(join(root, "checkpoint.json"));
		store.write({
			eventCount: 100,
			reconnectAttempts: 2,
			queuePressure: 3,
			droppedFrames: 0,
			stageTimingsMs: { relay: 4 },
			resources: { rssBytes: 10, fileDescriptors: 2, sockets: 1 },
		});
		const recovered = new CheckpointStore(join(root, "checkpoint.json"));
		expect(recovered.read()).toMatchObject({ revision: 1, eventCount: 100, reconnectAttempts: 2 });
		recovered.write({
			eventCount: 101,
			reconnectAttempts: 2,
			queuePressure: 1,
			droppedFrames: 0,
			stageTimingsMs: {},
			resources: { rssBytes: 11, fileDescriptors: 2, sockets: 1 },
		});
		expect(recovered.read()?.revision).toBe(2);
		expect(await readFile(join(root, "checkpoint.json"), "utf8")).not.toContain("private");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("remote-realtime exporter is allowlisted, deduplicated, and content-free", () => {
	const entries = [
		{
			kind: "remote-realtime",
			stage: "connected",
			eventCount: 1,
			transcript: "private",
			sdp: "private",
			token: "private",
			nested: { text: "private" },
		},
		{ kind: "remote-realtime", stage: "connected", eventCount: 1, transcript: "private" },
		{ kind: "remote-realtime", stage: "reconnecting", reconnectAttempts: 2, queuePressure: 4, droppedFrames: 1 },
	];
	const exported = exportRemoteRealtimeDiagnostics(entries);
	expect(exported).toEqual([
		{ kind: "remote-realtime", stage: "connected", eventCount: 1 },
		{ kind: "remote-realtime", stage: "reconnecting", reconnectAttempts: 2, queuePressure: 4, droppedFrames: 1 },
	]);
	expect(JSON.stringify(exported)).not.toContain("private");
});

test("scenario folders are private and never expose their correlation salt", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-scenario-"));
	try {
		const scenario = await createVoiceScenario(root, "voice-first");
		expect((await stat(scenario.directory)).mode & 0o777).toBe(0o700);
		expect(scenario.manifest).toMatchObject({ scenario: "voice-first", schemaVersion: 1 });
		expect(JSON.stringify(scenario.manifest)).not.toContain(scenario.correlationSalt);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer rejects expired allowlists, malformed captures, journal gaps, and resource growth", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-"));
	try {
		const capture = join(root, "capture.jsonl");
		await writeFile(
			capture,
			`${JSON.stringify({ kind: "manifest", schemaVersion: 1, source: "xcsh", version: "v", sourceCommit: "a".repeat(40), artifactSha256: "b".repeat(64), scenario: "voice-first", startedAtUnixMs: 1 })}\n${JSON.stringify({ kind: "event", sequence: 1, elapsedMs: 0, layer: "relay", direction: "in", message: { method: "thread/realtime/start" } })}\n${JSON.stringify({ kind: "footer", complete: true, events: 1 })}\n`,
		);
		const report = await analyzeVoiceUat({
			captureFiles: [capture],
			journal: [{ atUnixMs: 2, message: "warning: cgroup-kill", fingerprint: "cgroup-kill" }],
			resources: [
				{ atUnixMs: 1, rssBytes: 10, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 2, rssBytes: 30, fileDescriptors: 6, sockets: 4 },
			],
			allowlist: [
				{
					fingerprint: "cgroup-kill",
					evidence: "journal",
					owner: "runtime",
					issue: "#4404",
					artifactRange: "v",
					candidateSha256: "b".repeat(64),
					classifiedAtUnixMs: 0,
					expiresAtUnixMs: 1,
				},
			],
		});
		expect(report.failures).toEqual(
			expect.arrayContaining([
				"expired-allowlist:cgroup-kill",
				"resource-growth:rssBytes",
				"journal-without-checkpoint",
			]),
		);
		await writeFile(capture, "{not-json}\n");
		await expect(
			analyzeVoiceUat({ captureFiles: [capture], journal: [], resources: [], allowlist: [] }),
		).resolves.toMatchObject({
			failures: [
				"insufficient-resource-samples:post-close",
				"insufficient-resource-samples:preflight",
				"malformed-capture",
			],
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("runtime checkpoints lifecycle, queue high-water marks, rejections, delegation, and final state", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-runtime-"));
	try {
		let now = 1_000;
		const records: Record<string, unknown>[] = [];
		const runtime = new VoiceDiagnosticRuntime({
			checkpointFile: join(root, "checkpoint.json"),
			now: () => now,
			record: record => {
				records.push(record);
			},
			resources: () => ({
				rssBytes: 100,
				fileDescriptors: 4,
				sockets: 2,
				processState: "running",
				invocationId: "fixture-invocation",
			}),
		});
		runtime.transition("starting");
		for (let index = 0; index < 100; index++) runtime.event("response.audio.delta", "handled");
		runtime.event("unknown", "rejected", "unknownType");
		runtime.queues({ inboundBytes: 800, inboundLimit: 1_000, outboundBytes: 100, outboundLimit: 1_000 });
		runtime.delegation({ active: true, pending: 1, supersededExecutions: 0 });
		runtime.reconnect(false);
		runtime.stage("sideband-attach", 42);
		now += 30_001;
		runtime.tick();
		await runtime.close("closed");

		const checkpoint = new CheckpointStore(join(root, "checkpoint.json")).read();
		expect(checkpoint).toMatchObject({
			lifecycle: "closed",
			eventCount: 101,
			reconnectAttempts: 1,
			unexpectedReconnects: 1,
			inboundQueueHighWaterBytes: 800,
			outboundQueueHighWaterBytes: 100,
			rejectedEventClasses: { unknownType: 1 },
			eventDispositions: { handled: 100, rejected: 1 },
			delegation: { active: true, pending: 1, supersededExecutions: 0 },
			process: { pid: process.pid, state: "running", invocationId: "fixture-invocation" },
		});
		expect(records).toContainEqual(expect.objectContaining({ kind: "voiceUatFinding", severity: "warning" }));
		expect(records.at(-1)).toMatchObject({ kind: "voiceCheckpoint", lifecycle: "closed" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("sanitized exporter supports real diagnostic kinds and never copies arbitrary fields", () => {
	const exported = exportRemoteRealtimeDiagnostics([
		{ kind: "voiceDiagnostic", stage: "call-create", outcome: "succeeded", elapsedMs: 4, sdp: "secret" },
		{ kind: "voiceEventDiagnostic", eventTypes: { "session.created": 1 }, rejections: {}, transcript: "secret" },
		{ kind: "voiceCheckpoint", revision: 2, lifecycle: "connected", eventCount: 7, path: "/secret" },
		{ kind: "processExitDiagnostic", stage: "post-close", exitStatus: 0, message: "secret" },
	]);
	expect(exported).toEqual([
		{ kind: "voiceDiagnostic", stage: "call-create", outcome: "succeeded", elapsedMs: 4 },
		{ kind: "voiceEventDiagnostic", eventTypes: { "session.created": 1 }, rejections: {} },
		{ kind: "voiceCheckpoint", revision: 2, lifecycle: "connected", eventCount: 7 },
		{ kind: "processExitDiagnostic", stage: "post-close", exitStatus: 0 },
	]);
	expect(JSON.stringify(exported)).not.toContain("secret");
});

test("run ledger is atomic, monotonic, and evidence-gated", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-ledger-"));
	try {
		const ledger = new VoiceRunLedger(join(root, "ledger.json"));
		await ledger.initialize(
			{ commit: "a".repeat(40), binarySha256: "b".repeat(64), releaseTag: null, channel: "feature" },
			["A01", "A02"],
		);
		await ledger.update("A01", { state: "running", evidenceHashes: [], findings: [], repairs: [], receipts: [] });
		await expect(ledger.update("A01", { state: "passed" })).rejects.toThrow("evidence");
		await ledger.update("A01", {
			state: "passed",
			humanOutcomes: { connection: true, caption: true, heardAudio: true },
			evidenceHashes: ["c".repeat(64)],
			findings: [],
			receipts: ["preflight-3x10s", "post-close-60s", "replay-before-close"],
			transcriptEvidence: {
				schemaVersion: 1,
				visibility: "live-visible",
				durableUserSegments: 3,
				durableAssistantSegments: 3,
				transcriptComplete: true,
			},
		});
		const value = await ledger.read();
		expect(value).toMatchObject({
			schemaVersion: 3,
			revision: 3,
			candidate: { commit: "a".repeat(40), binarySha256: "b".repeat(64), channel: "feature" },
		});
		expect(value?.tasks.A01).toMatchObject({ projectTaskId: "A01", state: "passed" });
		expect(value?.tasks.A01.attempts).toHaveLength(1);
		expect(value?.tasks.A01.attempts[0]).toMatchObject({
			candidateCommit: "a".repeat(40),
			binarySha256: "b".repeat(64),
			state: "passed",
			evidenceHashes: ["c".repeat(64)],
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("warning classifications are complete, candidate-bound, and expire within thirty days", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-ledger-warning-"));
	try {
		const ledger = new VoiceRunLedger(join(root, "ledger.json"));
		await ledger.initialize(
			{ commit: "a".repeat(40), binarySha256: "b".repeat(64), releaseTag: null, channel: "feature" },
			["A01"],
		);
		const classifiedAtUnixMs = Date.now();
		const classification: WarningAllowlist = {
			fingerprint: "c".repeat(64),
			evidence: "replacement-cycle-1",
			owner: "runtime",
			issue: "#4406",
			artifactRange: "feature-candidate",
			candidateSha256: "b".repeat(64),
			classifiedAtUnixMs,
			benignRationale: "Synthetic test fixture",
			expiresAtUnixMs: classifiedAtUnixMs + 24 * 60 * 60 * 1000,
		};
		await ledger.classifyWarning(classification);
		expect((await ledger.read())?.warningClassifications).toEqual([classification]);
		await expect(ledger.classifyWarning({ ...classification, candidateSha256: "d".repeat(64) })).rejects.toThrow(
			"candidate",
		);
		await expect(
			ledger.classifyWarning({
				...classification,
				expiresAtUnixMs: classifiedAtUnixMs + 31 * 24 * 60 * 60 * 1000,
			}),
		).rejects.toThrow("expiry");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a replacement candidate preserves attempts while resetting classifications and task gates", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-ledger-candidate-"));
	try {
		const ledger = new VoiceRunLedger(join(root, "ledger.json"));
		const first = { commit: "a".repeat(40), binarySha256: "b".repeat(64), releaseTag: null, channel: "feature" };
		await ledger.initialize(first, ["A01", "A02"]);
		await ledger.update("A01", { state: "running" });
		await ledger.update("A01", {
			state: "passed",
			humanOutcomes: { connection: true, caption: true, heardAudio: true },
			evidenceHashes: ["f".repeat(64)],
			findings: [],
			receipts: ["preflight-3x10s", "post-close-60s", "replay-before-close"],
			transcriptEvidence: {
				schemaVersion: 1,
				visibility: "live-visible",
				durableUserSegments: 3,
				durableAssistantSegments: 3,
				transcriptComplete: true,
			},
		});
		await ledger.update("A02", { state: "running" });
		await ledger.update("A02", { state: "blocked", findings: ["session-ready-timeout"] });
		const classifiedAtUnixMs = Date.now();
		await ledger.classifyWarning({
			fingerprint: "c".repeat(64),
			evidence: "fixture",
			owner: "runtime",
			issue: "#4406",
			artifactRange: "first",
			candidateSha256: first.binarySha256,
			classifiedAtUnixMs,
			benignRationale: "Fixture",
			expiresAtUnixMs: classifiedAtUnixMs + 1_000,
		});
		const second = { commit: "d".repeat(40), binarySha256: "e".repeat(64), releaseTag: null, channel: "feature" };
		await ledger.initialize(second, ["A01", "A02"]);
		const value = await ledger.read();
		expect(value).toMatchObject({
			candidate: second,
			timingBaselines: {},
			warningClassifications: [],
			tasks: { A01: { state: "pending" }, A02: { state: "pending" } },
		});
		expect(value?.tasks.A01.attempts).toHaveLength(1);
		expect(value?.tasks.A01.attempts[0]).toMatchObject({
			binarySha256: first.binarySha256,
			state: "invalidated",
			findings: ["candidate-replaced"],
		});
		expect(value?.tasks.A02.attempts[0]).toMatchObject({
			binarySha256: first.binarySha256,
			state: "invalidated",
			findings: ["session-ready-timeout", "candidate-replaced"],
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer requires phased samples and rejects evidence from a different candidate", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-candidate-"));
	try {
		const capture = join(root, "capture.jsonl");
		await writeFile(
			capture,
			`${JSON.stringify({ kind: "manifest", schemaVersion: 1, sourceCommit: "a".repeat(40), artifactSha256: "b".repeat(64) })}\n${JSON.stringify({ kind: "footer", complete: true, events: 0 })}\n`,
		);
		const report = await analyzeVoiceUat({
			captureFiles: [capture],
			journal: [],
			resources: [{ atUnixMs: 1, phase: "preflight", rssBytes: 1, fileDescriptors: 1, sockets: 1 }],
			allowlist: [],
			candidate: { commit: "c".repeat(40), binarySha256: "d".repeat(64) },
		});
		expect(report.failures).toEqual(
			expect.arrayContaining([
				"candidate-mismatch:commit",
				"candidate-mismatch:binary",
				"insufficient-resource-samples:preflight",
				"insufficient-resource-samples:post-close",
			]),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("nested diagnostic data is sanitized instead of copied wholesale", () => {
	const exported = exportRemoteRealtimeDiagnostics([
		{
			kind: "voiceCheckpoint",
			revision: 1,
			lifecycle: "closed",
			rejectedEventClasses: { unknownType: 2, transcript: "secret" },
			stageTimingsMs: { attach: 10, path: "/private" },
			delegation: { active: false, pending: 0, supersededExecutions: 0, text: "secret" },
			resources: { rssBytes: 1, fileDescriptors: 2, sockets: 3, path: "/private" },
			process: { pid: 4, state: "running", invocationId: "fixture-invocation", command: "secret" },
		},
	]);
	expect(exported).toEqual([
		{
			kind: "voiceCheckpoint",
			revision: 1,
			lifecycle: "closed",
			rejectedEventClasses: { unknownType: 2 },
			stageTimingsMs: { attach: 10 },
			delegation: { active: false, pending: 0, supersededExecutions: 0 },
			resources: { rssBytes: 1, fileDescriptors: 2, sockets: 3 },
			process: { pid: 4, state: "running", invocationId: "fixture-invocation" },
		},
	]);
	expect(JSON.stringify(exported)).not.toMatch(/secret|private/);
});

test("warning fingerprints include source, unit, priority, template, exit, stage, and candidate", () => {
	const fingerprint = canonicalWarningFingerprint({
		source: "journal",
		unit: "xcsh-remote-control.service",
		priority: 4,
		message: "Process 123 (xcsh) exited with status 1 after 42ms",
		exitStatus: 1,
		stage: "replacement",
		candidateSha: "c".repeat(40),
	});
	expect(fingerprint.template).toBe("Process <n> (xcsh) exited with status <n> after <n>ms");
	expect(fingerprint.value).toMatch(/^[a-f0-9]{64}$/);
});

test("analyzer enforces drops, reconnects, correlation, human outcomes, and exact resource thresholds", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-policy-"));
	try {
		const capture = join(root, "capture.jsonl");
		await writeFile(
			capture,
			`${JSON.stringify({ kind: "voiceCheckpoint", revision: 1, droppedFrames: 1, unexpectedReconnects: 1 })}\n${JSON.stringify({ kind: "footer", complete: true, events: 0 })}\n`,
		);
		const mib = 1024 * 1024;
		const report = await analyzeVoiceUat({
			captureFiles: [capture],
			journal: [],
			resources: [
				{ atUnixMs: 0, phase: "preflight", rssBytes: 100 * mib, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 10_000, phase: "preflight", rssBytes: 100 * mib, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 20_000, phase: "preflight", rssBytes: 100 * mib, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 30_000, phase: "post-close", rssBytes: 165 * mib, fileDescriptors: 3, sockets: 2 },
				{ atUnixMs: 40_000, phase: "post-close", rssBytes: 165 * mib, fileDescriptors: 3, sockets: 2 },
				{ atUnixMs: 50_000, phase: "post-close", rssBytes: 165 * mib, fileDescriptors: 3, sockets: 2 },
			],
			allowlist: [],
			correlationGaps: ["session.created->checkpoint"],
			humanOutcomes: { connection: true, caption: false, heardAudio: true },
			stageTimings: [
				{ stage: "sideband", elapsedMs: 301, baselineMs: 100 },
				{ stage: "history", elapsedMs: 210, baselineMs: 100 },
				{ stage: "history", elapsedMs: 220, baselineMs: 100 },
				{ stage: "history", elapsedMs: 230, baselineMs: 100 },
			],
		});
		expect(report.failures).toEqual(
			expect.arrayContaining([
				"dropped-frame",
				"unexpected-reconnect",
				"correlation-gap:session.created->checkpoint",
				"human-outcome:caption",
				"resource-growth:rssBytes",
				"resource-retained:fileDescriptors",
				"resource-retained:sockets",
				"stage-timing:sideband",
				"stage-timing:history",
			]),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer distinguishes reopen-only transcript hydration from absent durable history", async () => {
	const reopened = await analyzeVoiceUat({
		captureFiles: [],
		journal: [],
		resources: [],
		allowlist: [],
		transcriptEvidence: {
			durableUserSegments: 3,
			durableAssistantSegments: 3,
			liveVisible: false,
			reopenVisible: true,
		},
	});
	expect(reopened.transcriptOutcome).toBe("reopen-only");
	expect(reopened.failures).toContain("transcript-visible-only-after-reopen");
	expect(reopened.failures).not.toContain("durable-transcript-absent");

	const absent = await analyzeVoiceUat({
		captureFiles: [],
		journal: [],
		resources: [],
		allowlist: [],
		transcriptEvidence: {
			durableUserSegments: 0,
			durableAssistantSegments: 0,
			liveVisible: false,
			reopenVisible: false,
		},
	});
	expect(absent.transcriptOutcome).toBe("durable-absent");
	expect(absent.failures).toContain("durable-transcript-absent");
	expect(absent.failures).not.toContain("transcript-visible-only-after-reopen");
});

test("analyzer validates checkpoint order, lifecycle order, sampling cadence, and invocation continuity", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-ordering-"));
	try {
		const capture = join(root, "capture.jsonl");
		await writeFile(
			capture,
			`${[
				{ kind: "manifest", schemaVersion: 1, sourceCommit: "a".repeat(40), artifactSha256: "b".repeat(64) },
				{ kind: "event", sequence: 1, message: { type: "session.output_audio.delta", delta: "AQID" } },
				{ kind: "event", sequence: 2, message: { type: "session.started", session: { id: "s1" } } },
				{ kind: "voiceCheckpoint", revision: 2 },
				{ kind: "voiceCheckpoint", revision: 1 },
				{ kind: "footer", complete: true, events: 2 },
			]
				.map(row => JSON.stringify(row))
				.join("\n")}\n`,
		);
		const report = await analyzeVoiceUat({
			captureFiles: [capture],
			journal: [],
			resources: [
				{ atUnixMs: 0, phase: "preflight", rssBytes: 1, fileDescriptors: 1, sockets: 1, invocationId: "one" },
				{ atUnixMs: 5_000, phase: "preflight", rssBytes: 1, fileDescriptors: 1, sockets: 1, invocationId: "one" },
				{ atUnixMs: 10_000, phase: "preflight", rssBytes: 1, fileDescriptors: 1, sockets: 1, invocationId: "two" },
				{ atUnixMs: 20_000, phase: "post-close", rssBytes: 1, fileDescriptors: 1, sockets: 1, invocationId: "two" },
				{ atUnixMs: 30_000, phase: "post-close", rssBytes: 1, fileDescriptors: 1, sockets: 1, invocationId: "two" },
				{ atUnixMs: 40_000, phase: "post-close", rssBytes: 1, fileDescriptors: 1, sockets: 1, invocationId: "two" },
			],
			checkpoints: [{ revision: 2, writtenAtUnixMs: 2 } as any],
			allowlist: [],
		});
		expect(report.failures).toEqual(
			expect.arrayContaining([
				"lifecycle-order:session.started",
				"non-monotonic-checkpoint-revision",
				"resource-sample-cadence:preflight",
				"invocation-continuity",
			]),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer accepts a connection open event before session readiness", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-connection-open-"));
	try {
		const capture = join(root, "capture.jsonl");
		await writeFile(
			capture,
			`${[
				{ kind: "manifest", schemaVersion: 1 },
				{ kind: "event", sequence: 1, layer: "connection", direction: "in", message: { type: "open" } },
				{ kind: "event", sequence: 2, layer: "realtime", direction: "in", message: { type: "session.started" } },
				{ kind: "event", sequence: 3, layer: "realtime", direction: "out", message: { type: "session.close" } },
				{ kind: "event", sequence: 4, layer: "connection", direction: "in", message: { type: "closed" } },
				{ kind: "footer", complete: true, events: 4 },
			]
				.map(row => JSON.stringify(row))
				.join("\n")}\n`,
		);
		const report = await analyzeVoiceUat({ captureFiles: [capture], journal: [], resources: [], allowlist: [] });
		expect(report.failures).not.toContain("lifecycle-order:session.started");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer blocks a failed runtime checkpoint even without a dropped frame", async () => {
	const report = await analyzeVoiceUat({
		captureFiles: [],
		journal: [],
		resources: [],
		allowlist: [],
		checkpoints: [
			{
				revision: 1,
				writtenAtUnixMs: 1,
				eventCount: 0,
				reconnectAttempts: 0,
				queuePressure: 0,
				droppedFrames: 0,
				stageTimingsMs: {},
				resources: { rssBytes: 1, fileDescriptors: 1, sockets: 1 },
				lifecycle: "failed",
			},
		],
	});
	expect(report.failures).toContain("runtime-failed");
});

test("analyzer accepts one explicitly expected controlled runtime rejection", async () => {
	const checkpoint = {
		revision: 1,
		writtenAtUnixMs: 1,
		eventCount: 1,
		reconnectAttempts: 0,
		queuePressure: 0,
		droppedFrames: 0,
		stageTimingsMs: {},
		resources: { rssBytes: 1, fileDescriptors: 1, sockets: 1 },
		lifecycle: "failed" as const,
	};
	const expected = await analyzeVoiceUat({
		captureFiles: [],
		journal: [],
		resources: [],
		allowlist: [],
		checkpoints: [checkpoint],
		requirements: { expectedRuntimeFailure: true },
	});
	expect(expected.failures).not.toContain("runtime-failed");
	expect(expected.failures).not.toContain("correlation-gap:runtime-failure");

	const missing = await analyzeVoiceUat({
		captureFiles: [],
		journal: [],
		resources: [],
		allowlist: [],
		checkpoints: [],
		requirements: { expectedRuntimeFailure: true },
	});
	expect(missing.failures).toContain("correlation-gap:runtime-failure");
});

test("analyzer accepts an explicitly expected nonzero process exit", async () => {
	const report = await analyzeVoiceUat({
		captureFiles: [],
		journal: [],
		resources: [],
		allowlist: [],
		processExits: [{ exitStatus: 137, signal: "KILL", expected: true }],
	});
	expect(report.failures).not.toContain("unexpected-process-exit");
});

test("analyzer enforces row-specific event, duration, capture, and reconnect correlations", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-row-"));
	try {
		const capture = join(root, "capture.jsonl");
		await writeFile(
			capture,
			`${JSON.stringify({ kind: "manifest" })}\n${JSON.stringify({ kind: "event", sequence: 1, elapsedMs: 1, message: { type: "session.created" } })}\n${JSON.stringify({ kind: "footer", complete: true, events: 1 })}\n`,
		);
		const report = await analyzeVoiceUat({
			captureFiles: [capture],
			journal: [],
			resources: [],
			allowlist: [],
			checkpoints: [],
			requirements: {
				minimumEventCounts: { "session.created": 2, "turn.done": 20 },
				minimumDurationMs: 60 * 60_000,
				minimumCaptures: 2,
				minimumReconnects: 1,
			},
		});
		expect(report.failures).toEqual(
			expect.arrayContaining([
				"correlation-gap:event:session.created",
				"correlation-gap:event:turn.done",
				"correlation-gap:duration",
				"correlation-gap:captures",
				"correlation-gap:reconnect",
			]),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer blocks failed delegated backing turns and realtime errors", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-delegation-failure-"));
	try {
		const voiceCapture = join(root, "voice.jsonl");
		const hostCapture = join(root, "host.jsonl");
		await writeFile(
			voiceCapture,
			`${[
				{ kind: "manifest" },
				{ kind: "event", sequence: 1, message: { type: "session.started" } },
				{ kind: "event", sequence: 2, message: { type: "delegation.created" } },
				{ kind: "event", sequence: 3, message: { type: "session.close" } },
				{ kind: "event", sequence: 4, message: { type: "closed" } },
				{ kind: "footer", complete: true, events: 4 },
			]
				.map(row => JSON.stringify(row))
				.join("\n")}\n`,
		);
		await writeFile(
			hostCapture,
			`${[
				{ kind: "manifest" },
				{
					kind: "event",
					sequence: 1,
					message: { method: "turn/completed", params: { turn: { status: "failed" } } },
				},
				{ kind: "event", sequence: 2, message: { method: "thread/realtime/error", params: {} } },
				{ kind: "footer", complete: true, events: 2 },
			]
				.map(row => JSON.stringify(row))
				.join("\n")}\n`,
		);
		const resources = [
			{ atUnixMs: 0, phase: "preflight" as const, rssBytes: 1, fileDescriptors: 1, sockets: 1 },
			{ atUnixMs: 10_000, phase: "preflight" as const, rssBytes: 1, fileDescriptors: 1, sockets: 1 },
			{ atUnixMs: 20_000, phase: "preflight" as const, rssBytes: 1, fileDescriptors: 1, sockets: 1 },
			{ atUnixMs: 30_000, phase: "post-close" as const, rssBytes: 1, fileDescriptors: 1, sockets: 1 },
			{ atUnixMs: 40_000, phase: "post-close" as const, rssBytes: 1, fileDescriptors: 1, sockets: 1 },
			{ atUnixMs: 50_000, phase: "post-close" as const, rssBytes: 1, fileDescriptors: 1, sockets: 1 },
		];
		const report = await analyzeVoiceUat({
			captureFiles: [voiceCapture],
			protocolFiles: [hostCapture],
			journal: [],
			resources,
			allowlist: [],
		});
		expect(report.failures).toEqual(
			expect.arrayContaining([
				"backing-turn-failed",
				"realtime-error",
				"delegation-no-successful-backing-turn",
				"delegation-context-return-missing",
			]),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyzer attributes JSON-RPC errors to the failed host request", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-analysis-rpc-error-"));
	try {
		const hostCapture = join(root, "host.jsonl");
		await writeFile(
			hostCapture,
			`${[
				{ kind: "manifest" },
				{ kind: "event", sequence: 1, message: { id: "request-1", method: "turn/start", params: {} } },
				{
					kind: "event",
					sequence: 2,
					message: { id: "request-1", error: { code: -32602, message: "redacted" } },
				},
			]
				.map(row => JSON.stringify(row))
				.join("\n")}\n`,
		);
		const report = await analyzeVoiceUat({
			captureFiles: [],
			protocolFiles: [hostCapture],
			journal: [],
			resources: [],
			allowlist: [],
		});
		expect(report.failures).toContain("rpc-error:turn/start");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("session-list policy requires explicit complete versioned transcript evidence", () => {
	const evidence = {
		schemaVersion: 1 as const,
		visibility: "session-list-selectable" as const,
		durableUserSegments: 3,
		durableAssistantSegments: 3,
		transcriptComplete: true,
	};
	expect(analyzeVoiceTranscriptEvidence(evidence, "session-list-selectable-v1")).toEqual({
		outcome: "session-list-selectable",
		failures: [],
	});
	expect(analyzeVoiceTranscriptEvidence(evidence).failures).toContain("transcript-visibility-not-accepted");
	expect(
		analyzeVoiceTranscriptEvidence({ ...evidence, visibility: "live-visible" }, "session-list-selectable-v1")
			.failures,
	).toEqual([]);
	for (const patch of [
		{ transcriptComplete: false },
		{ transcriptComplete: undefined },
		{ durableUserSegments: -1 },
		{ durableAssistantSegments: 0 },
		{ durableUserSegments: 1.5 },
		{ visibility: "reopen-only" },
		{ visibility: "not-visible" },
		{ visibility: "durable-absent" },
	])
		expect(
			analyzeVoiceTranscriptEvidence({ ...evidence, ...patch } as typeof evidence, "session-list-selectable-v1")
				.failures.length,
		).toBeGreaterThan(0);
	expect(analyzeVoiceTranscriptEvidence(undefined, "session-list-selectable-v1").failures).toContain(
		"transcript-evidence-pending",
	);
	const legacy = { durableUserSegments: 3, durableAssistantSegments: 3, liveVisible: false, reopenVisible: true };
	expect(analyzeVoiceTranscriptEvidence(legacy).failures).toContain("transcript-visible-only-after-reopen");
	expect(analyzeVoiceTranscriptEvidence(legacy, "session-list-selectable-v1").failures).toContain(
		"invalid-transcript-evidence",
	);
});

test("replay receipt requires completed transcript notifications before every close", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-close-receipt-"));
	try {
		const file = join(root, "host.jsonl");
		const events = ["turn/completed", "thread/realtime/closed"];
		const write = async (methods: string[]) =>
			writeFile(
				file,
				methods
					.map((method, i) =>
						JSON.stringify({
							kind: "event",
							sequence: i + 1,
							message: { method, params: { threadId: "fixture-thread" } },
						}),
					)
					.join("\n"),
			);
		await write(events);
		expect(await analyzeVoiceReplayBeforeClose([file])).toEqual([]);
		await write([...events, "thread/realtime/started", ...events]);
		expect(await analyzeVoiceReplayBeforeClose([file])).toEqual([]);
		await write([...events, "turn/completed"]);
		expect(await analyzeVoiceReplayBeforeClose([file])).toContain("replay-after-close");
		await write([...events].reverse());
		expect(await analyzeVoiceReplayBeforeClose([file])).toContain("replay-before-close-missing");
		expect(await analyzeVoiceReplayBeforeClose([])).toContain("replay-before-close-missing");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("diagnostics retain bounded policy/runtime hashes and failure classes without private content", () => {
	const hash = "a".repeat(64);
	const rows = exportRemoteRealtimeDiagnostics([
		{
			kind: "voicePolicyDiagnostic",
			policyVersion: "5",
			policySha256: hash,
			renderedInstructionsSha256: hash,
			outcome: "acknowledged",
			instructions: "private",
		},
		{ kind: "voiceRuntimeDiagnostic", runtimeContextSha256: hash, outcome: "queued", context: "private" },
		{ kind: "delegationFailure", key: hash, failureClass: "execution", outcome: "unresolved", text: "private" },
	]);
	expect(rows).toHaveLength(3);
	expect(rows[0]).toMatchObject({ policySha256: hash });
	expect(rows[2]).toMatchObject({ failureClass: "execution" });
	expect(JSON.stringify(rows)).not.toContain("private");
});

test("new diagnostic exports omit malformed hashes and unrecognized failure labels", () => {
	const rows = exportRemoteRealtimeDiagnostics([
		{
			kind: "voicePolicyDiagnostic",
			policyVersion: "private",
			policySha256: "private",
			renderedInstructionsSha256: "private",
			outcome: "private",
		},
		{ kind: "delegationFailure", key: "private", failureClass: "private", outcome: "private" },
	]);
	expect(rows).toEqual([{ kind: "voicePolicyDiagnostic" }, { kind: "delegationFailure" }]);
	expect(JSON.stringify(rows)).not.toContain("private");
});

test("audio diagnostics export numeric signal evidence without audio or arbitrary fields", () => {
	expect(
		exportRemoteRealtimeDiagnostics([
			{
				kind: "voiceAudioDiagnostic",
				frames: 2,
				samples: 960,
				signalFrames: 1,
				maxRms: 1000,
				peak: 1000,
				audio: "secret",
				transcript: "private",
			},
		]),
	).toEqual([{ kind: "voiceAudioDiagnostic", frames: 2, samples: 960, signalFrames: 1, maxRms: 1000, peak: 1000 }]);
});
