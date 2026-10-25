import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createKindResolver, type OpenAPISpec } from "@f5-sales-demo/pi-resource-management";
import { API_CATALOG_DATA, API_CATALOG_INDEX } from "../../coding-agent/src/internal-urls/api-catalog-index.generated";
import {
	API_SPEC_DATA,
	API_SPEC_INDEX,
	API_SPEC_VERSION,
	API_VALIDATION_DATA,
} from "../../coding-agent/src/internal-urls/api-spec-index.generated";
import { canonicalJson } from "../src/util";

const normalize = (value: string) =>
	value.replace(/\{metadata\.namespace\}/g, "{namespace}").replace(/\{metadata\.name\}/g, "{name}");
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function generateSpecification(): void {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
	const pin = JSON.parse(readFileSync(path.join(root, "tools/spec-release.json"), "utf8")) as {
		version: string;
		release_tag: string;
		target_commit: string;
		assets: Record<string, string>;
	};
	if (
		API_SPEC_VERSION !== pin.version ||
		API_CATALOG_INDEX.version !== pin.version ||
		API_SPEC_INDEX.version !== pin.version
	) {
		throw new Error("CLI specification and immutable release pin differ");
	}
	const resolver = createKindResolver(API_SPEC_INDEX, API_VALIDATION_DATA);
	const paths = new Set<string>();
	for (const kind of resolver.getKindsWithApiPaths()) {
		try {
			for (const value of Object.values(resolver.resolveKind(kind).paths)) paths.add(value);
		} catch {
			/* Discovery-only kinds are preserved but cannot produce a mutation contract. */
		}
	}
	const catalog = Object.fromEntries(
		Object.entries(API_CATALOG_DATA).flatMap(([name, category]) => {
			const operations = category.operations
				.filter(
					operation =>
						paths.has(normalize(operation.path)) &&
						["get", "post", "put", "delete"].includes(operation.method.toLowerCase()),
				)
				.map(operation => ({
					method: operation.method,
					path: operation.path,
					fieldMetadata: operation.fieldMetadata,
				}));
			return operations.length ? [[name, { operations }]] : [];
		}),
	);
	const specs: Record<string, OpenAPISpec> = {};
	for (const [domain, raw] of Object.entries(API_SPEC_DATA)) {
		const spec = raw as OpenAPISpec;
		const selectedPaths = Object.fromEntries(
			Object.entries(spec.paths).flatMap(([template, operations]) => {
				if (!paths.has(normalize(template))) return [];
				return [
					[
						template,
						Object.fromEntries(
							Object.entries(operations).filter(([method]) => ["get", "post", "put", "delete"].includes(method)),
						),
					],
				];
			}),
		);
		if (!Object.keys(selectedPaths).length) continue;
		const references = new Set<string>();
		const collect = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			for (const [key, child] of Object.entries(value)) {
				if (key === "$ref" && typeof child === "string") {
					if (!child.startsWith("#/components/schemas/"))
						throw new Error(`Unsupported schema reference in ${domain}`);
					references.add(child.slice("#/components/schemas/".length));
				} else collect(child);
			}
		};
		collect(selectedPaths);
		const schemas: Record<string, Record<string, unknown>> = {};
		for (const reference of references) {
			const schema = spec.components?.schemas?.[reference];
			if (!schema) throw new Error(`Missing schema ${domain}/${reference}`);
			schemas[reference] = schema;
			collect(schema);
		}
		specs[domain] = { info: spec.info, paths: selectedPaths, components: { schemas } };
	}
	const bytes = Buffer.from(
		canonicalJson({ version: pin.version, index: API_SPEC_INDEX, validation: API_VALIDATION_DATA, catalog, specs }),
	);
	const inputs = [
		"packages/coding-agent/src/internal-urls/api-spec-index.generated.ts",
		"packages/coding-agent/src/internal-urls/api-catalog-index.generated.ts",
		"tools/spec-release.json",
	];
	const receipt = {
		version: pin.version,
		upstreamRepository: "f5-sales-demo/api-specs-enriched",
		releaseTag: pin.release_tag,
		upstreamCommit: pin.target_commit,
		upstreamAssets: pin.assets,
		cliSourceCommit: execFileSync("git", ["log", "-1", "--format=%H", "--", ...inputs], {
			cwd: root,
			encoding: "utf8",
		}).trim(),
		cliInputs: Object.fromEntries(inputs.map(input => [input, sha(readFileSync(path.join(root, input)))])),
		specificationSha256: sha(bytes),
		uncompressedBytes: bytes.length,
		projection:
			"Canonical CLI CRUD paths, validation/catalog metadata, and transitively referenced schemas; no network fallback",
	};
	const compressed = gzipSync(bytes, { level: 9 });
	writeFileSync(
		path.join(root, "packages/f5-core/src/api-spec-index.generated.ts"),
		`// Generated from the pinned CLI specification by scripts/generate-specification.ts.\n` +
			`export const SPECIFICATION_BASE64: string = ${JSON.stringify(compressed.toString("base64"))};\n` +
			`export const SPECIFICATION_SHA256 = ${JSON.stringify(sha(bytes))};\n` +
			`export const SPECIFICATION_RECEIPT = ${JSON.stringify(receipt, null, "\t")} as const;\n`,
	);
	console.log(`Pinned F5 specification ${pin.version}: ${bytes.length} JSON bytes, ${compressed.length} gzip bytes`);
}
if (import.meta.main) generateSpecification();
