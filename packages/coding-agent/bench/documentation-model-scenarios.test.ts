import { describe, expect, it } from "bun:test";
import { selectModelBenchmarkScenarios } from "./model-scenario-library";

describe("offline documentation model scenarios", () => {
	it("covers exact evidence, missing content, tools-disabled sessions, and multi-turn follow-ups", () => {
		const scenarios = selectModelBenchmarkScenarios({ suite: "documentation" });
		expect(scenarios.map(scenario => scenario.id)).toEqual([
			"documentation-answer-waf",
			"documentation-answer-missing",
			"documentation-tools-disabled",
			"documentation-multi-turn-dns",
		]);
		const exact = scenarios[0]!;
		expect(exact.contract.requiredToolSequence?.map(call => call.name)).toEqual(["read", "read"]);
		expect(exact.contract.requiredKnowledgeSequence?.map(event => event.type)).toEqual(["read", "read"]);
		expect(scenarios[2]!.runtime.tools).toBe("none");
		expect(scenarios[3]!.turns).toHaveLength(2);
		expect(scenarios[3]!.turns?.[1]?.contract.requiredTools?.[0]?.arguments?.path).toBe(
			"xcsh://documentation/docs-cloud-f5-com/dns-management/how-to/configure-dns-load-balancer/index.md",
		);
	});
});
