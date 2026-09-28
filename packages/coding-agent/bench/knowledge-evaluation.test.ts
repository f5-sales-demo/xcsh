import { describe, expect, it } from "bun:test";
import path from "node:path";
import { classifyKnowledgeRequest, type KnowledgeClassifierResource } from "../src/internal-urls/knowledge-classifier";

interface FixtureRow {
	id: string;
	family: string;
	split: "tuning" | "sealed";
}

const fixture = (await Bun.file(path.join(import.meta.dir, "fixtures/knowledge-evaluation-v2.json")).json()) as {
	schemaVersion: number;
	seed: number;
	api: Array<FixtureRow & { query: string; expectedCategories: string[] }>;
	documentation: Array<FixtureRow & { query: string; source: "docs-cloud-f5-com" | "my-f5-com"; relevance: Record<string, number> }>;
	classifier: Array<
		FixtureRow & {
			prompt: string;
			expectedRoute: "api" | "documentation" | "none";
			source?: "docs-cloud-f5-com" | "my-f5-com";
			resource?: KnowledgeClassifierResource;
		}
	>;
};

function expectFamilyIsolation(rows: readonly FixtureRow[]): void {
	const splitByFamily = new Map<string, FixtureRow["split"]>();
	for (const row of rows) {
		const previous = splitByFamily.get(row.family);
		if (previous) expect(row.split).toBe(previous);
		else splitByFamily.set(row.family, row.split);
	}
}

describe("frozen hybrid knowledge evaluation", () => {
	it("meets minimum sizes with family-isolated tuning and sealed sets", () => {
		expect(fixture.schemaVersion).toBe(2);
		expect(fixture.seed).toBe(4496);
		expect(fixture.api.length).toBeGreaterThanOrEqual(240);
		expect(fixture.documentation.length).toBeGreaterThanOrEqual(160);
		expect(fixture.classifier.length).toBeGreaterThanOrEqual(300);
		expectFamilyIsolation(fixture.api);
		expectFamilyIsolation(fixture.documentation);
		expectFamilyIsolation(fixture.classifier);
		for (const row of fixture.documentation) {
			expect(Math.max(...Object.values(row.relevance))).toBe(3);
		}
	});

	it("meets the sealed deterministic classifier gate", () => {
		let truePositive = 0;
		let falsePositive = 0;
		let falseNegative = 0;
		let sealedNoMatchFalsePositive = 0;
		for (const row of fixture.classifier.filter(candidate => candidate.split === "sealed")) {
			const resources = row.resource ? [row.resource] : [];
			const actual = classifyKnowledgeRequest(row.prompt, {
				toolsEnabled: true,
				resources,
				documentationSource: row.source,
			});
			const expectedPositive = row.expectedRoute !== "none";
			const actualPositive = actual.route !== "none";
			if (expectedPositive && actual.route === row.expectedRoute) truePositive++;
			else if (expectedPositive) falseNegative++;
			else if (actualPositive) falsePositive++, sealedNoMatchFalsePositive++;
		}
		const precision = truePositive / Math.max(1, truePositive + falsePositive);
		const recall = truePositive / Math.max(1, truePositive + falseNegative);
		expect(precision).toBeGreaterThanOrEqual(0.99);
		expect(recall).toBeGreaterThanOrEqual(0.95);
		expect(sealedNoMatchFalsePositive).toBe(0);
	});
});
