// Conservative indexed property selection policy. Scores express rank, never probability.
import {
	type PropertyCandidate,
	propertyNamesCollection,
	propertyQueryTerms,
	propertyRequestedText,
	propertyRequestsBlock,
	propertyRequestsDirectObjectField,
	propertyTerms,
} from "./terraform-property-ranking";
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
	const query = new Set(propertyQueryTerms(queryText));
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
	for (const row of input.filter(row =>
		identifiers.every(identifier => row.schema_path.split(".").includes(identifier)),
	)) {
		const key = `${row.path}#${row.anchor}`;
		if (!unique.has(key) || unique.get(key)!.score < row.score) unique.set(key, row);
	}
	const ranked = [...unique.values()]
		.filter(row => !contradicts(query, row))
		.filter(
			row =>
				!(
					row.anchor === "section" &&
					!propertyNamesCollection(queryText, row) &&
					(/\b(?:field|attribute|property|parameter)\b/i.test(queryText) ||
						Boolean(propertyRequestedText(queryText))) &&
					!propertyRequestsBlock(queryText) &&
					[...unique.values()].some(other => {
						const terms = propertyTerms(other.schema_path.split(".").at(-1) ?? "");
						return (
							other.provider_type === row.provider_type &&
							other.provider_name === row.provider_name &&
							other.anchor.startsWith("schema-") &&
							other.schema_path.startsWith(`${row.schema_path}.`) &&
							terms.length > 0 &&
							terms.every(term => query.has(term)) &&
							!contradicts(query, other)
						);
					})
				),
		)
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
	const intent =
		propertyRequestedText(queryText) ??
		queryText.match(
			/\b(?:sets?|provides?|enables?|accepts?|specifies|specify|specifying|holds?|retrieves?)\b\s+(.+)/i,
		)?.[1];
	if (
		intent &&
		(/\b(?:attribute|field|property|parameter|option)\b/i.test(queryText) ||
			Boolean(propertyRequestedText(queryText)))
	) {
		const generic = new Set(["option", "native", "directly", "allow", "added"]);
		requestedTerms = propertyQueryTerms(intent.split(/\bfor\b|\breferenced in\b/i)[0]!).filter(
			term => !generic.has(term),
		);
		const local = new Set([
			...propertyTerms(`${first.schema_path} ${first.description}`),
			...(first.evidence_terms ?? []),
		]);
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
			row =>
				identifiers.every(identifier => row.schema_path.split(".").includes(identifier)) &&
				!contradicts(query, row) &&
				!ranked.some(r => r.path === row.path && r.anchor === row.anchor),
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
		const firstVocabulary = propertyTerms(first.schema_path).sort().join(" ");
		const otherVocabulary = propertyTerms(other.schema_path).sort().join(" ");
		if (first.schema_path !== other.schema_path && firstVocabulary === otherVocabulary)
			return { kind: "choices", destinations: collisions.slice(0, 5), reason: "Missing schema nesting order" };
		let a = parts.length - 1,
			b = otherParts.length - 1;
		while (a >= 0 && b >= 0 && parts[a] === otherParts[b]) {
			a--;
			b--;
		}
		if (a < 0 && b < 0) continue;
		if (propertyRequestsDirectObjectField(queryText, first) && otherParts.length > parts.length) continue;

		const operators = new Set(["and", "or", "none"]);
		const rawIdentifiers = new Set(queryText.toLowerCase().match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) ?? []);
		const logicalWords = new Set(
			[
				...queryText
					.toLowerCase()
					.matchAll(
						/\b(and|or|none)\s+(?:operator|branch|combinator|match)\b|\b(?:operator|branch|combinator)\s+(and|or|none)\b/g,
					),
			].map(match => match[1] ?? match[2]),
		);
		if (/\bnone of\b[^.!?]*\bmatch\b/i.test(queryText)) logicalWords.add("none");
		if (/\ball of\b[^.!?]*\bmatch\b/i.test(queryText)) logicalWords.add("and");
		if (/\bany of\b[^.!?]*\bmatch\b/i.test(queryText)) logicalWords.add("or");
		const operatorBranch = parts.some((part, index) => {
			const peer = otherParts[index];
			if (!peer || part === peer) return false;
			const own = part.split("_"),
				other = peer.split("_");
			return (
				operators.has(own.at(-1) ?? "") &&
				operators.has(other.at(-1) ?? "") &&
				own.slice(0, -1).join("_") === other.slice(0, -1).join("_") &&
				!rawIdentifiers.has(part) &&
				!(logicalWords.has(own.at(-1)!) && !logicalWords.has(other.at(-1)!))
			);
		});
		if (operatorBranch)
			return { kind: "choices", destinations: collisions.slice(0, 5), reason: "Missing boolean operator branch" };
		const differing = parts.slice(0, a + 1).filter(part => !otherParts.includes(part));
		if (
			!differing.some(part => {
				const full = propertyTerms(part);
				const index = parts.indexOf(part);
				const peer = propertyTerms(otherParts[index] ?? "");
				const common = full.filter(term => peer.includes(term));
				const difference = full.filter(term => !peer.includes(term));
				// Parallel equally deep segments can share descriptive boilerplate.
				const otherVocabulary = new Set(propertyTerms(other.schema_path));
				const terms = common.length >= 1 && difference.some(term => !otherVocabulary.has(term)) ? difference : full;
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
	const blockNamed = first.anchor === "section" && propertyRequestsBlock(queryText) && completeFieldTerms(first);
	const second = ranked.slice(1).find(other => {
		if (
			propertyNamesCollection(queryText, first) &&
			other.provider_type === first.provider_type &&
			other.provider_name === first.provider_name &&
			other.schema_path.startsWith(`${first.schema_path}.`)
		)
			return false;
		if (
			propertyRequestsDirectObjectField(queryText, first) &&
			other.provider_type === first.provider_type &&
			other.provider_name === first.provider_name &&
			other.schema_path.endsWith(`.${first.schema_path}`)
		)
			return false;
		if (
			blockNamed &&
			other.provider_type === first.provider_type &&
			other.provider_name === first.provider_name &&
			other.schema_path.startsWith(`${first.schema_path}.`)
		)
			return false;
		if (other.provider_type === first.provider_type && other.provider_name === first.provider_name && fieldNamed) {
			if (other.anchor === "section" && parts.slice(0, -1).join(".") === other.schema_path) return false;
			if (
				parts.at(-1) === "name" &&
				/\b(?:name of|object name|reference name)\b/i.test(queryText) &&
				!/\b(?:url|upload|inline)\b/i.test(queryText) &&
				other.schema_path === `${parts.slice(0, -1).join(".")}_url`
			)
				return false;

			const fieldTerms = propertyTerms(parts.at(-1) ?? "");
			if (
				fieldTerms.length >= 2 &&
				parts.slice(0, -1).join(".") === other.schema_path.split(".").slice(0, -1).join(".") &&
				!completeFieldTerms(other)
			)
				return false;
		}

		if (other.provider_type !== first.provider_type || other.provider_name !== first.provider_name) return true;
		if (requestedTerms.length && other.schema_path.split(".").at(-1) === parts.at(-1)) {
			const ownContext = new Set(propertyTerms(parts.slice(0, -1).join(" ")));
			const peerContext = new Set(propertyTerms(other.schema_path.split(".").slice(0, -1).join(" ")));
			if (
				requestedTerms.some(term => ownContext.has(term) && !peerContext.has(term)) &&
				!requestedTerms.some(term => peerContext.has(term) && !ownContext.has(term))
			)
				return false;
		}
		if (requestedTerms.length) {
			const matched = (row: PropertyCandidate) => {
				const terms = new Set([
					...propertyTerms(`${row.schema_path.split(".").at(-1)} ${row.description}`),
					...(row.evidence_terms ?? []),
				]);
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
