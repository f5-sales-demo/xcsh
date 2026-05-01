import { gunzipSync } from "node:zlib";
import { LRUCache } from "lru-cache";
import type { ApiSpecDomainEntry, ApiSpecIndex, OpenAPISpec } from "./api-spec-types";
import type { InternalResource, InternalUrl } from "./types";

const LRU_CAPACITY = 5;
const SCHEMA_RENDER_MAX_DEPTH = 3;

export interface ApiSpecResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

export function createApiSpecResolver(index: ApiSpecIndex, blobs: Record<string, string>): ApiSpecResolver {
	const cache = new LRUCache<string, OpenAPISpec>({ max: LRU_CAPACITY });

	function decompress(domain: string): OpenAPISpec {
		const cached = cache.get(domain);
		if (cached) return cached;

		const blob = blobs[domain];
		if (!blob) {
			throw new Error(`No spec blob for domain: ${domain}`);
		}

		const buffer = Buffer.from(blob, "base64");
		const decompressed = gunzipSync(buffer);
		const spec = JSON.parse(decompressed.toString("utf-8")) as OpenAPISpec;
		cache.set(domain, spec);
		return spec;
	}

	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = url.rawPathname ?? url.pathname;
			const domain = pathname.replace(/^\//, "").replace(/\/$/, "");

			if (!domain) {
				return makeResource(url, renderDomainIndex(index));
			}

			const entry = index.domains.find(d => d.domain === domain);
			if (!entry) {
				return makeResource(url, renderUnknownDomain(domain, index));
			}

			const resource = url.searchParams.get("resource");
			const pathFilter = url.searchParams.get("path");

			if (resource) {
				const spec = decompress(domain);
				const matchingPaths = filterPathsByResource(spec, resource);
				if (Object.keys(matchingPaths).length === 0) {
					return makeResource(url, renderUnknownResource(resource, entry, spec));
				}
				return makeResource(url, renderResourceSpec(domain, resource, spec));
			}

			if (pathFilter) {
				const spec = decompress(domain);
				return makeResource(url, renderPathSpec(domain, pathFilter, spec));
			}

			const spec = decompress(domain);
			return makeResource(url, renderDomainDetail(domain, entry, spec));
		},
	};
}

function makeResource(url: InternalUrl, content: string): InternalResource {
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		sourcePath: `xcsh://${url.rawHost}${url.rawPathname ?? "/"}`,
	};
}

function renderDomainIndex(index: ApiSpecIndex): string {
	const rows = index.domains.map(
		d => `| ${d.domain} | ${d.category} | ${d.resources.length} | ${d.pathCount} | ${d.descriptionShort} |`,
	);

	return [
		`# F5 XC API Specifications (v${index.version})`,
		"",
		`${index.domains.length} domains. Read \`xcsh://api-spec/{domain}\` for resource details.`,
		"",
		"| Domain | Category | Resources | Paths | Description |",
		"|--------|----------|-----------|-------|-------------|",
		...rows,
		"",
	].join("\n");
}

function renderDomainDetail(domain: string, entry: ApiSpecDomainEntry, spec: OpenAPISpec): string {
	const groups = groupPathsBySchema(spec);
	const schemaNames = [...groups.keys()].sort();

	const resourceRows = schemaNames.map(s => {
		const paths = groups.get(s)!;
		const opCount = Object.values(paths).reduce((n, m) => n + Object.keys(m).length, 0);
		return `| ${s} | ${opCount} operations |`;
	});

	const operationRows: string[] = [];
	for (const [pathKey, methods] of Object.entries(spec.paths)) {
		for (const [method, op] of Object.entries(methods)) {
			if (typeof op !== "object" || !op) continue;
			const summary = (op as Record<string, unknown>).summary ?? "";
			operationRows.push(`| ${method.toUpperCase()} | ${pathKey} | ${summary} |`);
		}
	}

	const sections = [
		`# ${entry.title} — F5 XC API`,
		"",
		`Category: ${entry.category} | Paths: ${entry.pathCount} | Complexity: ${entry.complexity}`,
		"",
		"## Resources",
		"",
		"| Resource | Info |",
		"|----------|------|",
		...resourceRows,
		"",
		"## Operations",
		"",
		"| Method | Path | Summary |",
		"|--------|------|---------|",
		...operationRows,
	];

	if (entry.useCases?.length) {
		sections.push("", "## Use Cases", ...entry.useCases.map(u => `- ${u}`));
	}

	if (entry.relatedDomains?.length) {
		sections.push("", "## Related Domains", `- ${entry.relatedDomains.join(", ")}`);
	}

	sections.push("", `Read \`xcsh://api-spec/${domain}?resource={name}\` for full endpoint specification.`, "");

	return sections.join("\n");
}

