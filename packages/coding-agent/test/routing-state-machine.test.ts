import { describe, expect, it } from "bun:test";
import { RoutingStateMachine } from "../src/routing/state-machine";

describe("Routing Hysteresis & State Machine (P08)", () => {
	it("should upgrade tier immediately on higher desired tier", () => {
		const sm = new RoutingStateMachine({ currentTier: "utility", downshiftStreak: 0 });

		const step1 = sm.evaluateNextTurn("balanced", 2);
		expect(step1.effectiveTier).toBe("balanced");
		expect(step1.downshiftStreak).toBe(0);

		const step2 = sm.evaluateNextTurn("frontier", 2);
		expect(step2.effectiveTier).toBe("frontier");
		expect(step2.downshiftStreak).toBe(0);
	});

	it("should require 2 consecutive lower turns before downshifting tier", () => {
		const sm = new RoutingStateMachine({ currentTier: "frontier", downshiftStreak: 0 });

		// Turn 1: desired lower tier (balanced) -> streak becomes 1, effective tier remains frontier
		const turn1 = sm.evaluateNextTurn("balanced", 2);
		expect(turn1.effectiveTier).toBe("frontier");
		expect(turn1.downshiftStreak).toBe(1);

		// Turn 2: desired lower tier again -> streak becomes 2, effective tier downshifts to balanced
		const turn2 = sm.evaluateNextTurn("balanced", 2);
		expect(turn2.effectiveTier).toBe("balanced");
		expect(turn2.downshiftStreak).toBe(0);
	});

	it("should reset downshift streak if a turn requests equal or higher tier", () => {
		const sm = new RoutingStateMachine({ currentTier: "frontier", downshiftStreak: 0 });

		// Turn 1: lower -> streak 1
		sm.evaluateNextTurn("balanced", 2);
		expect(sm.getState().downshiftStreak).toBe(1);

		// Turn 2: frontier -> streak resets to 0
		const turn2 = sm.evaluateNextTurn("frontier", 2);
		expect(turn2.effectiveTier).toBe("frontier");
		expect(turn2.downshiftStreak).toBe(0);
	});

	it("should enforce escalation floor on rejected outcomes until cleared", () => {
		const sm = new RoutingStateMachine({ currentTier: "balanced", downshiftStreak: 0 });

		sm.setEscalationFloor("frontier");
		const turn1 = sm.evaluateNextTurn("utility", 2);
		expect(turn1.effectiveTier).toBe("frontier"); // Floor enforced!

		sm.clearEscalationFloor();
		const turn2 = sm.evaluateNextTurn("utility", 2);
		expect(turn2.effectiveTier).toBe("utility"); // Floor cleared!
	});
});
