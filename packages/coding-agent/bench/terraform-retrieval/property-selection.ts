// Development-only selection policy. Scores express rank, never probability.
import { type PropertyCandidate, propertyTerms } from "./contrastive-ranking";
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
	if (
		query.has("custom") &&
		query.has("static") &&
		query.has("route") &&
		candidate.schema_path.split(".").includes("simple_static_route")
	)
		return true;
	if (query.has("single") && !query.has("dual") && path.has("dual")) return true;
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
	const identifiers = (queryText.toLowerCase().match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) ?? []).filter(
		term => !term.startsWith("xcsh_") && ![...input, ...alternatives].some(row => row.provider_name === term),
	);
	if (
		identifiers.some(
			identifier => ![...input, ...alternatives].some(row => row.schema_path.split(".").includes(identifier)),
		)
	)
		return { kind: "none", destinations: [], reason: "Unsupported explicit field identifier" };

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
	let requestedTerms: string[] = [];
	const intent = queryText.match(
		/\b(?:sets?|provides?|enables?|accepts?|specifies|specify|specifying|holds?|retrieves?)\b\s+(.+)/i,
	)?.[1];
	if (intent && /\b(?:attribute|field|property|parameter|option)\b/i.test(queryText)) {
		const generic = new Set(["option", "native", "directly", "allow", "added"]);
		requestedTerms = propertyTerms(intent.split(/\bfor\b/i)[0]!).filter(term => !generic.has(term));
		const local = new Set(propertyTerms(`${first.schema_path} ${first.description}`));
		const matches = requestedTerms.filter(term => local.has(term)).length;
		if (requestedTerms.length && matches / requestedTerms.length < 0.35)
			return {
				kind: "choices",
				destinations: ranked.slice(0, 5),
				reason: "Insufficient requested operation evidence",
			};
	}
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
		if (
			!differing.some(part => {
				const full = propertyTerms(part);
				const terms = full;
				return terms.length > 0 && terms.every(term => query.has(term));
			})
		)
			return { kind: "choices", destinations: collisions.slice(0, 5), reason: "Missing schema branch context" };
	}
	const completeFieldTerms = (candidate: PropertyCandidate) => {
		const terms = propertyTerms(candidate.schema_path.split(".").at(-1) ?? "");
		return terms.length > 0 && terms.every(term => query.has(term));
	};
	const fieldNamed = first.anchor.startsWith("schema-") && completeFieldTerms(first);
	const second = ranked.slice(1).find(other => {
		if (other.provider_type === first.provider_type && other.provider_name === first.provider_name && fieldNamed) {
			if (other.anchor === "section" && parts.slice(0, -1).join(".") === other.schema_path) return false;
			const fieldTerms = propertyTerms(parts.at(-1) ?? "");
			if (
				fieldTerms.length >= 2 &&
				parts.slice(0, -1).join(".") === other.schema_path.split(".").slice(0, -1).join(".") &&
				!completeFieldTerms(other)
			)
				return false;
		}

		if (other.provider_type !== first.provider_type || other.provider_name !== first.provider_name) return true;
		if (requestedTerms.length) {
			const matched = (row: PropertyCandidate) => {
				const terms = new Set(propertyTerms(`${row.schema_path.split(".").at(-1)} ${row.description}`));
				return new Set(requestedTerms.filter(term => terms.has(term)));
			};
			const firstMatches = matched(first),
				otherMatches = matched(other);
			if (firstMatches.size > otherMatches.size && [...otherMatches].every(term => firstMatches.has(term)))
				return false;
		}
		if (
			other.schema_path.split(".").at(-1) !== parts.at(-1) ||
			propertyTerms(other.description).join(" ") !== propertyTerms(first.description).join(" ")
		)
			return true;
		// All identical leaf/description branches were checked against full-scope collisions above.
		return false;
	});
	if (second && first.score < second.score * 1.3)
		return { kind: "choices", destinations: ranked.slice(0, 5), reason: "Close competing destinations" };
	return { kind: "leaf", destinations: [first], reason: "Separated candidate with supported branch context" };
}
