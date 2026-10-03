import { expect, test } from "bun:test";
import { selectPropertyDestination } from "../../src/internal-urls/terraform-property-selection";

const rows = ["create", "read", "update", "delete"].map((op, i) => ({
	provider_type: "resources",
	provider_name: "namespace",
	schema_path: `timeouts.${op}`,
	path: "documentation/resources/namespace/timeouts/index.md",
	anchor: `schema-timeouts--${op}`,
	description: `Timeout duration for ${op} operation.`,
	type: "string",
	score: 100 - i * 30,
	coverage: 0.8,
}));
test("lifecycle selection uses complete operation evidence and keeps every named operation", () => {
	const query = "Which resource field sets the maximum duration permitted for Namespace creation?";
	expect(selectPropertyDestination(query, rows).destinations[0]?.anchor).toBe("schema-timeouts--create");
	expect(selectPropertyDestination(query, rows).kind).toBe("leaf");
	const multi = selectPropertyDestination("Which resource timeout field controls creation and destruction?", rows);
	expect(multi.kind).toBe("choices");
	expect(multi.destinations.map(r => r.anchor)).toEqual(["schema-timeouts--create", "schema-timeouts--delete"]);
	for (const query of [
		"Which resource timeout field?",
		"Read the documentation for the timeout field",
		"Which initial timeout field?",
		"Which timeout field does not control creation?",
		"Which field sets retry counts for creation timeout?",
	])
		expect(selectPropertyDestination(query, rows).kind).not.toBe("leaf");
});

test("property documentation wording preserves an entire timeout block request", async () => {
	const { interpretTerraformLifecycle } = await import("../../src/internal-urls/terraform-lifecycle");
	expect(
		interpretTerraformLifecycle(
			"Where in the xcsh_namespace property documentation is the entire nested timeouts configuration block described?",
		)?.field,
	).toBe(false);
	expect(interpretTerraformLifecycle("Which property inside the timeouts block controls creation?")?.field).toBe(true);
});
