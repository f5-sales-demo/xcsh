import { describe, expect, it } from "bun:test";
import { createRoutingDecisionEvent, sanitizeRoutingEvent } from "../src/routing/events";

describe("Routing Observability & Events (O01)", () => {
	it("should sanitize routing events to ensure NO prompt, credential, header, or tool output is included", () => {
		const rawEvent = {
			type: "routing_decision",
			epochId: "route-123",
			provider: "openai",
			pool: "openai/gpt-5.6",
			tier: "frontier",
			model: "o3-mini",
			reasons: ["complex_intent"],
			promptText: "SECRET PASSWORD OR CODE HERE", // Sensitive!
			authHeader: "Bearer sk-123456", // Sensitive!
		};

		const sanitized = sanitizeRoutingEvent(rawEvent);

		expect((sanitized as unknown as Record<string, unknown>).promptText).toBeUndefined();
		expect((sanitized as unknown as Record<string, unknown>).authHeader).toBeUndefined();
		expect(sanitized.epochId).toBe("route-123");
		expect(sanitized.selectedModel).toBe("o3-mini");
	});

	it("should create well-formed routing decision event", () => {
		const event = createRoutingDecisionEvent({
			epochId: "route-123",
			mode: "auto",
			provider: "openai",
			poolId: "openai/gpt-5.6",
			effectiveTier: "frontier",
			selectedModel: "o3-mini",
			reasons: ["complex_intent"],
		});

		expect(event.type).toBe("routing_decision");
		expect(event.epochId).toBe("route-123");
		expect(event.effectiveTier).toBe("frontier");
		expect(event.selectedModel).toBe("o3-mini");
	});
});
