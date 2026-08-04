import * as path from "node:path";
import assistantIdentityPrompt from "./prompts/assistant-identity.md" with { type: "text" };
import azureCliAuthPrompt from "./prompts/azure-cli-auth.md" with { type: "text" };
import authenticatedContextPrompt from "./prompts/authenticated-context-probe.md" with { type: "text" };
import githubCliAuthPrompt from "./prompts/github-cli-auth.md" with { type: "text" };
import gitlabCliAuthPrompt from "./prompts/gitlab-cli-auth.md" with { type: "text" };
import meddpiccSkillPrompt from "./prompts/meddpicc-skill-probe.md" with { type: "text" };
import modelPingPrompt from "./prompts/model-ping.md" with { type: "text" };
import pluginSkillPrompt from "./prompts/plugin-skill-probe.md" with { type: "text" };
import pluginToolPrompt from "./prompts/plugin-tool-probe.md" with { type: "text" };
import readToolPrompt from "./prompts/read-tool-probe.md" with { type: "text" };
import salesforceCliAuthPrompt from "./prompts/salesforce-cli-auth.md" with { type: "text" };
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
	responseIncludes?: string;
	maxVisibleWords?: number;
	requiresContract?: boolean;
}

export interface ModelScenarioContract {
	expectedResponse?: string;
	requiredResponsePatterns?: ModelScenarioResponsePattern[];
	forbiddenResponsePatterns?: ModelScenarioResponsePattern[];
	requiredTools?: ModelScenarioToolExpectation[];
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
		id: "github-cli-auth",
		label: "Authenticated GitHub CLI",
		suite: "integrations",
		tier: 5,
		prompt: githubCliAuthPrompt.trim(),
		contract: {
			expectedResponse: "GitHub CLI authenticated: yes",
			requiredTools: [{ name: "gh_exec", count: 1, arguments: { args: ["auth", "status"] } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["gh_exec"], extensions: "installed", skills: "none", requiresContext: false },
	},
	{
		id: "azure-cli-auth",
		label: "Authenticated Azure CLI",
		suite: "integrations",
		tier: 5,
		prompt: azureCliAuthPrompt.trim(),
		contract: {
			expectedResponse: "Azure CLI authenticated: yes",
			requiredTools: [{ name: "az_account_show", count: 1, arguments: { action: "show" } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["az_account_show"], extensions: "installed", skills: "none", requiresContext: false },
	},
	{
		id: "gitlab-cli-auth",
		label: "Authenticated GitLab CLI",
		suite: "integrations",
		tier: 5,
		prompt: gitlabCliAuthPrompt.trim(),
		contract: {
			expectedResponse: "GitLab CLI authenticated: yes",
			requiredTools: [
				{
					name: "glab_exec",
					count: 1,
					arguments: { args: ["repo", "list", "--member", "--output", "json", "--per-page", "1"] },
				},
			],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["glab_exec"], extensions: "installed", skills: "none", requiresContext: false },
	},
	{
		id: "meddpicc-skill",
		label: "MEDDPICC plugin skill",
		suite: "integrations",
		tier: 5,
		prompt: meddpiccSkillPrompt.trim(),
		contract: {
			expectedResponse: "MEDDPICC operating principle: Evidence over hope",
			requiredTools: [{ name: "read", count: 1, arguments: { path: "skill://meddpicc:coach" } }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["read"], extensions: "installed", skills: ["meddpicc:coach"], requiresContext: false },
	},
	{
		id: "salesforce-cli-auth",
		label: "Authenticated Salesforce CLI",
		suite: "integrations",
		tier: 5,
		prompt: salesforceCliAuthPrompt.trim(),
		contract: {
			expectedResponse: "Salesforce CLI authenticated: yes",
			requiredTools: [{ name: "sf_org_display", count: 1, arguments: {} }],
			exclusiveTools: true,
		},
		quality: EXACT_CONTRACT_QUALITY,
		runtime: { tools: ["sf_org_display"], extensions: "installed", skills: "none", requiresContext: false },
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
