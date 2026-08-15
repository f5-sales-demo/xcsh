import { describe, expect, it } from "bun:test";
import { mapAgentSessionEventToAcpSessionUpdates } from "../src/modes/acp/acp-event-mapper";
import type { AgentSessionEvent } from "../src/session/agent-session";

function makeAssistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "anthropic-messages" as const,
		provider: "anthropic" as const,
		model: "claude-sonnet-4-20250514",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

function getChunkMessageId(event: { update: object }): string | undefined {
	const update = event.update as { messageId?: string | null };
	return typeof update.messageId === "string" ? update.messageId : undefined;
}

describe("ACP event mapper", () => {
	it("attaches a stable messageId to live assistant chunks", () => {
		const assistantMessage = makeAssistantMessage("chunk");
		const getMessageId = (message: unknown): string | undefined =>
			message === assistantMessage ? "a80f1ff7-4f0a-4e6b-9f09-c94857b62a4a" : undefined;

		const textUpdates = mapAgentSessionEventToAcpSessionUpdates(
			{
				type: "message_update",
				message: assistantMessage,
				assistantMessageEvent: { type: "text_delta", delta: "chunk" },
			} as AgentSessionEvent,
			"session-1",
			{ getMessageId },
		);
		const thoughtUpdates = mapAgentSessionEventToAcpSessionUpdates(
			{
				type: "message_update",
				message: assistantMessage,
				assistantMessageEvent: { type: "thinking_delta", delta: "plan" },
			} as AgentSessionEvent,
			"session-1",
			{ getMessageId },
		);

		expect(textUpdates).toHaveLength(1);
		expect(thoughtUpdates).toHaveLength(1);
		expect(textUpdates[0] ? getChunkMessageId(textUpdates[0]) : undefined).toBe(
			"a80f1ff7-4f0a-4e6b-9f09-c94857b62a4a",
		);
		expect(thoughtUpdates[0] ? getChunkMessageId(thoughtUpdates[0]) : undefined).toBe(
			"a80f1ff7-4f0a-4e6b-9f09-c94857b62a4a",
		);
	});
});

it("maps display_media to standard image and sanitized resource content", () => {
	const hash = "c".repeat(64);
	const descriptor = {
		version: 1 as const,
		id: `media_${"c".repeat(24)}`,
		kind: "image" as const,
		original: { ref: `blob:sha256:${hash}`, mimeType: "image/png", bytes: 4 },
		provenance: { sourceType: "path" as const, source: "/home/<user>/private.png" },
		playback: { autoplay: false, loop: false, muted: true as const, fpsCap: 12 },
	};
	const updates = mapAgentSessionEventToAcpSessionUpdates(
		{
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "display_media",
			result: {
				content: [{ type: "image", data: "aW1n", mimeType: "image/png" }],
				details: { descriptor },
			},
		} as AgentSessionEvent,
		"session-1",
	);
	const update = updates[0]!.update as { content?: unknown[]; rawOutput?: unknown };
	expect(update.content!.length).toBeGreaterThanOrEqual(2);
	expect(JSON.stringify(update)).toContain("xcsh-media://media_");
	expect(JSON.stringify(update)).not.toContain("/home/<user>");
});
