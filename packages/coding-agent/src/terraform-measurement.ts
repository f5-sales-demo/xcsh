import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILD_INFO } from "./internal-urls/build-info.generated";
import { TerraformDocumentationRepository, terraformHash } from "./internal-urls/terraform-documentation";
import { EMBEDDED_TERRAFORM_DOCUMENTATION } from "./internal-urls/terraform-documentation-assets.generated";
import type { InternalUrl } from "./internal-urls/types";

export function validateTerraformMeasurementRequests(input: unknown): string[] {
	if (!Array.isArray(input) || input.length < 1 || input.length > 10000 || input.some(uri => typeof uri !== "string"))
		throw new Error("Measurement requires one to 10000 request URIs");
	const requests = input as string[];
	for (const uri of requests) {
		const u = new URL(uri);
		if (u.protocol !== "xcsh:" || u.host !== "terraform-documentation" || u.username || u.password)
			throw new Error("Measurement requires Terraform documentation URIs");
	}
	return requests;
}

export async function measureTerraformRequests(input: unknown, read: (uri: string) => Promise<{ content: string }>) {
	const requests = validateTerraformMeasurementRequests(input);
	const results = [];
	for (const request of requests) {
		let discovery = "",
			context = "",
			responseHash = "",
			toolCalls = 0,
			totalBytes = 0,
			maxDiscoveryBytes = 0,
			maxContextBytes = 0;
		const discoveryTimes: number[] = [],
			contextTimes: number[] = [],
			routeTimes: number[] = [];
		for (let n = 0; n < 5; n++) {
			const start = performance.now();
			discovery = (await read(request)).content;
			discoveryTimes.push(performance.now() - start);
			toolCalls++;
			const bytes = Buffer.byteLength(discovery);
			if (bytes > 4096) throw new Error("Discovery budget violated");
			totalBytes += bytes;
			maxDiscoveryBytes = Math.max(maxDiscoveryBytes, bytes);
			context = "";
			const destination = [...discovery.matchAll(/^Read: (\S+)/gm)][0]?.[1];
			if (discovery.includes("Selected leaf;") && destination) {
				const target = new URL(destination);
				if (target.protocol !== "xcsh:" || target.host !== "terraform-documentation")
					throw new Error("Invalid measurement destination");
				target.searchParams.set("view", "context");
				const before = performance.now();
				context = (await read(target.href)).content;
				contextTimes.push(performance.now() - before);
				toolCalls++;
				const size = Buffer.byteLength(context);
				if (size > 16384) throw new Error("Context budget violated");
				totalBytes += size;
				maxContextBytes = Math.max(maxContextBytes, size);
			}
			const hash = terraformHash(`${discovery}\0${context}`);
			if (!n) responseHash = hash;
			else if (hash !== responseHash) throw new Error("Non-deterministic complete retrieval response");
			routeTimes.push(performance.now() - start);
		}
		results.push({
			request,
			discovery,
			context,
			response_sha256: responseHash,
			discovery_times_ms: discoveryTimes,
			context_times_ms: contextTimes,
			route_times_ms: routeTimes,
			tool_calls: toolCalls,
			total_response_bytes: totalBytes,
			max_discovery_bytes: maxDiscoveryBytes,
			max_context_bytes: maxContextBytes,
		});
	}
	return results;
}
export async function runTerraformMeasurement(requestFile: string): Promise<string> {
	if (!EMBEDDED_TERRAFORM_DOCUMENTATION) throw new Error("Measurement requires embedded Terraform documentation");
	const bytes = await readFile(requestFile);
	if (bytes.length > 4 * 1024 * 1024) throw new Error("Measurement request file exceeds 4 MiB");
	const requests = validateTerraformMeasurementRequests(JSON.parse(bytes.toString()));
	const repository = new TerraformDocumentationRepository(
		EMBEDDED_TERRAFORM_DOCUMENTATION,
		path.join(os.homedir(), ".xcsh/cache/terraform-documentation"),
	);
	const cold = performance.now();
	const db = await repository.database();
	const materializationMs = performance.now() - cold;
	try {
		const results = await measureTerraformRequests(requests, uri =>
			repository.resolve(Object.assign(new URL(uri), { rawHost: "terraform-documentation" }) as InternalUrl),
		);
		return JSON.stringify({
			schema_version: 1,
			installed_resolver: true,
			qualification_passed: false,
			build: BUILD_INFO,
			provider_version: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.provider_version,
			provider_source_commit: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.source_commit,
			index_sha256: EMBEDDED_TERRAFORM_DOCUMENTATION.pin.index.sha256,
			request_sha256: terraformHash(bytes),
			platform: os.platform(),
			arch: os.arch(),
			repetitions: 5,
			materialization_ms: materializationMs,
			model_network_ms: null,
			results,
		});
	} finally {
		db.close();
	}
}
