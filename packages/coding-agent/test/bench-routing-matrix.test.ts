import { describe, expect, it } from "bun:test";
import {
	classifyRunStatus,
	computeExitCode,
	expandLaneScenarios,
	extractUsage,
	parseArgs,
	redactSecretStrings,
} from "../scripts/bench-routing-matrix";

describe("Routing Matrix Benchmark Harness Helper Unit Tests", () => {
	it("parseArgs correctly parses CLI flags and environment defaults", () => {
		const parsed = parseArgs([
			"--repetitions",
			"5",
			"--warmups",
			"2",
			"--lanes",
			"openai,litellm-anthropic",
			"--report-dir",
			"/tmp/test-reports",
			"--dry-run",
		]);

		expect(parsed.repetitions).toBe(5);
		expect(parsed.warmups).toBe(2);
		expect(parsed.lanes).toEqual(["openai", "litellm-anthropic"]);
		expect(parsed.reportDir).toBe("/tmp/test-reports");
		expect(parsed.dryRun).toBe(true);
	});

	it("expandLaneScenarios expands all requested lanes into scenario matrix entries", () => {
		const scenarios = expandLaneScenarios(["openai", "litellm-anthropic"]);
		// 2 lanes * 4 scenario types (utility, balanced, frontier, multimodal) = 8 matrix entries
		expect(scenarios.length).toBe(8);
		expect(scenarios[0].lane).toBe("openai");
		expect(scenarios[0].anchorModel).toBe("openai/gpt-5.4-mini");
		expect(scenarios[4].lane).toBe("litellm-anthropic");
		expect(scenarios[4].anchorModel).toBe("litellm/claude-3-5-haiku-20241022");
	});

	it("classifyRunStatus identifies PASS, FAIL, and BLOCKED correctly", () => {
		// 1. PASS case
		const passResult = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "stop",
			responseMarkerVerified: true,
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(passResult.status).toBe("PASS");

		// 2. FAIL case (effectiveTier !== expectedTier)
		const failTier = classifyRunStatus({
			effectiveTier: "balanced",
			expectedTier: "utility",
			servingModel: "openai/gpt-5.4",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "stop",
			responseMarkerVerified: true,
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(failTier.status).toBe("FAIL");
		expect(failTier.reason).toContain("Tier mismatch");

		// 3. FAIL case (stopReason !== 'stop')
		const failStop = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "length",
			responseMarkerVerified: true,
			totalTokens: 50,
			isNetworkError: false,
		});
		expect(failStop.status).toBe("FAIL");

		// 4. BLOCKED case (Network or Auth Unavailability)
		const blockedAuth = classifyRunStatus({
			effectiveTier: "utility",
			expectedTier: "utility",
			servingModel: "openai/gpt-5.4-mini",
			expectedModel: "openai/gpt-5.4-mini",
			stopReason: "stop",
			responseMarkerVerified: false,
			totalTokens: 0,
			isNetworkError: true,
			error: "HTTP 401 Unauthorized",
		});
		expect(blockedAuth.status).toBe("BLOCKED");
		expect(blockedAuth.reason).toContain("BLOCKED");
	});

	it("extractUsage handles usage.input, usage.output, usage.totalTokens schema correctly", () => {
		const usage = extractUsage({
			usage: {
				input: 120,
				output: 45,
				totalTokens: 165,
			},
		});
		expect(usage.inputTokens).toBe(120);
		expect(usage.outputTokens).toBe(45);
		expect(usage.totalTokens).toBe(165);
	});

	it("redactSecretStrings recursively masks API keys and sensitive tokens in report objects", () => {
		const secretKey = "mock-secret-key-123456789";
		const inputObj = {
			inventory: {
				openai: { apiKey: secretKey, status: `Connected with key ${secretKey}` },
			},
			results: [{ model: "openai/gpt-5.6", rawResponse: `auth: Bearer ${secretKey}` }],
		};

		const redacted = redactSecretStrings(inputObj, [secretKey]);
		expect(JSON.stringify(redacted)).not.toContain(secretKey);
		expect(JSON.stringify(redacted)).toContain("[REDACTED]");
	});

	it("computeExitCode returns 1 if any scenario run produced a FAIL status", () => {
		expect(computeExitCode([{ status: "PASS" }, { status: "BLOCKED" }])).toBe(0);
		expect(computeExitCode([{ status: "PASS" }, { status: "FAIL" }])).toBe(1);
	});
});
