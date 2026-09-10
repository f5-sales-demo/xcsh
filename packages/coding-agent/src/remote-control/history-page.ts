// Ported behavior from Codex 0.153.4 thread_processor.rs and
// thread-store/local/thread_history/segment_paging.rs. See NOTICE.md and LICENSE.
import { ProtocolError } from "./errors";

export interface HistoryScope {
	threadId: string;
	collection: "turns" | "items";
	turnId: string | null;
}
export function historyCursor(scope: HistoryScope, anchor: string | undefined, includeAnchor = true): string | null {
	return anchor === undefined ? null : JSON.stringify({ version: 1, ...scope, anchor, includeAnchor });
}

export function historyPageLimit(value: unknown): number {
	const requestedLimit = value ?? 25;
	if (
		typeof requestedLimit !== "number" ||
		!Number.isInteger(requestedLimit) ||
		requestedLimit < 0 ||
		requestedLimit > 0xffffffff
	)
		throw new ProtocolError(-32602, "Invalid history page size");
	return Math.max(1, Math.min(100, requestedLimit));
}
export function historyPage<T>(
	entries: readonly { key: string; value: T }[],
	scope: HistoryScope,
	params: Record<string, unknown>,
): { data: T[]; nextCursor: string | null; backwardsCursor: string | null } {
	const limit = historyPageLimit(params.limit);
	const direction = params.sortDirection ?? (scope.collection === "turns" ? "desc" : "asc");
	if (direction !== "asc" && direction !== "desc") throw new ProtocolError(-32602, "Invalid history sort direction");
	let anchorIndex: number | undefined;
	let inclusive = false;
	if (params.cursor != null) {
		try {
			if (typeof params.cursor !== "string" || params.cursor.length > 8192) throw new Error();
			const cursor = JSON.parse(params.cursor);
			if (
				cursor?.version !== 1 ||
				cursor.threadId !== scope.threadId ||
				cursor.collection !== scope.collection ||
				cursor.turnId !== scope.turnId ||
				typeof cursor.anchor !== "string" ||
				typeof cursor.includeAnchor !== "boolean"
			)
				throw new Error();
			anchorIndex = entries.findIndex(entry => entry.key === cursor.anchor);
			if (anchorIndex < 0) throw new Error();
			inclusive = cursor.includeAnchor;
		} catch {
			throw new ProtocolError(-32602, "Invalid history cursor");
		}
	}
	const step = direction === "asc" ? 1 : -1;
	const start =
		anchorIndex === undefined ? (step === 1 ? 0 : entries.length - 1) : anchorIndex + (inclusive ? 0 : step);
	const page: { key: string; value: T }[] = [];
	let index = start;
	for (; index >= 0 && index < entries.length && page.length < limit; index += step) page.push(entries[index]);
	return {
		data: page.map(entry => entry.value),
		nextCursor: index >= 0 && index < entries.length ? historyCursor(scope, page.at(-1)?.key, false) : null,
		backwardsCursor: historyCursor(scope, page[0]?.key),
	};
}

type ItemsView = "full" | "summary" | "notLoaded";
export function historyItemsView(view: unknown): ItemsView {
	if (view == null) view = "summary";
	if (view !== "full" && view !== "summary" && view !== "notLoaded")
		throw new ProtocolError(-32602, "Invalid history items view");
	return view;
}
export function turnItemsView<T extends { items: Record<string, unknown>[]; itemsView: string }>(
	turn: T,
	view: ItemsView,
): T {
	if (view === "full") return { ...turn, items: [...turn.items], itemsView: view };
	if (view === "notLoaded") return { ...turn, items: [], itemsView: view };
	const firstUser = turn.items.find(item => item.type === "userMessage");
	const lastAgent = turn.items.findLast(item => item.type === "agentMessage");
	const items = firstUser ? [firstUser] : [];
	if (lastAgent && lastAgent.id !== firstUser?.id) items.push(lastAgent);
	return { ...turn, items, itemsView: view };
}
