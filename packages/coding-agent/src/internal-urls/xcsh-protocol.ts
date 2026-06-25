/**
 * Protocol handler for xcsh:// URLs.
 *
 * Serves statically embedded documentation files bundled at build time,
 * plus the runtime-resolved `about` identity doc.
 *
 * URL forms:
 * - xcsh:// - Lists all available documentation files
 * - xcsh://<file>.md - Reads a specific documentation file
 * - xcsh://about - Identity fingerprint (version, commit, branch, repo)
 * - xcsh://api-spec/ - API specification index
 * - xcsh://api-spec/{domain} - Domain detail
 * - xcsh://api-spec/{domain}?resource={name} - Resource spec
 * - xcsh://api-spec/workflows/ - Guided API workflows
 * - xcsh://api-spec/errors/ - Error resolution
 * - xcsh://api-spec/glossary/ - Acronym glossary
 * - xcsh://api-catalog/ - API operation catalog
 * - xcsh://api-catalog/{category} - Category operations with curl templates
 * - xcsh://terraform/ - Terraform provider index
 * - xcsh://terraform/{category} - Category resource list
 * - xcsh://terraform/{category}/{resource} - Self-contained resource doc
 * - xcsh://user - Human user profile
 * - xcsh://user?seed=true - Seed profile from sources and render
 *
 * Note: Salesforce context (xcsh://salesforce) has been extracted to the
 * salesforce plugin. See packages/salesforce/ for the standalone implementation.
 */
import * as path from "node:path";
import { logger } from "@f5xc-salesdemos/pi-utils";
import type { ContextStatus } from "../services/xcsh-context";
import { type ApiCatalogResolver, createApiCatalogResolver } from "./api-catalog-resolve";
import type { ApiCatalogCategory, ApiCatalogCategorySummary, ApiCatalogIndex } from "./api-catalog-types";
import { type ApiSpecResolver, createApiSpecResolver } from "./api-spec-resolve";
import type {
	ApiSpecDomainEnrichments,
	ApiSpecIndex,
	ApiSpecValidationResourceEntry,
	OpenAPISpec,
} from "./api-spec-types";
import { getRuntimeBuildInfo, type RuntimeBuildInfo, renderAboutDoc } from "./build-info-runtime";
import { loadComputerProfile, renderComputerProfileMarkdown, seedComputerProfile } from "./computer-profile";
import { type ConsoleCatalogData, EMPTY_CONSOLE_CATALOG } from "./console-catalog-types";
import { type ConsoleFieldMetadataData, EMPTY_CONSOLE_FIELD_METADATA } from "./console-field-metadata-types";
import { type ConsoleResolver, createConsoleResolver } from "./console-resolve";
import { EMBEDDED_DOC_FILENAMES, EMBEDDED_DOCS } from "./docs-index.generated";
import { createTerraformResolver, type TerraformResolver } from "./terraform-resolve";
import type { TerraformIndex } from "./terraform-types";
import type { InternalResource, InternalUrl, ProtocolHandler } from "./types";
import { loadProfile, renderProfileMarkdown, seedProfile } from "./user-profile";

const SCHEME_PREFIX = "xcsh://";
const ABOUT_ROUTE = "about";
const API_SPEC_HOST = "api-spec";
const API_CATALOG_HOST = "api-catalog";
const BRANDING_HOST = "branding";
const TERRAFORM_HOST = "terraform";
const USER_ROUTE = "user";
const COMPUTER_ROUTE = "computer";
const CONSOLE_HOST = "console";
const EMPTY_INDEX: ApiSpecIndex = { version: "unavailable", timestamp: "", domains: [] };
const EMPTY_CATALOG_INDEX: ApiCatalogIndex = {
	version: "unavailable",
	displayName: "F5 Distributed Cloud",
	service: "xcsh",
	categoryCount: 0,
	auth: { type: "", headerName: "", headerTemplate: "", tokenSource: "", baseUrlSource: "" },
	defaults: {},
};

const EMPTY_TERRAFORM_INDEX: TerraformIndex = {
	version: "unavailable",
	provider: { source: "", registry: "", required_block: "", config_block: "", auth_methods: [], syntax_rules: [] },
	categories: [],
	resources: {},
};

let _terraformCache: { index: TerraformIndex } | null = null;