function extractSchemaComponent(operationId: string): string | null {
	const match = operationId.match(/^ves\.io\.schema\.(.+?)\.(?:API|CustomAPI)\./);
	return match ? match[1] : null;
}

function groupPathsBySchema(spec: OpenAPISpec): Map<string, Record<string, Record<string, unknown>>> {
	const groups = new Map<string, Record<string, Record<string, unknown>>>();

	for (const [pathKey, methods] of Object.entries(spec.paths)) {
		for (const [method, op] of Object.entries(methods)) {
			if (typeof op !== "object" || !op) continue;
			const opId = (op as Record<string, unknown>).operationId as string | undefined;
			if (!opId) continue;
			const schema = extractSchemaComponent(opId);
			if (!schema) continue;
			if (!groups.has(schema)) {
				groups.set(schema, {});
			}
			const group = groups.get(schema)!;
			if (!group[pathKey]) group[pathKey] = {};
			group[pathKey][method] = op as Record<string, unknown>;
		}
	}

	return groups;
}

function filterPathsByResource(spec: OpenAPISpec, resource: string): Record<string, Record<string, unknown>> {
	const groups = groupPathsBySchema(spec);

	const exactKey = resource.replace(/-/g, "_");
	if (groups.has(exactKey)) {
		return groups.get(exactKey)!;
	}

	const partial = new Map<string, Record<string, Record<string, unknown>>>();
	for (const [schema, paths] of groups) {
		const schemaEnd = schema.split(".").at(-1) ?? schema;
		if (
			schemaEnd === exactKey ||
			schemaEnd.includes(exactKey) ||
			exactKey.includes(schemaEnd) ||
			schema === exactKey ||
			schema.endsWith(`.${exactKey}`)
		) {
			for (const [path, methods] of Object.entries(paths)) {
				if (!partial.has("merged")) partial.set("merged", {});
				const merged = partial.get("merged")!;
				if (!merged[path]) merged[path] = {};
				Object.assign(merged[path], methods);
			}
		}
	}
	if (partial.size > 0) {
		return partial.get("merged") ?? {};
	}

	const pluralized = exactKey.endsWith("s") ? exactKey : `${exactKey}s`;
	const result: Record<string, Record<string, unknown>> = {};
	for (const [pathKey, methods] of Object.entries(spec.paths)) {
		const segments = pathKey.split("/");
		if (segments.some(s => s === pluralized || s === exactKey)) {
			result[pathKey] = methods;
		}
	}
	return result;
}

function renderResourceSpec(_domain: string, resource: string, spec: OpenAPISpec): string {
	const matchingPaths = filterPathsByResource(spec, resource);
	const sections = [`# ${resource} — Full API Specification`, ""];

	for (const [pathKey, methods] of Object.entries(matchingPaths)) {
		for (const [method, op] of Object.entries(methods)) {
			if (typeof op !== "object" || !op) continue;
			const operation = op as Record<string, unknown>;
			sections.push(`## ${method.toUpperCase()} ${pathKey}`, "");
			if (operation.summary) sections.push(String(operation.summary), "");

			const params = operation.parameters as Array<Record<string, unknown>> | undefined;
			if (params?.length) {
				sections.push("### Parameters", "");
				sections.push("| Name | In | Required | Type | Description |");
				sections.push("|------|-----|----------|------|-------------|");
				for (const p of params) {
					const schema = (p.schema as Record<string, unknown>) ?? {};
					sections.push(
						`| ${p.name} | ${p.in} | ${p.required ? "yes" : "no"} | ${schema.type ?? "unknown"} | ${p.description ?? ""} |`,
					);
				}
				sections.push("");
			}

			const reqBody = operation.requestBody as Record<string, unknown> | undefined;
			if (reqBody) {
				sections.push("### Request Body", "");
				const content = reqBody.content as Record<string, Record<string, unknown>> | undefined;
				const jsonContent = content?.["application/json"];
				if (jsonContent?.schema) {
					const schema = resolveSchemaRef(jsonContent.schema as Record<string, unknown>, spec);
					sections.push(renderSchemaAsTable(schema, spec));
				}
			}

			const responses = operation.responses as Record<string, Record<string, unknown>> | undefined;
			if (responses) {
				for (const [status, resp] of Object.entries(responses)) {
					if (typeof resp !== "object" || !resp) continue;
					const respContent = (resp as Record<string, unknown>).content as
						| Record<string, Record<string, unknown>>
						| undefined;
					const jsonResp = respContent?.["application/json"];
					if (jsonResp?.schema) {
						sections.push(`### Response ${status}`, "");
						const schema = resolveSchemaRef(jsonResp.schema as Record<string, unknown>, spec);
						sections.push(renderSchemaAsTable(schema, spec));
					}
				}
			}

			sections.push("---", "");
		}
	}

	return sections.join("\n");
}

