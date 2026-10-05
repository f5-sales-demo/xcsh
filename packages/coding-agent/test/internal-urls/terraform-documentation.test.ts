import { describe, expect, test } from "bun:test";
import {
	parseTerraformPin,
	rewriteTerraformLinks,
	scoreTerraformAliasContext,
	terraformNamedChoice,
	terraformPassages,
	terraformProviderMention,
	terraformProviderSetupDestination,
	terraformQueryIdentity,
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

test("secret decryption and storage providers are not root provider authentication", () => {
	expect(
		terraformProviderSetupDestination("Where are credentials for the API crawler secret store provider configured?"),
	).toBeUndefined();
	expect(
		terraformProviderSetupDestination("Which decryption provider authenticates crawler password secrets?"),
	).toBeUndefined();
	expect(terraformProviderSetupDestination("Configure API token authentication for the xcsh provider")).toBe(
		"option-1-api-token-authentication",
	);
});

test("configuration verbs imply resource intent while read and mixed intent remain distinct", () => {
	expect(terraformQueryIdentity("Where do I supply a TLS certificate?").providerType).toBe("resources");
	expect(terraformQueryIdentity("How do I specify the backend address?").providerType).toBe("resources");
	expect(terraformQueryIdentity("Where do I configure or reference the backend port?").providerType).toBeUndefined();
	expect(terraformQueryIdentity("Read an existing certificate data source").providerType).toBe("data-sources");
});

test("generic descriptive nouns do not assert a provider owner", () => {
	const names = ["endpoint", "authentication", "http_loadbalancer", "certificate"];
	expect(
		terraformProviderMention("set response status for authentication on protected endpoints", names),
	).toBeUndefined();
	expect(terraformProviderMention("certificate resource configuration", names)).toBe("certificate");
	expect(terraformProviderMention("HTTP load balancer Bot Defense authentication status", names)).toBe(
		"http_loadbalancer",
	);
	expect(terraformProviderMention("xcsh_endpoint namespace", names)).toBe("endpoint");
});

test("alias branch scoring recognizes Kubernetes schema terminology", () => {
	const query = "Specify the Kubernetes service name for endpoint discovery";
	expect(
		scoreTerraformAliasContext(query, "origin_servers.k8s_service.service_name", ["origin", "pool"]),
	).toBeGreaterThan(
		scoreTerraformAliasContext(query, "origin_servers.consul_service.service_name", ["origin", "pool"]),
	);
});

test("common protocol wording does not choose a certificate architecture", () => {
	const choices = [
		{ schema_path: ["https"], aliases: ["existing certificates"] },
		{ schema_path: ["https_auto_cert"], aliases: ["automatic certificates"] },
	];
	expect(terraformNamedChoice("Terminate HTTPS traffic with TLS encryption", choices)).toBeUndefined();
	expect(terraformNamedChoice("HTTPS with automatic certificates", choices)).toBe(1);
	expect(terraformNamedChoice("Use existing certificates for HTTPS", choices)).toBe(0);
	expect(terraformNamedChoice("Configure https_auto_cert", choices)).toBe(1);
});

test("schema breadcrumb component cannot masquerade as provider identity", () => {
	const names = ["workload", "http_loadbalancer", "origin_pool"];
	expect(
		terraformProviderMention(
			"data source under service > advertise_options > http_loadbalancer > https > certificates. Field name",
			names,
		),
	).toBeUndefined();
	expect(
		terraformProviderMention("xcsh_workload under service > advertise_options > http_loadbalancer > https", names),
	).toBe("workload");
	expect(terraformProviderMention("HTTP load balancer under https > certificates", names)).toBe("http_loadbalancer");
});

test("explicit field lookup does not promote descriptive nouns to provider owners", () => {
	const names = ["namespace", "subnet", "workload"];
	expect(
		terraformProviderMention("Which namespace does this reference use? Field: `namespace`.", names),
	).toBeUndefined();
	expect(
		terraformProviderMention("Set prefix length of each allocated subnet. Field: `allocation_unit`.", names),
	).toBeUndefined();
	expect(terraformProviderMention("For the namespace resource. Field: `name`.", names)).toBe("namespace");
	expect(terraformProviderMention("For xcsh_subnet. Field: `name`.", names)).toBe("subnet");
});
