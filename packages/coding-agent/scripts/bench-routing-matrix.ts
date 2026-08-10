import * as path from "node:path";
import { RoutingCoordinator } from "../src/routing/coordinator";

async function main() {
	console.log("Running routing matrix benchmarks...");

	const coordinator = new RoutingCoordinator();
	const scenarios = [
		{ name: "Greeting", prompt: "Hello, how are you?", expectedTier: "utility" },
		{
			name: "Code Analysis",
			prompt: "Can you analyze this 10k line codebase for memory leaks?",
			expectedTier: "frontier",
		},
		{ name: "Images", prompt: "What is in this image?", expectedTier: "frontier", hasImages: true },
	];

	const report = {
		timestamp: new Date().toISOString(),
		results: [] as any[],
	};

	let passed = 0;

	for (const scenario of scenarios) {
		console.log(`Evaluating scenario: ${scenario.name}`);
		const result = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-5.6",
			mode: "auto",
			prompt: scenario.prompt,
			hasImages: scenario.hasImages || false,
			availableModels: ["openai/gpt-5.4-mini", "openai/gpt-5.4", "openai/gpt-5.6-sol", "anthropic/claude-opus-5"],
			ttftStartNs: Bun.nanoseconds(),
			signal: AbortSignal.timeout(10000),
		});

		const success = result.applied && Boolean(result.selectedModel);
		if (success) passed++;

		report.results.push({
			scenario: scenario.name,
			expectedTier: scenario.expectedTier,
			selectedModel: result.selectedModel,
			applied: result.applied,
			reasons: result.reasons,
		});
	}

	console.log(`\nResults: ${passed}/${scenarios.length} passed.`);
	const reportPath = path.join(process.cwd(), "routing-matrix-report.json");
	await Bun.write(reportPath, JSON.stringify(report, null, 2));
	console.log(`Report written to ${reportPath}`);
}

main().catch(err => {
	console.error("Benchmark failed:", err);
	process.exit(1);
});
