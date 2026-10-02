import os from "node:os";
import path from "node:path";
import { TerraformDocumentationRepository } from "./internal-urls/terraform-documentation";
import { EMBEDDED_TERRAFORM_DOCUMENTATION } from "./internal-urls/terraform-documentation-assets.generated";
import type { InternalUrl } from "./internal-urls/types";

export async function runTerraformDocumentationSmoke(): Promise<string> {
	if (!EMBEDDED_TERRAFORM_DOCUMENTATION) throw new Error("Terraform smoke requires embedded assets");
	const repository = new TerraformDocumentationRepository(
		EMBEDDED_TERRAFORM_DOCUMENTATION,
		path.join(os.homedir(), ".xcsh/cache/terraform-documentation"),
	);
	const trace: Array<Record<string, unknown>> = [];
	async function read(uri: string): Promise<string> {
		const url = Object.assign(new URL(uri), { rawHost: "terraform-documentation" }) as InternalUrl;
		return (await repository.resolve(url)).content;
	}
	const inventory = await read("xcsh://terraform-documentation/");
	if (!inventory.includes(EMBEDDED_TERRAFORM_DOCUMENTATION.pin.source_commit))
		throw new Error("Terraform provenance smoke failed");
	trace.push({
		event: "terraform-inventory",
		providerVersion: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.provider_version,
		sourceCommit: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.source_commit,
		documentCount: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.document_count,
	});
	const search = await read(
		"xcsh://terraform-documentation/?search=http_loadbalancer&provider_type=resources&provider_name=http_loadbalancer&role=fundamentals&limit=5",
	);
	if (!search.includes("xcsh://terraform-documentation/documentation/resources/http_loadbalancer/index.md"))
		throw new Error("Terraform filtered search smoke failed");
	trace.push({ event: "terraform-filtered-search", outcome: "top-five" });
	const facets = await read("xcsh://terraform-documentation/?facet=capability&limit=5");
	if (Buffer.byteLength(facets) > 4096 || !facets.includes("Facet: capability"))
		throw new Error("Terraform facet smoke failed");
	const hint = await read(
		"xcsh://terraform-documentation/documentation/resources/http_loadbalancer/properties/https/index.md?view=hint",
	);
	if (Buffer.byteLength(hint) > 4096 || !hint.includes("view=context")) throw new Error("Terraform hint smoke failed");
	trace.push({ event: "terraform-bounded-hint-facets", outcome: "within-4096-bytes" });
	const section = await read(
		"xcsh://terraform-documentation/documentation/resources/http_loadbalancer/properties/https/index.md#schema-https--port",
	);
	if (!section.includes("### port") || !section.includes("Validators"))
		throw new Error("Terraform explicit-anchor smoke failed");
	trace.push({ event: "terraform-explicit-anchor", outcome: "complete-property" });
	const database = await repository.database();
	const leaf =
		"documentation/resources/http_loadbalancer/properties/bot_defense/policy/protected_app_endpoints/flow_label/authentication/login/transaction_result/success_conditions/index.md";
	const complete = await read(`xcsh://terraform-documentation/${leaf}`);
	if (
		!complete.includes("regex_values") ||
		!complete.includes("xcsh://terraform-documentation/documentation/resources/")
	)
		throw new Error("Canonical deep leaf navigation smoke failed");
	trace.push({ event: "terraform-deep-leaf", path: leaf, outcome: "read-and-navigation" });
	const missing = await read("xcsh://terraform-documentation/?search=nonexistent_xyz_4649");
	if (!missing.includes("No results.")) throw new Error("Terraform missing smoke failed");
	trace.push({ event: "terraform-missing", outcome: "no-match-no-fetch" });
	database.close();
	return `${trace.map(entry => JSON.stringify(entry)).join("\n")}\nXCSH_TERRAFORM_DOCUMENTATION_SMOKE_OK`;
}
