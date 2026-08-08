import { describe, expect, it } from "bun:test";
import { RoutingCoordinator } from "../src/routing/coordinator";
import { RoutingStateMachine } from "../src/routing/state-machine";

describe("AgentSession Turn Routing Evaluation (I02)", () => {
	it("should evaluate routing decision during turn dispatch when routing mode is enabled", async () => {
		const sm = new RoutingStateMachine({ currentTier: "utility" }); // already at utility
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		const decision = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-5.6",
			mode: "auto",
			prompt: "Fix typo in line 5", // simple operation -> utility
			availableModels: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
		});

		expect(decision.mode).toBe("auto");
		expect(decision.applied).toBe(true);
		expect(decision.effectiveTier).toBe("utility");
		expect(decision.selectedModel).toBe("openai/gpt-5.6-luna");
	});

	it("should calculate used tokens correctly including deep array content blocks", async () => {
		const { calculateUsedTokens } = await import("../src/session/agent-session");
		const messages = [
			{ role: "user", content: "Hello world" }, // length 11 -> 2.75 -> 3
			{
				role: "assistant",
				content: [
					{ type: "text", text: "This is a" }, // length 9
					{ type: "image_url", image_url: { url: "..." } }, // ignored
					{ type: "text", text: " test block" }, // length 11
				],
			}, // 9 + 11 = 20 -> 5
		];
		// 11 + 20 = 31 total chars -> 31 / 4 = 7.75 -> round to 8
		expect(calculateUsedTokens(messages)).toBe(8);
	});
});
