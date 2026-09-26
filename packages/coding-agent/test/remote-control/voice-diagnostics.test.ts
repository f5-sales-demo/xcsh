import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeVoiceUat,
	CheckpointStore,
	canonicalWarningFingerprint,
	createVoiceScenario,
	exportRemoteRealtimeDiagnostics,
	VoiceDiagnosticRuntime,
	VoiceRunLedger,
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
		).resolves.toMatchObject({ failures: ["malformed-capture"] });
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
			resources: () => ({ rssBytes: 100, fileDescriptors: 4, sockets: 2, processState: "running" }),
		});
		runtime.transition("starting");
		for (let index = 0; index < 100; index++) runtime.event("response.audio.delta");
		runtime.event("unknown", "unknownType");
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
			delegation: { active: true, pending: 1, supersededExecutions: 0 },
			process: { pid: process.pid, state: "running" },
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
		await ledger.initialize("a".repeat(40), ["A01", "A02"]);
		await ledger.update("A01", { state: "running", evidenceHashes: [], findings: [], repairs: [], receipts: [] });
		await expect(ledger.update("A01", { state: "passed" })).rejects.toThrow("evidence");
		await ledger.update("A01", {
			state: "passed",
			humanOutcomes: { connection: true, caption: true, heardAudio: true },
			evidenceHashes: ["b".repeat(64)],
			findings: [],
			receipts: ["post-close-60s"],
		});
		const value = await ledger.read();
		expect(value).toMatchObject({ revision: 3, candidateSha: "a".repeat(40) });
		expect(value?.tasks.A01).toMatchObject({ state: "passed", attempts: 1 });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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
				{ atUnixMs: 1, phase: "preflight", rssBytes: 100 * mib, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 2, phase: "preflight", rssBytes: 100 * mib, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 3, phase: "preflight", rssBytes: 100 * mib, fileDescriptors: 2, sockets: 1 },
				{ atUnixMs: 4, phase: "post-close", rssBytes: 165 * mib, fileDescriptors: 3, sockets: 2 },
				{ atUnixMs: 5, phase: "post-close", rssBytes: 165 * mib, fileDescriptors: 3, sockets: 2 },
				{ atUnixMs: 6, phase: "post-close", rssBytes: 165 * mib, fileDescriptors: 3, sockets: 2 },
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
