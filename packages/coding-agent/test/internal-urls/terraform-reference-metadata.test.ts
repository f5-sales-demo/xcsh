import { expect, test } from "bun:test";
import {
	type TerraformMetadata,
	validateTerraformRetrievalMetadata,
} from "../../src/internal-urls/terraform-documentation";

const evidence = {
	version: 1,
	scope_path: ["backend"],
	member: "namespace",
	upstream_message: "ves.io.schema.ObjectRefType",
	source: "receipt-pinned-schema-identity",
};
const metadata = (reference: unknown): TerraformMetadata => ({
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
	schema_path: ["backend"],
	summary: "Fixture",
	aliases: [],
	parent_id: null,
	child_ids: [],
	sections: [
		{
			schema_path: ["backend", "namespace"],
			document_id: "fixture",
			anchor: "schema-backend--namespace",
			description: "Namespace",
			aliases: [],
			relationships: [],
			flags: ["optional"],
			reference_identity: reference,
		} as any,
	],
});
test("reference evidence requires exact direct path and verified identity", () => {
	expect(() => validateTerraformRetrievalMetadata(metadata(evidence))).not.toThrow();
	for (const change of [
		{ version: 2 },
		{ source: "description" },
		{ upstream_message: "example.ObjectRefType" },
		{ member: "name" },
		{ scope_path: [] },
		{ scope_path: ["other"] },
	]) {
		expect(() => validateTerraformRetrievalMetadata(metadata({ ...evidence, ...change }))).toThrow();
	}
});
test("absent legacy reference evidence remains valid", () => {
	const m = metadata(undefined);
	expect(() => validateTerraformRetrievalMetadata(m)).not.toThrow();
});

test("reference evidence rejects malformed shapes and root ownership", () => {
	for (const bad of [
		null,
		[],
		{ ...evidence, version: true },
		{ ...evidence, scope_path: ["../backend"] },
		{ ...evidence, member: "address" },
	])
		expect(() => validateTerraformRetrievalMetadata(metadata(bad))).toThrow();
	const root = metadata(evidence);
	root.sections![0]!.schema_path = ["namespace"];
	expect(() => validateTerraformRetrievalMetadata(root)).toThrow();
});
