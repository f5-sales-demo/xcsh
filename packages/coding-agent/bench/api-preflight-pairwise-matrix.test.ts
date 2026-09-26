import { describe, expect, it } from "bun:test";
import {
	API_PREFLIGHT_MATRIX_AXES,
	API_PREFLIGHT_MATRIX_SEED,
	generateApiPreflightPairwiseMatrix,
} from "./api-preflight-pairwise-matrix";

describe("API preflight pairwise prompt and trace matrix", () => {
	it("is fixed-seed deterministic and covers every pair of axis values", () => {
		const matrix = generateApiPreflightPairwiseMatrix();
		expect(matrix).toEqual(generateApiPreflightPairwiseMatrix(API_PREFLIGHT_MATRIX_SEED));
		expect(matrix).not.toEqual(generateApiPreflightPairwiseMatrix(API_PREFLIGHT_MATRIX_SEED + 1));
		const axes = Object.keys(API_PREFLIGHT_MATRIX_AXES) as Array<keyof typeof API_PREFLIGHT_MATRIX_AXES>;
		for (const [leftIndex, left] of axes.entries()) {
			for (const right of axes.slice(leftIndex + 1)) {
				for (const leftValue of API_PREFLIGHT_MATRIX_AXES[left]) {
					for (const rightValue of API_PREFLIGHT_MATRIX_AXES[right]) {
						expect(matrix.some(entry => entry[left] === leftValue && entry[right] === rightValue)).toBe(true);
					}
				}
			}
		}
	});

	it("records a prompt and expected trace for every selected combination", () => {
		for (const entry of generateApiPreflightPairwiseMatrix()) {
			expect(entry.prompt.length).toBeGreaterThan(20);
			expect(Array.isArray(entry.expectedTrace)).toBe(true);
			if (entry.control === "positive") expect(entry.expectedTrace.length).toBeGreaterThan(0);
			else expect(entry.expectedTrace).toEqual([]);
		}
	});
});
