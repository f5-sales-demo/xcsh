import { describe, expect, it } from "bun:test";
import { getBundledModel } from "@f5-sales-demo/pi-ai";
import { convertAnthropicMessages } from "@f5-sales-demo/pi-ai/providers/anthropic";
import { convertToLlm } from "../src/session/messages";
import { SessionManager } from "../src/session/session-manager";

describe("signed Anthropic compaction persistence", () => {
	it("restores the signed block before the retained tail without changing its content", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
		const kept = manager.appendMessage({ role: "user", content: "retained", timestamp: 2 });
		const block = {
			type: "compaction",
			content: "Exact summary\r\ncanary=玉",
			signature: "provider-signature",
			tool_changes: [],
		};
		manager.appendCompaction(block.content, undefined, kept, 30000, {}, false, {
			anthropicRemoteCompaction: {
				type: "anthropicHistory",
				provider: "anthropic",
				model: "claude-sonnet-5-5",
				blocks: [block],
			},
		});
		const messages = convertToLlm(manager.buildSessionContext().messages);
		const params = convertAnthropicMessages(
			messages,
			getBundledModel("anthropic", "claude-sonnet-5-5") as any,
			false,
		);
		expect(params[0].role).toBe("assistant");
		expect(params[0].content as unknown).toEqual([block]);
		expect(JSON.stringify(params.slice(1))).toContain("retained");
	});
});
