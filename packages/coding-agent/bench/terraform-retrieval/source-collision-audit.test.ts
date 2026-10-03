import { expect, test } from "bun:test";
import { sourceCollisionAlternatives } from "./source-collision-audit";
const first = {
	provider_type: "resources",
	provider_name: "fixture",
	schema_path: "architecture_a.route.addr",
	path: "a",
	anchor: "schema-a",
	description: "IP address.",
};
test("source collision inventory includes all roles and omitted architectures", () => {
	const rows = [
		first,
		{ ...first, schema_path: "architecture_b.route.addr", path: "b" },
		{ ...first, provider_type: "data-sources", path: "data" },
		{ ...first, description: "Other meaning.", path: "other" },
		{ ...first, provider_name: "another", path: "provider" },
	];
	expect(sourceCollisionAlternatives(first, rows).map(row => row.path)).toEqual(["data", "a", "b"]);
	expect(sourceCollisionAlternatives(first, [...rows].reverse())).toEqual(sourceCollisionAlternatives(first, rows));
});
test("descriptive whitespace cannot conceal equivalent source destinations", () => {
	expect(
		sourceCollisionAlternatives(first, [first, { ...first, description: "IP\naddress.", path: "peer" }]),
	).toHaveLength(2);
});
