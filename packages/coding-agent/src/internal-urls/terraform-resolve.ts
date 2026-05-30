import type { TerraformCategory, TerraformIndex, TerraformResource } from "./terraform-types";
import type { InternalResource, InternalUrl } from "./types";

export interface TerraformResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
}

export function createTerraformResolver(index: TerraformIndex): TerraformResolver {
	const categoryBySlug = new Map<string, TerraformCategory>();
	for (const cat of index.categories) {
		categoryBySlug.set(cat.slug, cat);
	}

	const resourceToCategory = new Map<string, string>();
	for (const cat of index.categories) {
		for (const resName of cat.resources) {
			resourceToCategory.set(resName, cat.slug);
		}
	}

	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = (url.rawPathname ?? url.pathname).replace(/^\/+/, "").replace(/\/+$/, "");

			if (!pathname) {
				return makeResource(url, renderL0(index));
			}

			const parts = pathname.split("/");

			if (parts.length === 1) {
				const slug = parts[0]!;

				const cat = categoryBySlug.get(slug);
				if (cat) return makeResource(url, renderL1(cat, index.resources));

				const res = index.resources[slug];
				if (res) {
					const catSlug = resourceToCategory.get(slug) ?? "";
					return makeResource(url, renderL2(slug, res, catSlug));
				}

				return makeResource(url, renderUnknown(slug, index));
			}

			if (parts.length === 2) {
				const resourceName = parts[1]!;
				const res = index.resources[resourceName];
				if (res) {
					const realCategory = resourceToCategory.get(resourceName) ?? parts[0]!;
					return makeResource(url, renderL2(resourceName, res, realCategory));
				}
				return makeResource(url, renderUnknown(resourceName, index));
			}

			return makeResource(url, renderUnknown(pathname, index));
		},
	};
}

function makeResource(url: InternalUrl, content: string): InternalResource {
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		sourcePath: `xcsh://terraform${url.rawPathname ?? "/"}`,
	};
}

function renderL0(index: TerraformIndex): string {
	const lines = [
		`# F5 Distributed Cloud Terraform Provider (v${index.version})`,
		"",
		`> Source: \`${index.provider.source}\` | Registry: ${index.provider.registry}`,
		"",
		"## Required Block",
		"",
		"```hcl",
		index.provider.required_block,
		"```",
		"",
		"## Syntax Rules",
		"",
		...index.provider.syntax_rules.map(r => `- ${r}`),
		"",
		"## Resource Categories",
		"",
		`${index.categories.length} categories. Read \`xcsh://terraform/{slug}\` for resource list.`,
		"",
		"| Category | Resources | Description |",
		"|----------|-----------|-------------|",
		...index.categories.map(c => `| ${c.name} | ${c.resource_count} | ${c.description} |`),
		"",
		"## Quick Reference",
		"",
		"Common resources — output these in ```terraform code blocks:",
		"",
		"- `f5xc_http_loadbalancer`: name, namespace, domains, advertise_on_public_default_vip {}",
		'- `f5xc_origin_pool`: name, namespace, port, origin_servers { public_ip { ip = "x.x.x.x" } }',
		'- `f5xc_healthcheck`: name, namespace, http_health_check { path = "/healthz" }, timeout, interval, unhealthy_threshold, healthy_threshold',
		"- `f5xc_app_firewall`: name, namespace, blocking {}",
		"- `f5xc_service_policy`: name, namespace, rule_list { rules { ... } }, any_server {}",
		"- `f5xc_namespace`: name",
		"",
		"Import: `terraform import f5xc_{type}.example namespace/name`",
		"",
	];
	return lines.join("\n");
}

function renderL1(cat: TerraformCategory, allResources: Readonly<Record<string, TerraformResource>>): string {
	const lines = [
		`# ${cat.name}`,
		"",
		cat.description,
		"",
		"## Resources",
		"",
		`Read \`xcsh://terraform/${cat.slug}/{resource}\` for full details.`,
		"",
	];

	for (const name of cat.resources) {
		const res = allResources[name];
		const desc = res ? truncateAt(res.description, 80) : "";
		lines.push(`- **${name}** — ${desc}`);
	}

	if (cat.dependency_chain) {
		lines.push("", "## Dependency Chain", "", cat.dependency_chain);
	}

	lines.push("");
	return lines.join("\n");
}

function renderL2(name: string, res: TerraformResource, categorySlug: string): string {
	const lines = [
		`# f5xc_${name}`,
		"",
		`Category: ${res.category} | \`xcsh://terraform/${categorySlug}\``,
		"",
		res.description,
		"",
	];

	if (res.required.length > 0) {
		lines.push("## Required", "");
		for (const f of res.required) lines.push(`- ${f}`);
		lines.push("");
	}

	if (res.oneof_groups && res.oneof_groups.length > 0) {
		lines.push("## OneOf Groups", "");
		for (const g of res.oneof_groups) {
			if (g.parent) {
				lines.push(`Within ${g.parent}, pick exactly one:`);
			} else {
				lines.push("Pick exactly one:");
			}
			for (const f of g.fields) lines.push(`  ${f}`);
			lines.push("");
		}
	}

	if (res.server_defaults && res.server_defaults.length > 0) {
		lines.push("## Server Defaults (safe to omit)", "");
		for (const f of res.server_defaults) lines.push(`- ${f}`);
		lines.push("");
	}

	if (res.minimal_config) {
		lines.push("## Minimal Valid Config", "", "```terraform", res.minimal_config, "```", "");
	}

	lines.push("## Dependencies", "");
	if (res.dependencies.requires.length > 0) {
		lines.push(`Requires: ${res.dependencies.requires.join(", ")}`);
	} else {
		lines.push("Requires: none");
	}
	if (res.dependencies.used_by && res.dependencies.used_by.length > 0) {
		lines.push(`Used by: ${res.dependencies.used_by.join(", ")}`);
	}
	lines.push("");

	lines.push("## Import", "", `\`${res.import_syntax}\``, "");

	return lines.join("\n");
}

function renderUnknown(query: string, index: TerraformIndex): string {
	const allNames = Object.keys(index.resources);
	const matches = allNames.filter(n => n.includes(query)).slice(0, 5);
	const suggestion =
		matches.length > 0 ? `\nDid you mean: ${matches.join(", ")}` : "\nUse `xcsh://terraform/` to list categories.";
	return `# Not found: ${query}\n${suggestion}\n`;
}

function truncateAt(s: string, maxLen: number): string {
	if (s.length <= maxLen) return s;
	const cut = s.lastIndexOf(" ", maxLen - 3);
	return `${s.slice(0, cut > 0 ? cut : maxLen - 3)}...`;
}
