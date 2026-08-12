import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	completeSimple,
	getBundledModel,
	type ImageContent,
	type Model,
	type TextContent,
	type UserMessage,
} from "@f5-sales-demo/pi-ai";
import { resolveAntigravityServingModelId } from "@f5-sales-demo/pi-ai/providers/google-gemini-cli";
import Ajv2020 from "ajv/dist/2020";
import { GoogleAuth } from "google-auth-library";
import { ModelRegistry, type ProviderDiscoveryState } from "../src/config/model-registry";
import { RoutingCoordinator } from "../src/routing/coordinator";
import { OPENAI_CODEX_ROUTING_POOL } from "../src/routing/subscription-profiles";
import type { RoutingPoolConfig, RoutingTier } from "../src/routing/types";

export type InventoryState =
	| "AVAILABLE"
	| "SIMULATED"
	| "BLOCKED_AUTH"
	| "BLOCKED_NETWORK"
	| "BLOCKED_RATE_LIMIT"
	| "UNSUPPORTED_DISCOVERY"
	| "FAIL_SCHEMA"
	| "FAIL_EMPTY_INVENTORY"
	| "FAIL_MISSING_TIERS";

export type RunStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED_UNTIERED" | "SIMULATED";

export interface LaneCapability {
	id: string;
	required: boolean;
	clientProvider: string;
	upstreamFamily: "openai" | "anthropic" | "google";
	endpointKind: "direct" | "gateway";
	poolId: string;
	inferenceApiType:
		| "openai-responses"
		| "openai-codex-responses"
		| "anthropic-messages"
		| "google-vertex"
		| "google-gemini-cli";
	inventoryAdapterId: "openai-compatible" | "anthropic" | "vertex-model-garden" | "oauth-entitlement";
	credentialResolverId: string;
	defaultBaseUrl?: string;
	multimodal: boolean;
	requireResponseModel: boolean;
	canProveUpstreamProvider: boolean;
	tiers: Record<RoutingTier, string>;
	effortPolicy?: RoutingPoolConfig["effortPolicy"];
}

export type BenchmarkProfile = "canonical" | "subscription";
export const CANONICAL_LANE_IDS = [
	"openai",
	"anthropic",
	"litellm-openai",
	"litellm-anthropic",
	"google-vertex",
] as const;
export const SUBSCRIPTION_LANE_IDS = ["google-antigravity", "openai-codex"] as const;

export const LANE_CAPABILITIES: Record<string, LaneCapability> = {
	openai: {
		id: "openai",
		required: true,
		clientProvider: "openai",
		upstreamFamily: "openai",
		endpointKind: "direct",
		poolId: "openai/gpt-5.6",
		inferenceApiType: "openai-responses",
		inventoryAdapterId: "openai-compatible",
		credentialResolverId: "xcsh-openai-direct",
		defaultBaseUrl: "https://api.openai.com/v1",
		multimodal: true,
		requireResponseModel: true,
		canProveUpstreamProvider: true,
		tiers: { utility: "gpt-5.4-mini", balanced: "gpt-5.4", frontier: "gpt-5.6-sol" },
	},
	anthropic: {
		id: "anthropic",
		required: true,
		clientProvider: "anthropic",
		upstreamFamily: "anthropic",
		endpointKind: "direct",
		poolId: "anthropic/claude",
		inferenceApiType: "anthropic-messages",
		inventoryAdapterId: "anthropic",
		credentialResolverId: "xcsh-anthropic-direct",
		defaultBaseUrl: "https://api.anthropic.com",
		multimodal: true,
		requireResponseModel: true,
		canProveUpstreamProvider: true,
		tiers: {
			utility: "claude-3-haiku-20240307",
			balanced: "claude-3-5-sonnet-20241022",
			frontier: "claude-opus-4-0",
		},
	},
	"litellm-openai": {
		id: "litellm-openai",
		required: true,
		clientProvider: "litellm",
		upstreamFamily: "openai",
		endpointKind: "gateway",
		poolId: "litellm/openai",
		inferenceApiType: "openai-responses",
		inventoryAdapterId: "openai-compatible",
		credentialResolverId: "xcsh-litellm-openai",
		multimodal: true,
		requireResponseModel: true,
		canProveUpstreamProvider: false,
		tiers: { utility: "gpt-5.4-mini", balanced: "gpt-5.4", frontier: "gpt-5.6-sol" },
	},
	"litellm-anthropic": {
		id: "litellm-anthropic",
		required: true,
		clientProvider: "anthropic",
		upstreamFamily: "anthropic",
		endpointKind: "gateway",
		poolId: "litellm/anthropic",
		inferenceApiType: "anthropic-messages",
		inventoryAdapterId: "openai-compatible",
		credentialResolverId: "xcsh-litellm-anthropic",
		multimodal: true,
		requireResponseModel: true,
		canProveUpstreamProvider: false,
		tiers: {
			utility: "claude-3-5-haiku-20241022",
			balanced: "claude-3-5-sonnet-20241022",
			frontier: "claude-opus-4-0",
		},
	},
	"google-vertex": {
		id: "google-vertex",
		required: true,
		clientProvider: "google-vertex",
		upstreamFamily: "google",
		endpointKind: "direct",
		poolId: "google-vertex/gemini",
		inferenceApiType: "google-vertex",
		inventoryAdapterId: "vertex-model-garden",
		credentialResolverId: "google-adc",
		multimodal: true,
		// The current Google Vertex SDK stream does not expose a response-reported model.
		requireResponseModel: false,
		canProveUpstreamProvider: true,
		tiers: { utility: "gemini-2.5-flash-lite", balanced: "gemini-2.5-flash", frontier: "gemini-2.5-pro" },
	},
	"google-antigravity": {
		id: "google-antigravity",
		required: true,
		clientProvider: "google-antigravity",
		upstreamFamily: "google",
		endpointKind: "gateway",
		poolId: "google-antigravity/subscription",
		inferenceApiType: "google-gemini-cli",
		inventoryAdapterId: "oauth-entitlement",
		credentialResolverId: "xcsh-auth-storage-google-antigravity",
		multimodal: true,
		requireResponseModel: true,
		canProveUpstreamProvider: false,
		// Flash handles normal operations; the planning/frontier tier uses Pro.
		tiers: {
			utility: "gemini-3.6-flash-high",
			balanced: "gemini-3.6-flash-high",
			frontier: "gemini-3.1-pro-high-vertex",
		},
		effortPolicy: { byTier: { utility: "high", balanced: "high", frontier: "high" } },
	},
	"openai-codex": {
		id: "openai-codex",
		required: true,
		clientProvider: "openai-codex",
		upstreamFamily: "openai",
		endpointKind: "gateway",
		poolId: OPENAI_CODEX_ROUTING_POOL.id,
		inferenceApiType: "openai-codex-responses",
		inventoryAdapterId: "oauth-entitlement",
		credentialResolverId: "xcsh-auth-storage-openai-codex",
		multimodal: true,
		requireResponseModel: true,
		canProveUpstreamProvider: false,
		tiers: OPENAI_CODEX_ROUTING_POOL.tiers,
		effortPolicy: OPENAI_CODEX_ROUTING_POOL.effortPolicy,
	},
};

