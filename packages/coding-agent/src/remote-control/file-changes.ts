/** File-change wire conversion; see NOTICE.md for the pinned Apache-2.0 source. */
import { isRecord } from "@f5-sales-demo/pi-utils";

export function updateFileHistoryItem(
	item: Record<string, unknown>,
	value: unknown,
): Record<string, unknown> | undefined {
	if (
		!isRecord(value) ||
		value.kind !== "fileChange" ||
		typeof value.status !== "string" ||
		!["inProgress", "completed", "failed", "declined"].includes(value.status) ||
		!Array.isArray(value.changes)
	)
		return;
	const paths = new Set<string>();
	const changes: { path: string; kind: Record<string, unknown>; diff: string }[] = [];
	for (const change of value.changes) {
		if (!isRecord(change) || typeof change.path !== "string" || paths.has(change.path)) return;
		paths.add(change.path);
		if ((change.type === "add" || change.type === "delete") && typeof change.content === "string") {
			changes.push({ path: change.path, kind: { type: change.type }, diff: change.content });
		} else if (
			change.type === "update" &&
			typeof change.unifiedDiff === "string" &&
			(change.movePath === null || typeof change.movePath === "string")
		) {
			changes.push({
				path: change.path,
				kind: { type: "update", move_path: change.movePath },
				diff:
					change.movePath === null ? change.unifiedDiff : `${change.unifiedDiff}\n\nMoved to: ${change.movePath}`,
			});
		} else return;
	}
	// Rust String ordering compares UTF-8 bytes, unlike JavaScript's UTF-16 ordering.
	changes.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
	return { ...item, changes, status: value.status };
}
