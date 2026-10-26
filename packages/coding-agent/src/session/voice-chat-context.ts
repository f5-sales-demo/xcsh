import { createHash } from "node:crypto";
import type { AgentMessage } from "@f5-sales-demo/pi-agent-core";
import { prompt } from "@f5-sales-demo/pi-utils";
import template from "../prompts/system/voice-chat-context.md" with { type: "text" };

/** Read only the selected branch's canonical speech records; no request is submitted here. */
export function voiceChatContext(entries: readonly unknown[], retained: readonly AgentMessage[]): AgentMessage[] {
	const transcripts = new Map<string, { id: string; role: string; text: string }>();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as {
			type?: string;
			customType?: string;
			data?: { kind?: string; item?: { id?: unknown; type?: unknown; role?: unknown; text?: unknown } };
		};
		const item = row.data?.item;
		if (
			row.type !== "custom" ||
			row.customType !== "remote-realtime" ||
			row.data?.kind !== "voiceTimeline" ||
			item?.type !== "transcriptSegment" ||
			typeof item.id !== "string" ||
			!["user", "assistant"].includes(String(item.role)) ||
			typeof item.text !== "string"
		)
			continue;
		transcripts.set(item.id, { id: item.id, role: String(item.role), text: item.text });
	}
	const recent: { id: string; role: string; text: string }[] = [];
	let bytes = 0;
	for (const item of [...transcripts.values()].reverse()) {
		const size = Buffer.byteLength(JSON.stringify(item));
		if (size > 16_384 || bytes + size > 16_384 || recent.length === 64) break;
		recent.unshift(item);
		bytes += size;
	}
	if (!recent.length) return [];
	const content = prompt.render(template, { transcripts: JSON.stringify(recent) }).trim();
	const fingerprint = createHash("sha256").update(content).digest("hex");
	const previous = retained.findLast(
		message => message.role === "custom" && message.customType === "voice-chat-context",
	);
	if (previous?.role === "custom" && previous.content === content) return [];
	return [
		{
			role: "custom",
			customType: "voice-chat-context",
			content,
			display: false,
			attribution: "agent",
			details: { fingerprint },
			timestamp: Date.now(),
		},
	];
}
