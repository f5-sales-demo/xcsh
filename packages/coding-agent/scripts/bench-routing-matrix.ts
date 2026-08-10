import * as fs from "node:fs";
import * as path from "node:path";
import { completeSimple, getBundledModel, type Model } from "@f5-sales-demo/pi-ai";
import { RoutingCoordinator } from "../src/routing/coordinator";
import type { RoutingTier } from "../src/routing/types";

interface BenchmarkArgs {
	repetitions: number;
	warmups: number;
	lanes: string[];
	reportDir: string;
	dryRun: boolean;
}

function parseArgs(): BenchmarkArgs {
	const args = process.argv.slice(2);
	const get = (flag: string): string | undefined => {
		const idx = args.indexOf(flag);
		return idx >= 0 ? args[idx + 1] : undefined;
	};
	const has = (flag: string): boolean => args.includes(flag);

	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const defaultReportDir = process.env.ROUTING_MATRIX_REPORT_DIR ?? path.join("/tmp", "routing-matrix-reports", ts);

	return {
		repetitions: Number(get("--repetitions") ?? process.env.ROUTING_MATRIX_REPETITIONS ?? "2"),
		warmups: Number(get("--warmups") ?? process.env.ROUTING_MATRIX_WARMUPS ?? "1"),
		lanes: (get("--lanes") ?? "openai,anthropic,litellm,google-vertex").split(",").map(s => s.trim().toLowerCase()),
		reportDir: get("--report-dir") ?? get("--out") ?? defaultReportDir,
		dryRun: has("--dry-run") || process.env.ROUTING_MATRIX_DRY_RUN === "true",
	};
}

interface ProviderCredential {
	provider: string;
	apiKey?: string;
	baseUrl?: string;
}

function getProviderCredentials(): Record<string, ProviderCredential> {
	return {
		openai: {
			provider: "openai",
			apiKey: process.env.OPENAI_API_KEY,
			baseUrl: process.env.OPENAI_BASE_URL,
		},
		anthropic: {
			provider: "anthropic",
			apiKey: process.env.ANTHROPIC_API_KEY,
			baseUrl: process.env.ANTHROPIC_BASE_URL,
		},
		litellm: {
			provider: "litellm",
			apiKey: process.env.LITELLM_API_KEY,
			baseUrl: process.env.LITELLM_BASE_URL ?? process.env.LITELLM_URL,
		},
		"google-vertex": {
			provider: "google-vertex",
			apiKey: process.env.VERTEX_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY,
			baseUrl: process.env.VERTEX_BASE_URL,
		},
	};
}

interface Scenario {
	name: string;
	anchorModel: string;
	prompt: string;
	expectedTier: RoutingTier;
	hasImages?: boolean;
	responseMarker: string;
}

const BENCHMARK_SCENARIOS: Scenario[] = [
	{
		name: "Greeting Utility",
		anchorModel: "openai/gpt-5.4-mini",
		prompt: "Respond with the word 'HELLO' and nothing else.",
		expectedTier: "utility",
		responseMarker: "HELLO",
	},
	{
		name: "Complex Code Analysis",
		anchorModel: "openai/gpt-5.6-sol",
		prompt:
			"Analyze a complex multi-file TypeScript architecture for concurrency deadlocks and memory leaks. Return 'ANALYSIS_OK'.",
		expectedTier: "frontier",
		responseMarker: "ANALYSIS",
	},
	{
		name: "Multimodal Visual Inspection",
		anchorModel: "openai/gpt-5.6-sol",
		prompt: "Describe what is visible in this uploaded image and verify 'VISUAL_OK'.",
		expectedTier: "frontier",
		hasImages: true,
		responseMarker: "VISUAL",
	},
];

function constructModel(provider: string, modelId: string): Model<any> {
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
		inputTypes: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	} as unknown as Model<any>;
}

