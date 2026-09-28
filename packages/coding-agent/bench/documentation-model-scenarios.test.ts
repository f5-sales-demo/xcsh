import { describe, expect, it } from "bun:test";
import { selectModelBenchmarkScenarios } from "./model-scenario-library";

describe("offline documentation model scenarios", () => {
	it("covers exact evidence, missing content, tools-disabled sessions, and multi-turn follow-ups", () => {
		const scenarios = selectModelBenchmarkScenarios({ suite: "documentation" });
			expect(scenarios.map(scenario => scenario.id)).toEqual([
			"documentation-answer-waf",
			"documentation-answer-client-side-defense",
			"documentation-answer-missing",
			"documentation-tools-disabled",
			"documentation-multi-turn-dns",
			"documentation-media-csd",
		]);
		const exact = scenarios[0]!;
		expect(exact.contract.requiredToolSequence?.map(call => call.name)).toEqual(["read", "read"]);
		expect(exact.contract.requiredKnowledgeSequence?.map(event => event.type)).toEqual(["read", "read"]);
		const marketing = scenarios[1]!;
		expect(marketing.contract.requiredToolSequence?.map(call => call.arguments?.path)).toEqual([
			"xcsh://documentation/?search=what%20is%20client%20side%20defense&source=www-f5-com&limit=1",
			"xcsh://documentation/www-f5-com/products/distributed-cloud-services/client-side-defense/index.md",
		]);
		expect(scenarios[3]!.runtime.tools).toBe("none");
		expect(scenarios[4]!.turns).toHaveLength(2);
		expect(scenarios[4]!.turns?.[1]?.contract.requiredTools?.[0]?.arguments?.path).toBe(
			"xcsh://documentation/docs-cloud-f5-com/dns-management/how-to/configure-dns-load-balancer/index.md",
		);
		const media = scenarios[5]!;
		expect(media.turns).toHaveLength(2);
		expect(media.runtime.tools).toEqual(["read", "display_media", "inspect_image"]);
		expect(media.turns?.[0]?.contract.requiredTools?.map(call => call.name)).toEqual(["read", "read"]);
		expect(media.turns?.[1]?.contract.requiredTools).toHaveLength(6);
		expect(media.turns?.[1]?.contract.requiredToolSequence?.map(call => call.arguments?.path)).toEqual([
			"xcsh://documentation/docs-cloud-f5-com/client-side-defense/how-tos/configure-csd/assets/9f920f51152fbc0aa0e3aef7c64730ba1948f40ee21921ea2cd3bf3bb1656ba7.png",
			"xcsh://documentation/docs-cloud-f5-com/client-side-defense/how-tos/configure-csd/assets/7cf9eb0ce4e3cf9f20fc479327dfec379c0f73a323187bed461dba02eb0815bd.png",
			"xcsh://documentation/docs-cloud-f5-com/client-side-defense/how-tos/configure-csd/assets/e83baeb148c2ff41847952981faf512bfb8b5c470ce6562aa425408549274183.png",
			"xcsh://documentation/docs-cloud-f5-com/client-side-defense/how-tos/configure-csd/assets/e2db8922b14530dafe30e1fbce10e3c46e73736456225dd39643006815de6fc8.png",
			"xcsh://documentation/docs-cloud-f5-com/client-side-defense/how-tos/configure-csd/assets/8ce8c0a99658588a1a404555e2b7f7fd95fc56279c193725fc3cfe4d53987606.png",
			"xcsh://documentation/docs-cloud-f5-com/client-side-defense/how-tos/configure-csd/assets/13e5844f8cefe7d79bf6951ee7d6af9b3c11300c68c21a83641f1dc3f37f6912.png",
		]);
		expect(media.turns?.[1]?.contract.requiredImageContentCount).toBe(6);
	});
});
