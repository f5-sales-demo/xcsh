import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	completeSimple,
	getBundledModel,
	getBundledModels,
	type ImageContent,
	type Model,
	type TextContent,
	type UserMessage,
} from "@f5-sales-demo/pi-ai";
import { RoutingCoordinator } from "../src/routing/coordinator";
import { BUILTIN_ROUTING_PRESETS } from "../src/routing/presets";
import type { RoutingPoolConfig, RoutingTier } from "../src/routing/types";

export interface BenchmarkArgs {
	repetitions: number;
	warmups: number;
	lanes: string[];
	reportDir: string;
	dryRun: boolean;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): BenchmarkArgs {
	const get = (flag: string): string | undefined => {
		const idx = argv.indexOf(flag);
		return idx >= 0 ? argv[idx + 1] : undefined;
	};
	const has = (flag: string): boolean => argv.includes(flag);

	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const defaultReportDir = process.env.ROUTING_MATRIX_REPORT_DIR ?? path.join("/tmp", "routing-matrix-reports", ts);

	const rawLanes =
		get("--lanes") ??
		process.env.ROUTING_MATRIX_LANES ??
		"openai,anthropic,litellm-openai,litellm-anthropic,google-vertex";

	const repStr = get("--repetitions") ?? process.env.ROUTING_MATRIX_REPETITIONS ?? "3";
	const warmStr = get("--warmups") ?? process.env.ROUTING_MATRIX_WARMUPS ?? "1";

	const repetitions = Number(repStr);
	const warmups = Number(warmStr);

	if (
		!Number.isInteger(repetitions) ||
		!Number.isFinite(repetitions) ||
		repetitions < 1 ||
		!Number.isInteger(warmups) ||
		!Number.isFinite(warmups) ||
		warmups < 0
	) {
		throw new Error(
			`Invalid benchmark counts: repetitions (${repStr}) must be an integer >= 1, warmups (${warmStr}) must be an integer >= 0`,
		);
	}

	return {
		repetitions,
		warmups,
		lanes: rawLanes.split(",").map(s => s.trim().toLowerCase()),
		reportDir: get("--report-dir") ?? get("--out") ?? defaultReportDir,
		dryRun: has("--dry-run") || process.env.ROUTING_MATRIX_DRY_RUN === "true",
	};
}

export interface ProviderCredential {
	lane: string;
	provider: string;
	presetId: string;
	apiKey?: string;
	baseUrl?: string;
	authMechanism?: string;
}

export function getProviderCredentials(): Record<string, ProviderCredential> {
	const openaiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_OAUTH_TOKEN;
	const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_OAUTH_TOKEN;
	const litellmKey =
		process.env.LITELLM_OPENAI_API_KEY ?? process.env.LITELLM_ANTHROPIC_API_KEY ?? process.env.LITELLM_API_KEY;
	const vertexKey =
		process.env.VERTEX_API_KEY ??
		process.env.GOOGLE_API_KEY ??
		process.env.GEMINI_API_KEY ??
		(process.env.GOOGLE_APPLICATION_CREDENTIALS ? "adc-configured" : undefined);

	return {
		openai: {
			lane: "openai",
			provider: "openai",
			presetId: "openai/gpt-5.6",
			apiKey: openaiKey,
			baseUrl: process.env.OPENAI_BASE_URL,
			authMechanism: openaiKey ? "api-key" : undefined,
		},
		anthropic: {
			lane: "anthropic",
			provider: "anthropic",
			presetId: "anthropic/claude",
			apiKey: anthropicKey,
			baseUrl: process.env.ANTHROPIC_BASE_URL,
			authMechanism: anthropicKey ? "api-key" : undefined,
		},
		"litellm-openai": {
			lane: "litellm-openai",
			provider: "litellm",
			presetId: "litellm/openai",
			apiKey: litellmKey,
			baseUrl: process.env.LITELLM_OPENAI_BASE_URL ?? process.env.LITELLM_BASE_URL ?? process.env.LITELLM_URL,
			authMechanism: litellmKey ? "api-key" : undefined,
		},
		"litellm-anthropic": {
			lane: "litellm-anthropic",
			provider: "litellm",
			presetId: "litellm/anthropic",
			apiKey: litellmKey,
			baseUrl: process.env.LITELLM_ANTHROPIC_BASE_URL ?? process.env.LITELLM_BASE_URL ?? process.env.LITELLM_URL,
			authMechanism: litellmKey ? "api-key" : undefined,
		},
		"google-vertex": {
			lane: "google-vertex",
			provider: "google-vertex",
			presetId: "google-vertex/gemini",
			apiKey: vertexKey,
			baseUrl: process.env.VERTEX_BASE_URL,
			authMechanism: process.env.GOOGLE_APPLICATION_CREDENTIALS ? "google-adc" : vertexKey ? "api-key" : undefined,
		},
	};
}

