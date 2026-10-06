import { expect, test } from "bun:test";
import { terraformTaskDestination } from "../../src/internal-urls/terraform-documentation";

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
});
