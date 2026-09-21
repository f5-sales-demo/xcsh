import * as path from "node:path";
import assistantIdentityPrompt from "./prompts/assistant-identity.md" with { type: "text" };
import apiCatalogDirectCategoryPrompt from "./prompts/api-catalog-direct-category-probe.md" with { type: "text" };
import apiCatalogExactResourcePrompt from "./prompts/api-catalog-exact-resource-probe.md" with { type: "text" };
import apiCatalogAliasPrompt from "./prompts/api-catalog-alias-probe.md" with { type: "text" };
import apiCatalogAmbiguousPrompt from "./prompts/api-catalog-ambiguous-probe.md" with { type: "text" };
import apiCatalogKnownResourcePrompt from "./prompts/api-catalog-known-resource-probe.md" with { type: "text" };
import apiCatalogNoMatchPrompt from "./prompts/api-catalog-no-match-probe.md" with { type: "text" };
import apiCatalogSemanticPrompt from "./prompts/api-catalog-semantic-probe.md" with { type: "text" };
import apiCatalogAnswerAmbiguousPrompt from "./prompts/api-catalog-answer-ambiguous.md" with { type: "text" };
import apiCatalogAnswerNoMatchPrompt from "./prompts/api-catalog-answer-no-match.md" with { type: "text" };
import apiCatalogAnswerWafPrompt from "./prompts/api-catalog-answer-waf.md" with { type: "text" };
import apiCatalogAnswerCloneDnsZonePrompt from "./prompts/api-catalog-answer-clone-dns-zone.md" with { type: "text" };
import apiCatalogAnswerImportBindDnsZonePrompt from "./prompts/api-catalog-answer-import-bind-dns-zone.md" with { type: "text" };
import apiCatalogAnswerValidateCloudUserAccountPrompt from "./prompts/api-catalog-answer-validate-cloud-user-account.md" with { type: "text" };
import apiSpecResourcePrompt from "./prompts/api-spec-resource-probe.md" with { type: "text" };
import authenticatedContextPrompt from "./prompts/authenticated-context-probe.md" with { type: "text" };
import modelPingPrompt from "./prompts/model-ping.md" with { type: "text" };
import pluginSkillPrompt from "./prompts/plugin-skill-probe.md" with { type: "text" };
import pluginToolPrompt from "./prompts/plugin-tool-probe.md" with { type: "text" };
import readToolPrompt from "./prompts/read-tool-probe.md" with { type: "text" };
import userAssistancePrompt from "./prompts/user-assistance.md" with { type: "text" };

export type ModelScenarioSuite = "ping" | "identity" | "tools" | "plugins" | "authenticated" | "integrations";

export interface ModelScenarioToolExpectation {
	name: string;
	count: number;
	arguments?: Record<string, unknown>;
	argumentPatterns?: Record<string, RegExp>;
}

export interface ModelScenarioResponsePattern {
	label: string;
	pattern: RegExp;
}

export interface ModelScenarioQualityCriterion {
	id: string;
	label: string;
	weight: number;
	responsePattern?: RegExp;
	forbiddenResponsePattern?: RegExp;
	responseIncludes?: string;
	maxVisibleWords?: number;
	requiresContract?: boolean;
}

export interface ModelScenarioContract {
	expectedResponse?: string;
	requiredResponsePatterns?: ModelScenarioResponsePattern[];
	forbiddenResponsePatterns?: ModelScenarioResponsePattern[];
	requiredTools?: ModelScenarioToolExpectation[];
	/** Ordered evidence reads; additional non-error reads remain permitted. */
	requiredToolSequence?: ModelScenarioToolExpectation[];
	exclusiveTools?: boolean;
}

export interface ModelScenarioRuntime {
	tools: "default" | "none" | string[];
	extensions: "none" | "plugin" | "installed";
	skills: "none" | string[];
	requiresContext: boolean;
}

export interface ModelBenchmarkScenario {
	id: string;
	label: string;
	suite: ModelScenarioSuite;
	tier: 0 | 1 | 2 | 3 | 4 | 5;
	prompt: string;
	contract: ModelScenarioContract;
	quality: ModelScenarioQualityCriterion[];
	runtime: ModelScenarioRuntime;
}

const EXACT_CONTRACT_QUALITY: ModelScenarioQualityCriterion[] = [
	{
		id: "contract",
		label: "Produces the exact response and tool behavior required by the scenario",
		weight: 100,
		requiresContract: true,
	},
];

