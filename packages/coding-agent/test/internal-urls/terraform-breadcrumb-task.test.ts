import { expect, test } from "bun:test";
import {
	rankTerraformDirectProperties,
	type TerraformSection,
	terraformTaskDestination,
} from "../../src/internal-urls/terraform-documentation";
import { propertyRequestsBlock } from "../../src/internal-urls/terraform-property-ranking";

test("an explicit ordered schema trail reaches exact field search before generic data-source guidance", () => {
	const trail = "`endpoint_policy_content` → `protected_mobile_endpoints` → `transaction_result_criteria`";
	expect(
		terraformTaskDestination(
			`For read-only xcsh_bot_endpoint_policy, I selected ${trail}. Which leaf controls the comparison operation?`,
		),
	).toBeUndefined();
	expect(terraformTaskDestination(`How do I import an object whose schema includes ${trail}?`)).toEqual({
		role: "import",
	});
	expect(terraformTaskDestination(`Show the root configuration for a data source with ${trail}.`)).toEqual({
		role: "fundamentals",
		anchor: "root-configuration",
	});
	expect(propertyRequestsBlock(`I choose a comparison operation under ${trail}. Which leaf controls it?`)).toBe(false);
	expect(propertyRequestsBlock("Which block should I choose for the comparison?")).toBe(true);
});

test("response-comparison intent refines a selected block to its documented operator leaf", () => {
	const parent = ["cookie_match_v2"];
	const sections: TerraformSection[] = [
		{
			schema_path: [...parent, "operator"],
			document_id: "cookie-match",
			anchor: "schema-cookie_match_v2--operator",
			description: "RESPONSE_OPERATOR_EQUALS_TO or RESPONSE_OPERATOR_CONTAINS",
			aliases: [],
			relationships: [],
			flags: [],
		},
		{
			schema_path: [...parent, "value"],
			document_id: "cookie-match",
			anchor: "schema-cookie_match_v2--value",
			description: "Value to compare",
			aliases: [],
			relationships: [],
			flags: [],
		},
	];
	expect(
		rankTerraformDirectProperties(
			"Which leaf controls the response-comparison operation, such as equality or containment?",
			parent,
			sections,
		)[0]?.anchor,
	).toBe("schema-cookie_match_v2--operator");
	expect(rankTerraformDirectProperties("Which leaf controls the operation?", parent, sections)).toEqual([]);
});
