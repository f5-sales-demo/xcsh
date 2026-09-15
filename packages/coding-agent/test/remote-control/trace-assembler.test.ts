import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleProtocolTraces, verifyTraceArtifactProvenance } from "../../src/remote-control/trace-assembler";

const commit = "a".repeat(40);
const artifactSha256 = "b".repeat(64);
function capture(role: string, startedAtUnixMs: number, elapsed: number[]) {
	return {
		role,
		rows: [
			{
				kind: "manifest",
				schemaVersion: 1,
				source: "xcsh",
				version: "fixture",
				sourceCommit: commit,
				artifactSha256,
				scenario: "voice-first",
				startedAtUnixMs,
			},
			...elapsed.map((elapsedMs, index) => ({
				kind: "event",
				sequence: index + 1,
				elapsedMs,
				layer: "rpc",
				direction: index % 2 ? "out" : "in",
				message:
					index % 2
						? { id: { $ref: "request" }, result: {} }
						: { id: { $ref: "request" }, method: "thread/start" },
			})),
			{ kind: "footer", complete: true, events: elapsed.length },
		],
	};
}

test("assembler validates and deterministically orders synchronized producer clocks", () => {
	const inputs = [capture("host", 1_000, [20, 40]), capture("voice", 1_010, [5, 50])];
	const first = assembleProtocolTraces(inputs);
	const second = assembleProtocolTraces(inputs);
	expect(second).toEqual(first);
	expect(first.events.map(event => [event.producer, event.sourceSequence])).toEqual([
		["voice", 1],
		["host", 1],
		["host", 2],
		["voice", 2],
	]);
	expect(first.footer).toEqual({ complete: true, events: 4 });
	expect(first.transportSummary.rpcMethods).toEqual({ "thread/start": 2 });
});

test("assembler rejects incomplete, discontinuous, and provenance-mismatched captures", () => {
	const incomplete = capture("host", 1_000, [1]);
	(incomplete.rows.at(-1) as any).complete = false;
	expect(() => assembleProtocolTraces([incomplete])).toThrow("incomplete");
	const gap = capture("host", 1_000, [1]);
	(gap.rows[1] as any).sequence = 2;
	expect(() => assembleProtocolTraces([gap])).toThrow("event sequence");
	const mismatch = capture("voice", 1_000, [1]);
	(mismatch.rows[0] as any).sourceCommit = "c".repeat(40);
	expect(() => assembleProtocolTraces([capture("host", 1_000, [1]), mismatch])).toThrow("provenance differs");
});

test("assembler accepts a missing trace hash only with matching verified artifact provenance", () => {
	const legacy = capture("host", 1_000, [1]);
	delete (legacy.rows[0] as any).artifactSha256;
	expect(() => assembleProtocolTraces([legacy])).toThrow("invalid provenance");
	const verifiedArtifact = { sourceCommit: commit, artifactSha256 };
	expect(assembleProtocolTraces([{ ...legacy, verifiedArtifact }]).manifest.artifactSha256).toBe(artifactSha256);
	expect(() =>
		assembleProtocolTraces([{ ...legacy, verifiedArtifact: { ...verifiedArtifact, sourceCommit: "c".repeat(40) } }]),
	).toThrow("external provenance differs");
});

test("artifact verifier derives the hash and requires the embedded full commit", async () => {
	const root = await mkdtemp(join(tmpdir(), "xcsh-trace-artifact-"));
	try {
		const artifact = join(root, "xcsh");
		const bytes = Buffer.from(`prefix-${commit}-suffix`);
		await writeFile(artifact, bytes);
		expect(await verifyTraceArtifactProvenance(artifact, commit)).toEqual({
			sourceCommit: commit,
			artifactSha256: createHash("sha256").update(bytes).digest("hex"),
		});
		await expect(verifyTraceArtifactProvenance(artifact, "c".repeat(40))).rejects.toThrow("does not contain");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
