import type { InternalResource, InternalUrl } from "./types";

const DEFAULT_PROVIDER_BASE_URL = "https://registry.terraform.io/v1/providers";
const DEFAULT_MODULE_BASE_URL = "https://registry.terraform.io/v1/modules";
const DEFAULT_TIMEOUT_MS = 10_000;
const SOURCE_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type RegistryFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RegistryResolverDeps {
	readonly fetch: RegistryFetch;
	readonly providerBaseUrl: string;
	readonly moduleBaseUrl: string;
	readonly timeoutMs: number;
}

interface ProviderVersion {
	readonly version: string;
	readonly protocols?: readonly string[];
	readonly platforms?: readonly { readonly os: string; readonly arch: string }[];
}

interface ModuleMetadata {
	readonly id?: string;
	readonly namespace: string;
	readonly name: string;
	readonly provider: string;
	readonly version: string;
	readonly description?: string;
	readonly source?: string;
	readonly verified?: boolean;
}

type RegistryRoute =
	| { readonly kind: "provider"; readonly namespace: string; readonly type: string }
	| { readonly kind: "module"; readonly namespace: string; readonly name: string; readonly provider: string };

function routeHelp(): string {
	return "Expected xcsh://registry/provider/<namespace>/<type> or xcsh://registry/module/<namespace>/<name>/<provider>";
}

function parseRoute(url: InternalUrl): RegistryRoute {
	const rawPath = url.rawPathname ?? url.pathname;
	const segments = rawPath.startsWith("/") ? rawPath.slice(1).split("/") : rawPath.split("/");
	if (segments[0] === "provider" && segments.length === 3) {
		const [, namespace, type] = segments;
		if (namespace && type) return validateRoute({ kind: "provider", namespace, type });
	}
	if (segments[0] === "module" && segments.length === 4) {
		const [, namespace, name, provider] = segments;
		if (namespace && name && provider) return validateRoute({ kind: "module", namespace, name, provider });
	}
	throw new Error(routeHelp());
}

function validateRoute(route: RegistryRoute): RegistryRoute {
	const names =
		route.kind === "provider" ? [route.namespace, route.type] : [route.namespace, route.name, route.provider];
	for (const name of names) {
		if (!SOURCE_NAME.test(name)) {
			throw new Error(
				`Invalid Terraform Registry source name "${name}": use lowercase ASCII letters, digits, and hyphens`,
			);
		}
	}
	return route;
}

function markdownResource(url: InternalUrl, content: string): InternalResource {
	return {
		url: url.href,
		content,
		contentType: "text/markdown",
		size: Buffer.byteLength(content, "utf-8"),
		sourcePath: url.href,
	};
}

function providerVersions(value: unknown): readonly ProviderVersion[] | null {
	if (typeof value !== "object" || value === null) return null;
	const versions = (value as { versions?: unknown }).versions;
	if (!Array.isArray(versions)) return null;
	for (const entry of versions) {
		if (typeof entry !== "object" || entry === null || typeof (entry as { version?: unknown }).version !== "string") {
			return null;
		}
	}
	return versions as ProviderVersion[];
}

function moduleMetadata(value: unknown): ModuleMetadata | null {
	if (typeof value !== "object" || value === null) return null;
	const item = value as Record<string, unknown>;
	for (const key of ["namespace", "name", "provider", "version"] as const) {
		if (typeof item[key] !== "string" || item[key].length === 0) return null;
	}
	return item as unknown as ModuleMetadata;
}

function renderProvider(namespace: string, type: string, versions: readonly ProviderVersion[]): string {
	const lines = [
		`# Terraform provider: ${namespace}/${type}`,
		"",
		`Source: \`${namespace}/${type}\``,
		`Available versions: ${versions.length}`,
		"",
		"| Version | Protocols | Platforms |",
		"|---------|-----------|-----------|",
	];
	for (const entry of versions) {
		const protocols = Array.isArray(entry.protocols) ? entry.protocols.join(", ") : "not advertised";
		const platforms = Array.isArray(entry.platforms)
			? entry.platforms
					.filter(platform => typeof platform?.os === "string" && typeof platform?.arch === "string")
					.map(platform => `${platform.os}/${platform.arch}`)
					.join(", ")
			: "not advertised";
		lines.push(`| ${entry.version} | ${protocols || "not advertised"} | ${platforms || "not advertised"} |`);
	}
	return lines.join("\n");
}

