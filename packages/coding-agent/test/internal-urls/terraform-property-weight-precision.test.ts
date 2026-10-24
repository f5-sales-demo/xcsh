import { expect, test } from "bun:test";
import { preparePropertyScope } from "../../src/internal-urls/terraform-property-ranking";

test("persisted ranking weights use fixed precision across math-library implementations", () => {
	const rows = ["alpha", "beta", "gamma"].map(name => ({
		provider_type: "resources",
		provider_name: "fixture",
		schema_path: name,
		path: name,
		anchor: "section",
		description: "",
	}));
	const scope = preparePropertyScope(rows);
	expect(scope.weights.get("alpha")).toBe(1.252762968495);
	expect([...scope.weights.values()]).toEqual([1.252762968495, 1.252762968495, 1.252762968495]);
});
