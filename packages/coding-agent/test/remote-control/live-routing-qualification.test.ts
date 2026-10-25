import { expect, test } from "bun:test";
import {
	type LiveRoutingBaseline,
	liveRoutingBaselineFailures,
	liveRoutingCases,
} from "../../src/remote-control/live-routing-qualification";

const candidate = { commit: "a".repeat(40), sha256: "b".repeat(64) };
function baseline(): LiveRoutingBaseline {
	return {
		catalogFrozen: true,
		candidate: { ...candidate },
		phoneBuild: "synthetic-phone-build",
		policyTemplates: [{ path: "remote-voice-live.md", sha256: "c".repeat(64) }],
		renderedInstructionsSha256: "d".repeat(64),
		liveModel: { requested: "gpt-live-1-codex", observed: "gpt-live-1-codex", source: "session.updated" },
		execution: { model: "synthetic-model", provider: "synthetic-provider", reasoning: "high" },
		captureVersions: [{ name: "collector", sha256: "e".repeat(64) }],
		fixtures: [{ name: "synthetic-repository", sha256: "f".repeat(64) }],
		captures: [
			{
				sha256: "1".repeat(64),
				rows: [
					{ kind: "manifest", sourceCommit: candidate.commit, artifactSha256: candidate.sha256 },
					{ kind: "event", sequence: 1 },
					{ kind: "footer", complete: true, events: 1 },
				],
			},
		],
		observations: liveRoutingCases
			.filter(c => c.stage === 1)
			.map(c => ({
				caseId: c.id,
				candidate: { ...candidate },
				phoneBuild: "synthetic-phone-build",
				captureSha256: "1".repeat(64),
				humanObservationSha256: "2".repeat(64),
				backendEvidenceSha256: c.executionEvidence ? "3".repeat(64) : undefined,
				passed: true,
			})),
	};
}

test("baseline cannot advance without actual Live model, rendered hash, or independent phone evidence", () => {
	const input = baseline();
	input.renderedInstructionsSha256 = undefined;
	input.liveModel.observed = undefined;
	input.observations[0].humanObservationSha256 = undefined;
	expect(liveRoutingBaselineFailures(input)).toEqual(
		expect.arrayContaining([
			"rendered-instructions-hash-missing",
			"actual-live-model-missing",
			"pairing:human-observation-missing",
		]),
	);
});

test.each(["missing-footer", "collector-death", "sequence-gap"])(
	"%s invalidates evidence without requesting work replay",
	fault => {
		const input = baseline();
		const rows = input.captures[0].rows;
		if (fault === "missing-footer") rows.pop();
		if (fault === "collector-death") rows.at(-1)!.complete = false;
		if (fault === "sequence-gap") rows[1].sequence = 2;
		expect(liveRoutingBaselineFailures(input).some(f => f.startsWith("capture:"))).toBe(true);
		expect(input.observations.every(o => o.passed)).toBe(true);
	},
);

test("historical phone evidence and acknowledgment cannot qualify the current candidate", () => {
	const input = baseline();
	input.observations[0].candidate.commit = "9".repeat(40);
	input.observations.find(o => o.caseId === "baseline-repository-read")!.backendEvidenceSha256 = undefined;
	expect(liveRoutingBaselineFailures(input)).toEqual(
		expect.arrayContaining(["pairing:candidate-mismatch", "baseline-repository-read:execution-evidence-missing"]),
	);
});

test("draft or partial baseline never advances; all nine sequential stages have cases", () => {
	const input = baseline();
	input.catalogFrozen = false;
	input.observations.pop();
	expect(liveRoutingBaselineFailures(input)).toContain("case-catalog-unfrozen");
	expect(liveRoutingBaselineFailures(input).length).toBeGreaterThan(0);
	expect([...new Set(liveRoutingCases.map(c => c.stage))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	expect(liveRoutingCases.every(c => c.required)).toBe(true);
});

test("complete candidate-bound baseline has no missing gate evidence", () => {
	expect(liveRoutingBaselineFailures(baseline())).toEqual([]);
});