function renderModule(metadata: ModuleMetadata): string {
	const address = `${metadata.namespace}/${metadata.name}/${metadata.provider}`;
	const lines = [
		`# Terraform module: ${address}`,
		"",
		`Source: \`${address}\``,
		`Latest version: ${metadata.version}`,
		`Verified: ${metadata.verified === true ? "yes" : "no"}`,
	];
	if (metadata.description) lines.push(`Description: ${metadata.description}`);
	if (metadata.source) lines.push(`Repository: ${metadata.source}`);
	return lines.join("\n");
}

function failure(route: RegistryRoute, heading: string, detail: string): string {
	const address =
		route.kind === "provider"
			? `${route.namespace}/${route.type}`
			: `${route.namespace}/${route.name}/${route.provider}`;
	return `# ${heading}\n\nRegistry address: \`${address}\`\n\n${detail}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class RegistryResolver {
	readonly #deps: RegistryResolverDeps;

	constructor(deps: RegistryResolverDeps) {
		this.#deps = deps;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const route = parseRoute(url);
		const address =
			route.kind === "provider"
				? `${route.namespace}/${route.type}/versions`
				: `${route.namespace}/${route.name}/${route.provider}`;
		const baseUrl = route.kind === "provider" ? this.#deps.providerBaseUrl : this.#deps.moduleBaseUrl;
		const requestUrl = `${baseUrl.replace(/\/+$/, "")}/${address}`;

		try {
			const response = await this.#deps.fetch(requestUrl, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(this.#deps.timeoutMs),
			});
			if (response.status === 404) {
				const kind = route.kind === "provider" ? "Provider" : "Module";
				return markdownResource(
					url,
					failure(
						route,
						`${kind} not found`,
						`Verify the namespace and ${route.kind === "provider" ? "type" : "name/provider"}, then retry the exact lookup.`,
					),
				);
			}
			if (!response.ok) {
				return markdownResource(
					url,
					failure(
						route,
						"Terraform Registry request failed",
						`The Registry returned HTTP ${response.status}. Try the lookup again; if it persists, verify Registry availability.`,
					),
				);
			}

			let data: unknown;
			try {
				data = await response.json();
			} catch {
				return markdownResource(
					url,
					failure(
						route,
						"Terraform Registry invalid response",
						"The Registry did not return valid JSON. No version or metadata was inferred.",
					),
				);
			}

			if (route.kind === "provider") {
				const versions = providerVersions(data);
				if (!versions) {
					return markdownResource(
						url,
						failure(
							route,
							"Terraform Registry invalid response",
							"The provider response did not contain documented version entries. No version was inferred.",
						),
					);
				}
				return markdownResource(url, renderProvider(route.namespace, route.type, versions));
			}

			const metadata = moduleMetadata(data);
			if (!metadata) {
				return markdownResource(
					url,
					failure(
						route,
						"Terraform Registry invalid response",
						"The module response omitted required metadata. No module arguments were inferred.",
					),
				);
			}
			return markdownResource(url, renderModule(metadata));
		} catch (error) {
			const timedOut =
				error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
			return markdownResource(
				url,
				failure(
					route,
					timedOut ? "Terraform Registry request timed out" : "Terraform Registry request failed",
					timedOut
						? `The lookup timed out after ${this.#deps.timeoutMs} ms. Try the lookup again or verify network access to the Registry.`
						: `Network error: ${errorMessage(error)}. Verify connectivity to the Registry and retry the exact lookup.`,
				),
			);
		}
	}
}

export function createRegistryResolver(deps: Partial<RegistryResolverDeps> = {}): RegistryResolver {
	return new RegistryResolver({
		fetch: deps.fetch ?? globalThis.fetch,
		providerBaseUrl: deps.providerBaseUrl ?? DEFAULT_PROVIDER_BASE_URL,
		moduleBaseUrl: deps.moduleBaseUrl ?? DEFAULT_MODULE_BASE_URL,
		timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
	});
}
