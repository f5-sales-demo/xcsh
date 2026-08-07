import { describe, expect, it } from "bun:test";
import { RoutingCoordinator } from "../src/routing";

describe("AgentSession Routing Methods (I02/I10)", () => {
	it("should return routing status and manage mode/pins/outcomes", () => {
		const coordinator = new RoutingCoordinator();
		const sm = coordinator.getStateMachine();

		expect(sm.getState().manualPin).toBeUndefined();

		sm.setManualPin("openai/o3-mini");
		expect(sm.getState().manualPin).toBe("openai/o3-mini");

		sm.clearManualPin();
		expect(sm.getState().manualPin).toBeUndefined();

		sm.setEscalationFloor("frontier");
		expect(sm.getState().escalationFloor).toBe("frontier");

		sm.clearEscalationFloor();
		expect(sm.getState().escalationFloor).toBeUndefined();
	});
});
