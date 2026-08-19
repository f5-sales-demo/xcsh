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

	it("preserves legacy resource maps and inline minimum configs", async () => {
		const index: TerraformIndex = {
			categories: [category],
			provider,
			resources: {
				app_firewall: {
					category: "security",
					dependencies: { requires: [] },
					description: "Application Firewall",
					import_syntax: "terraform import xcsh_app_firewall.example namespace/name",
					minimal_config: 'resource "xcsh_app_firewall" "example" {}',
					required: ["name", "namespace"],
				},
			},
			version: "0.1.0",
		};

		const resource = await createTerraformResolver(index).resolve(
			parseInternalUrl("xcsh://terraform/app_firewall") as never,
		);
		expect(resource.content).toContain('resource "xcsh_app_firewall" "example" {}');
		expect(resource.content).toContain("```terraform");
	});
});
