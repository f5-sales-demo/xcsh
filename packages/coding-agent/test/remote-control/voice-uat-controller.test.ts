import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	activeVoiceCallFromStatus,
	evaluateRowWatchdog,
	latestVoiceResourcePhase,
	type VoiceCandidate,
	VoiceUatController,
	type VoiceUatHost,
	voiceCandidateArtifactPath,
	voiceRowRequirements,
} from "../../src/remote-control/voice-uat-controller";

test("replacement candidates use immutable commit-scoped artifact paths", () => {
	const commit = "a".repeat(40);
	expect(voiceCandidateArtifactPath("/voice-uat", commit)).toBe(`/voice-uat/candidates/${commit}/xcsh-linux-x64`);
	expect(() => voiceCandidateArtifactPath("/voice-uat", "../candidate")).toThrow("commit");
});

test("active voice readiness ignores idle remote threads and preserves legacy fallback", () => {
	expect(activeVoiceCallFromStatus({ liveSessions: 1, activeVoiceSessions: 0 })).toBe(false);
	expect(activeVoiceCallFromStatus({ liveSessions: 1, activeVoiceSessions: 1 })).toBe(true);
	expect(activeVoiceCallFromStatus({ liveSessions: 1 })).toBe(true);
	expect(activeVoiceCallFromStatus({ liveSessions: 0 })).toBe(false);
});

test("resource phase follows the newest checkpoint regardless of directory order", () => {
	const checkpoints = [
		{ writtenAtUnixMs: 30, lifecycle: "connected" },
		{ writtenAtUnixMs: 10, lifecycle: "closed" },
	] as const;
	expect(latestVoiceResourcePhase(checkpoints)).toBe("active");
	expect(latestVoiceResourcePhase([...checkpoints].reverse())).toBe("active");
});

function host(overrides: Partial<VoiceUatHost> = {}) {
	const calls: string[] = [];
	const implementation: VoiceUatHost = {
		activeVoiceCall: async () => false,
		verifyCandidateArtifact: async () => true,
		captureBaseline: async () => ({ unit: "unit", dropIns: { "old.conf": "old" }, hashes: { unit: "a" } }),
		installCandidate: async () => {
			calls.push("install");
		},
		setCaptureEnvironment: async (_directory, _scenario, salt, expectedReconnect) => {
			calls.push(`environment:${salt.length}:${expectedReconnect}`);
		},
		startResourceSampling: async () => {
			calls.push("sample");
		},
		stopResourceSampling: async () => {
			calls.push("stop-sample");
		},
		inspectRowActivity: async () => ({}),
		clearCaptureEnvironment: async () => {
			calls.push("clear");
		},
		restart: async () => {
			calls.push("restart");
		},
		verifyCandidate: async () => true,
		restore: async () => {
			calls.push("restore");
		},
		verifyBaseline: async () => {
			calls.push("verify-baseline");
			return true;
		},
		journalAnchor: async () => "cursor",
		collectRow: async directory => {
			const evidence = join(directory, "capture.jsonl");
			await writeFile(
				evidence,
				`${[
					{ kind: "manifest", sourceCommit: "a".repeat(40), artifactSha256: "b".repeat(64) },
					{ kind: "event", sequence: 1, elapsedMs: 0, message: { type: "session.started" } },
					{ kind: "event", sequence: 2, elapsedMs: 1, message: { type: "session.close" } },
					{ kind: "event", sequence: 3, elapsedMs: 2, message: { type: "closed" } },
					{ kind: "checkpoint" },
					{ kind: "footer", complete: true, events: 3 },
				]
					.map(row => JSON.stringify(row))
					.join("\n")}\n`,
			);
			const protocol = join(directory, "protocol.jsonl");
			await writeFile(
				protocol,
				[
					{ kind: "manifest", sourceCommit: "a".repeat(40), artifactSha256: "b".repeat(64) },
					{
						kind: "event",
						sequence: 1,
						message: { method: "turn/completed", params: { threadId: "fixture-thread" } },
					},
					{
						kind: "event",
						sequence: 2,
						message: { method: "thread/realtime/closed", params: { threadId: "fixture-thread" } },
					},
				]
					.map(row => JSON.stringify(row))
					.join("\n"),
			);
			return {
				evidenceFiles: [evidence, protocol],
				findings: [],
				receipts: ["preflight-3x10s", "post-close-60s", "replay-before-close"],
				analysis: {
					captureFiles: [evidence],
					protocolFiles: [protocol],
					journal: [],
					resources: [
						{ atUnixMs: 0, phase: "preflight", rssBytes: 10, fileDescriptors: 2, sockets: 1 },
						{ atUnixMs: 10_000, phase: "preflight", rssBytes: 10, fileDescriptors: 2, sockets: 1 },
						{ atUnixMs: 20_000, phase: "preflight", rssBytes: 10, fileDescriptors: 2, sockets: 1 },
						{ atUnixMs: 30_000, phase: "post-close", rssBytes: 10, fileDescriptors: 2, sockets: 1 },
						{ atUnixMs: 40_000, phase: "post-close", rssBytes: 10, fileDescriptors: 2, sockets: 1 },
						{ atUnixMs: 50_000, phase: "post-close", rssBytes: 10, fileDescriptors: 2, sockets: 1 },
					],
					allowlist: [],
				},
			};
		},
		...overrides,
	};
	return { implementation, calls };
}