function loadTerraformIndex(): TerraformIndex {
	if (_terraformCache) return _terraformCache.index;
	try {
		const mod = require("./terraform-index.generated") as {
			TERRAFORM_INDEX?: TerraformIndex;
		};
		const index = mod.TERRAFORM_INDEX ?? EMPTY_TERRAFORM_INDEX;
		if (Object.keys(index.resources).length === 0) {
			logger.warn("terraform index loaded but contains 0 resources");
		}
		_terraformCache = { index };
	} catch (err) {
		logger.warn("terraform index unavailable, terraform protocol disabled", {
			error: err instanceof Error ? err.message : String(err),
		});
		_terraformCache = { index: EMPTY_TERRAFORM_INDEX };
	}
	return _terraformCache.index;
}

let _apiSpecCache: {
	index: ApiSpecIndex;
	data: Readonly<Record<string, OpenAPISpec>>;
	enrichments: Readonly<Record<string, ApiSpecDomainEnrichments>>;
	validationData: Readonly<Record<string, ApiSpecValidationResourceEntry>>;
	version: string;
} | null = null;

function loadApiSpecs(): {
	index: ApiSpecIndex;
	data: Readonly<Record<string, OpenAPISpec>>;
	enrichments: Readonly<Record<string, ApiSpecDomainEnrichments>>;
	validationData: Readonly<Record<string, ApiSpecValidationResourceEntry>>;
	version: string;
} {
	if (_apiSpecCache) return _apiSpecCache;
	try {
		const mod = require("./api-spec-index.generated") as {
			API_SPEC_INDEX?: ApiSpecIndex;
			API_SPEC_DATA?: Readonly<Record<string, unknown>>;
			API_SPEC_VERSION?: string;
			API_SPEC_ENRICHMENTS?: Readonly<Record<string, ApiSpecDomainEnrichments>>;
			API_VALIDATION_DATA?: Readonly<Record<string, ApiSpecValidationResourceEntry>>;
		};
		const index = mod.API_SPEC_INDEX ?? EMPTY_INDEX;
		const version = mod.API_SPEC_VERSION ?? "unknown";
		if (index.domains.length === 0) {
			logger.warn("api-spec index loaded but contains 0 domains");
		}
		_apiSpecCache = {
			index,
			data: (mod.API_SPEC_DATA ?? {}) as Readonly<Record<string, OpenAPISpec>>,
			enrichments: mod.API_SPEC_ENRICHMENTS ?? {},
			validationData: (mod.API_VALIDATION_DATA ?? {}) as Readonly<Record<string, ApiSpecValidationResourceEntry>>,
			version,
		};
	} catch (err) {
		logger.warn("api-spec index unavailable, embedded specs disabled", {
			error: err instanceof Error ? err.message : String(err),
		});
		_apiSpecCache = { index: EMPTY_INDEX, data: {}, enrichments: {}, validationData: {}, version: "unavailable" };
	}
	return _apiSpecCache;
}

let _apiCatalogCache: {
	index: ApiCatalogIndex;
	summaries: readonly ApiCatalogCategorySummary[];
	data: Readonly<Record<string, ApiCatalogCategory>>;
} | null = null;

function loadApiCatalog(): {
	index: ApiCatalogIndex;
	summaries: readonly ApiCatalogCategorySummary[];
	data: Readonly<Record<string, ApiCatalogCategory>>;
} {
	if (_apiCatalogCache) return _apiCatalogCache;
	try {
		const mod = require("./api-catalog-index.generated") as {
			API_CATALOG_INDEX?: ApiCatalogIndex;
			API_CATALOG_CATEGORY_SUMMARIES?: readonly ApiCatalogCategorySummary[];
			API_CATALOG_DATA?: Readonly<Record<string, ApiCatalogCategory>>;
		};
		const index = mod.API_CATALOG_INDEX ?? EMPTY_CATALOG_INDEX;
		const summaries = mod.API_CATALOG_CATEGORY_SUMMARIES ?? [];
		if (summaries.length === 0) {
			logger.warn("api-catalog index loaded but contains 0 categories");
		}
		_apiCatalogCache = {
			index,
			summaries,
			data: mod.API_CATALOG_DATA ?? {},
		};
	} catch (err) {
		logger.warn("api-catalog index unavailable, catalog disabled", {
			error: err instanceof Error ? err.message : String(err),
		});
		_apiCatalogCache = { index: EMPTY_CATALOG_INDEX, summaries: [], data: {} };
	}
	return _apiCatalogCache;
}

