import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUILD_INFO } from "./internal-urls/build-info.generated";
import { EMBEDDED_DOCUMENTATION_ASSETS } from "./internal-urls/documentation-assets.generated";
import { createEmbeddedDocumentationRepository } from "./internal-urls/documentation-repository";
import { createDocumentationResolver } from "./internal-urls/documentation-resolve";
import type { InternalUrl } from "./internal-urls/types";

function hash(text: string | Uint8Array): string {
	return createHash("sha256").update(text).digest("hex");
}
export function validateDocumentationMeasurementRequests(input: unknown): string[] {
	if (!Array.isArray(input) || input.length < 1 || input.length > 10000 || input.some(uri => typeof uri !== "string"))
		throw new Error("Measurement requires one to 10000 request URIs");
	for (const uri of input) {
		const u = new URL(uri);
		if (u.protocol !== "xcsh:" || u.host !== "documentation" || u.username || u.password)
			throw new Error("Measurement requires general documentation URIs");
	}
	return input;
}
export async function measureDocumentationRequests(
	input: unknown,
	read: (uri: string) => Promise<{ content: string }>,
) {
	const results = [];
	for (const request of validateDocumentationMeasurementRequests(input)) {
		let response = "",
			context = "",
			responseHash = "";
		const times: number[] = [];
		for (let n = 0; n < 5; n++) {
			const start = performance.now();
			response = (await read(request)).content;
			times.push(performance.now() - start);
			context = "";
			const destination = [...response.matchAll(/^Read: (\S+)/gm)][0]?.[1];
			if (destination) {
				validateDocumentationMeasurementRequests([destination]);
				context = (await read(destination)).content;
			}
			const currentHash = hash(`${response}\0${context}`);
			if (!n) responseHash = currentHash;
			else if (currentHash !== responseHash) throw new Error("Non-deterministic complete retrieval response");
		}
		results.push({ request, response, context, response_sha256: responseHash, times_ms: times });
	}
	return results;
}
export async function runDocumentationMeasurement(requestFile: string): Promise<string> {
	const assets = EMBEDDED_DOCUMENTATION_ASSETS;
	if (!assets) throw new Error("Measurement requires embedded documentation");
	const bytes = await readFile(requestFile);
	if (bytes.length > 4 * 1024 * 1024) throw new Error("Measurement request file exceeds 4 MiB");
	const repository = createEmbeddedDocumentationRepository(assets, {
		cacheRoot: path.join(os.homedir(), ".xcsh/cache/documentation-measurement"),
	});
	const start = performance.now();
	await repository.prime();
	const materializationMs = performance.now() - start;
	const resolver = createDocumentationResolver(repository);
	const results = await measureDocumentationRequests(JSON.parse(bytes.toString()), async uri => {
		const resource = await resolver.resolve(Object.assign(new URL(uri), { rawHost: "documentation" }) as InternalUrl);
		if (typeof resource.content !== "string") throw new Error("Measurement requires text resources");
		return { content: resource.content };
	});
	return JSON.stringify({
		schema_version: 1,
		installed_resolver: true,
		regression_only: true,
		build: BUILD_INFO,
		release_tag: assets.releaseTag,
		source_commit: assets.sourceCommit,
		index_sha256: assets.indexSha256,
		request_sha256: hash(bytes),
		platform: os.platform(),
		arch: os.arch(),
		repetitions: 5,
		materialization_ms: materializationMs,
		results,
	});
}
