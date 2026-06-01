import { describe, expect, it } from "bun:test";
import type { ProfileCollector } from "../../src/internal-urls/profile-collectors";
import { PROFILE_COLLECTORS } from "../../src/internal-urls/profile-collectors";

describe("PROFILE_COLLECTORS registry", () => {
	it("exports a non-empty readonly array", () => {
		expect(Array.isArray(PROFILE_COLLECTORS)).toBe(true);
		expect(PROFILE_COLLECTORS.length).toBeGreaterThanOrEqual(1);
	});

	it("each collector has required interface fields", () => {
		for (const collector of PROFILE_COLLECTORS) {
			expect(typeof collector.id).toBe("string");
			expect(collector.id.length).toBeGreaterThan(0);
			expect(typeof collector.name).toBe("string");
			expect(collector.name.length).toBeGreaterThan(0);
			expect(typeof collector.available).toBe("function");
			expect(typeof collector.collect).toBe("function");
		}
	});

	it("collector ids are unique", () => {
		const ids = PROFILE_COLLECTORS.map((c: ProfileCollector) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("collector ids match expected set", () => {
		const ids = PROFILE_COLLECTORS.map((c: ProfileCollector) => c.id);
		expect(ids).toContain("system");
	});
});

describe("ProfileCollector interface contract", () => {
	it("available() returns a boolean for each collector", async () => {
		const results = await Promise.all(
			PROFILE_COLLECTORS.map(async (c: ProfileCollector) => {
				const result = await c.available();
				return { id: c.id, result };
			}),
		);
		for (const { result } of results) {
			expect(typeof result).toBe("boolean");
		}
	}, 30_000);

	it("collect() returns an object for available collectors", async () => {
		const availability = await Promise.all(
			PROFILE_COLLECTORS.map(async (c: ProfileCollector) => ({
				collector: c,
				available: await c.available(),
			})),
		);
		const collectResults = await Promise.all(
			availability
				.filter(a => a.available)
				.map(async a => {
					const result = await a.collector.collect();
					return { id: a.collector.id, result };
				}),
		);
		for (const { result } of collectResults) {
			expect(result).toBeDefined();
			expect(typeof result).toBe("object");
			expect(result).not.toBeNull();
		}
	}, 30_000);
});