export interface BenchmarkArgs {
	profile: BenchmarkProfile;
	repetitions: number;
	warmups: number;
	lanes: string[];
	scenarios: string[];
	reportDir: string;
	dryRun: boolean;
	timeoutMs: number;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): BenchmarkArgs {
	const get = (flag: string): string | undefined => {
		const index = argv.indexOf(flag);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const repetitions = Number(get("--repetitions") ?? process.env.ROUTING_MATRIX_REPETITIONS ?? "3");
	const warmups = Number(get("--warmups") ?? process.env.ROUTING_MATRIX_WARMUPS ?? "1");
	const profile = (get("--profile") ?? process.env.ROUTING_MATRIX_PROFILE ?? "canonical") as BenchmarkProfile;
	if (profile !== "canonical" && profile !== "subscription") throw new Error(`Unknown profile: ${profile}`);
	const timeoutMs = Number(
		get("--timeout-ms") ?? process.env.ROUTING_MATRIX_TIMEOUT_MS ?? (profile === "subscription" ? "120000" : "20000"),
	);
	if (
		!Number.isInteger(repetitions) ||
		repetitions < 1 ||
		!Number.isInteger(warmups) ||
		warmups < 0 ||
		!Number.isInteger(timeoutMs) ||
		timeoutMs < 1
	) {
		throw new Error("Invalid benchmark counts or timeout");
	}
	const profileLanes = profile === "subscription" ? SUBSCRIPTION_LANE_IDS : CANONICAL_LANE_IDS;
	const lanes = (get("--lanes") ?? process.env.ROUTING_MATRIX_LANES ?? profileLanes.join(","))
		.split(",")
		.map(value => value.trim().toLowerCase())
		.filter(Boolean);
	for (const lane of lanes) {
		if (!LANE_CAPABILITIES[lane]) throw new Error(`Unknown lane: ${lane}`);
	}
	const scenarios = (get("--scenarios") ?? BASE_SCENARIOS.map(item => item.id).join(","))
		.split(",")
		.map(value => value.trim())
		.filter(Boolean);
	for (const scenario of scenarios) {
		if (!ALL_SCENARIOS.some(item => item.id === scenario)) throw new Error(`Unknown scenario: ${scenario}`);
	}
	return {
		profile,
		repetitions,
		warmups,
		timeoutMs,
		lanes,
		scenarios,
		reportDir:
			get("--report-dir") ??
			get("--out") ??
			process.env.ROUTING_MATRIX_REPORT_DIR ??
			path.join("/tmp", "routing-matrix-reports", timestamp),
		dryRun: argv.includes("--dry-run") || process.env.ROUTING_MATRIX_DRY_RUN === "true",
	};
}

export interface LaneCredential {
	apiKey?: string;
	authMechanism?: "bearer" | "api-key" | "oauth-bearer" | "oauth-packed" | "google-adc";
	baseUrl?: string;
	inventoryBaseUrl?: string;
	project?: string;
	location?: string;
}

async function resolveAdcAccessToken(): Promise<string | undefined> {
	if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) return undefined;
	try {
		const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
		const client = await auth.getClient();
		const token = await client.getAccessToken();
		return typeof token === "string" ? token : (token?.token ?? undefined);
	} catch {
		return undefined;
	}
}

export async function resolveLaneCredentials(): Promise<Record<string, LaneCredential>> {
	let storage:
		| {
				getApiKey(provider: string): Promise<string | undefined>;
				getOAuthCredential?(provider: string): unknown;
				close?(): void;
		  }
		| undefined;
	try {
		const { discoverAuthStorage } = await import("../src/sdk");
		storage = await discoverAuthStorage();
	} catch {
		storage = undefined;
	}
	const key = async (provider: string, explicit?: string) => explicit ?? (await storage?.getApiKey(provider));
	const openai = await key("openai", process.env.OPENAI_API_KEY);
	const anthropic = await key("anthropic", process.env.ANTHROPIC_OAUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY);
	const anthropicUsesOAuth = Boolean(process.env.ANTHROPIC_OAUTH_TOKEN || storage?.getOAuthCredential?.("anthropic"));
	const litellmOpenai = await key("litellm", process.env.LITELLM_OPENAI_API_KEY ?? process.env.LITELLM_API_KEY);
	const litellmAnthropic = await key("litellm", process.env.LITELLM_ANTHROPIC_API_KEY ?? process.env.LITELLM_API_KEY);
	const googleAntigravity = await key("google-antigravity", process.env.GOOGLE_ANTIGRAVITY_OAUTH_TOKEN);
	const openaiCodex = await key("openai-codex", process.env.OPENAI_CODEX_OAUTH_TOKEN);
	const adcToken = await resolveAdcAccessToken();
	storage?.close?.();
	const location = process.env.GOOGLE_CLOUD_LOCATION ?? process.env.VERTEX_LOCATION ?? "us-central1";
	const litellmBaseUrl = process.env.LITELLM_BASE_URL ?? process.env.LITELLM_URL;
	return {
		openai: {
			apiKey: openai,
			authMechanism: openai ? "bearer" : undefined,
			baseUrl: process.env.OPENAI_BASE_URL ?? LANE_CAPABILITIES.openai.defaultBaseUrl,
		},
		anthropic: {
			apiKey: anthropic,
			authMechanism: anthropic ? (anthropicUsesOAuth ? "oauth-bearer" : "api-key") : undefined,
			baseUrl: process.env.ANTHROPIC_BASE_URL ?? LANE_CAPABILITIES.anthropic.defaultBaseUrl,
		},
		"litellm-openai": {
			apiKey: litellmOpenai,
			authMechanism: litellmOpenai ? "bearer" : undefined,
			baseUrl: process.env.LITELLM_OPENAI_BASE_URL ?? litellmBaseUrl,
		},
		"litellm-anthropic": {
			apiKey: litellmAnthropic,
			authMechanism: litellmAnthropic ? "bearer" : undefined,
			baseUrl:
				process.env.LITELLM_ANTHROPIC_BASE_URL ??
				(litellmBaseUrl ? `${litellmBaseUrl.replace(/\/+$/, "")}/anthropic` : undefined),
			inventoryBaseUrl: process.env.LITELLM_ANTHROPIC_INVENTORY_URL ?? litellmBaseUrl,
		},
		"google-vertex": {
			apiKey: adcToken,
			authMechanism: adcToken ? "google-adc" : undefined,
			project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.VERTEX_PROJECT_ID,
			location,
			baseUrl: process.env.VERTEX_BASE_URL ?? `https://${location}-aiplatform.googleapis.com/v1beta1`,
		},
		"google-antigravity": {
			apiKey: googleAntigravity,
			authMechanism: googleAntigravity ? "oauth-packed" : undefined,
		},
		"openai-codex": {
			apiKey: openaiCodex,
			authMechanism: openaiCodex ? "oauth-packed" : undefined,
		},
	};
}

