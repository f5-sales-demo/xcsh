import { parse as parseYaml } from "yaml";
import type { ConsoleCatalogData } from "./console-catalog-types";
import type { InternalResource, InternalUrl } from "./types";

export interface ConsoleResolver {
	resolve(url: InternalUrl): Promise<InternalResource>;
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

function renderResource(resource: string, catalog: ConsoleCatalogData): string {
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
	if (console_.route_pattern) lines.push(`**Route:** \`${console_.route_pattern}\``, "");
	if (Array.isArray(console_.menu_path)) lines.push(`**Menu:** ${(console_.menu_path as string[]).join(" › ")}`, "");
	const ops = operationsFor(key, catalog);
	if (ops.length) {
		lines.push("## Operations", "");
		for (const op of ops) lines.push(`- \`xcsh://console/${key}/${op}\` (${op})`);
	}
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

export function createConsoleResolver(catalog: ConsoleCatalogData): ConsoleResolver {
	return {
		async resolve(url: InternalUrl): Promise<InternalResource> {
			const pathname = (url.rawPathname ?? url.pathname).replace(/^\//, "").replace(/\/$/, "");
			if (!pathname) return makeResource(url, renderIndex(catalog));
			const [resource, operation] = pathname.split("/");
			if (operation) return makeResource(url, renderWorkflow(resource, operation, catalog));
			return makeResource(url, renderResource(resource, catalog));
		},
	};
}
