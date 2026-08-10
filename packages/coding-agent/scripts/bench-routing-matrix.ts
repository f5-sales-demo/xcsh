import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { completeSimple, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
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

	return {
		repetitions: Number(get("--repetitions") ?? process.env.ROUTING_MATRIX_REPETITIONS ?? "3"),
		warmups: Number(get("--warmups") ?? process.env.ROUTING_MATRIX_WARMUPS ?? "1"),
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
}

export function getProviderCredentials(): Record<string, ProviderCredential> {
	return {
		openai: {
			lane: "openai",
			provider: "openai",
			presetId: "openai/gpt-5.6",
			apiKey: process.env.OPENAI_API_KEY,
			baseUrl: process.env.OPENAI_BASE_URL,
		},
		anthropic: {
			lane: "anthropic",
			provider: "anthropic",
			presetId: "anthropic/claude",
			apiKey: process.env.ANTHROPIC_API_KEY,
			baseUrl: process.env.ANTHROPIC_BASE_URL,
		},
		"litellm-openai": {
			lane: "litellm-openai",
			provider: "litellm",
			presetId: "litellm/openai",
			apiKey: process.env.LITELLM_API_KEY,
			baseUrl: process.env.LITELLM_BASE_URL ?? process.env.LITELLM_URL,
		},
		"litellm-anthropic": {
			lane: "litellm-anthropic",
			provider: "litellm",
			presetId: "litellm/anthropic",
			apiKey: process.env.LITELLM_API_KEY,
			baseUrl: process.env.LITELLM_BASE_URL ?? process.env.LITELLM_URL,
		},
		"google-vertex": {
			lane: "google-vertex",
			provider: "google-vertex",
			presetId: "google-vertex/gemini",
			apiKey: process.env.VERTEX_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
			baseUrl: process.env.VERTEX_BASE_URL,
		},
	};
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

export interface MatrixEntry {
	lane: string;
	anchorModel: string;
	presetId: string;
	scenario: ScenarioDefinition;
}

export const CUSTOM_BENCH_POOLS: Record<string, RoutingPoolConfig> = {
	...BUILTIN_ROUTING_PRESETS,
	"google-vertex/gemini": {
		id: "google-vertex/gemini",
		provider: "google-vertex",
		tiers: {
			utility: "gemini-3.6-flash",
			balanced: "gemini-3.6-flash-lite",
			frontier: "gemini-3.6-pro",
		},
	},
};

export function expandLaneScenarios(lanes: string[]): MatrixEntry[] {
	const credentials = getProviderCredentials();
	const matrix: MatrixEntry[] = [];

	for (const lane of lanes) {
		const cred = credentials[lane];
		const presetId = cred ? cred.presetId : lane;
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
	servingModel?: string;
	expectedModel?: string;
	stopReason?: string;
	responseMarkerVerified: boolean;
	totalTokens: number;
	isNetworkError: boolean;
	error?: string;
}

export function classifyRunStatus(options: ClassifyRunStatusOptions): {
	status: "PASS" | "FAIL" | "BLOCKED";
	reason?: string;
} {
	if (
		options.isNetworkError ||
		(options.error && /401|403|unauthorized|forbidden|missing api key|dns|connect/i.test(options.error))
	) {
		return {
			status: "BLOCKED",
			reason: `BLOCKED: Network or Credential Unavailability - ${options.error ?? "Provider Key Missing/Invalid"}`,
		};
	}

	if (options.effectiveTier !== options.expectedTier) {
		return {
			status: "FAIL",
			reason: `Tier mismatch: expected ${options.expectedTier}, got ${options.effectiveTier ?? "none"}`,
		};
	}

	if (options.stopReason && options.stopReason !== "stop" && options.stopReason !== "end_turn") {
		return {
			status: "FAIL",
			reason: `Stop reason invalid: expected 'stop', got '${options.stopReason}'`,
		};
	}

	if (!options.responseMarkerVerified) {
		return {
			status: "FAIL",
			reason: `Response marker verification failed`,
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

export function redactSecretStrings(obj: any, secrets: string[]): any {
	if (!obj) return obj;
	const activeSecrets = secrets.filter(s => s && s.length >= 4);
	if (activeSecrets.length === 0) return obj;

	const jsonStr = JSON.stringify(obj);
	let sanitized = jsonStr;

	for (const secret of activeSecrets) {
		const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		sanitized = sanitized.replace(new RegExp(escaped, "g"), "[REDACTED]");
	}

	sanitized = sanitized.replace(/(sk-[a-zA-Z0-9T_-]{12,})/g, "[REDACTED]");
	sanitized = sanitized.replace(/(Bearer\s+)[a-zA-Z0-9T_.-]+/gi, "$1[REDACTED]");

	return JSON.parse(sanitized);
}

export function computeExitCode(results: Array<{ status: string }>): number {
	const hasFail = results.some(r => r.status === "FAIL");
	return hasFail ? 1 : 0;
}

export function constructModel(provider: string, modelId: string): Model<any> {
	const bundled = getBundledModel(provider as any, modelId);
	if (bundled) return bundled;
	return {
		id: modelId,
		name: modelId,
		provider,
		api: provider === "anthropic" ? "anthropic" : "openai",
		baseUrl: "",
		contextWindow: 128000,
		maxTokens: 4096,
		reasoning: false,
		inputTypes: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as unknown as Model<any>;
}

// 1x1 PNG Base64 Data URL for real multimodal payloads
const REAL_TINY_PNG_DATA_URL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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

	const inventoryStatus: Record<
		string,
		{ available: boolean; apiKeyPresent: boolean; baseUrl?: string; reason?: string }
	> = {};
	const secretsToRedact: string[] = [];

	for (const lane of args.lanes) {
		const cred = credentials[lane];
		if (cred?.apiKey) secretsToRedact.push(cred.apiKey);
		const hasKey = Boolean(cred?.apiKey || args.dryRun);
		inventoryStatus[lane] = {
			available: hasKey,
			apiKeyPresent: Boolean(cred?.apiKey),
			baseUrl: cred?.baseUrl,
			reason: hasKey ? undefined : "BLOCKED: Missing API key",
		};
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
		"google-vertex/gemini-3.6-flash",
		"google-vertex/gemini-3.6-flash-lite",
		"google-vertex/gemini-3.6-pro",
	];

	// Warmup Phase
	if (args.warmups > 0 && !args.dryRun) {
		console.log(`\nExecuting ${args.warmups} warmup calls per active lane...`);
		for (const lane of args.lanes) {
			if (!inventoryStatus[lane]?.available) continue;
			const cred = credentials[lane];
			const preset = BUILTIN_ROUTING_PRESETS[cred?.presetId ?? ""] ?? BUILTIN_ROUTING_PRESETS["openai/gpt-5.6"];
			const warmupModelId = preset.tiers.utility;
			const warmupModel = constructModel(cred?.provider ?? "openai", warmupModelId);

			for (let w = 1; w <= args.warmups; w++) {
				try {
					await completeSimple(
						warmupModel,
						{ systemPrompt: "Warmup", messages: [{ role: "user", content: "ping", timestamp: Date.now() }] },
						{ apiKey: cred?.apiKey ?? "mock-key", maxTokens: 10 },
					);
					console.log(`  ✓ [Warmup ${w}/${args.warmups}] Success for lane ${lane} (${warmupModelId})`);
				} catch (err: any) {
					console.warn(
						`  ! [Warmup ${w}/${args.warmups}] Failed for lane ${lane}: ${err?.message ?? String(err)}`,
					);
					inventoryStatus[lane].reason = `BLOCKED: Warmup failed - ${err?.message ?? String(err)}`;
				}
			}
		}
	}

	const scenarioMatrix = expandLaneScenarios(args.lanes);
	const results: any[] = [];
	let totalRuns = 0;
	let passedRuns = 0;
	let blockedRuns = 0;
	let failedRuns = 0;

	for (const entry of scenarioMatrix) {
		const laneCred = credentials[entry.lane];
		const isLaneAvailable = Boolean(laneCred?.apiKey || args.dryRun);

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
			const [provider, modelName] = selectedModelId.includes("/")
				? (selectedModelId.split("/") as [string, string])
				: [entry.lane, selectedModelId];

			const preset = BUILTIN_ROUTING_PRESETS[entry.presetId];
			const expectedTierModel = preset ? preset.tiers[entry.scenario.expectedTier] : undefined;

			let inferenceSuccess = false;
			let isNetworkError = false;
			let errorMessage: string | undefined;
			let servingModel = selectedModelId;
			let stopReason = "stop";
			let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
			let responseContent = "";
			let responseMarkerVerified = false;

			if (!isLaneAvailable) {
				isNetworkError = true;
				errorMessage = `BLOCKED: Provider ${entry.lane} missing API key`;
			} else if (args.dryRun) {
				inferenceSuccess = true;
				servingModel = expectedTierModel
					? expectedTierModel.includes("/")
						? expectedTierModel
						: `${provider}/${expectedTierModel}`
					: selectedModelId;
				responseContent = `[Dry-Run] ${entry.scenario.responseMarker}`;
				responseMarkerVerified = true;
				stopReason = "stop";
				tokenUsage = { inputTokens: 20, outputTokens: 15, totalTokens: 35 };
			} else {
				try {
					const modelObj = constructModel(provider, modelName);
					if (laneCred?.baseUrl) {
						modelObj.baseUrl = laneCred.baseUrl;
					}

					const userMessages: any[] = [];
					if (entry.scenario.hasImages) {
						userMessages.push({
							role: "user",
							content: [
								{ type: "text", text: entry.scenario.prompt },
								{ type: "image_url", image_url: { url: REAL_TINY_PNG_DATA_URL } },
							],
							timestamp: Date.now(),
						});
					} else {
						userMessages.push({ role: "user", content: entry.scenario.prompt, timestamp: Date.now() });
					}

					const response = await completeSimple(
						modelObj,
						{
							systemPrompt: "You are a benchmark model.",
							messages: userMessages,
						},
						{
							apiKey: laneCred?.apiKey ?? "mock",
							maxTokens: 256,
						},
					);

					if (response) {
						inferenceSuccess = true;
						servingModel = (response as any).model ?? (response as any).servingModel ?? selectedModelId;
						stopReason = (response as any).finishReason ?? (response as any).stopReason ?? "stop";
						tokenUsage = extractUsage(response);

						responseContent =
							typeof response.content === "string" ? response.content : JSON.stringify(response.content ?? "");
						responseMarkerVerified =
							responseContent.length > 0 && responseContent.includes(entry.scenario.responseMarker);
					}
				} catch (err: any) {
					const errStr = err?.message ?? String(err);
					if (/401|403|unauthorized|forbidden|dns|connect|network/i.test(errStr)) {
						isNetworkError = true;
					}
					errorMessage = errStr;
				}
			}

			const classification = classifyRunStatus({
				effectiveTier: routingDecision.effectiveTier,
				expectedTier: entry.scenario.expectedTier,
				servingModel,
				expectedModel: expectedTierModel,
				stopReason,
				responseMarkerVerified,
				totalTokens: tokenUsage.totalTokens,
				isNetworkError,
				error: errorMessage,
			});

			if (classification.status === "PASS") passedRuns++;
			else if (classification.status === "BLOCKED") blockedRuns++;
			else failedRuns++;

			console.log(
				`  Rep ${rep}/${args.repetitions}: ${classification.status} | Tier: ${routingDecision.effectiveTier} (expected: ${entry.scenario.expectedTier}) | Model: ${servingModel} | Tokens: ${tokenUsage.totalTokens}${classification.reason ? ` | ${classification.reason}` : ""}`,
			);

			results.push({
				lane: entry.lane,
				scenario: entry.scenario.name,
				scenarioId: entry.scenario.id,
				repetition: rep,
				expectedTier: entry.scenario.expectedTier,
				effectiveTier: routingDecision.effectiveTier,
				selectedModel: selectedModelId,
				servingModel,
				applied: routingDecision.applied,
				reasons: routingDecision.reasons,
				inferenceSuccess,
				responseMarkerVerified,
				stopReason,
				tokenUsage,
				status: classification.status,
				statusReason: classification.reason,
				latencyMs: Math.round((Bun.nanoseconds() - startNs) / 1000000),
			});
		}
	}

	const rawReport = {
		timestamp: new Date().toISOString(),
		gitCommit,
		cleanWorktree,
		authoritative: !args.dryRun,
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
	console.log(`Out-of-Repo Report written to: ${reportPath}`);

	const exitCode = computeExitCode(results);
	if (exitCode !== 0) {
		console.error(`\nBenchmark completed with ${failedRuns} FAIL status runs.`);
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
