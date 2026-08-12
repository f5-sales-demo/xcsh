import { describe, expect, it } from "bun:test";
import { handleRouteCommand } from "../src/routing/commands";
import { RoutingCoordinator } from "../src/routing/coordinator";

describe("/route Commands (I09)", () => {
	it("should handle /route status", async () => {
		const coordinator = new RoutingCoordinator();
		const result = await handleRouteCommand(["status"], {
			coordinator,
			currentModel: "openai/gpt-4o",
			mode: "off",
		});

		expect(result.output).toContain("Routing Mode: off");
		expect(result.output).toContain("Active Model: openai/gpt-4o");
	});

	it("should handle /route off", async () => {
		const coordinator = new RoutingCoordinator();
		const result = await handleRouteCommand(["off"], {
			coordinator,
			currentModel: "openai/gpt-4o",
			mode: "auto",
		});

		expect(result.newMode).toBe("off");
		expect(result.output).toContain("Routing mode set to off");
	});

	it("should handle /route shadow", async () => {
		const coordinator = new RoutingCoordinator();
		const result = await handleRouteCommand(["shadow"], {
			coordinator,
			currentModel: "openai/gpt-4o",
			mode: "off",
		});

		expect(result.newMode).toBe("shadow");
		expect(result.output).toContain("Routing mode set to shadow");
	});

	it("should handle /route auto", async () => {
		const coordinator = new RoutingCoordinator();
		coordinator.getStateMachine().setManualPin("openai/o3-mini");

		const result = await handleRouteCommand(["auto"], {
			coordinator,
			currentModel: "openai/gpt-4o",
			mode: "off",
		});

		expect(result.newMode).toBe("auto");
		expect(coordinator.getStateMachine().getState().manualPin).toBeUndefined(); // Pin cleared!
		expect(result.output).toContain("Routing mode set to auto");
	});

	it("selects only reviewed provider-sticky subscription profiles", async () => {
		const coordinator = new RoutingCoordinator();
		const selected = await handleRouteCommand(["profile", "openai-codex"], {
			coordinator,
			currentModel: "openai-codex/gpt-5.6-terra",
			mode: "auto",
			profile: "none",
		});
		expect(selected.newProfile).toBe("openai-codex");
		expect(selected.output).toContain("openai-codex");

		const invalid = await handleRouteCommand(["profile", "unknown"], {
			coordinator,
			currentModel: "openai-codex/gpt-5.6-terra",
			mode: "auto",
		});
		expect(invalid.newProfile).toBeUndefined();
		expect(invalid.output).toContain("Usage");
	});
});
