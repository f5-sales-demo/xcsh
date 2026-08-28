import { describe, expect, it } from "bun:test";
import { parseInternalUrl } from "../../src/internal-urls/parse";
import { createTerraformResolver } from "../../src/internal-urls/terraform-resolve";
import type { TerraformIndex } from "../../src/internal-urls/terraform-types";

const provider = {
	auth_methods: [],
	config_block: 'provider "xcsh" {}',
	registry: "registry.terraform.io/f5/xcsh",
	required_block: 'terraform { required_providers { xcsh = { source = "f5/xcsh" } } }',
	source: "f5-sales-demo/terraform-provider-xcsh",
	syntax_rules: [],
};

const category = {
	description: "Security resources",
	name: "Security",
	resource_count: 1,
	resources: ["app_firewall"],
	slug: "security",
};

describe("createTerraformResolver", () => {
	it("resolves provider typed resource arrays and renders config references as provenance", async () => {
		const index = {
			categories: [category],
			provider,
			resources: [
				{
					category: "security",
					dependencies: { requires: ["namespace"] },
					description: "Application Firewall",
					import_syntax: "terraform import xcsh_app_firewall.example namespace/name",
					minimal_config: {
						format: "terraform",
						source: "_llms-txt/resources/app_firewall.txt#minimal-valid-config",
					},
					name: "app_firewall",
					required: ["name", "namespace"],
				},
			],
			version: "0.1.0",
		} as TerraformIndex;

		const resolver = createTerraformResolver(index);
		const resource = await resolver.resolve(parseInternalUrl("xcsh://terraform/security/app_firewall") as never);
		const categoryListing = await resolver.resolve(parseInternalUrl("xcsh://terraform/security") as never);

		expect(resource.content).toContain("Application Firewall");
		expect(resource.content).toContain("Configuration source");
		expect(resource.content).toContain("_llms-txt/resources/app_firewall.txt#minimal-valid-config");
		expect(resource.content).not.toContain("[object Object]");
		expect(categoryListing.content).toContain("Application Firewall");
	});

	it("renders a current non-importable resource without inventing an import command", async () => {
		const index: TerraformIndex = {
			categories: [
				{
					...category,
					name: "Uncategorized",
					resources: ["site_cloud_init"],
					slug: "uncategorized",
				},
			],
			provider,
			resources: [
				{
					category: "security",
					dependencies: { requires: [] },
					description: "Issue site-scoped Customer Edge cloud-init",
					minimal_config: {
						format: "terraform",
						source: "_llms-txt/resources/site_cloud_init.txt#minimal-valid-config",
					},
					name: "site_cloud_init",
					required: ["provider_ref", "site_name"],
				},
			],
			version: "0.1.0",
		};

		const resource = await createTerraformResolver(index).resolve(
			parseInternalUrl("xcsh://terraform/uncategorized/site_cloud_init") as never,
		);
		expect(resource.content).toContain("site_cloud_init");
		expect(resource.content).toContain("site_cloud_init.txt#minimal-valid-config");
		expect(resource.content).not.toContain("Import:");
		expect(resource.content).not.toContain("undefined");
	});
});
