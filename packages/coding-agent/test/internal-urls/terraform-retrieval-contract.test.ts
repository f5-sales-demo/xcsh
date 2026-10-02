import { expect, test } from "bun:test";
import {
	boundedTerraformResponse,
	selectTerraformCandidate,
	type TerraformMetadata,
	terraformQueryIdentity,
	validateTerraformRetrievalMetadata,
} from "../../src/internal-urls/terraform-documentation";

const metadata = (): TerraformMetadata => ({
	id: "fixture",
	canonical_id: "fixture",
	path: "documentation/resources/fixture/index.md",
	provider_type: "resources",
	provider_name: "fixture",
	role: "properties",
	schema_path: ["tls"],
	summary: "TLS",
	aliases: [],
	parent_id: null,
	child_ids: [],
	retrieval_version: 1,
	category: "security",
	capabilities: ["security.tls"],
	tasks: ["configuration"],
	sections: [],
	relationships: [],
});

test("retrieval metadata rejects unsupported versions and malformed facets", () => {
	for (const change of [
		{ retrieval_version: 2 },
		{ category: 8 },
		{ capabilities: "security" },
		{ tasks: ["probability"] },
		{ sections: [{}] },
		{
			relationships: [
				{ type: "requires", target_id: "missing", anchor: "section", enforcement: "description", source: "hint" },
			],
		},
	]) {
		expect(() => validateTerraformRetrievalMetadata({ ...metadata(), ...change } as TerraformMetadata)).toThrow();
	}
	expect(() => validateTerraformRetrievalMetadata(metadata())).not.toThrow();
});

test("bounded discovery preserves UTF-8 entries and continuation destinations", () => {
	const content = boundedTerraformResponse(
		"Provider: v1.0.0",
		["🙂".repeat(600), "x".repeat(3000), "y".repeat(3000)],
		4096,
		"Continue: xcsh://terraform-documentation/?facet=provider_name&cursor=fixture",
	);
	expect(Buffer.byteLength(content)).toBeLessThanOrEqual(4096);
	expect(content).toContain("🙂".repeat(600));
	expect(content).not.toContain("xxx");
	expect(content).toContain("Continue:");
});

test("selection distinguishes provider role and competing choices from ranking values", () => {
	const leaf = { path: metadata().path, anchor: "schema-tls--certificate", metadata: metadata(), ranking: 20 };
	expect(selectTerraformCandidate([leaf], false)).toBe("leaf");
	expect(selectTerraformCandidate([leaf, { ...leaf, ranking: 19 }], false)).toBe("choices");
	expect(
		selectTerraformCandidate(
			[leaf, { ...leaf, ranking: 1, metadata: { ...metadata(), provider_type: "data-sources" } }],
			false,
		),
	).toBe("choices");
	expect(selectTerraformCandidate([leaf], true)).toBe("choices");
});

test("query identity keeps exact provider mentions anywhere and concrete HCL resource intent", () => {
	expect(
		terraformQueryIdentity("Draft HCL for backend servers and attach xcsh_origin_pool at the end").providerPhrase,
	).toBe("origin pool");
	expect(terraformQueryIdentity("Where do I configure routing on xcsh_http_loadbalancer?").providerPhrase).toBe(
		"http loadbalancer",
	);
	expect(
		terraformQueryIdentity("Draft the Terraform status block under Bot Defense in xcsh_cdn_loadbalancer")
			.providerType,
	).toBe("resources");
	expect(terraformQueryIdentity("Read xcsh_origin_pool data source properties").providerType).toBe("data-sources");
	expect(terraformQueryIdentity("Should this be a resource or a data source?")).not.toHaveProperty("providerType");
	expect(terraformQueryIdentity("HTTP body payload name")).not.toHaveProperty("providerPhrase");
});
