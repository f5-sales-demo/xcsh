import { parse as parseYaml } from "yaml";
import type { ConsoleCatalogData } from "./console-catalog-types";
import type { ConsoleFieldMeta, ConsoleFieldMetadataData } from "./console-field-metadata-types";
import { EMPTY_CONSOLE_FIELD_METADATA } from "./console-field-metadata-types";
import type { InternalResource, InternalUrl } from "./types";

export interface ConsoleResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

/**
 * Render the "Required fields & constraints" section for a resource from the
 * embedded console field registry (api-specs-enriched/console_field_metadata).
 * Keyed by the resource's snake_case API kind. Surfaces, per required field, the
 * console label + form section + widget + validation, plus mutually-exclusive
 * (OneOf) groups — so the agent knows exactly what a create form needs before
 * driving it. Returns "" when no metadata exists for the kind.
 */
function renderRequiredFields(apiKind: string | undefined, fieldMeta: ConsoleFieldMetadataData): string {
	if (!apiKind) return "";
	const fields = fieldMeta.resources[apiKind];
	if (!fields) return "";
	let required = Object.entries(fields).filter(([, m]) => (m as ConsoleFieldMeta).required === true);
	// Name is universally required (DNS-1035) even if a resource's metadata doesn't list it.
	if (!required.some(([k]) => k === "metadata.name")) {
		required = [
			[
				"metadata.name",
				{
					label: "Name",
					form_section: "metadata",
					required: true,
					widget_type: "textbox",
					validation: { pattern: "^[a-z][a-z0-9-]*[a-z0-9]$", max_length: 64 },
				} as ConsoleFieldMeta,
			],
			...required,
		];
	}
	const lines = [
		"",
		"## Required fields & constraints",
		"",
		"Every create **must** provide a value for each of these (ask the user if one is missing — do not rely on it having been mentioned):",
		"",
	];
	for (const [apiField, raw] of required) {
		const m = raw as ConsoleFieldMeta;
		const bits: string[] = [];
		if (m.widget_type) bits.push(`widget: ${m.widget_type}`);
		if (m.default !== undefined) bits.push(`default: ${JSON.stringify(m.default)}`);
		if (m.validation?.pattern) bits.push(`pattern: \`${m.validation.pattern}\``);
		if (typeof m.validation?.max_length === "number") bits.push(`maxLength: ${m.validation.max_length}`);
		if (Array.isArray(m.options) && m.options.length) bits.push(`options: ${m.options.join(" | ")}`);
		const section = m.form_section ? `, section: ${m.form_section}` : "";
		lines.push(
			`- **${m.label ?? apiField}** (\`${apiField}\`${section})${bits.length ? ` — ${bits.join("; ")}` : ""}`,
		);
		if (Array.isArray(m.mutually_exclusive_with) && m.mutually_exclusive_with.length) {
			lines.push(
				`  - choose exactly one of: \`${apiField}\`, ${m.mutually_exclusive_with.map(f => `\`${f}\``).join(", ")}`,
			);
		}
	}
	lines.push("");
	return lines.join("\n");
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

function operationsFor(resource: string, catalog: ConsoleCatalogData): string[] {
	const prefix = `${resource}/`;
	return Object.keys(catalog.workflows)
		.filter(k => k.startsWith(prefix))
		.map(k => k.slice(prefix.length));
}

const normKey = (s: string): string => s.toLowerCase().replace(/[-_\s]+/g, "");

export function canonicalizeResource(name: string, catalog: ConsoleCatalogData): string | null {
	const target = normKey(name);
	const keys = Object.keys(catalog.resources);
	// exact-normalized match first
	let hit = keys.find(k => normKey(k) === target);
	if (hit) return hit;
	// tolerate trailing plural 's'
	const singular = target.replace(/s$/, "");
	hit = keys.find(k => normKey(k) === singular || normKey(k).replace(/s$/, "") === target);
	return hit ?? null;
}

function renderIndex(catalog: ConsoleCatalogData): string {
	const lines = [`# F5 XC Console Catalogue (v${catalog.version})`, "", "## Resources", ""];
	for (const id of Object.keys(catalog.resources).sort()) {
		const ops = operationsFor(id, catalog);
		lines.push(`- \`xcsh://console/${id}\`${ops.length ? ` — operations: ${ops.join(", ")}` : ""}`);
	}
	return `${lines.join("\n")}\n`;
}

function renderResource(resource: string, catalog: ConsoleCatalogData, fieldMeta: ConsoleFieldMetadataData): string {
	const key = canonicalizeResource(resource, catalog) ?? resource;
	const raw = catalog.resources[key];
	if (!raw) {
		const available = Object.keys(catalog.resources)
			.sort()
			.map(id => {
				const ops = operationsFor(id, catalog);
				return `- \`${id}\`${ops.length ? ` (${ops.join(", ")})` : ""}`;
			});
		return `# Unknown console resource: ${resource}\n\n## Available resources\n\n${available.join("\n")}\n`;
	}
	const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
	const console_ = (doc.console ?? {}) as Record<string, unknown>;
	const lines = [`# ${(doc.label as string | undefined) ?? key}`, ""];
	if (console_.route_pattern) {
		const fullRoute = console_.route_prefix
			? `${console_.route_prefix}${console_.route_pattern}`
			: console_.route_pattern;
		lines.push(`**Route:** \`${fullRoute}\``, "");
	}
	if (Array.isArray(console_.menu_path)) lines.push(`**Menu:** ${(console_.menu_path as string[]).join(" › ")}`, "");
	const ops = operationsFor(key, catalog);
	if (ops.length) {
		lines.push("## Operations", "");
		for (const op of ops) lines.push(`- \`xcsh://console/${key}/${op}\` (${op})`);
	}
	// Required fields & constraints, keyed by the resource's API kind.
	const apiKind = ((doc.api as Record<string, unknown> | undefined)?.kind as string | undefined) ?? undefined;
	lines.push(renderRequiredFields(apiKind, fieldMeta));
	return `${lines.join("\n")}\n`;
}

function renderWorkflow(resource: string, operation: string, catalog: ConsoleCatalogData): string {
	const key = canonicalizeResource(resource, catalog) ?? resource;
	const raw = catalog.workflows[`${key}/${operation}`];
	if (!raw) {
		const ops = operationsFor(key, catalog);
		const opsList = ops.length
			? `\n\n## Available operations for \`${key}\`\n\n${ops.map(op => `- \`${op}\``).join("\n")}`
			: "";
		return `# No console workflow for ${key}/${operation}${opsList}\n`;
	}
	const doc = (parseYaml(raw) ?? {}) as Record<string, unknown>;
	const steps = Array.isArray(doc.steps) ? (doc.steps as Record<string, unknown>[]) : [];
	const lines = [`# ${(doc.label as string | undefined) ?? `${key} ${operation}`}`, "", "## Steps", ""];
	for (const s of steps) {
		const sel = s.selector ? ` \`${s.selector}\`` : "";
		const val = s.value != null ? ` = ${JSON.stringify(s.value)}` : "";
		lines.push(
			`1. **${s.action}**${sel}${val} — ${(s.description as string | undefined) ?? (s.id as string | undefined) ?? ""}`,
		);
	}
	return `${lines.join("\n")}\n`;
}

export function createConsoleResolver(
	catalog: ConsoleCatalogData,
	fieldMeta: ConsoleFieldMetadataData = EMPTY_CONSOLE_FIELD_METADATA,
): ConsoleResolver {
	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = (url.rawPathname ?? url.pathname).replace(/^\//, "").replace(/\/$/, "");
			if (!pathname) return makeResource(url, renderIndex(catalog));
			const [resource, operation] = pathname.split("/");
			if (operation) return makeResource(url, renderWorkflow(resource, operation, catalog));
			return makeResource(url, renderResource(resource, catalog, fieldMeta));
		},
	};
}