export async function discoverAuthenticatedInventory(
	lane: string,
	cred: ProviderCredential,
	dryRun: boolean,
): Promise<{ success: boolean; models: string[]; reason?: string }> {
	if (dryRun) {
		const bundled = getBundledModels(cred.provider as any);
		return { success: true, models: bundled.map(m => m.id) };
	}

	if (!cred.apiKey) {
		return { success: false, models: [], reason: "BLOCKED: Credentials missing" };
	}

	try {
		const baseUrl =
			cred.baseUrl ??
			(cred.provider === "openai"
				? "https://api.openai.com/v1"
				: cred.provider === "anthropic"
					? "https://api.anthropic.com/v1"
					: undefined);
		if (!baseUrl) {
			const bundled = getBundledModels(cred.provider as any);
			return { success: true, models: bundled.map(m => m.id) };
		}

		const targetUrl = baseUrl.endsWith("/models") ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/models`;
		const headers: Record<string, string> = {};
		if (cred.provider === "anthropic") {
			headers["x-api-key"] = cred.apiKey;
			headers["anthropic-version"] = "2023-06-01";
		} else {
			headers.Authorization = `Bearer ${cred.apiKey}`;
		}

		const res = await fetch(targetUrl, {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(10000),
		});

		if (res.ok) {
			const data = (await res.json()) as any;
			const rawList = Array.isArray(data) ? data : (data?.data ?? []);
			const models = rawList.map((m: any) => (typeof m === "string" ? m : (m.id ?? m.name))).filter(Boolean);
			return { success: true, models };
		}

		if (res.status === 401 || res.status === 403) {
			return {
				success: false,
				models: [],
				reason: `BLOCKED: HTTP ${res.status} Unauthorized/Forbidden during inventory discovery`,
			};
		}

		// Fallback to bundled if discovery endpoint not implemented on provider gateway
		const bundled = getBundledModels(cred.provider as any);
		return { success: true, models: bundled.map(m => m.id) };
	} catch (err: any) {
		const errStr = err?.message ?? String(err);
		if (/401|403|unauthorized|forbidden|dns|connect|timeout/i.test(errStr)) {
			return { success: false, models: [], reason: `BLOCKED: Inventory discovery network error - ${errStr}` };
		}
		const bundled = getBundledModels(cred.provider as any);
		return { success: true, models: bundled.map(m => m.id) };
	}
}

export interface ScenarioDefinition {
	id: string;
	name: string;
	expectedTier: RoutingTier;
	prompt: string;
	responseMarker: string;
	hasImages?: boolean;
}

export const BASE_SCENARIOS: ScenarioDefinition[] = [
	{
		id: "utility-greeting",
		name: "Utility Greeting",
		expectedTier: "utility",
		prompt: "Respond with 'RESPOND_UTILITY_OK' and nothing else.",
		responseMarker: "RESPOND_UTILITY_OK",
	},
	{
		id: "balanced-reasoning",
		name: "Balanced Reasoning",
		expectedTier: "balanced",
		prompt: "Compare stack memory vs heap memory structure in detail and return 'RESPOND_BALANCED_OK'.",
		responseMarker: "RESPOND_BALANCED_OK",
	},
	{
		id: "frontier-analysis",
		name: "Frontier Complex Code Analysis",
		expectedTier: "frontier",
		prompt:
			"Perform a deep security analysis of a multi-file TypeScript architecture for concurrency deadlocks, memory leaks, and prototype pollution risks. Return 'RESPOND_FRONTIER_OK'.",
		responseMarker: "RESPOND_FRONTIER_OK",
	},
	{
		id: "multimodal-visual",
		name: "Multimodal Visual Inspection",
		expectedTier: "frontier",
		prompt: "Describe what is visible in this uploaded image and verify 'RESPOND_VISUAL_OK'.",
		responseMarker: "RESPOND_VISUAL_OK",
		hasImages: true,
	},
];

export const CUSTOM_BENCH_POOLS: Record<string, RoutingPoolConfig> = {
	...BUILTIN_ROUTING_PRESETS,
	"google-vertex/gemini": {
		id: "google-vertex/gemini",
		provider: "google-vertex",
		tiers: {
			utility: "gemini-2.5-flash-lite",
			balanced: "gemini-2.5-flash",
			frontier: "gemini-2.5-pro",
		},
	},
};

export interface MatrixEntry {
	lane: string;
	anchorModel: string;
	presetId: string;
	scenario: ScenarioDefinition;
}

export function expandLaneScenarios(lanes: string[]): MatrixEntry[] {
	const credentials = getProviderCredentials();
	const matrix: MatrixEntry[] = [];

	for (const lane of lanes) {
		const cred = credentials[lane];
		if (!cred) {
			throw new Error(`Unknown provider lane: '${lane}'`);
		}
		const presetId = cred.presetId;
		const pool = CUSTOM_BENCH_POOLS[presetId] ?? BUILTIN_ROUTING_PRESETS["openai/gpt-5.6"];

		for (const scenario of BASE_SCENARIOS) {
			const rawModel = pool.tiers[scenario.expectedTier];
			const anchorModel = rawModel.includes("/") ? rawModel : `${pool.provider}/${rawModel}`;

			matrix.push({
				lane,
				anchorModel,
				presetId,
				scenario,
			});
		}
	}

	return matrix;
}

export interface ClassifyRunStatusOptions {
	effectiveTier?: RoutingTier;
	expectedTier: RoutingTier;
	servingProvider?: string;
	expectedProvider?: string;
	servingModel?: string;
	expectedModel?: string;
	stopReason?: string;
	responseContent?: string;
	expectedMarker: string;
	totalTokens: number;
	isNetworkError: boolean;
	error?: string;
}

export function classifyRunStatus(options: ClassifyRunStatusOptions): {
	status: "PASS" | "FAIL" | "BLOCKED";
	reason?: string;
} {
	// Deterministic Routing / Model Mismatches take HIGHEST precedence over network BLOCKED
	if (options.effectiveTier !== options.expectedTier) {
		return {
			status: "FAIL",
			reason: `Tier mismatch: expected ${options.expectedTier}, got ${options.effectiveTier ?? "none"}`,
		};
	}

	if (options.servingProvider && options.expectedProvider) {
		if (options.servingProvider !== options.expectedProvider) {
			return {
				status: "FAIL",
				reason: `Provider mismatch: expected provider '${options.expectedProvider}', got '${options.servingProvider}'`,
			};
		}
	}

	if (options.servingModel && options.expectedModel) {
		if (options.servingModel !== options.expectedModel) {
			return {
				status: "FAIL",
				reason: `Model mismatch: expected ${options.expectedModel}, got ${options.servingModel}`,
			};
		}
	}

	// Network / Auth Unavailability when routing & model were correct -> BLOCKED
	if (
		options.isNetworkError ||
		(options.error && /401|403|unauthorized|forbidden|missing api key|dns|connect|timeout/i.test(options.error))
	) {
		return {
			status: "BLOCKED",
			reason: `BLOCKED: Network or Credential Unavailability - ${options.error ?? "Provider Key Missing/Invalid"}`,
		};
	}

	if (!options.stopReason || options.stopReason !== "stop") {
		return {
			status: "FAIL",
			reason: `Stop reason missing or invalid: expected 'stop', got '${options.stopReason ?? "undefined"}'`,
		};
	}

	// Exact marker validation: content must equal expectedMarker (trimmed)
	const content = options.responseContent?.trim() ?? "";
	if (content !== options.expectedMarker) {
		return {
			status: "FAIL",
			reason: `Exact response marker verification failed: expected '${options.expectedMarker}', got '${content.slice(0, 100)}'`,
		};
	}

	if (options.totalTokens <= 0) {
		return {
			status: "FAIL",
			reason: `Token usage invalid: totalTokens is ${options.totalTokens}`,
		};
	}

	if (options.error) {
		return {
			status: "FAIL",
			reason: `Behavioral error: ${options.error}`,
		};
	}

	return { status: "PASS" };
}

export function extractUsage(response: any): { inputTokens: number; outputTokens: number; totalTokens: number } {
	if (!response) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
	const usage = response.usage ?? (response.details as any)?.usage ?? {};

	const inputTokens = usage.input ?? usage.promptTokens ?? usage.inputTokens ?? 0;
	const outputTokens = usage.output ?? usage.completionTokens ?? usage.outputTokens ?? 0;
	const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;

	return { inputTokens, outputTokens, totalTokens };
}

export function redactSecretStrings(obj: any, secrets: string[] = []): any {
	if (!obj) return obj;
	const jsonStr = JSON.stringify(obj);
	let sanitized = jsonStr;

	const activeSecrets = secrets.filter(s => Boolean(s) && s.length >= 4);
	for (const secret of activeSecrets) {
		const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		sanitized = sanitized.replace(new RegExp(escaped, "g"), "[REDACTED]");
	}

	// Always execute generic token and credential URL sanitization preserving scheme
	const skPattern = new RegExp("(s" + "k-[a-zA-Z0-9T_-]{12,})", "g");
	sanitized = sanitized.replace(skPattern, "[REDACTED]");
	sanitized = sanitized.replace(/(mock-secret-[a-zA-Z0-9T_-]{8,})/g, "[REDACTED]");
	sanitized = sanitized.replace(/(Bearer\s+)[a-zA-Z0-9T_.-]+/gi, "$1[REDACTED]");
	sanitized = sanitized.replace(/(https?:\/\/)([^:]+):([^@]+)@/g, "$1[REDACTED]:[REDACTED]@");
	sanitized = sanitized.replace(/([?&](?:api_key|key|token|access_token)=)[^&"'\s]+/gi, "$1[REDACTED]");

	return JSON.parse(sanitized);
}

export interface ContractIntegrityOptions {
	dryRun: boolean;
	cleanWorktree: boolean;
	totalRuns: number;
	passedRuns: number;
	blockedRuns: number;
	failedRuns: number;
}

export function validateContractIntegrity(options: ContractIntegrityOptions): {
	authoritative: boolean;
	matrixComplete: boolean;
} {
	const matrixComplete =
		options.totalRuns > 0 &&
		options.passedRuns === options.totalRuns &&
		options.blockedRuns === 0 &&
		options.failedRuns === 0;

	const authoritative = !options.dryRun && options.cleanWorktree && matrixComplete;

	return { authoritative, matrixComplete };
}

export function computeExitCode(results: Array<{ status: string }>, passedRuns: number, totalRuns: number): number {
	const hasFail = results.some(r => r.status === "FAIL");
	if (hasFail) return 1;

	// Partial-BLOCKED executions (passedRuns < totalRuns) do NOT establish a complete matrix and must exit 1
	if (passedRuns < totalRuns || totalRuns === 0) return 1;

	return 0;
}

export function constructModel(provider: string, modelId: string): Model<any> {
	const bundled = getBundledModel(provider as any, modelId);
	if (bundled) return bundled;

	const api =
		provider === "anthropic"
			? "anthropic-messages"
			: provider === "google-vertex"
				? "google-vertex"
				: "openai-responses";

	return {
		id: modelId,
		name: modelId,
		provider,
		api,
		baseUrl: "",
		contextWindow: 128000,
		maxTokens: 4096,
		reasoning: false,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as unknown as Model<any>;
}

// 1x1 PNG Base64 string for strongly typed pi-ai multimodal payload
const REAL_TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function createMultimodalMessage(prompt: string, marker: string): UserMessage {
	const textBlock: TextContent = { type: "text", text: prompt };
	const imageBlock: ImageContent = {
		type: "image",
		data: REAL_TINY_PNG_BASE64,
		mimeType: "image/png",
	};

	return {
		role: "user",
		content: [textBlock, imageBlock],
		timestamp: Date.now(),
	};
}

export function normalizeStopReason(raw?: string): string | undefined {
	if (!raw) return undefined;
	const lower = raw.toLowerCase().trim();
	if (lower === "stop" || lower === "end_turn" || lower === "stop_sequence") {
		return "stop";
	}
	return lower;
}

async function main() {
	const args = parseArgs();
	console.log(`Starting Authenticated Routing Matrix Benchmark Harness...`);
	console.log(`Lanes: ${args.lanes.join(", ")} | Repetitions: ${args.repetitions} | Warmups: ${args.warmups}`);
	console.log(`Report Dir: ${args.reportDir} | Dry Run: ${args.dryRun}`);

	const credentials = getProviderCredentials();

	// Git Provenance
	let gitCommit = "unknown";
	let cleanWorktree = false;
	try {
		gitCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
		const statusOutput = execSync("git status --porcelain", { encoding: "utf8" }).trim();
		cleanWorktree = statusOutput.length === 0;
	} catch {}

	if (!args.dryRun && !cleanWorktree) {
		console.error(
			`ERROR: Git worktree is dirty during live authenticated run. Non-dry-run contract requires clean HEAD.`,
		);
		process.exit(1);
	}

	const inventoryStatus: Record<
		string,
		{
			available: boolean;
			apiKeyPresent: boolean;
			baseUrl?: string;
			authMechanism?: string;
			modelsDiscovered?: string[];
			reason?: string;
		}
	> = {};
	const secretsToRedact: string[] = [];

	console.log(`\nPerforming live HTTP inventory discovery per active lane...`);
	for (const lane of args.lanes) {
		const cred = credentials[lane];
		if (!cred) {
			throw new Error(`Unknown lane: '${lane}'`);
		}
		if (cred.apiKey) secretsToRedact.push(cred.apiKey);

		const discovery = await discoverAuthenticatedInventory(lane, cred, args.dryRun);

		inventoryStatus[lane] = {
			available: discovery.success,
			apiKeyPresent: Boolean(cred.apiKey),
			baseUrl: cred.baseUrl,
			authMechanism: cred.authMechanism,
			modelsDiscovered: discovery.models,
			reason: discovery.success ? undefined : discovery.reason,
		};

		if (discovery.success) {
			console.log(`  ✓ Discovered ${discovery.models.length} models for lane ${lane}`);
		} else {
			console.warn(`  ! Lane ${lane} inventory discovery failed: ${discovery.reason}`);
		}
	}

	const coordinator = new RoutingCoordinator();

	// Candidate pool models across all providers
	const availableModels = [
		"openai/gpt-5.4-mini",
		"openai/gpt-5.4",
		"openai/gpt-5.6-sol",
		"anthropic/claude-3-haiku-20240307",
		"anthropic/claude-3-5-sonnet-20241022",
		"anthropic/claude-opus-4-0",
		"litellm/gpt-5.4-mini",
		"litellm/gpt-5.4",
		"litellm/gpt-5.6-sol",
		"litellm/claude-3-5-haiku-20241022",
		"litellm/claude-3-5-sonnet-20241022",
		"litellm/claude-opus-4-0",
		"google-vertex/gemini-2.5-flash-lite",
		"google-vertex/gemini-2.5-flash",
		"google-vertex/gemini-2.5-pro",
	];

	let totalRuns = 0;
	let passedRuns = 0;
	let blockedRuns = 0;
	let failedRuns = 0;

	// Warmup Phase with baseUrl and timeout signal
	if (args.warmups > 0 && !args.dryRun) {
		console.log(`\nExecuting ${args.warmups} warmup calls per active lane...`);
		for (const lane of args.lanes) {
			if (!inventoryStatus[lane]?.available) continue;
			const cred = credentials[lane];
			const pool = CUSTOM_BENCH_POOLS[cred.presetId] ?? BUILTIN_ROUTING_PRESETS["openai/gpt-5.6"];
			const warmupModelId = pool.tiers.utility;
			const warmupModel = constructModel(cred.provider, warmupModelId);

			if (cred.baseUrl) {
				warmupModel.baseUrl = cred.baseUrl;
			}

			let warmupFailed = false;
			let warmupErrorReason: string | undefined;

			for (let w = 1; w <= args.warmups; w++) {
				try {
					await completeSimple(
						warmupModel,
						{ systemPrompt: "Warmup", messages: [{ role: "user", content: "ping", timestamp: Date.now() }] },
						{
							apiKey: cred.apiKey ?? "mock-key",
							maxTokens: 10,
							signal: AbortSignal.timeout(20000),
						},
					);
					console.log(`  ✓ [Warmup ${w}/${args.warmups}] Success for lane ${lane} (${warmupModelId})`);
				} catch (err: any) {
					warmupFailed = true;
					warmupErrorReason = err?.message ?? String(err);
					console.warn(`  ! [Warmup ${w}/${args.warmups}] Failed for lane ${lane}: ${warmupErrorReason}`);
					break;
				}
			}

			if (warmupFailed) {
				const isNet = /401|403|unauthorized|forbidden|dns|connect|timeout/i.test(warmupErrorReason ?? "");
				if (isNet) {
					inventoryStatus[lane].available = false;
					inventoryStatus[lane].reason = `BLOCKED: Warmup network/credential failure - ${warmupErrorReason}`;
				} else {
					// Warmup behavioral error counts as FAIL in metrics
					failedRuns++;
					inventoryStatus[lane].reason = `FAIL: Warmup behavioral error - ${warmupErrorReason}`;
				}
			}
		}
	}

	const scenarioMatrix = expandLaneScenarios(args.lanes);
	const results: any[] = [];

	for (const entry of scenarioMatrix) {
		const laneCred = credentials[entry.lane];
		const isLaneAvailable = Boolean(inventoryStatus[entry.lane]?.available);

		console.log(
			`\nLane: ${entry.lane} | Scenario: ${entry.scenario.name} (Expected Tier: ${entry.scenario.expectedTier})`,
		);

		for (let rep = 1; rep <= args.repetitions; rep++) {
			totalRuns++;
			coordinator.reset();
			const startNs = Bun.nanoseconds();

			const routingDecision = await coordinator.evaluateTurn({
				anchorModel: entry.anchorModel,
				mode: "auto",
				prompt: entry.scenario.prompt,
				hasImages: entry.scenario.hasImages || false,
				availableModels,
				customPools: CUSTOM_BENCH_POOLS,
				profilerMode: "rules",
				ttftStartNs: startNs,
				signal: AbortSignal.timeout(20000),
			});

			const selectedModelId = routingDecision.selectedModel ?? entry.anchorModel;
			const pool = CUSTOM_BENCH_POOLS[entry.presetId];
			const rawExpectedModel = pool ? pool.tiers[entry.scenario.expectedTier] : undefined;
			const expectedProvider = pool ? pool.provider : laneCred.provider;
			const expectedModel = rawExpectedModel
				? rawExpectedModel.includes("/")
					? rawExpectedModel
					: `${expectedProvider}/${rawExpectedModel}`
				: selectedModelId;

			const [selectedProvider, modelName] = selectedModelId.includes("/")
				? (selectedModelId.split("/") as [string, string])
				: [laneCred.provider, selectedModelId];

			let inferenceSuccess = false;
			let isNetworkError = false;
			let errorMessage: string | undefined;
			let servingProvider = selectedProvider;
			let servingModel = selectedModelId;
			let stopReason: string | undefined = "stop";
			let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
			let responseContent = "";

			if (!isLaneAvailable) {
				isNetworkError = true;
				errorMessage =
					inventoryStatus[entry.lane]?.reason ??
					`BLOCKED: Provider ${entry.lane} missing API key or warmup failed`;
			} else if (args.dryRun) {
				inferenceSuccess = true;
				servingProvider = expectedProvider ?? selectedProvider;
				servingModel = expectedModel;
				responseContent = entry.scenario.responseMarker;
				stopReason = "stop";
				tokenUsage = { inputTokens: 20, outputTokens: 15, totalTokens: 35 };
			} else {
				try {
					const modelObj = constructModel(selectedProvider, modelName);
					if (laneCred.baseUrl) {
						modelObj.baseUrl = laneCred.baseUrl;
					}

					let userMessage: UserMessage;
					if (entry.scenario.hasImages) {
						userMessage = createMultimodalMessage(entry.scenario.prompt, entry.scenario.responseMarker);
					} else {
						userMessage = { role: "user", content: entry.scenario.prompt, timestamp: Date.now() };
					}

					const response = await completeSimple(
						modelObj,
						{
							systemPrompt: "You are a benchmark model.",
							messages: [userMessage],
						},
						{
							apiKey: laneCred.apiKey ?? "mock",
							maxTokens: 256,
							signal: AbortSignal.timeout(20000),
						},
					);

					if (response) {
						inferenceSuccess = true;

						// Genuine serving provider & model extraction
						const rawProv = (response as any).provider ?? (response as any).servingProvider;
						const rawModel = (response as any).model ?? (response as any).servingModel ?? selectedModelId;

						servingProvider = rawProv ?? selectedProvider;
						servingModel = rawModel.includes("/") ? rawModel : `${servingProvider}/${rawModel}`;

						const rawStop = (response as any).finishReason ?? (response as any).stopReason;
						stopReason = normalizeStopReason(rawStop);
						tokenUsage = extractUsage(response);

						responseContent =
							typeof response.content === "string" ? response.content : JSON.stringify(response.content ?? "");
					}
				} catch (err: any) {
					const errStr = err?.message ?? String(err);
					if (/401|403|unauthorized|forbidden|dns|connect|network|timeout/i.test(errStr)) {
						isNetworkError = true;
					}
					errorMessage = errStr;
				}
			}

			const classification = classifyRunStatus({
				effectiveTier: routingDecision.effectiveTier,
				expectedTier: entry.scenario.expectedTier,
				servingProvider,
				expectedProvider,
				servingModel,
				expectedModel,
				stopReason,
				responseContent,
				expectedMarker: entry.scenario.responseMarker,
				totalTokens: tokenUsage.totalTokens,
				isNetworkError,
				error: errorMessage,
			});

			if (classification.status === "PASS") passedRuns++;
			else if (classification.status === "BLOCKED") blockedRuns++;
			else failedRuns++;

			console.log(
				`  Rep ${rep}/${args.repetitions}: ${classification.status} | Tier: ${routingDecision.effectiveTier} (expected: ${entry.scenario.expectedTier}) | Model: ${servingModel} (expected: ${expectedModel}) | Tokens: ${tokenUsage.totalTokens}${classification.reason ? ` | ${classification.reason}` : ""}`,
			);

			results.push({
				lane: entry.lane,
				scenario: entry.scenario.name,
				scenarioId: entry.scenario.id,
				repetition: rep,
				expectedTier: entry.scenario.expectedTier,
				effectiveTier: routingDecision.effectiveTier,
				selectedModel: selectedModelId,
				expectedProvider,
				expectedModel,
				servingProvider,
				servingModel,
				applied: routingDecision.applied,
				reasons: routingDecision.reasons,
				inferenceSuccess,
				stopReason,
				tokenUsage,
				status: classification.status,
				statusReason: classification.reason,
				latencyMs: Math.round((Bun.nanoseconds() - startNs) / 1000000),
			});
		}
	}

	const contractIntegrity = validateContractIntegrity({
		dryRun: args.dryRun,
		cleanWorktree,
		totalRuns,
		passedRuns,
		blockedRuns,
		failedRuns,
	});

	const rawReport = {
		timestamp: new Date().toISOString(),
		gitCommit,
		cleanWorktree,
		authoritative: contractIntegrity.authoritative,
		matrixComplete: contractIntegrity.matrixComplete,
		summary: {
			totalScenarios: scenarioMatrix.length,
			totalRuns,
			passedRuns,
			blockedRuns,
			failedRuns,
		},
		parameters: args,
		inventoryStatus,
		results,
	};

	const report = redactSecretStrings(rawReport, secretsToRedact);

	fs.mkdirSync(args.reportDir, { recursive: true });
	const reportPath = path.join(args.reportDir, "routing-matrix-report.json");
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

	console.log(`\nBenchmark Summary: ${passedRuns}/${totalRuns} PASS | ${blockedRuns} BLOCKED | ${failedRuns} FAIL`);
	console.log(
		`Matrix Complete: ${contractIntegrity.matrixComplete} | Authoritative: ${contractIntegrity.authoritative}`,
	);
	console.log(`Out-of-Repo Report written to: ${reportPath}`);

	const exitCode = computeExitCode(results, passedRuns, totalRuns);
	if (exitCode !== 0) {
		console.error(
			`\nBenchmark failed contract validation: Matrix is incomplete (${passedRuns}/${totalRuns} passed) or has failures (${failedRuns} failed).`,
		);
	}
	process.exit(exitCode);
}

// Execute main if run as script
if (import.meta.main) {
	main().catch(err => {
		console.error("Benchmark harness execution failed:", err);
		process.exit(1);
	});
}
