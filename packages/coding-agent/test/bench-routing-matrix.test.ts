import { describe, expect, it } from "bun:test";
import {
	classifyRunStatus,
	computeExitCode,
	createMultimodalMessage,
	discoverAuthenticatedInventory,
	expandLaneScenarios,
	extractUsage,
	parseArgs,
	redactSecretStrings,
	validateContractIntegrity,
} from "../scripts/bench-routing-matrix";

describe("Routing Matrix Benchmark Harness Helper Unit Tests", () => {
	it("parseArgs validates integer counts and rejects NaN, fractions, and negative values", () => {
		const parsed = parseArgs([
			"--repetitions",
			"3",
			"--warmups",
			"1",
			"--lanes",
			"openai,litellm-anthropic",
			"--report-dir",
			"/tmp/test-reports",
			"--dry-run",
		]);

		expect(parsed.repetitions).toBe(3);
		expect(parsed.warmups).toBe(1);
		expect(parsed.lanes).toEqual(["openai", "litellm-anthropic"]);

		expect(() => parseArgs(["--repetitions", "2.5"])).toThrow(/Invalid benchmark counts/);
		expect(() => parseArgs(["--warmups", "NaN"])).toThrow(/Invalid benchmark counts/);
		expect(() => parseArgs(["--repetitions", "-1"])).toThrow(/Invalid benchmark counts/);
	});

	it("expandLaneScenarios expands all requested lanes into scenario matrix entries", () => {
		const scenarios = expandLaneScenarios(["openai", "google-vertex"]);
		// 2 lanes * 4 scenario types (utility, balanced, frontier, multimodal) = 8 matrix entries
		expect(scenarios.length).toBe(8);
		expect(scenarios[0].lane).toBe("openai");
		expect(scenarios[0].anchorModel).toBe("openai/gpt-5.4-mini");
		expect(scenarios[4].lane).toBe("google-vertex");
		expect(scenarios[4].anchorModel).toBe("google-vertex/gemini-2.5-flash-lite");
	});

	it("classifyRunStatus enforces exact marker matching and strict provider/model FAIL criteria", () => {
		// 1. PASS case
		const passResult = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingProvider: "openai",
			expectedProvider: "openai",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "stop",
			responseContent: "RESPOND_UTILITY_OK",
			expectedMarker: "RESPOND_UTILITY_OK",
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(passResult.status).toBe("PASS");

		// 2. FAIL: Provider mismatch (e.g. anthropic vs openai)
		const failProvider = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingProvider: "openai",
			expectedProvider: "anthropic",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "anthropic/claude-3-haiku-20240307",
			stopReason: "stop",
			responseContent: "RESPOND_UTILITY_OK",
			expectedMarker: "RESPOND_UTILITY_OK",
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(failProvider.status).toBe("FAIL");
		expect(failProvider.reason).toContain("Provider mismatch");

		// 3. FAIL: Exact marker mismatch (extra text or missing marker)
		const failMarker = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingProvider: "openai",
			expectedProvider: "openai",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "stop",
			responseContent: "Hello world! Extra preamble before RESPOND_UTILITY_OK",
			expectedMarker: "RESPOND_UTILITY_OK",
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(failMarker.status).toBe("FAIL");
		expect(failMarker.reason).toContain("Exact response marker verification failed");

		// 4. FAIL: Missing stopReason (undefined or empty)
		const failMissingStop = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingProvider: "openai",
			expectedProvider: "openai",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: undefined,
			responseContent: "RESPOND_UTILITY_OK",
			expectedMarker: "RESPOND_UTILITY_OK",
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(failMissingStop.status).toBe("FAIL");
		expect(failMissingStop.reason).toContain("Stop reason missing");

		// 5. FAIL: Tier mismatch takes precedence over network error
		const failTierPrecedence = classifyRunStatus({
			effectiveTier: "balanced",
			expectedTier: "utility",
			servingProvider: "openai",
			expectedProvider: "openai",
			servingModel: "openai/gpt-5.4",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "stop",
			responseContent: "RESPOND_UTILITY_OK",
			expectedMarker: "RESPOND_UTILITY_OK",
			totalTokens: 50,
			isNetworkError: true,
			error: "HTTP 401 Unauthorized",
		});
		expect(failTierPrecedence.status).toBe("FAIL");
		expect(failTierPrecedence.reason).toContain("Tier mismatch");
	});

	it("redactSecretStrings sanitizes query credentials, Bearer tokens, mock secret keys, and preserves http/https schemes", () => {
		const rawReport = {
			httpEndpoint:
				"http://user:demopassword@gateway.example.com/v1/models?api_key=mock-secret-key-alpha-bravo-charlie",
			httpsEndpoint: "https://user:demopassword@gateway.example.com/v1/models?key=demokey-delta-echo-foxtrot",
			header: "Bearer demo-token-golf-hotel-india",
			key: "mock-secret-key-juliet-kilo-lima",
		};

		const redacted = redactSecretStrings(rawReport, []);
		const str = JSON.stringify(redacted);

		expect(str).not.toContain("demopassword");
		expect(str).not.toContain("mock-secret-key-alpha-bravo-charlie");
		expect(str).not.toContain("demokey-delta-echo-foxtrot");
		expect(str).not.toContain("demo-token-golf-hotel-india");
		expect(str).not.toContain("mock-secret-key-juliet-kilo-lima");

		expect(redacted.httpEndpoint).toContain("http://");
		expect(redacted.httpsEndpoint).toContain("https://");
		expect(str).toContain("[REDACTED]");
	});

	it("extractUsage handles usage.input, usage.output, usage.totalTokens correctly", () => {
		const usage = extractUsage({
			usage: {
				input: 100,
				output: 40,
				totalTokens: 140,
			},
		});
		expect(usage.inputTokens).toBe(100);
		expect(usage.outputTokens).toBe(40);
		expect(usage.totalTokens).toBe(140);
	});

	it("createMultimodalMessage builds strongly typed pi-ai image payload content blocks", () => {
		const msg = createMultimodalMessage("Describe this image", "RESPOND_VISUAL_OK");
		expect(msg.role).toBe("user");
		expect(Array.isArray(msg.content)).toBe(true);

		const imageBlock = (msg.content as any[]).find(b => b.type === "image");
		expect(imageBlock).toBeDefined();
		expect(imageBlock.type).toBe("image");
		expect(typeof imageBlock.data).toBe("string");
		expect(imageBlock.mimeType).toBe("image/png");
	});

	it("validateContractIntegrity distinguishes complete validated matrix from partial-BLOCKED execution", () => {
		// Dry run is never authoritative
		const dryRunContract = validateContractIntegrity({
			dryRun: true,
			cleanWorktree: true,
			totalRuns: 60,
			passedRuns: 60,
			blockedRuns: 0,
			failedRuns: 0,
		});
		expect(dryRunContract.authoritative).toBe(false);
		expect(dryRunContract.matrixComplete).toBe(true);

		// Partial-BLOCKED run (1 PASS + 59 BLOCKED) is NOT authoritative and NOT complete
		const partialBlockedContract = validateContractIntegrity({
			dryRun: false,
			cleanWorktree: true,
			totalRuns: 60,
			passedRuns: 1,
			blockedRuns: 59,
			failedRuns: 0,
		});
		expect(partialBlockedContract.authoritative).toBe(false);
		expect(partialBlockedContract.matrixComplete).toBe(false);

		// Complete live execution (60/60 PASS) is authoritative and matrixComplete
		const cleanContract = validateContractIntegrity({
			dryRun: false,
			cleanWorktree: true,
			totalRuns: 60,
			passedRuns: 60,
			blockedRuns: 0,
			failedRuns: 0,
		});
		expect(cleanContract.authoritative).toBe(true);
		expect(cleanContract.matrixComplete).toBe(true);
	});

	it("computeExitCode returns 1 for partial-BLOCKED executions, failures, or incomplete matrix runs", () => {
		expect(computeExitCode([{ status: "PASS" }], 1, 1)).toBe(0);
		expect(computeExitCode([{ status: "PASS" }, { status: "FAIL" }], 1, 2)).toBe(1);
		expect(computeExitCode([{ status: "PASS" }, { status: "BLOCKED" }], 1, 2)).toBe(1); // partial-BLOCKED must exit 1
	});

	it("discoverAuthenticatedInventory handles mock discovery gracefully", async () => {
		const discovery = await discoverAuthenticatedInventory(
			"openai",
			{
				lane: "openai",
				provider: "openai",
				presetId: "openai/gpt-5.6",
				apiKey: "mock-key",
			},
			true, // dryRun
		);
		expect(discovery.success).toBe(true);
		expect(discovery.models.length).toBeGreaterThan(0);
	});
});