export const MODEL_BENCHMARK_PLUGIN_DIR = path.join(import.meta.dir, "fixtures/model-benchmark-plugin");

export const MODEL_BENCHMARK_SCENARIOS: readonly ModelBenchmarkScenario[] = [
	{
		id: "ping",
		label: "Ping",
		suite: "ping",
		tier: 0,
		prompt: modelPingPrompt.trim(),
		contract: { expectedResponse: "PONG" },
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: "none", extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "assistant-identity",
		label: "Assistant identity",
		suite: "identity",
		tier: 1,
		prompt: assistantIdentityPrompt.trim(),
		contract: {
			requiredResponsePatterns: [
				{ label: "identifies as xcsh", pattern: /\bxcsh\b/i },
				{ label: "anchors on F5", pattern: /\bF5\b|Distributed Cloud/i },
				{ label: "states its operating specialty", pattern: /sales engineer|network|security/i },
			],
		},
		quality: [
			{ id: "identity", label: "Identifies itself as xcsh", weight: 15, responsePattern: /\bxcsh\b/i },
			{
				id: "mission",
				label: "States its F5 sales-engineering mission",
				weight: 15,
				responsePattern: /technical coworker|sales engineer/i,
			},
			{
				id: "platform",
				label: "Explains F5 Distributed Cloud platform expertise",
				weight: 15,
				responsePattern: /F5 Distributed Cloud|F5 XC|\bWAAP\b/i,
			},
			{
				id: "network-security",
				label: "Covers network and security engineering",
				weight: 15,
				responsePattern: /network|security|TLS|DDoS/i,
			},
			{
				id: "sales-execution",
				label: "Covers sales-cycle or customer execution",
				weight: 15,
				responsePattern: /MEDDPICC|discovery|customer|POC|competitive/i,
			},
			{
				id: "automation",
				label: "Covers automation or infrastructure as code",
				weight: 10,
				responsePattern: /automat|Terraform|API|manifest/i,
			},
			{
				id: "evidence",
				label: "States an evidence or verification discipline",
				weight: 5,
				responsePattern: /evidence|verif|ground|source of truth/i,
			},
			{
				id: "directness",
				label: "Answers directly in at most 250 visible words",
				weight: 10,
				maxVisibleWords: 250,
			},
		],
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: true },
	},
	{
		id: "user-assistance",
		label: "User identity and assistance",
		suite: "identity",
		tier: 1,
		prompt: userAssistancePrompt.trim(),
		contract: {
			requiredResponsePatterns: [
				{ label: "connects the user to F5 or the active platform context", pattern: /\bF5\b|sales engineer|tenant|namespace/i },
			],
		},
		quality: [
			{
				id: "identity-boundary",
				label: "Distinguishes session evidence from verified personal identity",
				weight: 15,
				responsePattern: /based on|inferred|cannot verify|not verified|session (?:evidence|signals)|context (?:suggests|indicates)/i,
			},
			{
				id: "role",
				label: "Connects the user to the F5 sales-engineering role",
				weight: 15,
				responsePattern: /F5.*sales engineer|sales engineer.*F5/i,
			},
			{
				id: "active-context",
				label: "Names the active tenant context",
				weight: 10,
			},
			{
				id: "platform-help",
				label: "Offers concrete F5 platform help",
				weight: 15,
				responsePattern: /F5 XC|Distributed Cloud|WAAP|WAF|API Security/i,
			},
			{
				id: "network-security-help",
				label: "Offers network or security engineering help",
				weight: 10,
				responsePattern: /network|security|TLS|routing|DDoS/i,
			},
			{
				id: "sales-help",
				label: "Offers sales-cycle or customer-facing help",
				weight: 10,
				responsePattern: /MEDDPICC|customer|discovery|competitive|deal|meeting/i,
			},
			{
				id: "deliverables",
				label: "Offers actionable automation or deliverables",
				weight: 10,
				responsePattern: /Terraform|manifest|automat|diagram|presentation|test plan/i,
			},
			{
				id: "evidence",
				label: "States an evidence or verification discipline",
				weight: 5,
				responsePattern: /evidence|verif|ground|current product documentation/i,
			},
			{
				id: "directness",
				label: "Answers directly in at most 300 visible words",
				weight: 10,
				maxVisibleWords: 300,
			},
		],
		runtime: { tools: "none", extensions: "none", skills: "none", requiresContext: true },
	},
	{
		id: "read-tool",
		label: "Built-in read tool",
		suite: "tools",
		tier: 2,
		prompt: readToolPrompt.trim(),
		contract: {
			expectedResponse: "TOOL_PROBE_OK_7F3C",
			requiredTools: [
				{
					name: "read",
					count: 1,
					argumentPatterns: {
						path: /(?:^|\/)packages\/coding-agent\/bench\/fixtures\/tool-probe\.txt$/,
					},
				},
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-known-resource",
		label: "API catalog known-resource lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogKnownResourcePrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_KNOWN_RESOURCE_OK_1E7A",
			requiredTools: [
				{
					name: "read",
					count: 1,
					argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=http%20load%20balancer$/ },
				},
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-alias",
		label: "API catalog alias lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogAliasPrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_ALIAS_OK_5C92",
			requiredTools: [
				{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=create%20zone$/ } },
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-semantic",
		label: "API catalog natural-language lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogSemanticPrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_NATURAL_LANGUAGE_OK_8B4D",
			requiredTools: [
				{
					name: "read",
					count: 1,
					argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=web%20application%20firewall$/ },
				},
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-ambiguous",
		label: "API catalog ambiguous discovery lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogAmbiguousPrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_AMBIGUOUS_OK_3F61",
			requiredTools: [
				{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=network%20policy$/ } },
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-answer-waf",
		label: "API discovery answer quality: Web Application Firewall",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogAnswerWafPrompt.trim(),
		contract: {
			requiredToolSequence: [
				{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=web%20application%20firewall$/ } },
				{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/[a-z0-9-]+$/ } },
				{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-spec\/virtual\?resource=app_firewall$/ } },
			],
			requiredResponsePatterns: [
				{ label: "selects app_firewall", pattern: /\bapp[_ -]?firewall\b/i },
				{ label: "states the create method and path", pattern: /POST\s+\/api\/config\/namespaces\/\{(?:metadata\.)?namespace\}\/app_firewalls/i },
				{ label: "states all required fields", pattern: /metadata\.name[\s\S]{0,200}metadata\.namespace[\s\S]{0,200}(?:path\.metadata\.namespace|path\s*:\s*`?metadata\.namespace)/i },
			],
			forbiddenResponsePatterns: [
				{ label: "does not substitute curl, vesctl, or Terraform", pattern: /\b(?:curl|vesctl|terraform)\b/i },
			],
		},
		quality: [
			{ id: "evidence-sequence", label: "Follows the catalog-to-schema internal URL sequence", weight: 30, requiresContract: true },
			{ id: "resource", label: "Selects the app_firewall resource", weight: 15, responsePattern: /\bapp[_ -]?firewall\b/i },
			{ id: "internal-urls", label: "Cites both catalog and API-spec internal URLs", weight: 15, responsePattern: /xcsh:\/\/api-catalog\/[\s\S]*xcsh:\/\/api-spec\//i },
			{ id: "method-path", label: "States the authoritative POST path", weight: 20, responsePattern: /POST\s+\/api\/config\/namespaces\/\{(?:metadata\.)?namespace\}\/app_firewalls/i },
			{ id: "required-fields", label: "States the required field set", weight: 15, responsePattern: /metadata\.name[\s\S]{0,200}metadata\.namespace[\s\S]{0,200}(?:path\.metadata\.namespace|path\s*:\s*`?metadata\.namespace)/i },
			{ id: "no-substitution", label: "Avoids unsupported CLI or Terraform substitutions", weight: 5, forbiddenResponsePattern: /\b(?:curl|vesctl|terraform)\b/i },
		],
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-answer-ambiguous",
		label: "API discovery answer quality: ambiguous intent",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogAnswerAmbiguousPrompt.trim(),
		contract: {
			requiredTools: [{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=network%20policy$/ } }],
			exclusiveTools: true,
			requiredResponsePatterns: [
				{ label: "asks for clarification", pattern: /\bclarif|\bwhich\b[\s\S]{0,80}\b(?:kind|scope|type|use case|namespace)\b|could mean\b/i },
			],
			forbiddenResponsePatterns: [{ label: "does not invent an API path", pattern: /\b(?:POST|PUT|PATCH|DELETE)\s+\/api\//i }],
		},
		quality: [
			{ id: "safe-discovery", label: "Uses exactly the catalog lookup", weight: 35, requiresContract: true },
			{ id: "clarification", label: "Requests a meaningful disambiguating choice", weight: 35, responsePattern: /\bclarif|\bwhich\b[\s\S]{0,80}\b(?:kind|scope|type|use case|namespace)\b|could mean\b/i },
			{ id: "no-invented-path", label: "Does not invent a mutation path", weight: 30, forbiddenResponsePattern: /\b(?:POST|PUT|PATCH|DELETE)\s+\/api\//i },
		],
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-answer-clone-dns-zone",
		label: "API discovery answer quality: clone DNS zone",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogAnswerCloneDnsZonePrompt.trim(),
		contract: {
			requiredToolSequence: [
				{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=clone%20a%20DNS%20zone$/ } },
				{ name: "read", count: 1, arguments: { path: "xcsh://api-catalog/dns-dns-zone-clone-from-dns-domain" } },
			],
			requiredResponsePatterns: [
				{ label: "selects the DNS-zone clone category", pattern: /dns-dns-zone-clone-from-dns-domain/i },
				{ label: "states the clone method and path", pattern: /POST\s+\/api\/config\/dns\/namespaces\/system\/dns_zone\/clone_from_dns_domain/i },
				{ label: "states that no fields are required", pattern: /(?:required fields?|required input)(?:\s+are|\s*:)?.{0,40}\bnone\b|\bno required (?:fields?|input)/i },
			],
			forbiddenResponsePatterns: [{ label: "does not substitute curl, vesctl, or Terraform", pattern: /\b(?:curl|vesctl|terraform)\b/i }],
		},
		quality: [
			{ id: "evidence-sequence", label: "Reads the QMD-discovered category after the natural-language query", weight: 30, requiresContract: true },
			{ id: "resource", label: "Selects the DNS-zone clone category", weight: 20, responsePattern: /dns-dns-zone-clone-from-dns-domain/i },
			{ id: "internal-urls", label: "Cites both internal URLs", weight: 15, responsePattern: /xcsh:\/\/api-catalog\/\?search=clone%20a%20DNS%20zone[\s\S]*xcsh:\/\/api-catalog\/dns-dns-zone-clone-from-dns-domain/i },
			{ id: "method-path", label: "States the authoritative POST path", weight: 20, responsePattern: /POST\s+\/api\/config\/dns\/namespaces\/system\/dns_zone\/clone_from_dns_domain/i },
			{ id: "required-fields", label: "States that the operation has no required fields", weight: 10, responsePattern: /(?:required fields?|required input)(?:\s+are|\s*:)?.{0,40}\bnone\b|\bno required (?:fields?|input)/i },
			{ id: "no-substitution", label: "Avoids unsupported CLI or Terraform substitutions", weight: 5, forbiddenResponsePattern: /\b(?:curl|vesctl|terraform)\b/i },
		],
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-answer-validate-cloud-user-account", label: "API discovery answer quality: validate cloud user account", suite: "tools", tier: 2,
		prompt: apiCatalogAnswerValidateCloudUserAccountPrompt.trim(),
		contract: { requiredToolSequence: [
			{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=validate%20cloud%20user%20account$/ } },
			{ name: "read", count: 1, arguments: { path: "xcsh://api-catalog/cloud-data-cloud-user-accounts-validate" } },
		], requiredResponsePatterns: [
			{ label: "selects validation category", pattern: /cloud-data-cloud-user-accounts-validate/i },
			{ label: "states GET path", pattern: /GET[\s\S]{0,200}\/api\/cloud-data\/namespaces\/system\/cloud_user_accounts\/\{cloud_user_account_name\}\/validate/i },
			{ label: "states required path parameter", pattern: /cloud_user_account_name.{0,80}(?:required|path)|(?:required|path).{0,80}cloud_user_account_name/i },
		], forbiddenResponsePatterns: [{ label: "does not invent mutation", pattern: /\b(?:POST|PUT|PATCH|DELETE)\s+\/api\//i }] },
		quality: [
			{ id: "evidence-sequence", label: "Reads QMD-discovered category", weight: 35, requiresContract: true },
			{ id: "resource", label: "Selects validation category", weight: 20, responsePattern: /cloud-data-cloud-user-accounts-validate/i },
			{ id: "method-path", label: "States GET path", weight: 25, responsePattern: /GET[\s\S]{0,200}\/api\/cloud-data\/namespaces\/system\/cloud_user_accounts\/\{cloud_user_account_name\}\/validate/i },
			{ id: "parameter", label: "States required parameter", weight: 15, responsePattern: /cloud_user_account_name.{0,80}(?:required|path)|(?:required|path).{0,80}cloud_user_account_name/i },
			{ id: "no-invention", label: "Does not invent mutation", weight: 5, forbiddenResponsePattern: /\b(?:POST|PUT|PATCH|DELETE)\s+\/api\//i },
		], runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-answer-import-bind-dns-zone", label: "API discovery answer quality: import BIND DNS zone", suite: "tools", tier: 2,
		prompt: apiCatalogAnswerImportBindDnsZonePrompt.trim(),
		contract: { requiredToolSequence: [
			{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=import%20bind%20DNS%20zone$/ } },
			{ name: "read", count: 1, arguments: { path: "xcsh://api-catalog/dns-dns-zone-import-bind-create" } },
		], requiredResponsePatterns: [
			{ label: "selects BIND-import category", pattern: /dns-dns-zone-import-bind-create/i },
			{ label: "states POST path", pattern: /POST\s+\/api\/config\/dns\/namespaces\/system\/dns_zone\/import_bind_create/i },
			{ label: "states required file", pattern: /\bfile\b.{0,80}\brequired\b|\brequired\b.{0,80}\bfile\b/i },
		], forbiddenResponsePatterns: [{ label: "does not substitute CLI", pattern: /\b(?:curl|vesctl|terraform)\b/i }] },
		quality: [
			{ id: "evidence-sequence", label: "Reads QMD-discovered category", weight: 35, requiresContract: true },
			{ id: "resource", label: "Selects BIND-import category", weight: 20, responsePattern: /dns-dns-zone-import-bind-create/i },
			{ id: "method-path", label: "States POST path", weight: 25, responsePattern: /POST\s+\/api\/config\/dns\/namespaces\/system\/dns_zone\/import_bind_create/i },
			{ id: "required-fields", label: "States required file", weight: 15, responsePattern: /\bfile\b.{0,80}\brequired\b|\brequired\b.{0,80}\bfile\b/i },
			{ id: "no-substitution", label: "Avoids unsupported substitutions", weight: 5, forbiddenResponsePattern: /\b(?:curl|vesctl|terraform)\b/i },
		], runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-answer-no-match",
		label: "API discovery answer quality: no match",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogAnswerNoMatchPrompt.trim(),
		contract: {
			requiredTools: [{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=unmatched%20api%20intent$/ } }],
			exclusiveTools: true,
			requiredResponsePatterns: [{ label: "reports no catalog match", pattern: /\bno (?:matching )?(?:catalog )?(?:category|resource|match)\b|\b(?:catalog )?(?:cannot|did not) identify\b/i }],
			forbiddenResponsePatterns: [{ label: "does not invent an API method or path", pattern: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\//i }],
		},
		quality: [
			{ id: "safe-discovery", label: "Uses exactly the no-match catalog lookup", weight: 40, requiresContract: true },
			{ id: "no-match", label: "Clearly reports that no supported match was found", weight: 35, responsePattern: /\bno (?:matching )?(?:catalog )?(?:category|resource|match)\b|\b(?:catalog )?(?:cannot|did not) identify\b/i },
			{ id: "no-invention", label: "Does not invent an API method or path", weight: 25, forbiddenResponsePattern: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\//i },
		],
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "plugin-skill",
		label: "Plugin skill",
		suite: "plugins",
		tier: 3,
		prompt: pluginSkillPrompt.trim(),
		contract: {
			expectedResponse: "SKILL_PROBE_OK_8A21",
			requiredTools: [
				{ name: "read", count: 1, arguments: { path: "skill://model-benchmark:probe" } },
				{
					name: "read",
					count: 1,
					arguments: { path: "skill://model-benchmark:probe/proof.md" },
				},
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: {
			tools: ["read"],
			extensions: "plugin",
			skills: ["model-benchmark:probe"],
			requiresContext: false,
		},
	},
	{
		id: "plugin-tool",
		label: "Plugin extension tool",
		suite: "plugins",
		tier: 3,
		prompt: pluginToolPrompt.trim(),
		contract: {
			expectedResponse: "XCSH_PLUGIN_ECHO_OK_C91D:hello-world",
			requiredTools: [
				{ name: "xcsh_plugin_echo", count: 1, arguments: { value: "hello-world" } },
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["xcsh_plugin_echo"], extensions: "plugin", skills: "none", requiresContext: false },
	},
	{
		id: "authenticated-context",
		label: "Authenticated F5 XC context",
		suite: "authenticated",
		tier: 4,
		prompt: authenticatedContextPrompt.trim(),
		contract: {
			requiredResponsePatterns: [
				{ label: "reports the exact namespace count", pattern: /Accessible namespace count:\s*\d+/i },
				{ label: "reports tenant context", pattern: /tenant/i },
			],
			forbiddenResponsePatterns: [
				{ label: "does not print credentials", pattern: /APIToken|Authorization|api[_ -]?token/i },
				{
					label: "does not report an estimate or blocked count",
					pattern: /\[blocked\]|lower bound|\bestimat(?:e|ed|ion)\b/i,
				},
			],
			requiredTools: [
				{ name: "xcsh_api", count: 1, arguments: { method: "GET", path: "/api/web/namespaces" } },
			],
			exclusiveTools: true,
		},
		quality: [
			{
				id: "contract",
				label: "Uses the authenticated tool exactly once and reports every required field safely",
				weight: 90,
				requiresContract: true,
			},
			{
				id: "directness",
				label: "Reports the requested result in at most 80 visible words",
				weight: 10,
				maxVisibleWords: 80,
			},
		],
		runtime: { tools: ["xcsh_api"], extensions: "none", skills: "none", requiresContext: true },
	},
	{
		id: "api-catalog-exact-resource",
		label: "API catalog exact resource lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogExactResourcePrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_EXACT_RESOURCE_OK_6D18",
			requiredTools: [{ name: "read", count: 1, arguments: { path: "xcsh://api-catalog/?resource=http_loadbalancer" } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-direct-category",
		label: "API catalog direct category lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogDirectCategoryPrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_DIRECT_CATEGORY_OK_7A3E",
			requiredTools: [{ name: "read", count: 1, arguments: { path: "xcsh://api-catalog/http-loadbalancers" } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-spec-resource-schema",
		label: "API specification schema lookup",
		suite: "tools",
		tier: 2,
		prompt: apiSpecResourcePrompt.trim(),
		contract: {
			expectedResponse: "API_SPEC_RESOURCE_OK_4B29",
			requiredTools: [{ name: "read", count: 1, arguments: { path: "xcsh://api-spec/virtual?resource=http_loadbalancer" } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
	{
		id: "api-catalog-no-match",
		label: "API catalog no-match lookup",
		suite: "tools",
		tier: 2,
		prompt: apiCatalogNoMatchPrompt.trim(),
		contract: {
			expectedResponse: "API_CATALOG_NO_MATCH_OK_9F50",
			requiredTools: [{ name: "read", count: 1, argumentPatterns: { path: /^xcsh:\/\/api-catalog\/\?search=unmatched%20api%20intent$/ } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "none", skills: "none", requiresContext: false },
	},
];

export function selectModelBenchmarkScenarios(options: {
	suite?: ModelScenarioSuite | "all";
	ids?: string[];
	maxTier?: number;
	contextName?: string;
}): ModelBenchmarkScenario[] {
	const requestedIds = new Set(options.ids ?? []);
	const selected = MODEL_BENCHMARK_SCENARIOS.filter(scenario => {
		if (requestedIds.size > 0 && !requestedIds.has(scenario.id)) return false;
		if (options.suite && options.suite !== "all" && scenario.suite !== options.suite) return false;
		if (options.maxTier !== undefined && scenario.tier > options.maxTier) return false;
		return true;
	});
	if (requestedIds.size > 0) {
		const selectedIds = new Set(selected.map(scenario => scenario.id));
		const missing = [...requestedIds].filter(id => !selectedIds.has(id));
		if (missing.length > 0) throw new Error(`Unknown or filtered scenario: ${missing.join(", ")}`);
	}
	if (selected.length === 0) throw new Error("No benchmark scenarios selected");
	if (!options.contextName) return selected;
	return selected.map(scenario => ({
		...scenario,
		quality: scenario.quality.map(criterion =>
			criterion.id === "active-context" ? { ...criterion, responseIncludes: options.contextName } : criterion,
		),
	}));
}
