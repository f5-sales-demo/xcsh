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
	if (!search.includes("Document: docs/resources/http_loadbalancer.md"))
		throw new Error("Terraform filtered search smoke failed");
	trace.push({ event: "terraform-filtered-search", outcome: "top-five" });
	const section = await read(
		"xcsh://terraform-documentation/docs/guides/resources--http_loadbalancer--properties--https.md#schema-https--port",
	);
	if (!section.includes("### port") || !section.includes("Validators"))
		throw new Error("Terraform explicit-anchor smoke failed");
	trace.push({ event: "terraform-explicit-anchor", outcome: "complete-property" });
	const database = await repository.database();
	const continuation = database
		.query(
			"SELECT path FROM terraform_documents WHERE json_extract(metadata,'$.projection_part')=2 ORDER BY path LIMIT 1",
		)
		.get() as { path: string } | null;
	if (!continuation) throw new Error("Terraform smoke requires a continuation document");
	const complete = await read(`xcsh://terraform-documentation/${continuation.path}`);
	if (!complete.includes("xcsh://terraform-documentation/"))
		throw new Error("Terraform continuation navigation smoke failed");
	trace.push({ event: "terraform-continuation", path: continuation.path, outcome: "read-and-navigation" });
	const missing = await read("xcsh://terraform-documentation/?search=nonexistent_xyz_4649");
	if (!missing.includes("No results.")) throw new Error("Terraform missing smoke failed");
	trace.push({ event: "terraform-missing", outcome: "no-match-no-fetch" });
	database.close();
	return `${trace.map(entry => JSON.stringify(entry)).join("\n")}\nXCSH_TERRAFORM_DOCUMENTATION_SMOKE_OK`;
}
