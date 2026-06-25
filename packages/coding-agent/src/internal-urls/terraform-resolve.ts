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
		"## Provider Configuration (REQUIRED)",
		"",
		'Every generated `.tf` MUST contain BOTH the `terraform {}` block and the `provider "xcsh" {}` block below.',
		'Omitting the provider block causes `terraform plan` to fail with "Provider requires explicit configuration. Add a provider block".',
		"",
		"```hcl",
		`${index.provider.required_block}\n\n${index.provider.config_block}`,
		"```",
		"",
		"## Authentication",
		"",
		...index.provider.auth_methods.map(m => `- ${m}`),
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
		"- `xcsh_http_loadbalancer`: name, namespace, domains, advertise_on_public_default_vip {}",
		'- `xcsh_origin_pool`: name, namespace, port, origin_servers { public_ip { ip = "x.x.x.x" } }',
		'- `xcsh_healthcheck`: name, namespace, http_health_check { path = "/healthz" }, timeout, interval, unhealthy_threshold, healthy_threshold',
		"- `xcsh_app_firewall`: name, namespace, blocking {}",
		"- `xcsh_service_policy`: name, namespace, rule_list { rules { ... } }, any_server {}",
		"- `xcsh_certificate`: name, namespace, certificate_url, private_key { blindfold_secret_info { location } }",
		"- `xcsh_rate_limiter_policy`: name, namespace, any_server {}",
		'- `xcsh_api_definition`: name, namespace, swagger_specs = ["string:///..."]',
		"- `xcsh_namespace`: name",
		"",
		"Import: `terraform import xcsh_{type}.example namespace/name`",
		'Cross-refs use blocks: `app_firewall { name = "x" namespace = "y" }` not string refs.',
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

function renderL2(name: string, res: TerraformResource, _categorySlug: string): string {
	const lines = [`# xcsh_${name}`, "", res.description, "", `Required: ${res.required.join(", ") || "none"}`];

	if (res.oneof_groups && res.oneof_groups.length > 0) {
		const groups = res.oneof_groups.filter(g => !g.parent).map(g => g.fields.join(" | "));
		if (groups.length > 0) {
			lines.push("", "OneOf (pick one per group, use empty block `field {}`):");
			for (const g of groups) lines.push(`- ${g}`);
		}
	}

	if (res.minimal_config) {
		lines.push("", "## Config", "", "```terraform", res.minimal_config, "```");
	}

	lines.push("", `Import: \`${res.import_syntax}\``);
	if (res.dependencies.requires.length > 0) {
		lines.push(`Depends on: ${res.dependencies.requires.join(", ")}`);
	}
	lines.push("");
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
