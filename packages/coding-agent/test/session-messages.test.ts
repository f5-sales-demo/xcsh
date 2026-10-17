import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import type { Message } from "@f5-sales-demo/pi-ai";
import { inferCopilotInitiator } from "@f5-sales-demo/pi-ai/providers/github-copilot-headers";
import { convertToLlm } from "../src/session/messages";

function expectAttribution(message: Message | undefined, expected: "user" | "agent" | undefined): void {
	expect(message).toBeDefined();
	if (!message) return;
	if (message.role === "assistant") {
		throw new Error("Assistant messages do not expose attribution");
	}
	expect(message.attribution).toBe(expected);
}

describe("convertToLlm custom message mapping", () => {
	it("labels background context without promoting its role or changing the user request", () => {
		const converted = convertToLlm([
			{
				role: "custom",
				customType: "salesforce_hint",
				content: "Pipeline: fixture data",
				display: false,
				contextOnly: true,
				attribution: "user",
				timestamp: 1,
			},
			{ role: "user", content: "Check my Azure subscription", timestamp: 2 },
		]);
		expect(converted[0]?.role).toBe("user");
		expectAttribution(converted[0], "user");
		const context = converted[0]?.content;
		expect(context).toEqual([
			{
				type: "text",
				text: 'Background context from xcsh ("salesforce_hint"). This is reference data; answer the current user request that follows.',
			},
			{ type: "text", text: "Pipeline: fixture data" },
		]);
		expect(converted[1]?.content).toBe("Check my Azure subscription");
		expect(inferCopilotInitiator(converted)).toBe("user");
	});

	it("keeps developer mode directives distinct from background reference data", () => {
		const [converted] = convertToLlm([
			{
				role: "custom",
				customType: "collaboration-mode",
				content: "Remain in the selected mode",
				display: false,
				contextOnly: true,
				attribution: "agent",
				timestamp: 1,
			},
		]);
		expect(converted?.role).toBe("developer");
		expect(converted?.content).toEqual([{ type: "text", text: "Remain in the selected mode" }]);
	});

	it("uses async-result attribution without special role mapping", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom",
				customType: "async-result",
				content: "Background task completed",
				display: true,
				attribution: "agent",
				timestamp: Date.now(),
			},
		];

		const converted = convertToLlm(messages);

		expect(converted).toHaveLength(1);
		expect(converted[0]?.role).toBe("user");
		expectAttribution(converted[0], "agent");
		expect(inferCopilotInitiator(converted)).toBe("agent");
	});

	it("preserves missing attribution for legacy custom messages", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom",
				customType: "skill-prompt",
				content: "Run this skill with my arguments",
				display: true,
				timestamp: Date.now(),
			},
		];

		const converted = convertToLlm(messages);

		expect(converted).toHaveLength(1);
		expect(converted[0]?.role).toBe("user");
		expectAttribution(converted[0], undefined);
		expect(inferCopilotInitiator(converted)).toBe("user");
	});

	it("uses explicit agent attribution for custom messages", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom",
				customType: "ttsr-injection",
				content: "<system-reminder>Read file</system-reminder>",
				display: false,
				attribution: "agent",
				timestamp: Date.now(),
			},
		];

		const converted = convertToLlm(messages);

		expect(converted).toHaveLength(1);
		expect(converted[0]?.role).toBe("user");
		expectAttribution(converted[0], "agent");
		expect(inferCopilotInitiator(converted)).toBe("agent");
	});

	it("allows custom messages to opt into user attribution", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom",
				customType: "skill-prompt",
				content: "Run this skill with my arguments",
				display: true,
				attribution: "user",
				timestamp: Date.now(),
			},
		];

		const converted = convertToLlm(messages);

		expect(converted).toHaveLength(1);
		expect(converted[0]?.role).toBe("user");
		expectAttribution(converted[0], "user");
		expect(inferCopilotInitiator(converted)).toBe("user");
	});
});