export interface InventoryResult {
	laneId: string;
	state: InventoryState;
	models: string[];
	endpointId: string;
	durationMs: number;
	httpStatus?: number;
	reasonCode?: string;
	missingTiers: string[];
	eligibleCandidates: string[];
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function endpointFingerprint(raw?: string): string {
	if (!raw) return "unconfigured";
	try {
		const url = new URL(raw);
		return createHash("sha256").update(`${url.protocol}//${url.host}${url.pathname}`).digest("hex").slice(0, 16);
	} catch {
		return "invalid-endpoint";
	}
}

function modelListUrl(capability: LaneCapability, credential: LaneCredential): string | undefined {
	const rawBase = credential.inventoryBaseUrl ?? credential.baseUrl;
	if (!rawBase) return undefined;
	const base = rawBase.replace(/\/+$/, "");
	if (capability.inventoryAdapterId === "vertex-model-garden") {
		return `${base}/publishers/google/models`;
	}
	if (/\/models$/.test(base)) return base;
	if (/\/v1$/.test(base)) return `${base}/models`;
	return `${base}/v1/models`;
}

function parseInventory(capability: LaneCapability, payload: unknown): string[] | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	let entries: unknown;
	if (capability.inventoryAdapterId === "vertex-model-garden") {
		entries = (payload as any).publisherModels;
	} else {
		entries = Array.isArray(payload) ? payload : ((payload as any).data ?? (payload as any).models);
	}
	if (!Array.isArray(entries)) return undefined;
	const models = entries
		.map(entry => {
			if (typeof entry === "string") return entry;
			if (!entry || typeof entry !== "object") return undefined;
			const raw = (entry as any).id ?? (entry as any).name;
			if (typeof raw !== "string" || raw.length === 0) return undefined;
			return capability.inventoryAdapterId === "vertex-model-garden" ? raw.split("/").pop() : raw;
		})
		.filter((value): value is string => Boolean(value));
	return [...new Set(models)].sort();
}

export async function discoverLaneInventory(
	capability: LaneCapability,
	credential: LaneCredential,
	fetchImpl: FetchLike = globalThis.fetch,
	signal?: AbortSignal,
): Promise<InventoryResult> {
	const started = performance.now();
	const url = modelListUrl(capability, credential);
	const base = {
		laneId: capability.id,
		models: [] as string[],
		endpointId: endpointFingerprint(url),
		durationMs: 0,
		missingTiers: [] as string[],
		eligibleCandidates: [] as string[],
	};
	if (!credential.apiKey || !credential.authMechanism) {
		return {
			...base,
			state: "BLOCKED_AUTH",
			durationMs: performance.now() - started,
			reasonCode: "missing_credentials",
		};
	}
	if (!url) {
		return {
			...base,
			state: "UNSUPPORTED_DISCOVERY",
			durationMs: performance.now() - started,
			reasonCode: "missing_inventory_endpoint",
		};
	}
	const headers = new Headers({ accept: "application/json" });
	if (capability.inventoryAdapterId === "anthropic") {
		if (credential.authMechanism === "oauth-bearer") {
			headers.set("authorization", `Bearer ${credential.apiKey}`);
			headers.set("anthropic-beta", "oauth-2025-04-20");
		} else {
			headers.set("x-api-key", credential.apiKey);
			headers.set("anthropic-version", "2023-06-01");
		}
	} else {
		headers.set("authorization", `Bearer ${credential.apiKey}`);
	}
	let response: Response;
	try {
		response = await fetchImpl(url, { method: "GET", headers, signal });
	} catch (error) {
		return {
			...base,
			state: "BLOCKED_NETWORK",
			durationMs: performance.now() - started,
			reasonCode:
				error instanceof DOMException && error.name === "AbortError"
					? "inventory_aborted"
					: "inventory_network_error",
		};
	}
	if (!response.ok) {
		const state: InventoryState =
			response.status === 401 || response.status === 403
				? "BLOCKED_AUTH"
				: response.status === 404
					? "UNSUPPORTED_DISCOVERY"
					: response.status === 429
						? "BLOCKED_RATE_LIMIT"
						: "BLOCKED_NETWORK";
		return {
			...base,
			state,
			httpStatus: response.status,
			durationMs: performance.now() - started,
			reasonCode: `inventory_http_${response.status}`,
		};
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return { ...base, state: "FAIL_SCHEMA", durationMs: performance.now() - started, reasonCode: "malformed_json" };
	}
	const models = parseInventory(capability, payload);
	if (!models) {
		return {
			...base,
			state: "FAIL_SCHEMA",
			durationMs: performance.now() - started,
			reasonCode: "invalid_inventory_schema",
		};
	}
	if (models.length === 0) {
		return {
			...base,
			state: "FAIL_EMPTY_INVENTORY",
			durationMs: performance.now() - started,
			reasonCode: "empty_inventory",
		};
	}
	return { ...base, state: "AVAILABLE", models, durationMs: performance.now() - started };
}

