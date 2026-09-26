import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type VoiceCandidate,
	VoiceUatController,
	type VoiceUatHost,
} from "../../src/remote-control/voice-uat-controller";

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
		journalAnchor: async () => "cursor",
		collectRow: async directory => {
			const evidence = join(directory, "capture.jsonl");
			await writeFile(
				evidence,
				`${JSON.stringify({ kind: "checkpoint" })}\n${JSON.stringify({ kind: "footer", complete: true, events: 0 })}\n`,
			);
			return { evidenceFiles: [evidence], findings: [], receipts: ["post-close-60s"] };
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
		expect(slept).toBe(60_000);
		expect(fake.calls).toEqual(["install", "restart", "environment:64:false", "restart", "clear"]);
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
		expect(fake.calls).toEqual(["install", "restart", "restore", "restart"]);
	} finally {
		await rm(root, { recursive: true, force: true });
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
