import { performance } from "node:perf_hooks";
import { TerraformDocumentationRepository } from "../src/internal-urls/terraform-documentation";
import { EMBEDDED_TERRAFORM_DOCUMENTATION } from "../src/internal-urls/terraform-documentation-assets.generated";
import type { InternalUrl } from "../src/internal-urls/types";

if (!EMBEDDED_TERRAFORM_DOCUMENTATION) throw new Error("Terraform assets missing");
const repository = new TerraformDocumentationRepository(
	EMBEDDED_TERRAFORM_DOCUMENTATION,
	"/tmp/xcsh-4649-acceptance-cache",
);
async function resolve(uri: string): Promise<string> {
	const url = new URL(uri) as InternalUrl;
	url.rawHost = url.hostname;
	url.rawPathname = uri.slice(uri.indexOf("/", 7)).split(/[?#]/)[0];
	return (await repository.resolve(url)).content;
}
const start = performance.now();
const inventory = await resolve("xcsh://terraform-documentation/");
console.log(
	JSON.stringify({
		event: "inventory",
		startupMs: performance.now() - start,
		version: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.provider_version,
		valid: inventory.includes(String(EMBEDDED_TERRAFORM_DOCUMENTATION.pin.document_count)),
	}),
);
const scenarios = [
	[
		"How do I tell Bot Defense that a login succeeded?",
		"",
		"http_loadbalancer--properties--bot_defense--policy--protected_app_endpoints--flow_label--authentication--login--transaction_result--success_conditions.md",
	],
	["where do I put login success rules", "", "transaction_result--success_conditions.md"],
	["how do I use a certificate I already have for HTTPS", "", "resources--http_loadbalancer--properties--https.md"],
	["configure HTTP load balancer", "", "docs/resources/http_loadbalancer.md"],
	["authentication certificate API token", "", "docs/index.md"],
	[
		"TLS invalid configuration",
		"provider_type=resources&provider_name=http_loadbalancer&role=example",
		"http_loadbalancer--example",
	],
	[
		"http_loadbalancer",
		"provider_type=resources&provider_name=http_loadbalancer&role=fundamentals",
		"docs/resources/http_loadbalancer.md",
	],
	[
		"https port TLS",
		"provider_type=resources&provider_name=http_loadbalancer&role=properties",
		"http_loadbalancer--properties--https",
	],
	["import", "provider_type=resources&provider_name=http_loadbalancer&role=import", "http_loadbalancer--import"],
	["timeouts", "provider_type=resources&provider_name=http_loadbalancer&role=timeouts", "http_loadbalancer--timeouts"],
	[
		"http_loadbalancer",
		"provider_type=data-sources&provider_name=http_loadbalancer&role=fundamentals",
		"docs/data-sources/http_loadbalancer.md",
	],
	[
		"terminate",
		"provider_type=actions&provider_name=access_active_session_terminate",
		"docs/actions/access_active_session_terminate.md",
	],
	[
		"kubernetes manifests",
		"provider_type=ephemeral-resources&provider_name=kubernetes_manifests",
		"kubernetes_manifests",
	],
];
for (const [query, filters, expected] of scenarios) {
	const before = performance.now();
	const content = await resolve(
		`xcsh://terraform-documentation/?search=${encodeURIComponent(query!)}&${filters}&limit=5`,
	);
	const passed = content.includes(expected!);
	console.log(JSON.stringify({ event: "search", query, passed, latencyMs: performance.now() - before, content }));
	if (!passed) throw new Error(`Relevance scenario failed: ${query}`);
}
const section = await resolve(
	"xcsh://terraform-documentation/docs/guides/resources--http_loadbalancer--properties--https.md#schema-https--port",
);
if (!section.includes("port")) throw new Error("Explicit anchor read failed");
console.log(JSON.stringify({ event: "anchor", passed: true, content: section }));