interface BrandingCanonicalEntry {
	long_form: string;
	description?: string;
	legacy_names?: string[];
	comparable_to?: string[];
}

interface BrandingDeprecationEntry {
	deprecated: Record<string, string>;
	canonical: Record<string, string>;
	required_providers_block?: string;
}

let _brandingCache: {
	version: string;
	canonical: Record<string, BrandingCanonicalEntry>;
	deprecations: Record<string, BrandingDeprecationEntry>;
	glossary: Record<string, Record<string, string>>;
	domain: Record<string, Record<string, string>>;
} | null = null;

function loadBranding(): {
	version: string;
	canonical: Record<string, BrandingCanonicalEntry>;
	deprecations: Record<string, BrandingDeprecationEntry>;
	glossary: Record<string, Record<string, string>>;
	domain: Record<string, Record<string, string>>;
} {
	if (_brandingCache) return _brandingCache;
	try {
		const mod = require("./branding-index.generated") as {
			BRANDING_VERSION?: string;
			BRANDING_CANONICAL?: Record<string, BrandingCanonicalEntry>;
			BRANDING_DEPRECATIONS?: Record<string, BrandingDeprecationEntry>;
			BRANDING_GLOSSARY?: Record<string, Record<string, string>>;
			BRANDING_DOMAIN?: Record<string, Record<string, string>>;
		};
		_brandingCache = {
			version: mod.BRANDING_VERSION ?? "unknown",
			canonical: (mod.BRANDING_CANONICAL ?? {}) as Record<string, BrandingCanonicalEntry>,
			deprecations: (mod.BRANDING_DEPRECATIONS ?? {}) as Record<string, BrandingDeprecationEntry>,
			glossary: mod.BRANDING_GLOSSARY ?? {},
			domain: mod.BRANDING_DOMAIN ?? {},
		};
	} catch (err) {
		logger.warn("branding index unavailable, branding protocol disabled", {
			error: err instanceof Error ? err.message : String(err),
		});
		_brandingCache = { version: "unavailable", canonical: {}, deprecations: {}, glossary: {}, domain: {} };
	}
	return _brandingCache;
}

let _consoleCatalogCache: ConsoleCatalogData | null = null;
function loadConsoleCatalog(): ConsoleCatalogData {
	if (_consoleCatalogCache) return _consoleCatalogCache;
	try {
		const mod = require("./console-catalog.generated") as { CONSOLE_CATALOG_DATA?: ConsoleCatalogData };
		_consoleCatalogCache = mod.CONSOLE_CATALOG_DATA ?? EMPTY_CONSOLE_CATALOG;
	} catch {
		_consoleCatalogCache = EMPTY_CONSOLE_CATALOG;
	}
	return _consoleCatalogCache;
}

let _consoleFieldMetaCache: ConsoleFieldMetadataData | null = null;
function loadConsoleFieldMetadata(): ConsoleFieldMetadataData {
	if (_consoleFieldMetaCache) return _consoleFieldMetaCache;
	try {
		const mod = require("./console-field-metadata.generated") as {
			CONSOLE_FIELD_METADATA?: ConsoleFieldMetadataData;
		};
		_consoleFieldMetaCache = mod.CONSOLE_FIELD_METADATA ?? EMPTY_CONSOLE_FIELD_METADATA;
	} catch {
		_consoleFieldMetaCache = EMPTY_CONSOLE_FIELD_METADATA;
	}
	return _consoleFieldMetaCache;
}

export interface InternalDocsProtocolOptions {
	readonly resolveBuildInfo?: () => Promise<RuntimeBuildInfo>;
	readonly getContextStatus?: () => ContextStatus | null;
	readonly apiSpecResolver?: ApiSpecResolver;
	readonly apiCatalogResolver?: ApiCatalogResolver;
}

export class InternalDocsProtocolHandler implements ProtocolHandler {
	readonly scheme = "xcsh";
	readonly #resolveBuildInfo: () => Promise<RuntimeBuildInfo>;
	readonly #getContextStatus: (() => ContextStatus | null) | undefined;
	#apiSpecResolver: ApiSpecResolver | null;
	#apiCatalogResolver: ApiCatalogResolver | null;
	#terraformResolver: TerraformResolver | null;
	#consoleResolver: ConsoleResolver | null = null;

