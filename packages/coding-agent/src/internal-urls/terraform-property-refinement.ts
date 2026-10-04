import type { RankedProperty } from "./terraform-property-selection";
export function refineRankedProperty(rows: readonly RankedProperty[], path: string, anchor: string): RankedProperty[] {
	const block = rows[0];
	if (!block || block.anchor !== "section") return [...rows];
	const field = rows.find(
		row =>
			row.path === path &&
			row.anchor === anchor &&
			row.provider_type === block.provider_type &&
			row.provider_name === block.provider_name,
	);
	if (!field) return [...rows];
	return rows
		.filter(row => row !== block)
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
}
