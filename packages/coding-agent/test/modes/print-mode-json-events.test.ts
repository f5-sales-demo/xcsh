import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@f5-sales-demo/pi-agent-core";
import { buildJsonAgentEventLine } from "../../src/modes/print-mode";

const hiddenMessage = {
	role: "custom" as const,
	customType: "private-hint",
	content: "private extension context",
	display: false,
	timestamp: Date.now(),
};

describe("json mode agent events", () => {
	it("does not emit hidden extension context through message or aggregate events", () => {
		const messageEvent: AgentEvent = { type: "message_start", message: hiddenMessage };
		const aggregateEvent: AgentEvent = {
			type: "agent_end",
			messages: [
				hiddenMessage,
				{
					role: "user",
					content: [{ type: "text", text: "visible prompt" }],
					timestamp: Date.now(),
				},
			],
		};

		expect(buildJsonAgentEventLine(messageEvent)).toBeUndefined();
		const line = buildJsonAgentEventLine(aggregateEvent);
		expect(line).toBeDefined();
		expect(line).not.toContain("private extension context");
		expect(line).toContain("visible prompt");
	});
});
