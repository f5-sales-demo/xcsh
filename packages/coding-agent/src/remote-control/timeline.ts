// Ported paging/order semantics from pinned thread-store/local/thread_history/realtime.rs.
// Native source-entry identities keep anchors stable across append and compaction.
// See NOTICE.md and LICENSE.
import { ProtocolError } from "./errors";
import type { TimelineEntry, TimelineRow } from "./history";
import { historyPageLimit } from "./history-page";

const kinds = { turnStarted: 0, item: 1, realtime: 2, turnCompleted: 3 } as const;
const id = (entry: TimelineEntry): string => ("item" in entry ? String(entry.item.id) : entry.turnId);
function compare(a: TimelineRow, b: TimelineRow): number {
	return (
		a.entry.position - b.entry.position ||
		kinds[a.entry.type] - kinds[b.entry.type] ||
		Buffer.compare(Buffer.from(id(a.entry)), Buffer.from(id(b.entry)))
	);
}
function realtimeItem(value: Record<string, unknown>): Record<string, unknown> {
	const invalid = () => new ProtocolError(-32000, "Invalid stored realtime history");
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		typeof value.id !== "string" ||
		typeof value.realtimeSessionId !== "string"
	)
		throw invalid();
	const base = { id: value.id, realtimeSessionId: value.realtimeSessionId, type: value.type };
	if (value.type === "realtimeSessionStarted") return base;
	if (
		value.type === "transcriptSegment" &&
		(value.role === "user" || value.role === "assistant") &&
		typeof value.text === "string"
	)
		return { ...base, role: value.role, text: value.text };
	if (value.type === "realtimeSessionClosed" && (value.outcome === "ended" || value.outcome === "failed"))
		return { ...base, outcome: value.outcome };
	if (value.type === "bemItemPromoted" && typeof value.turnId === "string" && typeof value.itemId === "string") {
		const presentation = value.presentation as { type?: unknown; index?: unknown } | null;
		if (presentation?.type === "wholeItem" || presentation?.type === "inlineMarkdown")
			return { ...base, turnId: value.turnId, itemId: value.itemId, presentation: { type: presentation.type } };
		if (
			presentation?.type === "inlineVisualization" &&
			typeof presentation.index === "number" &&
			Number.isInteger(presentation.index) &&
			presentation.index >= 0 &&
			presentation.index <= 0xffffffff
		)
			return {
				...base,
				turnId: value.turnId,
				itemId: value.itemId,
				presentation: { type: presentation.type, index: presentation.index },
			};
	}
	throw invalid();
}
export function timelinePage(threadId: string, timeline: readonly TimelineRow[], params: Record<string, unknown>) {
	const limit = historyPageLimit(params.limit);
	const rows: TimelineRow[] = [];
	const realtime = new Map<string, TimelineRow>();
	for (const row of timeline) {
		if (row.entry.type !== "realtime") {
			rows.push(row);
			continue;
		}
		const item = realtimeItem(row.entry.item);
		const existing = realtime.get(String(item.id));
		if (existing && existing.entry.type === "realtime") existing.entry.item = item;
		else {
			const next: TimelineRow = { ...row, entry: { ...row.entry, item } };
			rows.push(next);
			realtime.set(String(item.id), next);
		}
	}
	rows.sort(compare);
	let end = rows.length;
	if (params.cursor != null) {
		try {
			if (typeof params.cursor !== "string" || params.cursor.length > 8192) throw new Error();
			const cursor = JSON.parse(params.cursor);
			if (
				cursor?.version !== 1 ||
				cursor.threadId !== threadId ||
				typeof cursor.sourceId !== "string" ||
				typeof cursor.id !== "string" ||
				!Object.hasOwn(kinds, cursor.type)
			)
				throw new Error();
			end = rows.findIndex(
				row => row.sourceId === cursor.sourceId && row.entry.type === cursor.type && id(row.entry) === cursor.id,
			);
			if (end < 0) throw new Error();
		} catch {
			throw new ProtocolError(-32600, "Invalid thread timeline cursor");
		}
	}
	const start = Math.max(0, end - limit);
	const page = rows.slice(start, end);
	let activeRealtimeSessionAtPageStart: string | null = null;
	if (page.length)
		for (let i = start - 1; i >= 0; i--) {
			const row = rows[i].entry;
			if (row.type !== "realtime") continue;
			if (row.item.type === "realtimeSessionStarted") {
				activeRealtimeSessionAtPageStart = String(row.item.realtimeSessionId);
				break;
			}
			if (row.item.type === "realtimeSessionClosed") break;
		}
	const anchor = page[0];
	return {
		data: page.map(row => row.entry),
		nextCursor:
			start > 0 && anchor
				? JSON.stringify({
						version: 1,
						threadId,
						sourceId: anchor.sourceId,
						type: anchor.entry.type,
						id: id(anchor.entry),
					})
				: null,
		activeRealtimeSessionAtPageStart,
	};
}
