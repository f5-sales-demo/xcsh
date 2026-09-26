import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	analyzeVoiceUat,
	CheckpointStore,
	createVoiceScenario,
	exportRemoteRealtimeDiagnostics,
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
