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

	it("should calculate decision but NOT apply switch or mutate state machine in 'shadow' mode", async () => {
		const sm = new RoutingStateMachine({ currentTier: "balanced" });
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		const decision = await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "shadow",
			prompt: "Summarize README.md", // simple read -> utility
			availableModels: available,
		});

		expect(decision.mode).toBe("shadow");
		expect(decision.applied).toBe(false);
		expect(decision.desiredTier).toBe("utility");
		expect(decision.effectiveTier).toBe("balanced");
		expect(decision.reasons).toContain("mode_shadow");

		// State machine operational state remains unmutated!
		expect(sm.getState().currentTier).toBe("balanced");
		expect(sm.getState().downshiftStreak).toBe(0);
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
		expect(decision.selectedModel).toBe("openai/gpt-4o-mini");
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

	it("should defer state machine mutations until pool resolution is verified non-degraded", async () => {
		const sm = new RoutingStateMachine({ currentTier: "frontier", downshiftStreak: 1 });
		const coordinator = new RoutingCoordinator({ stateMachine: sm });

		// Degraded availability (0 available models) causes tier resolution to fail
		await coordinator.evaluateTurn({
			anchorModel: "openai/gpt-4o",
			mode: "auto",
			prompt: "Simple task", // Drives desired utility -> triggering downshift calculation
			availableModels: [],
		});

		// The active state machine should remain untouched
		expect(sm.getState().downshiftStreak).toBe(1);
	});
});
