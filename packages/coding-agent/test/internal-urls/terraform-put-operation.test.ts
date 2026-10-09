import { expect, test } from "bun:test";
import { propertyRequestedText, rankPropertyScope } from "../../src/internal-urls/terraform-property-ranking";

test("put questions retain the requested operation without treating declarations as fields", () => {
	expect(propertyRequestedText("where do I put login success rules")).toBe("login success rules");
	expect(propertyRequestedText("Where do I put the retry ceiling?")).toBe("the retry ceiling");
	expect(propertyRequestedText("Where do I put the resource declaration?")).toBeUndefined();
});

test("provider scopes missing requested concepts cannot claim complete coverage", () => {
	const rows = [
		{
			provider_type: "resources",
			provider_name: "fixture",
			schema_path: "rules",
			path: "rules.md",
			anchor: "section",
			description: "Configure pod rules",
			leaf: ["rule"],
			context: [],
			descriptionTerms: ["pod", "rule"],
			aliasTerms: [],
		},
	];
	const ranked = rankPropertyScope("where do I put login success rules", { rows, weights: new Map([["rule", 2]]) });
	expect(ranked[0]!.coverage).toBeLessThan(0.5);
});