export interface OAuthEntitlementSnapshot {
	state?: ProviderDiscoveryState;
	models: Model<any>[];
}

export type OAuthEntitlementResolver = (provider: string) => Promise<OAuthEntitlementSnapshot>;

async function resolveOAuthEntitlements(provider: string): Promise<OAuthEntitlementSnapshot> {
	const { discoverAuthStorage } = await import("../src/sdk");
	const storage = await discoverAuthStorage();
	try {
		const registry = new ModelRegistry(storage);
		await registry.refreshProvider(provider, "online");
		const state = registry.getProviderDiscoveryState(provider);
		const entitled = new Set(state?.models ?? []);
		return {
			state,
			models: registry.getAvailable().filter(model => model.provider === provider && entitled.has(model.id)),
		};
	} finally {
		storage.close();
	}
}

/**
 * Discover subscription models through the provider's authenticated entitlement endpoint.
 * Cached or bundled models are never accepted as live discovery evidence.
 */
export async function discoverOAuthEntitlementInventory(
	capability: LaneCapability,
	credential: LaneCredential,
	resolver: OAuthEntitlementResolver = resolveOAuthEntitlements,
): Promise<{ inventory: InventoryResult; models: Model<any>[] }> {
	const started = performance.now();
	const base: InventoryResult = {
		laneId: capability.id,
		state: "BLOCKED_AUTH",
		models: [],
		endpointId: createHash("sha256")
			.update(`oauth-entitlement:${capability.clientProvider}`)
			.digest("hex")
			.slice(0, 16),
		durationMs: 0,
		missingTiers: [],
		eligibleCandidates: [],
	};
	if (!credential.apiKey || credential.authMechanism !== "oauth-packed") {
		return {
			inventory: { ...base, durationMs: performance.now() - started, reasonCode: "missing_oauth_credentials" },
			models: [],
		};
	}
	let snapshot: OAuthEntitlementSnapshot;
	try {
		snapshot = await resolver(capability.clientProvider);
	} catch {
		return {
			inventory: {
				...base,
				state: "BLOCKED_NETWORK",
				durationMs: performance.now() - started,
				reasonCode: "entitlement_discovery_error",
			},
			models: [],
		};
	}
	const state = snapshot.state;
	if (!state) {
		return {
			inventory: {
				...base,
				state: "UNSUPPORTED_DISCOVERY",
				durationMs: performance.now() - started,
				reasonCode: "missing_entitlement_adapter_state",
			},
			models: [],
		};
	}
	if (state.status === "unauthenticated") {
		return {
			inventory: {
				...base,
				state: "BLOCKED_AUTH",
				durationMs: performance.now() - started,
				reasonCode: "entitlement_auth_failed",
			},
			models: [],
		};
	}
	if (state.status !== "ok" || state.stale) {
		return {
			inventory: {
				...base,
				state: "BLOCKED_NETWORK",
				durationMs: performance.now() - started,
				reasonCode: state.stale ? "stale_entitlement_inventory" : "entitlement_discovery_unavailable",
			},
			models: [],
		};
	}
	const modelsById = new Map(snapshot.models.map(model => [model.id, model]));
	const models = [...new Set(state.models)].sort();
	if (models.length === 0) {
		return {
			inventory: {
				...base,
				state: "FAIL_EMPTY_INVENTORY",
				durationMs: performance.now() - started,
				reasonCode: "empty_entitlement_inventory",
			},
			models: [],
		};
	}
	const missingRecords = models.filter(model => !modelsById.has(model));
	if (missingRecords.length > 0) {
		return {
			inventory: {
				...base,
				state: "FAIL_SCHEMA",
				models,
				durationMs: performance.now() - started,
				reasonCode: "missing_entitlement_model_metadata",
			},
			models: [],
		};
	}
	return {
		inventory: { ...base, state: "AVAILABLE", models, durationMs: performance.now() - started },
		models: models.map(model => modelsById.get(model)!),
	};
}

