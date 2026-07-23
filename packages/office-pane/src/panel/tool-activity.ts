/**
 * Pure tool-activity folding for the transcript's live "Reading data…" rows.
 *
 * xcsh's chat-handler emits a `chat_tool_notice` on every tool_execution_start
 * and tool_execution_end (host tools AND engine tools), carrying `{ tool, ok }`
 * but NO per-call id. So start↔end are paired by tool name: a notice whose tool
 * already has a still-running activity SETTLES it; otherwise it STARTS a new one.
 * Sequential same-tool calls therefore become distinct rows (settle, then start),
 * which is exactly what a reader wants to see.
 *
 * Browser-safe: no node:* imports, no Office.js. Framework-free + immutable.
 */
import type { ChatToolNoticeMsg } from "../core";

export interface ToolActivity {
	readonly tool: string;
	readonly running: boolean;
	readonly ok: boolean;
}

/** Fold one `chat_tool_notice` into a turn's ordered activity list. */
export function foldToolNotice(activities: readonly ToolActivity[], notice: ChatToolNoticeMsg): ToolActivity[] {
	const idx = activities.findIndex(a => a.running && a.tool === notice.tool);
	if (idx >= 0) {
		const next = activities.slice();
		next[idx] = { ...next[idx], running: false, ok: notice.ok };
		return next;
	}
	return [...activities, { tool: notice.tool, running: true, ok: notice.ok }];
}

/**
 * Settle any still-running activities — called when the turn reaches a terminal
 * frame (chat_done / chat_error) so an unclosed activity never spins forever.
 * Returns the same reference when nothing is running (avoids a needless re-render).
 */
export function settleActivities(activities: readonly ToolActivity[]): ToolActivity[] {
	if (!activities.some(a => a.running)) return activities as ToolActivity[];
	return activities.map(a => (a.running ? { ...a, running: false } : a));
}
