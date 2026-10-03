import { describe, expect, it } from "bun:test";
import { generateTypeScript } from "../../scripts/generate-terraform-index";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { createTerraformResolver } from "../../src/internal-urls/terraform-resolve";
import type { CanonicalTerraformIndex } from "../../src/internal-urls/terraform-types";

describe("canonical Terraform navigation", () => {
	it("renders exact source links without synthesizing configuration", async () => {
		const index: CanonicalTerraformIndex = {
			schema_version: 1,
			provider: "registry.terraform.io/f5-sales-demo/xcsh",
			providerTag: "v13.0.0",
			pages: [
				{
					id: "leaf",
					title: "Custom errors",
					summary: "Map value budget",
					category: "virtual",
					provider_name: "http_loadbalancer",
					provider_type: "resources",
					role: "reference",
					source_url: "https://example.com/exact-doc",
					body_sha256: "sha256:synthetic",
				},
			],
		};
		const result = await createTerraformResolver(index).resolve(
			parseInternalUrl("xcsh://terraform/http_loadbalancer"),
		);
		expect(result.content).toContain("https://example.com/exact-doc");
		expect(result.content).toContain("v13.0.0");
	});
	it("projects deterministic compressed hints from the canonical corpus", () => {
		const source = {
			schema_version: 1,
			provider: "xcsh",
			pages: [{ id: "leaf", summary: "exact", unused: "large" }],
		};
		const output = generateTypeScript(source, "v13.0.0", "a".repeat(40));
		expect(output).toBe(generateTypeScript(source, "v13.0.0", "a".repeat(40)));
		expect(output).toContain("gunzipSync");
		expect(output).toContain("CanonicalTerraformIndex");
	});
});
