import { expect, test } from "bun:test";
import {
	type TerraformMetadata,
	validateTerraformRetrievalMetadata,
} from "../../src/internal-urls/terraform-documentation";

const rule = {
	version: 1,
	validator: "OneOf",
	values: ["GRE", "IPSEC"],
	case_sensitive: true,
	complete: true,
	source: "ast-validator:github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator.OneOf",
};
const metadata = (section: Record<string, unknown>): TerraformMetadata => ({
	retrieval_version: 1,
	category: "networking",
	capabilities: ["networking"],
	tasks: ["configuration"],
	relationships: [],
	id: "fixture",
	canonical_id: "fixture",
	path: "documentation/resources/fixture/index.md",
	provider_type: "resources",
	provider_name: "fixture",
	role: "properties",
	schema_path: [],
	summary: "Fixture",
	aliases: [],
	parent_id: null,
	child_ids: [],
	sections: [
		{
			schema_path: ["protocol"],
			document_id: "fixture",
			anchor: "schema-protocol",
			description: "Protocol",
			aliases: [],
			flags: ["optional"],
			relationships: [],
			...section,
		},
	],
});
test("typed enum metadata rejects malformed provenance and partial value sets", () => {
	for (const change of [
		{ version: 2 },
		{ source: "description" },
		{ complete: false },
		{ case_sensitive: false },
		{ values: ["IPSEC", "GRE"] },
		{ values: ["GRE", "GRE"] },
	]) {
		expect(() =>
			validateTerraformRetrievalMetadata(
				metadata({ enum_validators: [{ ...rule, ...change }], enum_extraction_complete: true }),
			),
		).toThrow();
	}
});
test("typed enum metadata rejects missing coverage and contradictory completeness", () => {
	for (const section of [
		{ enum_validators: [rule] },
		{ enum_extraction_complete: true },
		{ enum_validators: [{ ...rule, complete: false, values: [] }], enum_extraction_complete: true },
		{ enum_validators: [rule], enum_extraction_complete: "true" },
	])
		expect(() => validateTerraformRetrievalMetadata(metadata(section))).toThrow();
});
test("absent old enum metadata and explicit unresolved records remain valid", () => {
	expect(() => validateTerraformRetrievalMetadata(metadata({}))).not.toThrow();
	expect(() =>
		validateTerraformRetrievalMetadata(metadata({ enum_validators: [rule], enum_extraction_complete: true })),
	).not.toThrow();
	expect(() =>
		validateTerraformRetrievalMetadata(
			metadata({ enum_validators: [{ ...rule, complete: false, values: [] }], enum_extraction_complete: false }),
		),
	).not.toThrow();
});
