import { expect, test } from "bun:test";
import { verifiedChoiceEdges } from "../../src/internal-urls/terraform-choice-edges";

const relation = (anchor: string) => ({
	type: "conflicts" as const,
	target_id: "page",
	anchor,
	enforcement: "provider-schema",
	source: "ast-validator:ConflictingObjectAttributes",
	group: "opaque-group",
});
test("verified group destinations produce symmetric exact leaf edges without self edges", () => {
	const rows = verifiedChoiceEdges([
		relation("schema-append"),
		relation("schema-overwrite"),
		relation("schema-append"),
	]);
	expect(rows).toHaveLength(2);
	expect(rows.map(row => [row.source_id, row.source_anchor, row.target_id, row.anchor])).toEqual([
		["page", "schema-append", "page", "schema-overwrite"],
		["page", "schema-overwrite", "page", "schema-append"],
	]);
});
test("requires, advisory, unrelated groups and incomplete groups do not become choice edges", () => {
	for (const rows of [
		[relation("schema-only")],
		[
			{ ...relation("schema-a"), type: "requires" as const },
			{ ...relation("schema-b"), type: "requires" as const },
		],
		[relation("schema-a"), { ...relation("schema-b"), group: "other" }],
		[relation("schema-a"), { ...relation("schema-b"), enforcement: "advisory" }],
	])
		expect(verifiedChoiceEdges(rows)).toEqual([]);
});
test("cross-page groups preserve exact identities and anchors", () => {
	const rows = verifiedChoiceEdges([relation("schema-value"), { ...relation("section"), target_id: "child" }]);
	expect(
		rows.some(
			row =>
				row.source_id === "page" &&
				row.source_anchor === "schema-value" &&
				row.target_id === "child" &&
				row.anchor === "section",
		),
	).toBe(true);
});

test("relationship ordering includes type and source across input permutations", () => {
	const rows = [
		relation("schema-a"),
		relation("schema-b"),
		{ ...relation("schema-a"), source: "other-validator" },
		{ ...relation("schema-b"), source: "other-validator" },
	];
	expect(verifiedChoiceEdges(rows)).toEqual(verifiedChoiceEdges([...rows].reverse()));
});