const candidate: VoiceCandidate = {
	commit: "a".repeat(40),
	version: "v21.46.9",
	sha256: "b".repeat(64),
	executable: "/candidate/xcsh-linux-x64",
};

test("row requirements encode disruption, delegation, and soak correlations", () => {
	expect(voiceRowRequirements("B04")).toMatchObject({
		minimumEventCounts: { "session.started": 1, "delegation.created": 1, "delegation.context.appended": 1 },
	});
	expect(voiceRowRequirements("C03")).toMatchObject({ minimumReconnects: 1 });
	expect(voiceRowRequirements("C05")).toMatchObject({
		minimumEventCounts: { error: 1 },
		expectedRuntimeFailure: true,
	});
	expect(voiceRowRequirements("C07")).toMatchObject({ expectedProcessExits: 1 });
	expect(voiceRowRequirements("D01")).toMatchObject({ minimumEventCounts: { "turn.done": 20 } });
	expect(voiceRowRequirements("D02")).toMatchObject({ minimumDurationMs: 55 * 60_000 });
	expect(voiceRowRequirements("D03")).toMatchObject({ minimumCaptures: 2, minimumDurationMs: 60 * 60_000 });
});

test("controller rejects candidate metadata that does not match the immutable artifact", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		const fake = host({ verifyCandidateArtifact: async () => false });
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await expect(controller.prepare(candidate, ["A01"])).rejects.toThrow("provenance");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("finish-row invokes integrated analysis and cannot pass incomplete capture", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		const fake = host({
			collectRow: async directory => {
				const evidence = join(directory, "capture.jsonl");
				await writeFile(evidence, `${JSON.stringify({ kind: "event" })}\n`);
				return {
					evidenceFiles: [evidence],
					findings: [],
					receipts: [],
					analysis: { captureFiles: [evidence], journal: [], resources: [], allowlist: [] },
				};
			},
		});
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		await controller.startRow("A01", false);
		const result = await controller.finishRow("A01", { connection: true, caption: true, heardAudio: true });
		expect(result.analysisResult!.failures).toContain("incomplete-capture");
		expect((await controller.status()).ledger.tasks.A01.state).toBe("blocked");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("analyze-row collects the same structured evidence as finish-row", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-analyze-"));
	try {
		const fake = host();
		const collect = fake.implementation.collectRow;
		let collections = 0;
		fake.implementation.collectRow = async (directory, anchor) => {
			collections++;
			const value = await collect(directory, anchor);
			return {
				...value,
				analysis: {
					...value.analysis,
					journal: [{ atUnixMs: 1, message: "fixture warning", fingerprint: "fixture-warning" }],
					processExits: [{ exitStatus: 143, signal: "TERM", expected: false }],
				},
			};
		};
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		await controller.startRow("A01", false);
		await controller.finishRow("A01");
		const result = await controller.analyzeRow("A01");
		expect(collections).toBe(2);
		expect(result.analysisResult?.failures).toEqual(
			expect.arrayContaining(["unclassified-warning:fixture-warning", "unexpected-process-exit"]),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("stale-row recovery preserves evidence as an invalidated attempt without restarting", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		const fake = host();
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		await controller.startRow("A01", false);
		await controller.recoverRow("A01", "A01-ANALYSIS-NOT-INTEGRATED", "invalidated");
		const status = await controller.status();
		expect(status.state.activeRow).toBeUndefined();
		expect(status.ledger.schemaVersion).toBe(3);
		expect(status.ledger.tasks.A01.state).toBe("invalidated");
		expect(status.ledger.tasks.A01.attempts).toHaveLength(1);
		expect(status.ledger.tasks.A01.attempts[0]).toMatchObject({
			candidateCommit: candidate.commit,
			binarySha256: candidate.sha256,
			state: "invalidated",
			findings: expect.arrayContaining(["A01-ANALYSIS-NOT-INTEGRATED"]),
		});
		expect(fake.calls.filter(call => call === "restart")).toHaveLength(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("recovery refuses to touch a row while its voice call remains active", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		let active = false;
		const fake = host({ activeVoiceCall: async () => active });
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		await controller.startRow("A01", false);
		active = true;
		await expect(controller.recoverRow("A01", "interrupted", "interrupted")).rejects.toThrow("active voice call");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("row watchdogs begin at call activity and enforce ordinary and soak ceilings", () => {
	expect(evaluateRowWatchdog("A01", { now: 1_000_000, callActivityAtUnixMs: undefined })).toEqual({
		state: "waiting-for-call",
	});
	expect(evaluateRowWatchdog("A01", { now: 121_001, callActivityAtUnixMs: 1_000 })).toMatchObject({
		state: "failed",
		finding: "session-ready-timeout",
	});
	expect(
		evaluateRowWatchdog("D02", { now: 56 * 60_000, callActivityAtUnixMs: 0, sessionReadyAtUnixMs: 1 }),
	).toMatchObject({ state: "close-call" });
	expect(
		evaluateRowWatchdog("D03", { now: 61 * 60_000, callActivityAtUnixMs: 0, sessionReadyAtUnixMs: 1 }),
	).toMatchObject({ state: "running" });
	expect(
		evaluateRowWatchdog("D03", { now: 61.5 * 60_000 + 1, callActivityAtUnixMs: 0, sessionReadyAtUnixMs: 1 }),
	).toMatchObject({ state: "failed", finding: "row-timeout" });
	expect(
		evaluateRowWatchdog("A01", {
			now: 10_000,
			callActivityAtUnixMs: 1,
			sessionReadyAtUnixMs: 2,
			closedAtUnixMs: 9_000,
		}),
	).toEqual({ state: "closed" });
});

test("live watchdog reports the D02 close window and blocks timed-out rows", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-watchdog-"));
	try {
		let now = 0;
		const fake = host({
			inspectRowActivity: async () => ({ callActivityAtUnixMs: 1, sessionReadyAtUnixMs: 2 }),
		});
		const controller = new VoiceUatController(root, fake.implementation, async milliseconds => {
			now += milliseconds;
		});
		await controller.prepare(candidate, ["D02"]);
		await controller.deploy();
		await controller.startRow("D02", false);
		now = 55 * 60_000 + 1;
		expect(await controller.watchRow("D02", () => now, 1_000)).toEqual({ state: "close-call" });
		await controller.recoverRow("D02", "fixture-reset", "invalidated");

		const timeoutRoot = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-watchdog-timeout-"));
		try {
			const timed = host({ inspectRowActivity: async () => ({ callActivityAtUnixMs: 1 }) });
			const timeoutController = new VoiceUatController(timeoutRoot, timed.implementation, async () => {});
			await timeoutController.prepare(candidate, ["A01"]);
			await timeoutController.deploy();
			await timeoutController.startRow("A01", false);
			expect(await timeoutController.watchRow("A01", () => 121_002, 1_000)).toMatchObject({
				state: "failed",
				finding: "session-ready-timeout",
			});
			expect((await timeoutController.status()).ledger.tasks.A01.state).toBe("blocked");
		} finally {
			await rm(timeoutRoot, { recursive: true, force: true });
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("controller prepares private state and never persists the row salt", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		const fake = host();
		let slept = 0;
		const controller = new VoiceUatController(root, fake.implementation, async milliseconds => {
			slept += milliseconds;
		});
		await controller.prepare(candidate, ["A01"]);
		expect((await stat(root)).mode & 0o777).toBe(0o700);
		await controller.deploy();
		await controller.startRow("A01", false);
		const serialized = await readFile(join(root, "controller.json"), "utf8");
		expect(serialized).not.toMatch(/[a-f0-9]{64}.*correlation/i);
		await controller.finishRow("A01", { connection: true, caption: true, heardAudio: true });
		expect(slept).toBe(80_000);
		expect(fake.calls).toEqual(["install", "restart", "environment:64:false", "restart", "sample", "clear"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("human outcomes can be imported after automated evidence collection", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-outcomes-"));
	try {
		const fake = host();
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		await controller.startRow("A01", false);
		await controller.finishRow("A01");
		expect((await controller.status()).ledger.tasks.A01.state).toBe("blocked");
		await controller.importHumanOutcomes(
			"A01",
			{ connection: true, caption: true, heardAudio: true },
			{
				durableUserSegments: 1,
				durableAssistantSegments: 1,
				schemaVersion: 1,
				visibility: "live-visible",
				transcriptComplete: true,
			},
		);
		const attempt = (await controller.status()).ledger.tasks.A01.attempts.at(-1)!;
		expect(attempt.state).toBe("passed");
		expect(attempt.transcriptEvidence).toMatchObject({ visibility: "live-visible", transcriptComplete: true });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("controller preserves reopen-only transcript evidence as a blocking finding", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-transcript-"));
	try {
		const fake = host();
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		await controller.startRow("A01", false);
		await controller.finishRow(
			"A01",
			{ connection: true, caption: false, heardAudio: true },
			{
				durableUserSegments: 3,
				durableAssistantSegments: 3,
				schemaVersion: 1,
				visibility: "reopen-only",
				transcriptComplete: true,
			},
		);
		const attempt = (await controller.status()).ledger.tasks.A01.attempts.at(-1)!;
		expect(attempt.state).toBe("blocked");
		expect(attempt.findings).toEqual(
			expect.arrayContaining(["human-outcome:caption", "transcript-visible-only-after-reopen"]),
		);
		expect(attempt.transcriptEvidence).toEqual({
			durableUserSegments: 3,
			durableAssistantSegments: 3,
			schemaVersion: 1,
			visibility: "reopen-only",
			transcriptComplete: true,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("final evidence is generated only from a completed ledger and contains no private paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-finalize-"));
	try {
		const fake = host();
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await expect(controller.finalize()).rejects.toThrow("not passed");
		await controller.deploy();
		await controller.startRow("A01", false);
		await controller.finishRow(
			"A01",
			{ connection: true, caption: true, heardAudio: true },
			{
				schemaVersion: 1,
				visibility: "live-visible",
				durableUserSegments: 3,
				durableAssistantSegments: 3,
				transcriptComplete: true,
			},
		);
		const receipt = await controller.finalize();
		expect(receipt).toMatchObject({
			file: "sanitized-evidence.json",
			sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		const published = await readFile(join(root, receipt.file), "utf8");
		expect(JSON.parse(published)).toMatchObject({
			schemaVersion: 3,
			candidate: { commit: candidate.commit, sha256: candidate.sha256 },
			tasks: { A01: { state: "passed" } },
		});
		expect(published).not.toMatch(
			/capture\.jsonl|correlation|salt|transcriptText|audioData|pairing|credential|SDP|\/tmp\//i,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("published artifact verification persists a content-addressed provenance receipt", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-published-"));
	try {
		const fake = host();
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		const published = { ...candidate, releaseTag: "v21.46.9", channel: "stable" };
		await controller.prepare(published, ["A01"]);
		const receipt = await controller.verifyPublishedArtifact(published);
		const receiptSha256 = receipt.receiptSha256;
		expect(receipt).toMatchObject({
			verified: true,
			commit: published.commit,
			version: published.version,
			sha256: published.sha256,
			releaseTag: published.releaseTag,
			channel: "stable",
			receiptFile: "published-artifact-receipt.json",
		});
		expect(receiptSha256).toMatch(/^[a-f0-9]{64}$/);
		const saved = await readFile(join(root, receipt.receiptFile), "utf8");
		expect(createHash("sha256").update(saved).digest("hex")).toBe(receiptSha256);
		expect(JSON.parse(saved)).toMatchObject({
			commit: published.commit,
			version: published.version,
			artifactSha256: published.sha256,
			releaseTag: published.releaseTag,
			channel: "stable",
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("controller automatically restores the exact baseline after failed deployment health", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		const fake = host({ verifyCandidate: async () => false });
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await expect(controller.deploy()).rejects.toThrow("verification");
		expect(fake.calls).toEqual(["install", "restart", "restore", "restart", "verify-baseline"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("deployment failures at install, restart, provenance, and health all restore and verify the baseline", async () => {
	for (const failure of ["install", "restart", "verify"] as const) {
		const root = await mkdtemp(join(tmpdir(), `xcsh-voice-controller-${failure}-`));
		try {
			let restarts = 0;
			const fake = host({
				installCandidate: async () => {
					fake.calls.push("install");
					if (failure === "install") throw new Error("install failed");
				},
				restart: async () => {
					fake.calls.push("restart");
					restarts++;
					if (failure === "restart" && restarts === 1) throw new Error("restart failed");
				},
				verifyCandidate: async () => failure !== "verify",
			});
			const controller = new VoiceUatController(root, fake.implementation, async () => {});
			await controller.prepare(candidate, ["A01"]);
			await expect(controller.deploy()).rejects.toThrow();
			expect(fake.calls).toContain("restore");
			expect(fake.calls.at(-1)).toBe("verify-baseline");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test("controller waits through transient startup health before accepting a candidate", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-voice-controller-"));
	try {
		let attempts = 0;
		const fake = host({ verifyCandidate: async () => ++attempts >= 3 });
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await controller.deploy();
		expect(attempts).toBe(3);
		expect(fake.calls).toEqual(["install", "restart"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

const selectableTranscript = {
	schemaVersion: 1 as const,
	visibility: "session-list-selectable" as const,
	durableUserSegments: 3,
	durableAssistantSegments: 3,
	transcriptComplete: true,
};
const passedHuman = { connection: true, caption: true, heardAudio: true };

test("explicit policy binds new attempts and permits list selection after local receipts", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-policy-"));
	try {
		const fake = host();
		const controller = new VoiceUatController(root, fake.implementation, async () => {});
		await controller.prepare(candidate, ["A01", "A02"], "session-list-selectable-v1");
		await controller.deploy();
		await controller.startRow("A01", false);
		await controller.finishRow("A01");
		await expect(controller.startRow("A02", false)).rejects.toThrow("A01 must pass");
		await controller.importHumanOutcomes("A01", passedHuman, selectableTranscript);
		const status = await controller.status();
		expect(status.state).toMatchObject({ schemaVersion: 3, acceptancePolicy: "session-list-selectable-v1" });
		expect(status.ledger.tasks.A01.attempts.at(-1)).toMatchObject({
			state: "passed",
			acceptancePolicy: "session-list-selectable-v1",
		});
		await controller.startRow("A02", false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("human import preserves automated defects and blocks missing transcript and receipts", async () => {
	for (const defect of ["warning", "receipt", "transcript"] as const) {
		const root = await mkdtemp(join(tmpdir(), "xcsh-policy-defect-"));
		try {
			const fake = host();
			const collect = fake.implementation.collectRow;
			fake.implementation.collectRow = async (directory, anchor) => {
				const result = await collect(directory, anchor);
				return {
					...result,
					findings: defect === "warning" ? ["automated-defect"] : [],
					receipts: defect === "receipt" ? [] : result.receipts,
				};
			};
			const controller = new VoiceUatController(root, fake.implementation, async () => {});
			await controller.prepare(candidate, ["A01"], "session-list-selectable-v1");
			await controller.deploy();
			await controller.startRow("A01", false);
			await controller.finishRow("A01");
			await controller.importHumanOutcomes(
				"A01",
				passedHuman,
				defect === "transcript" ? undefined : selectableTranscript,
			);
			expect((await controller.status()).ledger.tasks.A01.state).toBe("blocked");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test("policy mismatches reject changes and historical read preserves the original ledger", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-policy-history-"));
	try {
		const controller = new VoiceUatController(root, host().implementation, async () => {});
		await controller.prepare(candidate, ["A01"]);
		await expect(controller.prepare(candidate, ["A01"], "session-list-selectable-v1")).rejects.toThrow("policy");
		const file = join(root, "ledger.json");
		const value = JSON.parse(await readFile(file, "utf8"));
		value.schemaVersion = 2;
		delete value.acceptancePolicy;
		await writeFile(file, JSON.stringify(value));
		const before = await readFile(file, "utf8");
		const stateFile = join(root, "controller.json");
		const state = JSON.parse(await readFile(stateFile, "utf8"));
		state.schemaVersion = 2;
		delete state.acceptancePolicy;
		await writeFile(stateFile, JSON.stringify(state));
		expect((await controller.status()).ledger.schemaVersion).toBe(2);
		expect(await readFile(file, "utf8")).toBe(before);
		await expect(controller.prepare(candidate, ["A01"], "session-list-selectable-v1")).rejects.toThrow("policy");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("finalization exports only transcript metadata and revalidates tampered acceptance", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-policy-export-"));
	try {
		const controller = new VoiceUatController(root, host().implementation, async () => {});
		await controller.prepare(candidate, ["A01"], "session-list-selectable-v1");
		await controller.deploy();
		await controller.startRow("A01", false);
		const extra = {
			...selectableTranscript,
			transcriptText: "private-content",
			audioData: "private-content",
			pairing: "private-content",
			credentials: "private-content",
			salt: "private-content",
			sdp: "private-content",
			captures: "private-content",
		};
		await controller.finishRow("A01", passedHuman, extra);
		const result = await controller.finalize();
		const text = await readFile(join(root, result.file), "utf8");
		expect(text).not.toContain("private-content");
		expect(JSON.parse(text)).toMatchObject({
			schemaVersion: 3,
			acceptancePolicy: "session-list-selectable-v1",
			tasks: {
				A01: {
					attempts: [
						{
							transcriptEvidence: selectableTranscript,
							transcriptOutcome: "session-list-selectable",
							receipts: expect.arrayContaining(["replay-before-close"]),
						},
					],
				},
			},
		});
		const file = join(root, "ledger.json");
		const value = JSON.parse(await readFile(file, "utf8"));
		value.tasks.A01.attempts[0].transcriptEvidence.transcriptComplete = false;
		await writeFile(file, JSON.stringify(value));
		await expect(controller.finalize()).rejects.toThrow("not passed");
		value.tasks.A01.attempts[0].acceptancePolicy = "strict";
		await writeFile(file, JSON.stringify(value));
		await expect(controller.status()).rejects.toThrow("policy mismatch");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