function renderPathSpec(_domain: string, pathKey: string, spec: OpenAPISpec): string {
	const methods = spec.paths[pathKey];
	if (!methods) {
		const available = Object.keys(spec.paths).slice(0, 10);
		return [`# Path not found: ${pathKey}`, "", "Available paths:", ...available.map(p => `- \`${p}\``), ""].join(
			"\n",
		);
	}

	const sections = [`# ${pathKey}`, ""];

	for (const [method, op] of Object.entries(methods)) {
		if (typeof op !== "object" || !op) continue;
		const operation = op as Record<string, unknown>;
		sections.push(`## ${method.toUpperCase()}`, "");
		if (operation.summary) sections.push(String(operation.summary), "");
	}

	return sections.join("\n");
}

function resolveSchemaRef(schema: Record<string, unknown>, spec: OpenAPISpec): Record<string, unknown> {
	const ref = schema.$ref as string | undefined;
	if (!ref) return schema;

	const match = ref.match(/^#\/components\/schemas\/(.+)$/);
	if (!match) return schema;

	const schemaName = match[1];
	const resolved = spec.components?.schemas?.[schemaName];
	return (resolved as Record<string, unknown>) ?? schema;
}

function renderSchemaAsTable(schema: Record<string, unknown>, spec: OpenAPISpec, depth = 0, prefix = ""): string {
	if (depth > SCHEMA_RENDER_MAX_DEPTH) return "";

	const resolved = resolveSchemaRef(schema, spec);
	const properties = resolved.properties as Record<string, Record<string, unknown>> | undefined;
	if (!properties) {
		const type = (resolved.type as string) ?? "object";
		return `Type: ${type}\n`;
	}

	const required = (resolved.required as string[]) ?? [];
	const rows: string[] = [];

	if (depth === 0) {
		rows.push("| Field | Type | Required | Description |");
		rows.push("|-------|------|----------|-------------|");
	}

	for (const [name, prop] of Object.entries(properties)) {
		const fieldProp = resolveSchemaRef(prop, spec);
		const fieldName = prefix ? `${prefix}.${name}` : name;
		const type = (fieldProp.type as string) ?? "object";
		const desc = (fieldProp.description as string) ?? "";
		const isRequired = required.includes(name) ? "yes" : "no";

		rows.push(`| ${fieldName} | ${type} | ${isRequired} | ${desc} |`);

		if (type === "object" && fieldProp.properties && depth < SCHEMA_RENDER_MAX_DEPTH) {
			const nested = renderSchemaAsTable(fieldProp, spec, depth + 1, fieldName);
			const nestedLines = nested.split("\n").filter(l => l.startsWith("|") && !l.startsWith("| Field"));
			rows.push(...nestedLines);
		}
	}

	rows.push("");
	return rows.join("\n");
}

function renderUnknownDomain(requested: string, index: ApiSpecIndex): string {
	const suggestions = index.domains
		.filter(d => d.domain.includes(requested) || requested.includes(d.domain.slice(0, 3)))
		.slice(0, 5);

	const sections = [`# Domain not found: ${requested}`, ""];

	if (suggestions.length > 0) {
		sections.push("Did you mean:", ...suggestions.map(d => `- \`${d.domain}\` — ${d.descriptionShort}`), "");
	}

	sections.push("Available domains:", ...index.domains.map(d => `- \`${d.domain}\` — ${d.descriptionShort}`), "");

	return sections.join("\n");
}

function renderUnknownResource(requested: string, entry: ApiSpecDomainEntry, spec: OpenAPISpec): string {
	const groups = groupPathsBySchema(spec);
	const schemaNames = [...groups.keys()].sort();

	return [
		`# Resource not found: ${requested}`,
		"",
		`Available resources in ${entry.domain} (from API operations):`,
		...schemaNames.map(s => `- \`${s}\``),
		"",
		`Use \`xcsh://api-spec/${entry.domain}?resource={name}\` with one of the above.`,
		"",
	].join("\n");
}
