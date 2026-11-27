import type { AnthropicRequestControls } from "@f5-sales-demo/pi-ai";
import { validateAnthropicControls } from "@f5-sales-demo/pi-ai/providers/anthropic-controls";

/** Session-branch state wins over global settings after restart or branch switching. */
export function resolveAnthropicSessionControls(
	settings: unknown,
	entries: readonly { type: string; customType?: string; data?: unknown }[],
): AnthropicRequestControls {
	const saved = entries.findLast(entry => entry.type === "custom" && entry.customType === "anthropic-controls");
	const controls = structuredClone((saved?.data ?? settings ?? {}) as AnthropicRequestControls);
	if (controls.anthropicCompaction)
		throw new Error("Anthropic compaction is a per-request operation; use the server compaction setting");
	validateAnthropicControls(controls);
	return controls;
}
