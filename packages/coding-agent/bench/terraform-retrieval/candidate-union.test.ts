import { expect, test } from "bun:test";
import { fuseCandidateRoutes } from "./candidate-union";

test("candidate union preserves independent global and provider evidence", () => {
	const rows = fuseCandidateRoutes(
		[
			["a", "b", "c"],
			["c", "d", "e"],
		],
		5,
	);
	expect(rows[0]?.uri).toBe("c");
	expect(rows.map(r => r.uri)).toContain("a");
	expect(rows.map(r => r.uri)).toContain("d");
});
test("alias duplicates never add ranking evidence and ties are deterministic", () => {
	expect(
		fuseCandidateRoutes(
			[
				["a", "a", "b"],
				["b", "a"],
			],
			5,
		),
	).toEqual(
		fuseCandidateRoutes(
			[
				["a", "b"],
				["b", "a"],
			],
			5,
		),
	);
	const first = fuseCandidateRoutes(
		[
			["b", "a"],
			["a", "b"],
		],
		5,
	);
	expect(first.map(r => r.uri)).toEqual(["a", "b"]);
	expect(first.every(r => r.score === Number(r.score.toFixed(12)))).toBe(true);
});
