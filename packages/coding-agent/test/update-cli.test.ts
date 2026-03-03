import { describe, expect, it } from "bun:test";
import { _resolveUpdateMethodForTest } from "../src/cli/update-cli";

describe("update-cli install target detection", () => {
	it("uses bun update when prioritized omp is inside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/user/.bun/bin/omp", "/Users/user/.bun/bin");

		expect(method).toBe("bun");
	});

	it("uses binary update when prioritized omp is outside bun global bin", () => {
		const method = _resolveUpdateMethodForTest("/Users/user/.local/bin/omp", "/Users/user/.bun/bin");

		expect(method).toBe("binary");
	});

	it("uses binary update when bun global bin cannot be resolved", () => {
		const method = _resolveUpdateMethodForTest("/Users/user/.local/bin/omp", undefined);

		expect(method).toBe("binary");
	});
});
