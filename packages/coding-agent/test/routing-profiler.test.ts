import { describe, expect, it } from "bun:test";
import { profileTaskDeterministic } from "../src/routing/profiler";
import { PROFILING_FIXTURES } from "./fixtures/profiling-fixtures";

describe("Deterministic Profiler (P02)", () => {
	for (const fixture of PROFILING_FIXTURES) {
		it(`should correctly profile fixture: ${fixture.id} (${fixture.description})`, () => {
			const profile = profileTaskDeterministic({
				prompt: fixture.prompt,
				contextEstimate: fixture.contextEstimate,
				hasImages: fixture.hasImages,
				priorRejection: fixture.priorRejection,
			});

			expect(profile.complexityScore).toBeGreaterThanOrEqual(fixture.expectedScoreMin);
			expect(profile.complexityScore).toBeLessThanOrEqual(fixture.expectedScoreMax);
			expect(profile.desiredTier).toBe(fixture.expectedTier);

			for (const reason of fixture.expectedReasons) {
				expect(profile.reasons).toContain(reason);
			}
		});
	}
});
