import { gunzipSync } from "node:zlib";
import { LRUCache } from "lru-cache";
import type { ApiCatalogCategory, ApiCatalogCategorySummary, ApiCatalogIndex } from "./api-catalog-types";
import type { InternalResource, InternalUrl } from "./types";

const LRU_CAPACITY = 5;

export interface ApiCatalogResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

export function createApiCatalogResolver(
	index: ApiCatalogIndex,
	categorySummaries: readonly ApiCatalogCategorySummary[],
	blobs: Record<string, string>,
): ApiCatalogResolver {
	const cache = new LRUCache<string, ApiCatalogCategory>({ max: LRU_CAPACITY });

	function decompress(category: string): ApiCatalogCategory {
		const cached = cache.get(category);
		if (cached) return cached;

		const blob = blobs[category];
		if (!blob) throw new Error(`No catalog blob for category: ${category}`);

		const buffer = Buffer.from(blob, "base64");
		const decompressed = gunzipSync(buffer);
		const cat = JSON.parse(decompressed.toString("utf-8")) as ApiCatalogCategory;
		cache.set(category, cat);
		return cat;
	}

	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = url.rawPathname ?? url.pathname;
			const category = pathname.replace(/^\//, "").replace(/\/$/, "");
			const search = url.searchParams.get("search");

			if (!category) {
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
				const cat = decompress(category);
				return makeResource(url, renderCatalogDetail(cat, index));
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
	const lower = term.toLowerCase();
	const matches = summaries.filter(
		c => c.name.toLowerCase().includes(lower) || c.displayName.toLowerCase().includes(lower),
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

function renderCatalogDetail(cat: ApiCatalogCategory, index: ApiCatalogIndex): string {
	const sections: string[] = [`# ${cat.displayName}`, "", `${cat.operations.length} operations.`];

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

		if (op.bodySchema) {
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
	}

	sections.push("");
	return sections.join("\n");
}

function renderUnknownCategory(requested: string, summaries: readonly ApiCatalogCategorySummary[]): string {
	const suggestions = summaries
		.filter(c => c.name.includes(requested) || requested.includes(c.name.slice(0, 4)))
		.slice(0, 5);

	const sections = [`# Category not found: ${requested}`, ""];
	if (suggestions.length > 0) {
		sections.push("Did you mean:", ...suggestions.map(c => `- \`${c.name}\` — ${c.displayName}`), "");
	}
	sections.push("Use `xcsh://api-catalog/` to see all categories.", "");
	return sections.join("\n");
}
