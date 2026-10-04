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

test("operation duration requests inside a timeout block identify the direct lifecycle field", async () => {
	const { interpretTerraformLifecycle } = await import("../../src/internal-urls/terraform-lifecycle");
	for (const [word, op] of [
		["creation", "create"],
		["read", "read"],
		["update", "update"],
		["deletion", "delete"],
	]) {
		const query = `Configure the ${word} timeout duration in the timeouts block for xcsh_namespace.`;
		expect(interpretTerraformLifecycle(query)?.field).toBe(true);
		expect(selectPropertyDestination(query, rows).destinations[0]?.schema_path).toBe(`timeouts.${op}`);
		expect(selectPropertyDestination(query, rows).kind).toBe("leaf");
	}
	expect(
		interpretTerraformLifecycle("Read the entire timeouts block describing creation and deletion operations")?.field,
	).toBe(false);
});

test("describing operation values does not turn block reads into field reads", async () => {
	const { interpretTerraformLifecycle } = await import("../../src/internal-urls/terraform-lifecycle");
	for (const noun of ["duration", "value", "limit"])
		expect(interpretTerraformLifecycle(`Read the timeouts block describing creation ${noun}`)?.field).toBe(false);
	for (const noun of ["request", "connection", "TLS"])
		expect(
			interpretTerraformLifecycle(`Configure the creation ${noun} timeout duration in the timeouts block`),
		).toBeUndefined();
	expect(
		selectPropertyDestination(
			"Configure the creation timeout duration rather than deletion in the timeouts block for xcsh_namespace",
			rows,
		).kind,
	).toBe("choices");
});

test("refresh inflections keep documented read lifecycle operation", async () => {
	const { interpretTerraformLifecycle } = await import("../../src/internal-urls/terraform-lifecycle");
	expect(
		selectPropertyDestination("Which timeout governs refreshing a namespace resource?", rows).destinations[0]
			?.schema_path,
	).toBe("timeouts.read");
	expect(selectPropertyDestination("Which timeout governs refreshing a namespace resource?", rows).kind).toBe("leaf");
	expect(interpretTerraformLifecycle("Which connection timeout governs refreshing a request?")).toBeUndefined();
});

test("refreshing documentation does not assert a read lifecycle operation", () => {
	for (const verb of ["Refresh", "Refreshing", "Refreshed"])
		expect(
			selectPropertyDestination(`${verb} the timeout documentation for a namespace resource`, rows).kind,
		).not.toBe("leaf");
});

test("plural timeout documentation preserves absent lifecycle operation", () => {
	for (const verb of ["Refresh", "Refreshing", "Refreshed", "Refreshes"])
		expect(
			selectPropertyDestination(`${verb} the timeouts documentation for a namespace resource`, rows).kind,
		).not.toBe("leaf");
});

test("traffic inactivity timeouts are transport properties rather than lifecycle operations", async () => {
	const { interpretTerraformLifecycle } = await import("../../src/internal-urls/terraform-lifecycle");
	for (const q of ["Locate the no-traffic stream timeout", "Where is the timeout for an inactive session?"])
		expect(interpretTerraformLifecycle(q)).toBeUndefined();
	expect(interpretTerraformLifecycle("Which timeout governs deletion of the session resource?")?.operations).toEqual([
		"delete",
	]);
});
