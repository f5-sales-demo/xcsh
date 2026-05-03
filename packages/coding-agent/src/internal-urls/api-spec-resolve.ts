import type { ApiSpecDomainEntry, ApiSpecIndex, OpenAPIPathOperation, OpenAPISpec } from "./api-spec-types";
import type { InternalResource, InternalUrl } from "./types";

const SCHEMA_RENDER_MAX_DEPTH = 3;
const CRUD_OPERATION_SUFFIXES = [".API.Create", ".API.Replace", ".API.Get", ".API.List", ".API.Delete"];

const groupsCache = new WeakMap<OpenAPISpec, Map<string, Record<string, Record<string, OpenAPIPathOperation>>>>();

function getCachedGroups(spec: OpenAPISpec): Map<string, Record<string, Record<string, OpenAPIPathOperation>>> {
	const cached = groupsCache.get(spec);
	if (cached) return cached;
	const groups = groupPathsBySchema(spec);
	groupsCache.set(spec, groups);
	return groups;
}

export interface ApiSpecResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

export function createApiSpecResolver(
	index: ApiSpecIndex,
	data: Readonly<Record<string, OpenAPISpec>>,
): ApiSpecResolver {
	function lookup(domain: string): OpenAPISpec {
		const spec = data[domain];
		if (!spec) throw new Error(`No spec data for domain: ${domain}`);
		return spec;
	}

	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = url.rawPathname ?? url.pathname;
			const domain = pathname.replace(/^\//, "").replace(/\/$/, "");

			if (!domain) {
				return makeResource(url, renderDomainIndex(index));
			}

			// Reserved sub-paths — checked before domain lookup
			if (domain === "workflows" || domain.startsWith("workflows/")) {
				const workflowId = domain.replace(/^workflows\/?/, "");
				return makeResource(url, workflowId ? renderWorkflowDetail(workflowId, index) : renderWorkflowIndex(index));
			}

			if (domain === "errors" || domain.startsWith("errors/")) {
				const errorKey = domain.replace(/^errors\/?/, "");
				return makeResource(url, errorKey ? renderErrorDetail(errorKey, index) : renderErrorIndex(index));
			}

			if (domain === "glossary" || domain.startsWith("glossary/")) {
				return makeResource(url, renderGlossary(index));
			}

			const entry = index.domains.find(d => d.domain === domain);
			if (!entry) {
				return makeResource(url, renderUnknownDomain(domain, index));
			}

			try {
				const resource = url.searchParams.get("resource");
				const pathFilter = url.searchParams.get("path");

				if (resource) {
					const crud = url.searchParams.get("crud") === "true";
					const spec = lookup(domain);
					const matchingPaths = filterPathsByResource(spec, resource, entry);
					if (Object.keys(matchingPaths).length === 0) {
						return makeResource(url, renderUnknownResource(resource, entry, spec));
					}
					return makeResource(url, renderResourceSpec(domain, resource, spec, entry, { crudOnly: crud }));
				}

				if (pathFilter) {
					const spec = lookup(domain);
					return makeResource(url, renderPathSpec(domain, pathFilter, spec));
				}

				const spec = lookup(domain);
				return makeResource(url, renderDomainDetail(domain, entry, spec));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return makeResource(url, `# Error loading ${domain}\n\n${message}\n`);
			}
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
	const criticalSet = new Set(index.criticalResources ?? []);
	const rows = index.domains.map(d => {
		const icon = d.icon ?? "";
		const tier = d.requiresTier ?? "";
		const hasCritical = d.resources.some(r => criticalSet.has(r.name));
		const desc = hasCritical ? `${d.descriptionShort} *` : d.descriptionShort;
		return `| ${icon} | ${d.domain} | ${d.category} | ${d.resources.length} | ${d.pathCount} | ${tier} | ${desc} |`;
	});

	const lines = [
		`# F5 XC API Specifications (v${index.version})`,
		"",
		`${index.domains.length} domains. Read \`xcsh://api-spec/{domain}\` for resource details.`,
		"",
		"| Icon | Domain | Category | Resources | Paths | Tier | Description |",
		"|------|--------|----------|-----------|-------|------|-------------|",
		...rows,
		"",
	];

	if (criticalSet.size > 0) {
		lines.push("\\* = contains critical resources", "");
	}

	return lines.join("\n");
}

function renderDomainDetail(domain: string, entry: ApiSpecDomainEntry, spec: OpenAPISpec): string {
	const sections: string[] = [
		`# ${entry.title} — F5 XC API`,
		"",
		`Category: ${entry.category} | Paths: ${entry.pathCount} | Complexity: ${entry.complexity}`,
	];

	if (entry.isPreview || entry.requiresTier === "Advanced") {
		const tags: string[] = [];
		if (entry.isPreview) tags.push("Preview API");
		if (entry.requiresTier === "Advanced") tags.push("Requires Advanced tier");
		sections.push("", `> ${tags.join(" | ")}`);
	}

	if (entry.descriptionMedium) {
		sections.push("", entry.descriptionMedium);
	}

	sections.push("", "## Resources", "");
	sections.push("| Resource | Description | Tier | Observability | Requires |");
	sections.push("|----------|-------------|------|---------------|----------|");
	for (const r of entry.resources) {
		const tier = r.tier ?? "";
		const obs: string[] = [];
		if (r.supportsLogs) obs.push("logs");
		if (r.supportsMetrics) obs.push("metrics");
		const requires = r.dependencies?.required.join(", ") ?? "";
		sections.push(`| ${r.name} | ${r.description} | ${tier} | ${obs.join(", ")} | ${requires} |`);
	}

	const hints = entry.resources.flatMap(r => r.relationshipHints ?? []);
	if (hints.length > 0) {
		sections.push("", "## Relationships", ...hints.map(h => `- ${h}`));
	}

	const operationRows: string[] = [];
	for (const [pathKey, methods] of Object.entries(spec.paths)) {
		for (const [method, op] of Object.entries(methods)) {
			if (typeof op !== "object" || !op) continue;
			const summary = op.summary ?? "";
			operationRows.push(`| ${method.toUpperCase()} | ${pathKey} | ${summary} |`);
		}
	}

	sections.push("", "## Operations", "");
	sections.push("| Method | Path | Summary |");
	sections.push("|--------|------|---------|");
	sections.push(...operationRows);

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

function groupPathsBySchema(spec: OpenAPISpec): Map<string, Record<string, Record<string, OpenAPIPathOperation>>> {
	const groups = new Map<string, Record<string, Record<string, OpenAPIPathOperation>>>();

	for (const [pathKey, methods] of Object.entries(spec.paths)) {
		for (const [method, op] of Object.entries(methods)) {
			if (typeof op !== "object" || !op) continue;
			const opId = op.operationId;
			if (!opId) continue;
			const schema = extractSchemaComponent(opId);
			if (!schema) continue;
			if (!groups.has(schema)) {
				groups.set(schema, {});
			}
			const group = groups.get(schema)!;
			if (!group[pathKey]) group[pathKey] = {};
			group[pathKey][method] = op;
		}
	}

	return groups;
}

function filterPathsByResource(
	spec: OpenAPISpec,
	resource: string,
	entry?: ApiSpecDomainEntry,
): Record<string, Record<string, OpenAPIPathOperation>> {
	// Primary: use pre-computed api_paths from enriched index
	if (entry) {
		const indexedResource = entry.resources.find(r => r.name === resource);
		if (indexedResource?.apiPaths?.length) {
			const result: Record<string, Record<string, OpenAPIPathOperation>> = {};
			for (const ap of indexedResource.apiPaths) {
				const methods = spec.paths[ap];
				if (methods) result[ap] = methods;
			}
			if (Object.keys(result).length > 0) return result;
		}
	}

	// Fallback 1: index-guided schemaComponents lookup
	if (entry) {
		const indexedResource = entry.resources.find(r => r.name === resource);
		if (indexedResource?.schemaComponents?.length) {
			const groups = getCachedGroups(spec);
			const result: Record<string, Record<string, OpenAPIPathOperation>> = {};
			for (const comp of indexedResource.schemaComponents) {
				const paths = groups.get(comp);
				if (paths) {
					for (const [pathKey, pathMethods] of Object.entries(paths)) {
						if (!result[pathKey]) result[pathKey] = {};
						Object.assign(result[pathKey], pathMethods);
					}
				}
			}
			if (Object.keys(result).length > 0) return result;
		}
	}

	// Fallback 2: operationId-based heuristic matching
	const groups = getCachedGroups(spec);

	const exactKey = resource.replace(/-/g, "_");
	if (groups.has(exactKey)) {
		return groups.get(exactKey)!;
	}

	const partial = new Map<string, Record<string, Record<string, OpenAPIPathOperation>>>();
	for (const [schema, paths] of groups) {
		const schemaEnd = schema.split(".").at(-1) ?? schema;
		if (
			schemaEnd === exactKey ||
			schemaEnd.includes(exactKey) ||
			exactKey.includes(schemaEnd) ||
			schema === exactKey ||
			schema.endsWith(`.${exactKey}`)
		) {
			for (const [p, methods] of Object.entries(paths)) {
				if (!partial.has("merged")) partial.set("merged", {});
				const merged = partial.get("merged")!;
				if (!merged[p]) merged[p] = {};
				Object.assign(merged[p], methods);
			}
		}
	}
	if (partial.size > 0) {
		return partial.get("merged") ?? {};
	}

	const pluralized = exactKey.endsWith("s") ? exactKey : `${exactKey}s`;
	const result: Record<string, Record<string, OpenAPIPathOperation>> = {};
	for (const [pathKey, methods] of Object.entries(spec.paths)) {
		const segments = pathKey.split("/");
		if (segments.some(s => s === pluralized || s === exactKey)) {
			result[pathKey] = methods;
		}
	}
	return result;
}

function renderResourceSpec(
	_domain: string,
	resource: string,
	spec: OpenAPISpec,
	entry?: ApiSpecDomainEntry,
	options?: { crudOnly?: boolean },
): string {
	const matchingPaths = filterPathsByResource(spec, resource, entry);
	const label = options?.crudOnly ? "CRUD Operations" : "Full API Specification";
	const sections = [`# ${resource} — ${label}`, ""];

	for (const [pathKey, methods] of Object.entries(matchingPaths)) {
		for (const [method, op] of Object.entries(methods)) {
			if (typeof op !== "object" || !op) continue;
			if (options?.crudOnly) {
				const opId = op.operationId ?? "";
				if (!CRUD_OPERATION_SUFFIXES.some(s => opId.endsWith(s))) continue;
			}
			const operation = op;
			sections.push(`## ${method.toUpperCase()} ${pathKey}`, "");
			if (operation.summary) sections.push(String(operation.summary), "");

			const params = operation.parameters;
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

			const reqBody = operation.requestBody;
			if (reqBody) {
				sections.push("### Request Body", "");
				const content = reqBody.content as Record<string, Record<string, unknown>> | undefined;
				const jsonContent = content?.["application/json"];
				if (jsonContent?.schema) {
					const schema = resolveSchemaRef(jsonContent.schema as Record<string, unknown>, spec);
					sections.push(renderSchemaAsTable(schema, spec));
				}
			}

			const responses = operation.responses;
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
		const operation = op;
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

function renderWorkflowIndex(index: ApiSpecIndex): string {
	const workflows = index.guidedWorkflows?.workflows ?? [];
	if (workflows.length === 0) {
		return "# Guided Workflows\n\nNo workflows available.\n";
	}

	const rows = workflows.map(w => `| ${w.id} | ${w.name} | ${w.domain} | ${w.complexity} | ${w.steps.length} |`);

	return [
		"# Guided API Workflows",
		"",
		`${workflows.length} step-by-step workflows. Read \`xcsh://api-spec/workflows/{id}\` for details.`,
		"",
		"| ID | Name | Domain | Complexity | Steps |",
		"|----|------|--------|------------|-------|",
		...rows,
		"",
	].join("\n");
}

function renderWorkflowDetail(id: string, index: ApiSpecIndex): string {
	const workflow = index.guidedWorkflows?.workflows.find(w => w.id === id);
	if (!workflow) {
		const available = index.guidedWorkflows?.workflows.map(w => `- \`${w.id}\` — ${w.name}`) ?? [];
		return [`# Workflow not found: ${id}`, "", "Available workflows:", ...available, ""].join("\n");
	}

	const sections: string[] = [
		`# ${workflow.name}`,
		"",
		`Complexity: ${workflow.complexity} | Domain: ${workflow.domain} | Steps: ${workflow.steps.length}`,
	];

	if (workflow.prerequisites.length > 0) {
		sections.push("", "**Prerequisites:**", ...workflow.prerequisites.map(p => `- ${p}`));
	}

	for (const step of workflow.steps) {
		sections.push("", `## Step ${step.order}: ${step.name}`, "");
		sections.push(step.description);
		if (step.resource) sections.push(`Resource: \`${step.resource}\``);
		if (step.required_fields?.length) sections.push(`Required fields: ${step.required_fields.join(", ")}`);
		if (step.depends_on?.length) sections.push(`Depends on: step ${step.depends_on.join(", step ")}`);
		if (step.tips?.length) sections.push("", "**Tips:**", ...step.tips.map(t => `- ${t}`));
		if (step.verification?.length) sections.push("", "**Verify:**", ...step.verification.map(v => `- ${v}`));
	}

	sections.push("");
	return sections.join("\n");
}

function renderErrorIndex(index: ApiSpecIndex): string {
	const er = index.errorResolution;
	if (!er) {
		return "# Error Resolution\n\nNo error resolution data available.\n";
	}

	const httpRows = Object.entries(er.http_errors).map(([code, e]) => `| HTTP | ${code} | ${e.name} |`);
	const resourceRows = Object.keys(er.resource_errors).map(r => `| Resource | ${r} | ${r} errors |`);

	return [
		"# API Error Resolution",
		"",
		"Read `xcsh://api-spec/errors/{code}` for HTTP errors or `xcsh://api-spec/errors/{resource}` for resource-specific errors.",
		"",
		"| Type | Code/Resource | Name |",
		"|------|---------------|------|",
		...httpRows,
		...resourceRows,
		"",
	].join("\n");
}

function renderErrorDetail(key: string, index: ApiSpecIndex): string {
	const er = index.errorResolution;
	if (!er) return `# Error: ${key}\n\nNo error resolution data available.\n`;

	const httpError = er.http_errors[key];
	if (httpError) {
		const sections: string[] = [
			`# HTTP ${httpError.code} — ${httpError.name}`,
			"",
			httpError.description,
			"",
			"## Common Causes",
			...httpError.common_causes.map(c => `- ${c}`),
			"",
			"## Diagnostic Steps",
		];
		for (const ds of httpError.diagnostic_steps) {
			sections.push(`${ds.step}. **${ds.action}** — ${ds.description}`);
			if (ds.command) sections.push(`   \`${ds.command}\``);
		}
		sections.push("", "## Prevention", ...httpError.prevention.map(p => `- ${p}`));
		if (httpError.related_errors?.length) {
			sections.push("", `Related errors: ${httpError.related_errors.join(", ")}`);
		}
		sections.push("");
		return sections.join("\n");
	}

	const resourceErrors = er.resource_errors[key];
	if (resourceErrors) {
		const rows = resourceErrors.map(e => `| ${e.error_code} | ${e.pattern} | ${e.resolution} |`);
		return [
			`# ${key} — Common Errors`,
			"",
			"| Error Code | Pattern | Resolution |",
			"|------------|---------|------------|",
			...rows,
			"",
		].join("\n");
	}

	return [
		`# Error not found: ${key}`,
		"",
		"Use `xcsh://api-spec/errors/` to see available error codes and resources.",
		"",
	].join("\n");
}

function renderGlossary(index: ApiSpecIndex): string {
	const ac = index.acronyms;
	if (!ac) return "# API Glossary\n\nNo glossary data available.\n";

	const sections = ["# API Glossary", ""];
	for (const cat of ac.categories) {
		const items = ac.acronyms.filter(a => a.category === cat);
		if (items.length === 0) continue;
		sections.push(`## ${cat}`, "");
		sections.push("| Acronym | Expansion |");
		sections.push("|---------|-----------|");
		for (const a of items) {
			sections.push(`| ${a.acronym} | ${a.expansion} |`);
		}
		sections.push("");
	}

	return sections.join("\n");
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
	const groups = getCachedGroups(spec);
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
