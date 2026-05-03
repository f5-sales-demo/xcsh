import type { ApiCatalogCategory, ApiCatalogCategorySummary, ApiCatalogIndex } from "./api-catalog-types";
import type { ApiSpecIndex } from "./api-spec-types";
import type { InternalResource, InternalUrl } from "./types";

function normalizeSearchTerm(s: string): string {
	return s.toLowerCase().replace(/_/g, "-");
}

export interface ApiCatalogResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

export function createApiCatalogResolver(
	index: ApiCatalogIndex,
	categorySummaries: readonly ApiCatalogCategorySummary[],
	data: Readonly<Record<string, ApiCatalogCategory>>,
	specIndex?: ApiSpecIndex,
): ApiCatalogResolver {
	function lookup(category: string): ApiCatalogCategory {
		const cat = data[category];
		if (!cat) throw new Error(`No catalog data for category: ${category}`);
		return cat;
	}

	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = url.rawPathname ?? url.pathname;
			const category = pathname.replace(/^\//, "").replace(/\/$/, "");
			const search = url.searchParams.get("search");
			const resourceName = url.searchParams.get("resource");
			const compact = url.searchParams.get("compact") === "true";

			if (!category) {
				if (resourceName && specIndex) {
					for (const domain of specIndex.domains) {
						const res = domain.resources.find(r => r.name === resourceName);
						if (res?.catalogCategories?.length) {
							const catName = res.catalogCategories[0];
							if (categorySummaries.some(c => c.name === catName)) {
								try {
									const cat = lookup(catName);
									return makeResource(url, renderCatalogDetail(cat, index, { compact }));
								} catch {
									break;
								}
							}
						}
					}
					return makeResource(url, renderCatalogSearch(index, categorySummaries, resourceName));
				}

				const content = search
					? renderCatalogSearch(index, categorySummaries, search)
					: renderCatalogIndex(index, categorySummaries);
				return makeResource(url, content);
			}

			const summary = categorySummaries.find(c => c.name === category);
			if (!summary) {
				return makeResource(url, renderUnknownCategory(category, categorySummaries));
			}

			try {
				const cat = lookup(category);
				return makeResource(url, renderCatalogDetail(cat, index, { compact }));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return makeResource(url, `# Error loading ${category}\n\n${message}\n`);
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

function renderCatalogIndex(index: ApiCatalogIndex, summaries: readonly ApiCatalogCategorySummary[]): string {
	const rows = summaries.map(c => `| ${c.name} | ${c.displayName} | ${c.operationCount} |`);

	return [
		`# F5 XC API Catalog (v${index.version})`,
		"",
		`${summaries.length} categories. Read \`xcsh://api-catalog/{category}\` for operation details.`,
		"",
		"| Category | Display Name | Operations |",
		"|----------|--------------|------------|",
		...rows,
		"",
	].join("\n");
}

function renderCatalogSearch(
	_index: ApiCatalogIndex,
	summaries: readonly ApiCatalogCategorySummary[],
	term: string,
): string {
	const normalized = normalizeSearchTerm(term);
	const matches = summaries.filter(
		c => normalizeSearchTerm(c.name).includes(normalized) || normalizeSearchTerm(c.displayName).includes(normalized),
	);

	if (matches.length === 0) {
		return [
			`# No categories matching "${term}"`,
			"",
			`Use \`xcsh://api-catalog/\` to see all ${summaries.length} categories.`,
			"",
		].join("\n");
	}

	const rows = matches.map(c => `| ${c.name} | ${c.displayName} | ${c.operationCount} |`);

	return [
		`# API Catalog — search: "${term}"`,
		"",
		`${matches.length} matching categories.`,
		"",
		"| Category | Display Name | Operations |",
		"|----------|--------------|------------|",
		...rows,
		"",
	].join("\n");
}

function sanitizeTableCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/\r/g, "");
}

function formatConstraints(constraints: Record<string, unknown> | undefined): string {
	if (!constraints) return "--";
	const parts: string[] = [];
	if (constraints.pattern) parts.push(`pattern: \`${constraints.pattern}\``);
	if (constraints.maxLength != null) parts.push(`maxLength: ${constraints.maxLength}`);
	if (constraints.minLength != null) parts.push(`minLength: ${constraints.minLength}`);
	if (constraints.minimum != null) parts.push(`min: ${constraints.minimum}`);
	if (constraints.maximum != null) parts.push(`max: ${constraints.maximum}`);
	if (constraints.minItems != null) parts.push(`minItems: ${constraints.minItems}`);
	if (constraints.maxItems != null) parts.push(`maxItems: ${constraints.maxItems}`);
	if (constraints.format) parts.push(`format: ${constraints.format}`);
	if (Array.isArray(constraints.enum)) parts.push(`enum: ${constraints.enum.join(", ")}`);
	return parts.length > 0 ? parts.join(", ") : "--";
}

function formatRequiredFor(
	reqFor: { minimum_config?: boolean; create?: boolean; update?: boolean; read?: boolean } | undefined,
): string {
	if (!reqFor) return "--";
	const ops: string[] = [];
	if (reqFor.minimum_config) ops.push("minimum_config");
	if (reqFor.create) ops.push("create");
	if (reqFor.update) ops.push("update");
	if (reqFor.read) ops.push("read");
	return ops.length > 0 ? ops.join(", ") : "--";
}

function fieldMetadataFingerprint(metadata: Record<string, unknown>): string {
	return JSON.stringify(metadata, (key, value) => {
		if (key === "validatedAt" || key === "confidence" || key === "source") return undefined;
		return value;
	});
}

function formatDefault(defaultVal: unknown, serverDefault: boolean | undefined): string {
	if (defaultVal == null && !serverDefault) return "--";
	let val = "--";
	if (defaultVal != null) {
		val = typeof defaultVal === "object" ? JSON.stringify(defaultVal) : String(defaultVal);
	}
	return serverDefault ? `${val} (server)` : val;
}

function renderCatalogDetail(cat: ApiCatalogCategory, index: ApiCatalogIndex, options?: { compact?: boolean }): string {
	const sections: string[] = [`# ${cat.displayName}`, "", `${cat.operations.length} operations.`];
	let fieldConstraintsRenderedForOp: string | null = null;
	let fieldConstraintsFingerprint: string | null = null;

	for (const op of cat.operations) {
		sections.push("", `## ${op.method.toUpperCase()} ${op.path}`, "");
		sections.push(op.description);
		sections.push(`Danger level: ${op.dangerLevel}`);

		if (op.parameters.length > 0) {
			sections.push("", "### Parameters", "");
			sections.push("| Name | In | Required | Type | Default |");
			sections.push("|------|-----|----------|------|---------|");
			for (const p of op.parameters) {
				sections.push(`| ${p.name} | ${p.in} | ${p.required ? "yes" : "no"} | ${p.type} | ${p.default ?? ""} |`);
			}
		}

		if (!op.minimumPayload && op.bodySchema) {
			const minConfig = (op.bodySchema as Record<string, unknown>)["x-f5xc-minimum-configuration"] as
				| Record<string, unknown>
				| undefined;
			if (minConfig?.required_fields) {
				sections.push("", "### Minimum Configuration");
				sections.push(`Required fields: ${(minConfig.required_fields as string[]).join(", ")}`);
			}
		}

		sections.push("", "### Curl Example", "", "```bash");
		const tokenVar = `$${index.auth.tokenSource}`;
		const authHeader = `${index.auth.headerName}: ${index.auth.headerTemplate.replace("$TOKEN", tokenVar).replace("{token}", tokenVar)}`;
		sections.push(`curl -X ${op.method.toUpperCase()} "$${index.auth.baseUrlSource}${op.path}" \\`);
		sections.push(`  -H "${authHeader}" \\`);
		if (op.method.toUpperCase() !== "GET" && op.method.toUpperCase() !== "DELETE") {
			sections.push('  -H "Content-Type: application/json" \\');
			sections.push("  -d @payload.json");
		} else {
			const lastLine = sections[sections.length - 1];
			sections[sections.length - 1] = lastLine.replace(/ \\$/, "");
		}
		sections.push("```");

		// Minimum Configuration (Tier 1)
		if (op.minimumPayload) {
			sections.push("", "### Minimum Configuration", "");
			sections.push(`Required fields: ${op.minimumPayload.requiredFields.join(", ")}`);
			sections.push("", "```json", JSON.stringify(op.minimumPayload.json, null, 2), "```");
		}

		// Field Constraints (Tier 2) — skipped in compact mode, deduped when identical across operations
		if (op.fieldMetadata && Object.keys(op.fieldMetadata).length > 0 && !options?.compact) {
			const currentFingerprint = fieldMetadataFingerprint(op.fieldMetadata as Record<string, unknown>);
			if (fieldConstraintsRenderedForOp && currentFingerprint === fieldConstraintsFingerprint) {
				sections.push("", "### Field Constraints");
				sections.push(`Same as ${fieldConstraintsRenderedForOp} — see above.`, "");
			} else {
				fieldConstraintsRenderedForOp = `${op.method.toUpperCase()} ${op.path}`;
				fieldConstraintsFingerprint = currentFingerprint;
				sections.push("", "### Field Constraints", "");
				sections.push("| Field | Type | Description | Constraint | Required For | Default |");
				sections.push("|-------|------|-------------|-----------|--------------|---------|");
				for (const [field, meta] of Object.entries(op.fieldMetadata)) {
					const desc = sanitizeTableCell(meta.description ?? "");
					const constraint = sanitizeTableCell(formatConstraints(meta.constraints));
					const reqFor = formatRequiredFor(meta.required_for);
					const def = sanitizeTableCell(formatDefault(meta.default, meta.serverDefault));
					sections.push(`| ${field} | ${meta.type} | ${desc} | ${constraint} | ${reqFor} | ${def} |`);
				}
			}
		}

		// OneOf Recommendations
		if (op.oneOfRecommendations && Object.keys(op.oneOfRecommendations).length > 0) {
			sections.push("", "### OneOf Recommendations", "");
			sections.push("| Path | Recommended Variant |");
			sections.push("|------|-------------------|");
			for (const [path, variant] of Object.entries(op.oneOfRecommendations)) {
				sections.push(`| ${path} | ${variant} |`);
			}
		}

		// Response Summary
		if (op.responseSummary && op.responseSummary.length > 0) {
			sections.push("", "### Response", "");
			sections.push("| Field | Type | Description |");
			sections.push("|-------|------|-------------|");
			for (const f of op.responseSummary) {
				sections.push(`| ${f.field} | ${f.type} | ${sanitizeTableCell(f.description)} |`);
			}
		}
	}

	sections.push("");
	return sections.join("\n");
}

function renderUnknownCategory(requested: string, summaries: readonly ApiCatalogCategorySummary[]): string {
	const suggestions = summaries
		.filter(c => {
			const norm = normalizeSearchTerm(requested);
			const normName = normalizeSearchTerm(c.name);
			return normName.includes(norm) || norm.includes(normName.slice(0, 4));
		})
		.slice(0, 5);

	const sections = [`# Category not found: ${requested}`, ""];
	if (suggestions.length > 0) {
		sections.push("Did you mean:", ...suggestions.map(c => `- \`${c.name}\` — ${c.displayName}`), "");
	}
	sections.push("Use `xcsh://api-catalog/` to see all categories.", "");
	return sections.join("\n");
}
