import { expect, test } from "bun:test";
import { voiceChatContext } from "../../src/session/voice-chat-context";

const transcript = (id: string, text: string) => ({
	type: "custom",
	customType: "remote-realtime",
	data: { kind: "voiceTimeline", item: { id, type: "transcriptSegment", role: "user", text } },
});
test("speech and typing share selected durable context without a new backend submission", () => {
	const messages = voiceChatContext([transcript("speech", "Continue our selected topic")], []);
	expect(messages).toHaveLength(1);
	expect(messages[0]!.role).toBe("custom");
	expect(JSON.stringify(messages)).toContain("Continue our selected topic");
	expect(JSON.stringify(messages)).toContain("not a new request");
	expect(voiceChatContext([transcript("speech", "Continue our selected topic")], messages)).toEqual([]);
});
test("speech context ignores unrelated entries and deduplicates canonical segment identities", () => {
	expect(voiceChatContext([{ ...transcript("old", "hidden"), customType: "other" }], [])).toEqual([]);
	const messages = voiceChatContext([transcript("same", "first"), transcript("same", "final")], []);
	expect(JSON.stringify(messages)).not.toContain("first");
	expect(JSON.stringify(messages)).toContain("final");
});
