import { describe, expect, test } from "bun:test";
import {
	parseTerraformPin,
	rewriteTerraformLinks,
	terraformPassages,
} from "../../src/internal-urls/terraform-documentation";

describe("Terraform documentation", () => {
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
				"[Parent](../resources/http_loadbalancer.md#https) [External](https://example.com/)",
				"docs/guides/reference--part-2.md",
			),
		).toBe(
			"[Parent](xcsh://terraform-documentation/docs/resources/http_loadbalancer.md#https) [External](https://example.com/)",
		);
	});
	test("rejects unpinned snapshot identities", () => {
		expect(() => parseTerraformPin({})).toThrow("Invalid Terraform snapshot identity");
	});
});
