import { describe, expect, test } from "bun:test";
import {
	parseTerraformPin,
	rewriteTerraformLinks,
	terraformPassages,
	terraformSearchQuery,
} from "../../src/internal-urls/terraform-documentation";

describe("Terraform documentation", () => {
	test("normalizes conversational questions without dropping domain constraints", () => {
		expect(terraformSearchQuery("How do I tell Bot Defense that a login succeeded?")).toBe(
			'"bot"* AND "defense"* AND "login"* AND ("succeeded"* OR "success"*)',
		);
		expect(terraformSearchQuery("login failed")).toContain('"failure"*');
		expect(terraformSearchQuery("How do I configure HTTPS?")).toBe('"https"*');
		expect(terraformSearchQuery("the and how")).toBe("");
	});
	test("preserves explicit schema anchors, nested property sections and fences", () => {
		const body =
			'# TLS\n\n<a id="schema-https--port"></a>\n\n### port\n\n```hcl\n# Code heading\nport = 443\n```\n\n#### Validation\nRange 1-65535.\n\n### port\nSecond heading.\n';
		const passages = terraformPassages(body);
		expect(passages.find(p => p.anchor === "schema-https--port")?.markdown).toContain(
			"```hcl\n# Code heading\nport = 443\n```",
		);
		expect(passages.find(p => p.anchor === "schema-https--port")?.markdown).toContain("Range 1-65535.");
		expect(passages.some(p => p.anchor === "port-1")).toBe(true);
		expect(passages.some(p => p.anchor === "code-heading")).toBe(false);
	});
	test("resolves internal links across directories and retains external links", () => {
		expect(
			rewriteTerraformLinks(
				"[Parent](../resources/http_loadbalancer/index.md#https) [External](https://example.com/)",
				"documentation/guides/reference.md",
			),
		).toBe(
			"[Parent](xcsh://terraform-documentation/documentation/resources/http_loadbalancer/index.md#https) [External](https://example.com/)",
		);
	});
	test("maps canonical Pages links and rejects Registry projection paths", () => {
		expect(
			rewriteTerraformLinks(
				"[HTTPS](https://f5-sales-demo.github.io/terraform-provider-xcsh/resources/http_loadbalancer/properties/https/#section)",
				"documentation/index.md",
			),
		).toBe(
			"[HTTPS](xcsh://terraform-documentation/documentation/resources/http_loadbalancer/properties/https/index.md#section)",
		);
		expect(() => rewriteTerraformLinks("[Old](../docs/resources/example.md)", "documentation/index.md")).toThrow(
			"Unsafe Terraform document path",
		);
	});
	test("rejects unpinned snapshot identities", () => {
		expect(() => parseTerraformPin({})).toThrow("Invalid Terraform snapshot identity");
	});
});
