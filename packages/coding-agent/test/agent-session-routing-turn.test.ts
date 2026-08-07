import { describe, expect, it } from "bun:test";
import { RoutingCoordinator, RoutingStateMachine } from "../src/routing";

describe("AgentSession Turn Routing Evaluation (I02)", () => {
	it("should evaluate routing decision during turn dispatch when routing mode is enabled", async () => {
		const sm = new RoutingStateMachine({ currentTier: "utility" }); // already at utility
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		const decision = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "auto",
			prompt: "Fix typo in line 5", // simple operation -> utility
			availableModels: ["openai/gpt-4o-mini", "openai/gpt-4o", "openai/o3-mini"],
		});

		expect(decision.mode).toBe("auto");
		expect(decision.applied).toBe(true);
		expect(decision.effectiveTier).toBe("utility");
		expect(decision.selectedModel).toBe("openai/gpt-4o-mini");
	});
});
