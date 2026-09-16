import { expect, test } from "bun:test";
import { scoreContextFlow } from "../../src/remote-control/context-evaluation";

const selection = { kind: "selection" as const, context: "beta", outcome: "connected" as const };
const query = { kind: "query" as const, context: "beta", credentialMatches: true };

test("successful combined and follow-up requests require selection before querying", () => {
	expect(scoreContextFlow([selection, query], "beta", "query").passed).toBe(true);
	expect(scoreContextFlow([query, selection], "beta", "query")).toMatchObject({ passed: false, prematureQueries: 1 });
	expect(scoreContextFlow([query], "beta", "query").passed).toBe(false);
});

test("a plausible answer cannot compensate for querying the wrong tenant or credential", () => {
	expect(scoreContextFlow([selection, { ...query, context: "alpha" }], "beta", "query")).toMatchObject({
		passed: false,
		wrongTargetQueries: 1,
	});
	expect(scoreContextFlow([selection, { ...query, credentialMatches: false }], "beta", "query").passed).toBe(false);
});

test("missing context requires a stopped selection and never substitutes a remembered tenant", () => {
	expect(
		scoreContextFlow([{ kind: "selection", context: "absent", outcome: "failed" }], "absent", "blocked").passed,
	).toBe(true);
	expect(scoreContextFlow([selection, query], "absent", "blocked")).toMatchObject({
		passed: false,
		substitutedSelections: 1,
	});
});

test("authentication failure is a valid blocker only when no query follows", () => {
	const failure = { ...selection, outcome: "auth_error" as const };
	expect(scoreContextFlow([failure], "beta", "blocked").passed).toBe(true);
	expect(scoreContextFlow([failure, query], "beta", "blocked")).toMatchObject({ passed: false, prematureQueries: 1 });
});

test("a missing identity can require clarification after successful context selection", () => {
	expect(scoreContextFlow([selection], "beta", "clarification").passed).toBe(true);
	expect(scoreContextFlow([], "beta", "clarification").passed).toBe(false);
});