	constructor(options: InternalDocsProtocolOptions = {}) {
		this.#resolveBuildInfo = options.resolveBuildInfo ?? getRuntimeBuildInfo;
		this.#getContextStatus = options.getContextStatus;
		this.#apiSpecResolver = options.apiSpecResolver ?? null;
		this.#apiCatalogResolver = options.apiCatalogResolver ?? null;
		this.#terraformResolver = null;
	}

	#getApiSpecResolver(): ApiSpecResolver {
		if (!this.#apiSpecResolver) {
			const specs = loadApiSpecs();
			this.#apiSpecResolver = createApiSpecResolver(
				specs.index,
				specs.data,
				specs.enrichments,
				specs.validationData,
			);
		}
		return this.#apiSpecResolver;
	}

	#getApiCatalogResolver(): ApiCatalogResolver {
		if (!this.#apiCatalogResolver) {
			const catalog = loadApiCatalog();
			const specs = loadApiSpecs();
			this.#apiCatalogResolver = createApiCatalogResolver(
				catalog.index,
				catalog.summaries,
				catalog.data,
				specs.index,
			);
		}
		return this.#apiCatalogResolver;
	}

	#getTerraformResolver(): TerraformResolver {
		if (!this.#terraformResolver) {
			this.#terraformResolver = createTerraformResolver(loadTerraformIndex());
		}
		return this.#terraformResolver;
	}

	#getConsoleResolver(): ConsoleResolver {
		if (!this.#consoleResolver) {
			this.#consoleResolver = createConsoleResolver(loadConsoleCatalog(), loadConsoleFieldMetadata());
		}
		return this.#consoleResolver;
	}

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const host = url.rawHost || url.hostname;

		if (host === API_SPEC_HOST) {
			return this.#getApiSpecResolver().resolve(url);
		}

		if (host === API_CATALOG_HOST) {
			return this.#getApiCatalogResolver().resolve(url);
		}

		if (host === CONSOLE_HOST) {
			return this.#getConsoleResolver().resolve(url);
		}

		if (host === TERRAFORM_HOST) {
			return this.#getTerraformResolver().resolve(url);
		}

		if (host === BRANDING_HOST) {
			return this.#resolveBranding(url);
		}

		if (host === USER_ROUTE) {
			return this.#resolveUserProfile(url);
		}

		if (host === COMPUTER_ROUTE) {
			return this.#resolveComputerProfile(url);
		}

		const pathname = url.rawPathname ?? url.pathname;
		const filename = host ? (pathname && pathname !== "/" ? host + pathname : host) : "";

		if (!filename) {
			return this.#listDocs(url);
		}

		return this.#readDoc(filename, url);
	}

	async #resolveUserProfile(url: InternalUrl): Promise<InternalResource> {
		const params = new URLSearchParams(url.search);
		const shouldSeed = params.get("seed") === "true";

		const profile = shouldSeed ? await seedProfile() : await loadProfile();
		const content = renderProfileMarkdown(profile);

		const hasOwnership = profile._fieldOwnership && Object.keys(profile._fieldOwnership).length > 0;
		const notes: string[] = [
			"This profile is the authoritative source for person data (manager, partner, territories, role).",
			"Do NOT query Salesforce or other services for fields that are already populated here.",
		];
		if (hasOwnership) {
			notes.push(
				`Fields owned by external sources: ${Object.entries(profile._fieldOwnership!)
					.map(([k, v]) => `${k} (${v})`)
					.join(", ")}. These are automatically kept in sync.`,
			);
		}

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `xcsh://${USER_ROUTE}`,
			notes,
		};
	}

	async #resolveComputerProfile(url: InternalUrl): Promise<InternalResource> {
		const params = new URLSearchParams(url.search);
		const shouldRefresh = params.get("refresh") === "true";

		const profile = shouldRefresh ? await seedComputerProfile() : await loadComputerProfile();
		const content = renderComputerProfileMarkdown(profile);

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `xcsh://${COMPUTER_ROUTE}`,
		};
	}

	async #listDocs(url: InternalUrl): Promise<InternalResource> {
		if (EMBEDDED_DOC_FILENAMES.length === 0) {
			throw new Error("No documentation files found");
		}

		const specs = loadApiSpecs();
		const catalog = loadApiCatalog();
		const branding = loadBranding();
		const syntheticEntry = `- [${ABOUT_ROUTE}](${SCHEME_PREFIX}${ABOUT_ROUTE}) — identity and build fingerprint`;
		const apiSpecEntry = `- [${API_SPEC_HOST}/](${SCHEME_PREFIX}${API_SPEC_HOST}/) — F5 XC API specifications (${specs.index.domains.length} domains, v${specs.version})`;
		const apiCatalogEntry = `- [${API_CATALOG_HOST}/](${SCHEME_PREFIX}${API_CATALOG_HOST}/) — F5 XC API operation catalog (${catalog.summaries.length} categories, v${catalog.index.version})`;
		const brandingEntry = `- [${BRANDING_HOST}](${SCHEME_PREFIX}${BRANDING_HOST}) — F5 XC branding and legacy name mapping (v${branding.version})`;
		const userEntry = `- [${USER_ROUTE}](${SCHEME_PREFIX}${USER_ROUTE}) — human user profile`;
		const computerEntry = `- [${COMPUTER_ROUTE}](${SCHEME_PREFIX}${COMPUTER_ROUTE}) — machine hardware and environment profile`;
		const tf = loadTerraformIndex();
		const terraformEntry = `- [${TERRAFORM_HOST}/](${SCHEME_PREFIX}${TERRAFORM_HOST}/) — F5 XC Terraform provider (${Object.keys(tf.resources).length} resources, v${tf.version})`;
		const listing = [
			syntheticEntry,
			apiSpecEntry,
			apiCatalogEntry,
			brandingEntry,
			terraformEntry,
			userEntry,
			computerEntry,
			...EMBEDDED_DOC_FILENAMES.map(f => `- [${f}](${SCHEME_PREFIX}${f})`),
		].join("\n");
		const totalCount = EMBEDDED_DOC_FILENAMES.length + 7;
		const content = `# Documentation\n\n${totalCount} files available:\n\n${listing}\n`;

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: SCHEME_PREFIX,
		};
	}

	#resolveBranding(url: InternalUrl): InternalResource {
		const subpath = (url.rawPathname ?? url.pathname).replace(/^\/+/, "").replace(/\/+$/, "");

		let content: string;

		if (!subpath || subpath === "/") {
			content = this.#brandingOverview();
		} else if (subpath === "terraform") {
			content = this.#brandingTerraform();
		} else if (subpath === "legacy") {
			content = this.#brandingLegacy();
		} else if (subpath === "volterra") {
			content = this.#brandingVolterra();
		} else {
			content = `Unknown branding path: ${subpath}\n\nAvailable paths:\n- xcsh://branding\n- xcsh://branding/terraform\n- xcsh://branding/legacy\n- xcsh://branding/volterra`;
		}

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `xcsh://branding${subpath ? `/${subpath}` : ""}`,
		};
	}

	#brandingOverview(): string {
		const { version, canonical, deprecations } = loadBranding();
		const lines = [`# F5 Distributed Cloud Branding (v${version})`, "", "## Product Names (Current API)", ""];

		for (const [key, value] of Object.entries(canonical)) {
			lines.push(`### ${value.long_form}`);
			lines.push(`- API identifier: \`${key}\``);
			if (value.legacy_names?.length) {
				lines.push(`- Legacy names: ${value.legacy_names.join(", ")}`);
			}
			if (value.comparable_to?.length) {
				lines.push(`- Comparable to: ${value.comparable_to.join(", ")}`);
			}
			lines.push("");
		}

		lines.push("## Deprecated Tooling", "");

		for (const [key, dep] of Object.entries(deprecations)) {
			lines.push(`### ${key}`);
			lines.push(`- **Deprecated**: ${dep.deprecated.registry ?? dep.deprecated.url ?? dep.deprecated.note ?? ""}`);
			lines.push(`- **Use instead**: ${dep.canonical.registry ?? dep.canonical.url ?? dep.canonical.note ?? ""}`);
			lines.push("");
		}

		lines.push(
			"## Subpaths",
			"- `xcsh://branding/terraform` — Terraform provider override details",
			"- `xcsh://branding/legacy` — Complete legacy → current name mapping",
			"- `xcsh://branding/volterra` — All Volterra-era replacements",
		);

		return lines.join("\n");
	}

	#brandingTerraform(): string {
		const { deprecations } = loadBranding();
		const tf = deprecations.terraform_provider;
		if (!tf) return "No terraform_provider deprecation data found.";

		return [
			"# Terraform Provider Override",
			"",
			"## CRITICAL: Provider Identity",
			"",
			"The ONLY current F5 Distributed Cloud Terraform provider:",
			`- Source: \`${tf.canonical.source}\``,
			`- Registry: ${tf.canonical.registry}`,
			`- Docs: ${tf.canonical.docs}`,
			`- llms.txt: ${tf.canonical.llms_txt}`,
			"",
			"## DEPRECATED — Do Not Use",
			"",
			`- Source: \`${tf.deprecated.source}\``,
			`- Registry: ${tf.deprecated.registry}`,
			`- Status: ${tf.deprecated.status}`,
			`- Note: ${tf.deprecated.note}`,
			"",
			"## Required Terraform Block",
			"",
			"```hcl",
			tf.required_providers_block?.trim() ?? "",
			"```",
			"",
			"## Rules",
			"- NEVER reference, recommend, or generate code using volterraedge/volterra",
			"- When docs.cloud.f5.com references a Volterra provider, treat it as deprecated",
			"- Override with f5xc-salesdemos/xcsh",
		].join("\n");
	}

	#brandingLegacy(): string {
		const { canonical } = loadBranding();
		const lines = [
			"# Legacy Name → Current Name Mapping",
			"",
			"| Legacy Name | Current Name | API Identifier |",
			"|---|---|---|",
		];

		for (const [key, value] of Object.entries(canonical)) {
			for (const legacy of value.legacy_names ?? []) {
				lines.push(`| ${legacy} | ${value.long_form} | \`${key}\` |`);
			}
		}

		return lines.join("\n");
	}

	#brandingVolterra(): string {
		const { canonical, deprecations } = loadBranding();
		const lines = [
			"# Volterra-era Replacements",
			"",
			"F5 acquired Volterra and rebranded to F5 Distributed Cloud.",
			"Everything listed below has been replaced.",
			"",
			"## Product Names",
			"",
		];

		for (const [key, value] of Object.entries(canonical)) {
			for (const legacy of value.legacy_names ?? []) {
				lines.push(`- **${legacy}** → ${value.long_form} (\`${key}\`)`);
			}
		}

		lines.push("", "## Tooling", "");

		for (const [depKey, dep] of Object.entries(deprecations)) {
			lines.push(`### ${depKey}`);
			for (const val of Object.values(dep.deprecated)) {
				lines.push(`- ~~${val}~~`);
			}
			lines.push("  **Replace with:**");
			for (const val of Object.values(dep.canonical)) {
				lines.push(`  - ${val}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	async #readDoc(filename: string, url: InternalUrl): Promise<InternalResource> {
		if (path.isAbsolute(filename)) {
			throw new Error(`Absolute paths are not allowed in ${SCHEME_PREFIX} URLs`);
		}

		const normalized = path.posix.normalize(filename.replaceAll("\\", "/"));
		if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
			throw new Error(`Path traversal (..) is not allowed in ${SCHEME_PREFIX} URLs`);
		}

		if (normalized === ABOUT_ROUTE || normalized === `${ABOUT_ROUTE}.md`) {
			const info = await this.#resolveBuildInfo();
			const context = this.#getContextStatus?.() ?? null;
			const content = renderAboutDoc(info, context);
			return {
				url: url.href,
				content,
				contentType: "text/markdown",
				size: Buffer.byteLength(content, "utf-8"),
				sourcePath: `${SCHEME_PREFIX}${ABOUT_ROUTE}`,
			};
		}

		const content = EMBEDDED_DOCS[normalized];
		if (content === undefined) {
			const lookup = normalized.replace(/\.md$/, "");
			const suggestions = EMBEDDED_DOC_FILENAMES.filter(
				f => f.includes(lookup) || lookup.includes(f.replace(/\.md$/, "")),
			).slice(0, 5);
			const suffix =
				suggestions.length > 0
					? `\nDid you mean: ${suggestions.join(", ")}`
					: `\nUse ${SCHEME_PREFIX} to list available files.`;
			throw new Error(`Documentation file not found: ${filename}${suffix}`);
		}

		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: `${SCHEME_PREFIX}${normalized}`,
		};
	}
}
