// Development-only selection policy. Scores express rank, never probability.
import { propertyTerms, type PropertyCandidate } from "./contrastive-ranking";
export interface RankedProperty extends PropertyCandidate {
	score: number;
	coverage: number;
}
const contradictoryPairs = [
	["inside", "outside"],
	["ipv4", "ipv6"],
	["public", "private"],
	["success", "failure"],
] as const;
function contradicts(query: Set<string>, candidate: PropertyCandidate) {
	const path = new Set(propertyTerms(candidate.schema_path));
	return contradictoryPairs.some(
		([a, b]) =>
			(query.has(a) && !query.has(b) && path.has(b) && !path.has(a)) ||
			(query.has(b) && !query.has(a) && path.has(a) && !path.has(b)),
	);
}
export function selectPropertyDestination(
	queryText: string,
	input: readonly RankedProperty[],
	alternatives: readonly RankedProperty[] = [],
): { kind: "leaf" | "choices" | "none"; destinations: RankedProperty[]; reason: string } {
	const query = new Set(propertyTerms(queryText));
	const unique = new Map<string, RankedProperty>();
	for (const row of input) {
		const key = `${row.path}#${row.anchor}`;
		if (!unique.has(key) || unique.get(key)!.score < row.score) unique.set(key, row);
	}
	const ranked = [...unique.values()]
		.filter(row => !contradicts(query, row))
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
	const first = ranked[0];
	if (!first) return { kind: "none", destinations: [], reason: "No supported candidate" };
	if (first.coverage < 0.35 || first.score <= 0)
		return { kind: "choices", destinations: ranked.slice(0, 5), reason: "Insufficient query coverage" };
	const parts = first.schema_path.split(".");
	const collisions = [
		first,
		...ranked.slice(1),
		...alternatives.filter(
			row => !contradicts(query, row) && !ranked.some(r => r.path === row.path && r.anchor === row.anchor),
		),
	].filter(
		row =>
			row.schema_path.split(".").at(-1) === parts.at(-1) &&
			propertyTerms(row.description).join(" ") === propertyTerms(first.description).join(" "),
	);
	for (const other of collisions.slice(1)) {
		if (other.provider_type !== first.provider_type || other.provider_name !== first.provider_name)
			return { kind: "choices", destinations: collisions.slice(0, 5), reason: "Missing provider identity or role" };
		const otherParts = other.schema_path.split(".");
		let a = parts.length - 1,
			b = otherParts.length - 1;
		while (a >= 0 && b >= 0 && parts[a] === otherParts[b]) {
			a--;
			b--;
		}
		if (a < 0 && b < 0) continue;
		const differing = parts.slice(0, a + 1).filter(part => !otherParts.includes(part));
		if (!differing.some(part => propertyTerms(part).every(term => query.has(term))))
			return { kind: "choices", destinations: collisions.slice(0, 5), reason: "Missing schema branch context" };
	}
	const second = ranked[1];
	if (second && first.score < second.score * 1.3)
		return { kind: "choices", destinations: ranked.slice(0, 5), reason: "Close competing destinations" };
	return { kind: "leaf", destinations: [first], reason: "Separated candidate with supported branch context" };
}
