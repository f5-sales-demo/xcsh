import { describe, expect, it } from "bun:test";
import { RoutingCoordinator } from "../src/routing/coordinator";
import { RoutingStateMachine } from "../src/routing/state-machine";

describe("Routing Coordinator (I01)", () => {
	const available = ["gpt-4o-mini", "gpt-4o", "o3-mini"];

	it("should pass through unchanged when routing mode is 'off'", async () => {
		const sm = new RoutingStateMachine();
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		const decision = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "off",
			prompt: "Summarize file",
			availableModels: available,
		});

		expect(decision.mode).toBe("off");
		expect(decision.applied).toBe(false);
		expect(decision.selectedModel).toBe("openai/gpt-4o");
		expect(decision.reasons).toContain("mode_off");
	});

	it("should calculate decision but NOT apply switch when routing mode is 'shadow'", async () => {
		const sm = new RoutingStateMachine({ currentTier: "balanced" });
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		// Turn 1: desired = utility -> streak = 1, effective = balanced
		const decision1 = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "shadow",
			prompt: "Summarize README.md", // simple read -> utility
			availableModels: available,
		});

		expect(decision1.mode).toBe("shadow");
		expect(decision1.applied).toBe(false);
		expect(decision1.desiredTier).toBe("utility");
		expect(decision1.effectiveTier).toBe("balanced");

		// Turn 2: desired = utility -> streak = 2 -> downshifts to utility
		const decision2 = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "shadow",
			prompt: "Summarize README.md",
			availableModels: available,
		});

		expect(decision2.desiredTier).toBe("utility");
		expect(decision2.effectiveTier).toBe("utility");
		expect(decision2.selectedModel).toBe("gpt-4o-mini");
		expect(decision2.reasons).toContain("mode_shadow");
	});

	it("should apply temporary model switch when routing mode is 'auto'", async () => {
		const sm = new RoutingStateMachine({ currentTier: "utility" }); // already at utility
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		const decision = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "auto",
			prompt: "Summarize README.md", // simple read -> utility
			availableModels: available,
		});

		expect(decision.mode).toBe("auto");
		expect(decision.applied).toBe(true);
		expect(decision.desiredTier).toBe("utility");
		expect(decision.effectiveTier).toBe("utility");
		expect(decision.selectedModel).toBe("gpt-4o-mini");
	});

	it("should respect manual pin until cleared", async () => {
		const sm = new RoutingStateMachine();
		sm.setManualPin("openai/o3-mini");

		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		const decision = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "auto",
			prompt: "Summarize README.md",
			availableModels: available,
		});

		expect(decision.applied).toBe(false);
		expect(decision.selectedModel).toBe("openai/o3-mini");
		expect(decision.reasons).toContain("user_model_pin");
	});
});