async function main() {
	const args = parseArgs();
	console.log(`Starting Authenticated Routing Matrix Benchmark...`);
	console.log(`Lanes: ${args.lanes.join(", ")} | Repetitions: ${args.repetitions} | Warmups: ${args.warmups}`);
	console.log(`Report Dir: ${args.reportDir} | Dry Run: ${args.dryRun}`);

	const credentials = getProviderCredentials();
	const inventoryStatus: Record<string, { available: boolean; apiKeyPresent: boolean; reason?: string }> = {};

	for (const lane of args.lanes) {
		const cred = credentials[lane];
		const hasKey = Boolean(cred?.apiKey || args.dryRun);
		inventoryStatus[lane] = {
			available: hasKey,
			apiKeyPresent: Boolean(cred?.apiKey),
			reason: hasKey ? undefined : "BLOCKED: Missing API key",
		};
	}

	const coordinator = new RoutingCoordinator();

	// Active candidate pool per lane
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
		"google-vertex/gemini-3.6-flash",
		"google-vertex/gemini-3.6-pro",
	];

	// Warmup phase per active provider lane
	if (args.warmups > 0 && !args.dryRun) {
		console.log("\nExecuting warmup calls across active provider lanes...");
		for (const lane of args.lanes) {
			if (!inventoryStatus[lane]?.available) continue;
			const cred = credentials[lane];
			try {
				const warmupModel = constructModel(lane, lane === "openai" ? "gpt-5.4-mini" : "claude-3-haiku-20240307");
				await completeSimple(
					warmupModel,
					{ systemPrompt: "Warmup", messages: [{ role: "user", content: "ping", timestamp: Date.now() }] },
					{ apiKey: cred.apiKey ?? "mock-key", maxTokens: 10 },
				);
				console.log(`  ✓ Warmup succeeded for lane: ${lane}`);
			} catch (err: any) {
				console.warn(`  ! Warmup failed for lane ${lane}: ${err?.message ?? String(err)}`);
				inventoryStatus[lane].reason = `BLOCKED: Warmup failed - ${err?.message ?? String(err)}`;
			}
		}
	}

	const results: any[] = [];
	let totalRuns = 0;
	let passedRuns = 0;
	let blockedRuns = 0;

	for (const scenario of BENCHMARK_SCENARIOS) {
		console.log(`\nScenario: ${scenario.name} (Expected Tier: ${scenario.expectedTier})`);

		for (let rep = 1; rep <= args.repetitions; rep++) {
			coordinator.reset();
			totalRuns++;
			const startNs = Bun.nanoseconds();

			const routingDecision = await coordinator.evaluateTurn({
				anchorModel: scenario.anchorModel,
				mode: "auto",
				prompt: scenario.prompt,
				hasImages: scenario.hasImages || false,
				availableModels,
				profilerMode: "rules",
				ttftStartNs: startNs,
				signal: AbortSignal.timeout(15000),
			});

			const selectedModelId = routingDecision.selectedModel ?? "openai/gpt-5.4-mini";
			const [provider, modelName] = selectedModelId.includes("/")
				? (selectedModelId.split("/") as [string, string])
				: ["openai", selectedModelId];

			const laneCred = credentials[provider];
			const isLaneAvailable = Boolean(laneCred?.apiKey || args.dryRun);

			let inferenceSuccess = false;
			let isBlocked = false;
			let errorMessage: string | undefined;
			let servingModel = selectedModelId;
			let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
			let responseContent = "";
			let responseMarkerVerified = false;

			if (!isLaneAvailable) {
				isBlocked = true;
				errorMessage = `BLOCKED: Provider ${provider} missing API key`;
				blockedRuns++;
			} else if (args.dryRun) {
				inferenceSuccess = true;
				responseContent = `[Dry-Run] Mock response containing ${scenario.responseMarker}`;
				responseMarkerVerified = true;
				servingModel = selectedModelId;
				tokenUsage = { promptTokens: 15, completionTokens: 10, totalTokens: 25 };
			} else {
				try {
					const modelObj = constructModel(provider, modelName);
					if (laneCred.baseUrl) {
						modelObj.baseUrl = laneCred.baseUrl;
					}
					const response = await completeSimple(
						modelObj,
						{
							systemPrompt: "You are a benchmark model.",
							messages: [{ role: "user", content: scenario.prompt, timestamp: Date.now() }],
						},
						{
							apiKey: laneCred.apiKey ?? "mock",
							maxTokens: 256,
						},
					);

					if (response) {
						inferenceSuccess = true;
						servingModel = (response as any).model ?? selectedModelId;
						responseContent =
							typeof response.content === "string" ? response.content : JSON.stringify(response.content ?? "");
						responseMarkerVerified =
							responseContent.length > 0 &&
							(scenario.responseMarker ? responseContent.includes(scenario.responseMarker) : true);

						if ((response as any).usage) {
							tokenUsage = {
								promptTokens: (response as any).usage.promptTokens ?? 0,
								completionTokens: (response as any).usage.completionTokens ?? 0,
								totalTokens: (response as any).usage.totalTokens ?? 0,
							};
						}
					}
				} catch (err: any) {
					isBlocked = true;
					errorMessage = `Inference failed: ${err?.message ?? String(err)}`;
					blockedRuns++;
				}
			}

			const tierMatches = routingDecision.effectiveTier === scenario.expectedTier;
			const pass = tierMatches && (args.dryRun ? true : inferenceSuccess && responseMarkerVerified && !isBlocked);

			if (pass) passedRuns++;

			console.log(
				`  Rep ${rep}/${args.repetitions}: ${pass ? "PASS" : isBlocked ? "BLOCKED" : "FAIL"} | Tier: ${routingDecision.effectiveTier} | Model: ${servingModel} | Tokens: ${tokenUsage.totalTokens}`,
			);

			results.push({
				scenario: scenario.name,
				repetition: rep,
				expectedTier: scenario.expectedTier,
				effectiveTier: routingDecision.effectiveTier,
				tierMatches,
				selectedModel: selectedModelId,
				servingModel,
				applied: routingDecision.applied,
				reasons: routingDecision.reasons,
				inferenceSuccess,
				responseMarkerVerified,
				tokenUsage,
				isBlocked,
				error: errorMessage,
				latencyMs: Math.round((Bun.nanoseconds() - startNs) / 1000000),
				pass,
			});
		}
	}

	const report = {
		timestamp: new Date().toISOString(),
		summary: {
			totalScenarios: BENCHMARK_SCENARIOS.length,
			totalRuns,
			passedRuns,
			blockedRuns,
			failedRuns: totalRuns - passedRuns - blockedRuns,
		},
		lanes: args.lanes,
		inventoryStatus,
		results,
	};

	fs.mkdirSync(args.reportDir, { recursive: true });
	const reportPath = path.join(args.reportDir, "routing-matrix-report.json");
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

	console.log(`\nBenchmark Complete: ${passedRuns}/${totalRuns} passed (${blockedRuns} blocked).`);
	console.log(`Out-of-Repo Report written to: ${reportPath}`);
}

main().catch(err => {
	console.error("Benchmark harness execution failed:", err);
	process.exit(1);
});
