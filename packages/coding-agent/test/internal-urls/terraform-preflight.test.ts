import { describe, expect, it } from "bun:test";
import { classifyTerraformPreflight } from "../../src/internal-urls/terraform-preflight";

describe("Terraform turn activation", () => {
	it.each([
		"Write Terraform for an origin pool",
		"Generate HCL",
		"edit main.tf",
		"terraform init -upgrade",
		"Read xcsh://terraform-documentation/",
	])("activates explicit requests: %s", text => {
		expect(classifyTerraformPreflight(text, false)).toBe(true);
	});
	it.each(["Create an origin pool", "What time is it?", "Write a poem", "Look up HTTP LB API limits"])(
		"does not fetch for unrelated requests: %s",
		text => {
			expect(classifyTerraformPreflight(text, false)).toBe(false);
			expect(classifyTerraformPreflight(text, true)).toBe(false);
		},
	);
	it.each([
		"Add a variable for its namespace",
		"Keep version 15.1.0",
		"Now write the files",
		"Update the lock file",
		"yes",
		"Validate it",
		"Also set port to 8443",
	])("keeps continuing Terraform turns: %s", text => {
		expect(classifyTerraformPreflight(text, true)).toBe(true);
		expect(classifyTerraformPreflight(text, false)).toBe(false);
	});
});