export function reconcileLaneInventory(
	capability: LaneCapability,
	models: string[],
): Pick<InventoryResult, "state" | "missingTiers" | "eligibleCandidates"> {
	const available = new Set(models.map(model => model.replace(/^models\//, "")));
	const configured = [...new Set([capability.tiers.utility, capability.tiers.balanced, capability.tiers.frontier])];
	const missingTiers = configured.filter(model => !available.has(model));
	const eligibleCandidates = configured
		.filter(model => available.has(model))
		.map(model => `${capability.clientProvider}/${model}`);
	return { state: missingTiers.length ? "FAIL_MISSING_TIERS" : "AVAILABLE", missingTiers, eligibleCandidates };
}

export interface ScenarioDefinition {
	id: string;
	name: string;
	expectedTier: RoutingTier;
	prompt: string;
	responseMarker: string;
	hasImages?: boolean;
	priorRejection?: boolean;
}

export const BASE_SCENARIOS: ScenarioDefinition[] = [
	{
		id: "utility-greeting",
		name: "Utility exact response",
		expectedTier: "utility",
		prompt: "Summarize this instruction silently, then output RESPOND_UTILITY_OK and nothing else.",
		responseMarker: "RESPOND_UTILITY_OK",
	},
	{
		id: "balanced-reasoning",
		name: "Balanced architecture reasoning",
		expectedTier: "balanced",
		prompt: "Analyze this architecture question silently. Output RESPOND_BALANCED_OK and nothing else.",
		responseMarker: "RESPOND_BALANCED_OK",
	},
	{
		id: "frontier-analysis",
		name: "Frontier architecture migration analysis",
		expectedTier: "frontier",
		prompt: "Perform a deep architecture migration analysis silently. Output RESPOND_FRONTIER_OK and nothing else.",
		responseMarker: "RESPOND_FRONTIER_OK",
	},
	{
		id: "multimodal-visual",
		name: "Frontier image-derived inspection",
		expectedTier: "frontier",
		prompt:
			"Perform a security architecture inspection of the attached image. Transcribe the large visible routing code exactly and output only that code.",
		responseMarker: "ROUTE-7C",
		hasImages: true,
	},
];

export const ESCALATION_SCENARIO: ScenarioDefinition = {
	id: "rejection-escalation",
	name: "Frontier rejection escalation",
	expectedTier: "frontier",
	prompt:
		"Re-evaluate the rejected architecture and security migration deeply. Output RESPOND_ESCALATION_OK and nothing else.",
	responseMarker: "RESPOND_ESCALATION_OK",
	priorRejection: true,
};

export const ALL_SCENARIOS: ScenarioDefinition[] = [...BASE_SCENARIOS, ESCALATION_SCENARIO];

export interface MatrixEntry {
	lane: string;
	anchorModel: string;
	scenario: ScenarioDefinition;
	repetition: number;
}

export function expandLaneScenarios(lanes: string[], repetitions = 1, scenarios = BASE_SCENARIOS): MatrixEntry[] {
	const rows: MatrixEntry[] = [];
	for (const lane of lanes) {
		const capability = LANE_CAPABILITIES[lane];
		if (!capability) throw new Error(`Unknown lane: ${lane}`);
		for (const scenario of scenarios) {
			for (let repetition = 1; repetition <= repetitions; repetition++) {
				rows.push({
					lane,
					anchorModel: `${capability.clientProvider}/${capability.tiers.utility}`,
					scenario,
					repetition,
				});
			}
		}
	}
	return rows;
}

export function extractResponseText(content: unknown): { ok: boolean; text: string; reasonCode?: string } {
	if (typeof content === "string") return { ok: true, text: content.trim() };
	if (!Array.isArray(content)) return { ok: false, text: "", reasonCode: "invalid_content_shape" };
	const text: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") return { ok: false, text: "", reasonCode: "invalid_content_block" };
		if ((block as any).type === "text" && typeof (block as any).text === "string") {
			text.push((block as any).text.trim());
			continue;
		}
		if ((block as any).type === "thinking" || (block as any).type === "redactedThinking") continue;
		return { ok: false, text: text.join("\n"), reasonCode: `unexpected_${String((block as any).type ?? "block")}` };
	}
	return { ok: text.length > 0, text: text.join("\n").trim(), reasonCode: text.length ? undefined : "missing_text" };
}

export interface ClassifyMeasuredRunOptions {
	effectiveTier?: RoutingTier;
	expectedTier: RoutingTier;
	requestedModel: string;
	expectedResponseModel?: string;
	responseModel?: string;
	clientProvider?: string;
	expectedClientProvider: string;
	responseContent: unknown;
	expectedMarker: string;
	stopReason?: string;
	totalTokens: number;
	requireResponseModel: boolean;
	blockedReasonCode?: string;
	error?: string;
}

export function classifyMeasuredRun(options: ClassifyMeasuredRunOptions): { status: RunStatus; reasonCode?: string } {
	if (options.blockedReasonCode) return { status: "BLOCKED", reasonCode: options.blockedReasonCode };
	if (options.effectiveTier !== options.expectedTier) return { status: "FAIL", reasonCode: "tier_mismatch" };
	if (options.clientProvider !== options.expectedClientProvider)
		return { status: "FAIL", reasonCode: "client_provider_mismatch" };
	if (options.requireResponseModel && !options.responseModel)
		return { status: "FAIL", reasonCode: "missing_response_model" };
	if (
		options.responseModel &&
		normalizeModelId(options.responseModel) !==
			normalizeModelId(options.expectedResponseModel ?? options.requestedModel)
	) {
		return { status: "FAIL", reasonCode: "response_model_mismatch" };
	}
	if (options.stopReason !== "stop") return { status: "FAIL", reasonCode: "invalid_stop_reason" };
	const extracted = extractResponseText(options.responseContent);
	if (!extracted.ok) return { status: "FAIL", reasonCode: extracted.reasonCode };
	if (extracted.text !== options.expectedMarker) return { status: "FAIL", reasonCode: "marker_mismatch" };
	if (options.totalTokens <= 0) return { status: "FAIL", reasonCode: "invalid_usage" };
	if (options.error) return { status: "FAIL", reasonCode: "behavioral_error" };
	return { status: "PASS" };
}

function normalizeModelId(model: string): string {
	return model.includes("/") ? model.split("/").slice(1).join("/") : model;
}

export interface ContractIntegrityOptions {
	dryRun: boolean;
	cleanWorktree: boolean;
	exactHead: boolean;
	secretScanPassed: boolean;
	expectedWarmups: number;
	expectedMeasured: number;
	inventories: Array<{ state: InventoryState }>;
	warmups: Array<{ status: RunStatus }>;
	measured: Array<{ status: RunStatus }>;
}

export function validateContractIntegrity(options: ContractIntegrityOptions): {
	matrixComplete: boolean;
	authoritative: boolean;
} {
	const allPass = (rows: Array<{ status: RunStatus }>) => rows.every(row => row.status === "PASS");
	const matrixComplete =
		!options.dryRun &&
		options.inventories.length > 0 &&
		options.inventories.every(item => item.state === "AVAILABLE") &&
		options.warmups.length === options.expectedWarmups &&
		options.measured.length === options.expectedMeasured &&
		allPass(options.warmups) &&
		allPass(options.measured);
	const authoritative = matrixComplete && options.cleanWorktree && options.exactHead && options.secretScanPassed;
	return { matrixComplete, authoritative };
}

export function computeExitCode(options: { hasFailure: boolean; hasBlocked: boolean; invalidCli: boolean }): number {
	if (options.invalidCli) return 64;
	if (options.hasFailure) return 1;
	if (options.hasBlocked) return 2;
	return 0;
}

export function redactSecretStrings<T>(value: T, secrets: string[] = []): T {
	const secretSet = secrets.filter(secret => secret.length >= 4);
	const visit = (node: unknown, key?: string): unknown => {
		if (Array.isArray(node)) return node.map(item => visit(item));
		if (node && typeof node === "object") {
			return Object.fromEntries(Object.entries(node).map(([entryKey, item]) => [entryKey, visit(item, entryKey)]));
		}
		if (typeof node !== "string") return node;
		if (key && /authorization|api[-_]?key|token|secret|credential|adcpath/i.test(key)) return "[REDACTED]";
		let sanitized = node;
		for (const secret of secretSet) sanitized = sanitized.split(secret).join("[REDACTED]");
		sanitized = sanitized.replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
		sanitized = sanitized.replace(/(https?:\/\/)([^:@/]+):([^@/]+)@/gi, "$1[REDACTED]:[REDACTED]@");
		sanitized = sanitized.replace(/([?&](?:api_key|key|token|access_token)=)[^&\s"']+/gi, "$1[REDACTED]");
		sanitized = sanitized.replace(
			/(?:[A-Za-z]:\\|\/)[^\s"']*(?:credential|service-account|adc)[^\s"']*\.json/gi,
			"[REDACTED_PATH]",
		);
		return sanitized;
	};
	return visit(value) as T;
}

let reportValidator: ReturnType<Ajv2020["compile"]> | undefined;
export function validateRoutingMatrixReport(report: unknown): { valid: boolean; errors?: unknown } {
	if (!reportValidator) {
		const schemaPath = path.join(import.meta.dir, "routing-matrix-report.schema.json");
		const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
		reportValidator = new Ajv2020({ allErrors: true }).compile(schema);
	}
	const valid = reportValidator(report);
	return { valid: Boolean(valid), errors: reportValidator.errors };
}

const VISUAL_FIXTURE_PNG =
	"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";

export function createMultimodalMessage(prompt: string): UserMessage {
	const text: TextContent = { type: "text", text: prompt };
	const image: ImageContent = { type: "image", data: VISUAL_FIXTURE_PNG, mimeType: "image/png" };
	return { role: "user", content: [text, image], timestamp: Date.now() };
}

function constructModel(
	capability: LaneCapability,
	modelId: string,
	baseUrl?: string,
	discoveredModels: readonly Model<any>[] = [],
): Model<any> {
	const discovered = discoveredModels.find(
		model => model.provider === capability.clientProvider && model.id === modelId,
	);
	if (discovered) return baseUrl ? { ...discovered, baseUrl } : discovered;
	const bundled = getBundledModel(capability.clientProvider as any, modelId);
	if (bundled) return baseUrl ? { ...bundled, baseUrl } : bundled;
	return {
		id: modelId,
		name: modelId,
		provider: capability.clientProvider,
		api: capability.inferenceApiType,
		baseUrl: baseUrl ?? "",
		contextWindow: 128000,
		maxTokens: 4096,
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as Model<any>;
}

function customPool(capability: LaneCapability): RoutingPoolConfig {
	return {
		id: capability.poolId,
		provider: capability.clientProvider,
		tiers: capability.tiers,
		effortPolicy: capability.effortPolicy,
	};
}

interface ReportRow {
	lane: string;
	kind: "warmup" | "measured";
	status: RunStatus;
	reasonCode?: string;
	requestedModel?: string;
	responseModel?: string;
	clientProvider?: string;
	responseModelSource?: string;
	upstreamProvider?: string;
	upstreamProviderSource?: string;
	scenarioId?: string;
	repetition: number;
	effectiveTier?: RoutingTier;
	requestedEffort?: string;
	effortReason?: string;
	stopReason?: string;
	usage?: { input: number; output: number; totalTokens: number };
	startedAt: string;
	durationMs: number;
}

function responseEvidence(response: any): {
	responseModel?: string;
	responseModelSource?: string;
	upstreamProvider?: string;
	upstreamProviderSource?: string;
} {
	const attribution = response?.responseAttribution;
	return {
		responseModel: attribution?.responseModel,
		responseModelSource: attribution?.responseModelSource,
		upstreamProvider: attribution?.upstreamProvider,
		upstreamProviderSource: attribution?.upstreamProviderSource,
	};
}

function expectedResponseModel(capability: LaneCapability, requestedModel: string): string {
	return capability.id === "google-antigravity"
		? resolveAntigravityServingModelId(normalizeModelId(requestedModel))
		: requestedModel;
}

function normalizedUsage(response: any): { input: number; output: number; totalTokens: number } {
	const usage = response?.usage ?? {};
	const input = usage.input ?? usage.inputTokens ?? usage.promptTokens ?? 0;
	const output = usage.output ?? usage.outputTokens ?? usage.completionTokens ?? 0;
	return { input, output, totalTokens: usage.totalTokens ?? input + output };
}

function gitState(): { commit: string; clean: boolean; exactHead: boolean } {
	try {
		const commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
		const clean = execSync("git status --porcelain", { encoding: "utf8" }).trim().length === 0;
		let exactHead = false;
		try {
			exactHead = commit === execSync("git rev-parse origin/main", { encoding: "utf8" }).trim();
		} catch {}
		return { commit, clean, exactHead };
	} catch {
		return { commit: "unknown", clean: false, exactHead: false };
	}
}

function scanCandidate(reportPath: string): boolean {
	try {
		const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
		execFileSync(
			"gitleaks",
			["dir", path.dirname(reportPath), "--no-banner", "--redact", "--config", path.join(root, ".gitleaks.toml")],
			{
				stdio: "pipe",
			},
		);
		return true;
	} catch {
		return false;
	}
}

async function run(): Promise<number> {
	let args: BenchmarkArgs;
	try {
		args = parseArgs();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 64;
	}
	const git = gitState();
	const credentials = await resolveLaneCredentials();
	const inventory: InventoryResult[] = [];
	const eligibleByLane = new Map<string, string[]>();
	const discoveredModelsByLane = new Map<string, Model<any>[]>();
	const secrets = Object.values(credentials).flatMap(item => (item.apiKey ? [item.apiKey] : []));
	for (const laneId of args.lanes) {
		const capability = LANE_CAPABILITIES[laneId];
		if (args.dryRun) {
			const models = Object.values(capability.tiers);
			const reconciled = reconcileLaneInventory(capability, models);
			inventory.push({
				laneId,
				state: "SIMULATED",
				models,
				endpointId: "simulated",
				durationMs: 0,
				missingTiers: [],
				eligibleCandidates: reconciled.eligibleCandidates,
			});
			eligibleByLane.set(laneId, reconciled.eligibleCandidates);
			continue;
		}
		const entitlement =
			capability.inventoryAdapterId === "oauth-entitlement"
				? await discoverOAuthEntitlementInventory(capability, credentials[laneId])
				: undefined;
		const discovered = entitlement
			? entitlement.inventory
			: await discoverLaneInventory(
					capability,
					credentials[laneId],
					globalThis.fetch,
					AbortSignal.timeout(args.timeoutMs),
				);
		if (entitlement?.models.length) discoveredModelsByLane.set(laneId, entitlement.models);
		if (discovered.state === "AVAILABLE") {
			const reconciled = reconcileLaneInventory(capability, discovered.models);
			discovered.state = reconciled.state;
			discovered.missingTiers = reconciled.missingTiers;
			discovered.eligibleCandidates = reconciled.eligibleCandidates;
			eligibleByLane.set(laneId, reconciled.eligibleCandidates);
		}
		inventory.push(discovered);
	}

	const warmupRows: ReportRow[] = [];
	for (const laneId of args.lanes) {
		const capability = LANE_CAPABILITIES[laneId];
		const discovered = inventory.find(item => item.laneId === laneId)!;
		for (let repetition = 1; repetition <= args.warmups; repetition++) {
			const startedAt = new Date().toISOString();
			const started = performance.now();
			if (args.dryRun) {
				warmupRows.push({
					lane: laneId,
					kind: "warmup",
					status: "SIMULATED",
					repetition,
					startedAt,
					durationMs: 0,
				});
				continue;
			}
			if (discovered.state !== "AVAILABLE") {
				warmupRows.push({
					lane: laneId,
					kind: "warmup",
					status: discovered.state.startsWith("FAIL") ? "FAIL" : "BLOCKED",
					reasonCode: discovered.reasonCode ?? discovered.state.toLowerCase(),
					repetition,
					startedAt,
					durationMs: performance.now() - started,
				});
				continue;
			}
			const requestedModel = capability.tiers.utility;
			try {
				const response = await completeSimple(
					constructModel(
						capability,
						requestedModel,
						credentials[laneId].baseUrl,
						discoveredModelsByLane.get(laneId),
					),
					{ systemPrompt: "Warmup", messages: [{ role: "user", content: "Reply OK", timestamp: Date.now() }] },
					{
						apiKey: credentials[laneId].apiKey,
						maxTokens: 8,
						reasoning: capability.effortPolicy?.byTier.utility as any,
						signal: AbortSignal.timeout(args.timeoutMs),
					},
				);
				const evidence = responseEvidence(response);
				const usage = normalizedUsage(response);
				const responseModelValid =
					!capability.requireResponseModel ||
					(evidence.responseModel !== undefined &&
						normalizeModelId(evidence.responseModel) ===
							normalizeModelId(expectedResponseModel(capability, requestedModel)));
				const clientProviderValid = response?.provider === capability.clientProvider;
				const status: RunStatus =
					response?.stopReason === "stop" && usage.totalTokens > 0 && responseModelValid && clientProviderValid
						? "PASS"
						: "FAIL";
				warmupRows.push({
					lane: laneId,
					kind: "warmup",
					status,
					reasonCode: status === "PASS" ? undefined : "warmup_behavioral_failure",
					requestedModel,
					requestedEffort: capability.effortPolicy?.byTier.utility,
					clientProvider: response?.provider,
					...evidence,
					stopReason: response?.stopReason,
					usage,
					repetition,
					startedAt,
					durationMs: performance.now() - started,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const blocked = /401|403|429|unauthorized|forbidden|timeout|network|connect|dns/i.test(message);
				warmupRows.push({
					lane: laneId,
					kind: "warmup",
					status: blocked ? "BLOCKED" : "FAIL",
					reasonCode: blocked ? "warmup_external_block" : "warmup_behavioral_failure",
					requestedModel,
					repetition,
					startedAt,
					durationMs: performance.now() - started,
				});
			}
		}
	}

	const selectedScenarios = ALL_SCENARIOS.filter(item => args.scenarios.includes(item.id));
	const measuredRows: ReportRow[] = [];
	const coordinator = new RoutingCoordinator();
	for (const entry of expandLaneScenarios(args.lanes, args.repetitions, selectedScenarios)) {
		const capability = LANE_CAPABILITIES[entry.lane];
		const discovered = inventory.find(item => item.laneId === entry.lane)!;
		const startedAt = new Date().toISOString();
		const started = performance.now();
		if (!args.dryRun && discovered.state !== "AVAILABLE") {
			measuredRows.push({
				lane: entry.lane,
				kind: "measured",
				status: discovered.state.startsWith("FAIL") ? "FAIL" : "BLOCKED",
				reasonCode: discovered.reasonCode ?? discovered.state.toLowerCase(),
				scenarioId: entry.scenario.id,
				repetition: entry.repetition,
				startedAt,
				durationMs: performance.now() - started,
			});
			continue;
		}
		coordinator.reset();
		const pool = customPool(capability);
		const decision = await coordinator.evaluateTurn({
			anchorModel: entry.anchorModel,
			mode: "auto",
			prompt: entry.scenario.prompt,
			hasImages: entry.scenario.hasImages,
			priorRejection: entry.scenario.priorRejection,
			availableModels: eligibleByLane.get(entry.lane) ?? [],
			customPools: { [capability.poolId]: pool },
			profilerMode: "rules",
			tierEffort: capability.effortPolicy?.byTier as Record<string, string> | undefined,
			signal: AbortSignal.timeout(args.timeoutMs),
		});
		const requestedModel = decision.selectedModel ?? entry.anchorModel;
		if (args.dryRun) {
			measuredRows.push({
				lane: entry.lane,
				kind: "measured",
				status: "SIMULATED",
				requestedModel,
				requestedEffort: decision.selectedEffort,
				effortReason: decision.effortReason,
				scenarioId: entry.scenario.id,
				repetition: entry.repetition,
				effectiveTier: decision.effectiveTier,
				startedAt,
				durationMs: performance.now() - started,
			});
			continue;
		}
		try {
			const modelId = normalizeModelId(requestedModel);
			const message = entry.scenario.hasImages
				? createMultimodalMessage(entry.scenario.prompt)
				: { role: "user" as const, content: entry.scenario.prompt, timestamp: Date.now() };
			const response = await completeSimple(
				constructModel(
					capability,
					modelId,
					credentials[entry.lane].baseUrl,
					discoveredModelsByLane.get(entry.lane),
				),
				{ systemPrompt: "Follow the exact benchmark output contract.", messages: [message] },
				{
					apiKey: credentials[entry.lane].apiKey,
					maxTokens: 64,
					reasoning: decision.selectedEffort as any,
					signal: AbortSignal.timeout(args.timeoutMs),
				},
			);
			const evidence = responseEvidence(response);
			const usage = normalizedUsage(response);
			const classification = classifyMeasuredRun({
				effectiveTier: decision.effectiveTier,
				expectedTier: entry.scenario.expectedTier,
				requestedModel,
				expectedResponseModel: expectedResponseModel(capability, requestedModel),
				responseModel: evidence.responseModel,
				clientProvider: response?.provider,
				expectedClientProvider: capability.clientProvider,
				responseContent: response?.content,
				expectedMarker: entry.scenario.responseMarker,
				stopReason: response?.stopReason,
				totalTokens: usage.totalTokens,
				requireResponseModel: capability.requireResponseModel,
			});
			measuredRows.push({
				lane: entry.lane,
				kind: "measured",
				status: classification.status,
				reasonCode: classification.reasonCode,
				requestedModel,
				requestedEffort: decision.selectedEffort,
				effortReason: decision.effortReason,
				clientProvider: response?.provider,
				...evidence,
				scenarioId: entry.scenario.id,
				repetition: entry.repetition,
				effectiveTier: decision.effectiveTier,
				stopReason: response?.stopReason,
				usage,
				startedAt,
				durationMs: performance.now() - started,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const blocked = /401|403|429|unauthorized|forbidden|timeout|network|connect|dns/i.test(message);
			measuredRows.push({
				lane: entry.lane,
				kind: "measured",
				status: blocked ? "BLOCKED" : "FAIL",
				reasonCode: blocked ? "inference_external_block" : "inference_behavioral_failure",
				requestedModel,
				requestedEffort: decision.selectedEffort,
				effortReason: decision.effortReason,
				scenarioId: entry.scenario.id,
				repetition: entry.repetition,
				effectiveTier: decision.effectiveTier,
				startedAt,
				durationMs: performance.now() - started,
			});
		}
	}

	const expectedWarmups = args.lanes.length * args.warmups;
	const expectedMeasured = args.lanes.length * selectedScenarios.length * args.repetitions;
	const provisionalContract = validateContractIntegrity({
		dryRun: args.dryRun,
		cleanWorktree: git.clean,
		exactHead: git.exactHead,
		secretScanPassed: true,
		expectedWarmups,
		expectedMeasured,
		inventories: inventory,
		warmups: warmupRows,
		measured: measuredRows,
	});
	const report = redactSecretStrings(
		{
			schemaVersion: 3,
			startedAt: warmupRows[0]?.startedAt ?? measuredRows[0]?.startedAt ?? new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			git,
			parameters: args,
			capabilities: args.lanes.map(lane => LANE_CAPABILITIES[lane]),
			inventory,
			warmups: warmupRows,
			measured: measuredRows,
			summary: {
				...provisionalContract,
				expectedWarmups,
				expectedMeasured,
				passedWarmups: warmupRows.filter(row => row.status === "PASS").length,
				passedMeasured: measuredRows.filter(row => row.status === "PASS").length,
			},
			security: { redacted: true, secretScanPassed: true },
		},
		secrets,
	);
	const schema = validateRoutingMatrixReport(report);
	if (!schema.valid) {
		console.error("Report schema validation failed", schema.errors);
		return 1;
	}
	fs.mkdirSync(args.reportDir, { recursive: true });
	const candidate = path.join(args.reportDir, ".routing-matrix-report.candidate.json");
	const finalPath = path.join(args.reportDir, "routing-matrix-report.json");
	fs.writeFileSync(candidate, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	const secretScanPassed = scanCandidate(candidate);
	if (!secretScanPassed) {
		fs.rmSync(candidate, { force: true });
		console.error("Secret scan failed; no report published");
		return 1;
	}
	fs.renameSync(candidate, finalPath);
	const reportHash = createHash("sha256").update(fs.readFileSync(finalPath)).digest("hex");
	fs.writeFileSync(
		path.join(args.reportDir, "routing-matrix-report.receipt.json"),
		`${JSON.stringify({ schemaVersion: 1, reportSha256: reportHash, scanner: "gitleaks", passed: true }, null, 2)}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	const hasFailure =
		[...inventory].some(item => item.state.startsWith("FAIL")) ||
		[...warmupRows, ...measuredRows].some(row => row.status === "FAIL");
	const hasBlocked =
		inventory.some(item => item.state.startsWith("BLOCKED") || item.state === "UNSUPPORTED_DISCOVERY") ||
		[...warmupRows, ...measuredRows].some(row => row.status === "BLOCKED");
	console.log(`Report: ${finalPath}`);
	console.log(`Warmups: ${warmupRows.filter(row => row.status === "PASS").length}/${expectedWarmups} PASS`);
	console.log(`Measured: ${measuredRows.filter(row => row.status === "PASS").length}/${expectedMeasured} PASS`);
	console.log(
		`Matrix complete: ${provisionalContract.matrixComplete}; authoritative: ${provisionalContract.authoritative}`,
	);
	return computeExitCode({ hasFailure, hasBlocked, invalidCli: false });
}

if (import.meta.main) {
	run()
		.then(code => process.exit(code))
		.catch(error => {
			console.error("Benchmark harness failed", error);
			process.exit(1);
		});
}
