import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BUILD_INFO } from "./internal-urls/build-info.generated";
import { parseInternalUrl } from "./internal-urls/parse";
import { PUBLIC_CITATION_SOURCES } from "./internal-urls/public-citation-destinations.generated";
import { InternalDocsProtocolHandler } from "./internal-urls/xcsh-protocol";

export function validateCorpusMeasurementRequests(input: unknown): string[] {
	if (!Array.isArray(input) || !input.length || input.length > 10000 || input.some(uri => typeof uri !== "string"))
		throw new Error("Corpus measurement requires one to 10000 offline corpus URIs");
	for (const uri of input) {
		const parsed = parseInternalUrl(uri);
		if (
			parsed.protocol !== "xcsh:" ||
			!["documentation", "terraform-documentation", "api-spec", "api-catalog"].includes(parsed.rawHost) ||
			parsed.username ||
			parsed.password
		)
			throw new Error("Corpus measurement requires offline corpus URIs");
	}
	return input;
}
export async function measureCorpusRequests(input: unknown, read: (uri: string) => Promise<{ content: unknown }>) {
	const results = [];
	for (const request of validateCorpusMeasurementRequests(input)) {
		let response = "",
			error: string | null = null,
			digest = "";
		const times: number[] = [];
		for (let repetition = 0; repetition < 5; repetition++) {
			const start = performance.now();
			try {
				response = JSON.stringify((await read(request)).content);
				error = null;
			} catch (failure) {
				response = "";
				error = failure instanceof Error ? failure.message : String(failure);
			}
			times.push(performance.now() - start);
			const current = createHash("sha256").update(JSON.stringify({ response, error })).digest("hex");
			if (repetition && digest !== current) throw new Error("Non-deterministic installed corpus response");
			digest = current;
		}
		results.push({ request, response_sha256: digest, error, times_ms: times });
	}
	return results;
}
export async function runCorpusMeasurement(file: string): Promise<string> {
	const input = await readFile(file);
	if (input.length > 4 * 1024 * 1024) throw new Error("Corpus measurement requests exceed 4 MiB");
	const handler = new InternalDocsProtocolHandler();
	const results = await measureCorpusRequests(JSON.parse(input.toString("utf8")), uri =>
		handler.resolve(parseInternalUrl(uri)),
	);
	return JSON.stringify({
		schema_version: 1,
		regression_only: true,
		installed_resolver: true,
		build: BUILD_INFO,
		corpora: PUBLIC_CITATION_SOURCES,
		repetitions: 5,
		request_sha256: createHash("sha256").update(input).digest("hex"),
		results,
	});
}
