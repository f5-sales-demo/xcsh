import { interpretTerraformLifecycle, lifecycleEvidence, type TerraformLifecycleIntent } from "./terraform-lifecycle";
// Conservative indexed property selection policy. Scores express rank, never probability.
import {
	type PropertyCandidate,
	propertyConflictingNamedScope,
	propertyExcludedSchemaIdentifiers,
	propertyExplicitSchemaPaths,
	propertyGroupingKey,
	propertyInvalidExcludedScope,
	propertyMatchesExplicitPaths,
	propertyMatchesGrouping,
	propertyMatchesWorkloadArchitecture,
	propertyMatchesWorkloadPortCount,
	propertyMentionedSchemaPaths,
	propertyNamesCollection,
	propertyQueryTerms,
	propertyRequestedBlockText,
	propertyRequestedText,
	propertyRequestedType,
	propertyRequestsBlock,
	propertyRequestsDirectObjectField,
	propertyRequestsRootField,
	propertySchemaIdentifiers,
	propertyTerms,
	propertyUncertainExcludedIdentifiers,
	propertyUncertainGrouping,
	propertyWorkloadArchitecture,
	propertyWorkloadPortCount,
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
	context?: { lifecycle?: TerraformLifecycleIntent; identityResolved?: boolean },
): { kind: "leaf" | "choices" | "none"; destinations: RankedProperty[]; reason: string } {
	const identityPeers = [...input, ...alternatives];
	const excludedIdentifiers = propertyExcludedSchemaIdentifiers(queryText);
	const uncertainExcluded = propertyUncertainExcludedIdentifiers(queryText);
	if (propertyInvalidExcludedScope(queryText))
		return { kind: "none", destinations: [], reason: "Invalid literal excluded branch" };
	if (uncertainExcluded.length || propertyConflictingNamedScope(queryText))
		return {
			kind: "choices",
			destinations: [...input].slice(0, 5),
			reason: "Uncertain or conflicting named branch scope",
		};
	const included = (row: PropertyCandidate) =>
		!excludedIdentifiers.some(identifier => row.schema_path.split(".").includes(identifier));
	input = input.filter(included);
	alternatives = alternatives.filter(included);
	input = input.filter(row => propertyMatchesWorkloadArchitecture(queryText, row));
	input = input.filter(row => propertyMatchesWorkloadPortCount(queryText, row));
	alternatives = alternatives.filter(row => propertyMatchesWorkloadPortCount(queryText, row));
	alternatives = alternatives.filter(row => propertyMatchesWorkloadArchitecture(queryText, row));
	input = input.filter(row => propertyMatchesExplicitPaths(queryText, row));
	alternatives = alternatives.filter(row => propertyMatchesExplicitPaths(queryText, row));
	if (propertyExplicitSchemaPaths(queryText).length && !input.length && !alternatives.length)
		return { kind: "none", destinations: [], reason: "Unsupported explicit schema path" };
	const requestedType = propertyRequestedType(queryText);
	if (requestedType) {
		input = input.filter(row => row.type == null || row.type === requestedType);
		alternatives = alternatives.filter(row => row.type == null || row.type === requestedType);
	}
	if (propertyRequestsRootField(queryText)) {
		input = input.filter(row => !row.schema_path.includes("."));
		alternatives = alternatives.filter(row => !row.schema_path.includes("."));
	}
	const query = new Set(propertyQueryTerms(queryText));
	const identifiers = propertySchemaIdentifiers(queryText).filter(
		term => ![...input, ...alternatives].some(row => row.provider_name === term),
	);
	const identifiersFor = (row: PropertyCandidate) =>
		identifiers.filter(id => propertySchemaIdentifiers(queryText, row.provider_name).includes(id));
	const identifiersMatch = (row: PropertyCandidate) =>
		identifiersFor(row).every(id => row.schema_path.split(".").includes(id));
	if (
		identifiers.some(
			identifier =>
				![...input, ...alternatives].some(
					row => !identifiersFor(row).includes(identifier) || row.schema_path.split(".").includes(identifier),
				),
		)
	)
		return { kind: "none", destinations: [], reason: "Unsupported explicit field identifier" };

	const pathMentions = propertyMentionedSchemaPaths(queryText);
	if (pathMentions.length && !propertyExplicitSchemaPaths(queryText).length) {
		const candidates = [
			...new Map(
				[...input, ...alternatives]
					.filter(identifiersMatch)
					.filter(row => !contradicts(query, row))
					.map(row => [`${row.path}#${row.anchor}`, row]),
			).values(),
		].sort(
			(a, b) =>
				b.score - a.score ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
		return {
			kind: candidates.length ? "choices" : "none",
			destinations: candidates.slice(0, 5),
			reason: "Alternative or negated schema path intent",
		};
	}
	if (propertyUncertainGrouping(queryText))
		return { kind: "choices", destinations: [...input].slice(0, 5), reason: "Uncertain or alternative grouping key" };
	if (propertyGroupingKey(queryText)) {
		input = input.filter(row => propertyMatchesGrouping(queryText, row));
		alternatives = alternatives.filter(row => propertyMatchesGrouping(queryText, row));
		if (!input.length) return { kind: "choices", destinations: [], reason: "Unsupported requested grouping key" };
	}
	const lifecycle = context?.lifecycle ?? interpretTerraformLifecycle(queryText);
	if (lifecycle?.field) {
		const operations = lifecycle.operations.length ? lifecycle.operations : ["create", "read", "update", "delete"];
		const rows = [
			...new Map(
				[...alternatives, ...input]
					.filter(row => operations.some(op => row.schema_path === `timeouts.${op}`) && identifiersMatch(row))
					.map(row => [`${row.path}#${row.anchor}`, row]),
			).values(),
		];
		if (rows.length) {
			const choices = {
				kind: "choices" as const,
				destinations: rows,
				reason: "Missing or unsupported lifecycle operation",
			};
			if (
				lifecycle.operations.length !== 1 ||
				context?.identityResolved === false ||
				new Set(rows.map(row => `${row.provider_type}:${row.provider_name}`)).size !== 1
			)
				return choices;
			const first = rows[0]!;
			const intent = lifecycleEvidence(lifecycle.evidence);
			const requested = propertyQueryTerms(intent);
			const local = new Set(propertyTerms(`${first.schema_path} ${first.description} ${first.provider_name}`));
			if (
				/\b(?:retry|retries|count)\b/i.test(intent) ||
				(requested.length && requested.filter(term => local.has(term)).length / requested.length < 0.35)
			)
				return choices;
			return { kind: "leaf", destinations: [first], reason: "Exact documented lifecycle operation" };
		}
	}

	const unique = new Map<string, RankedProperty>();
	for (const row of input.filter(row => identifiersMatch(row))) {
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
					(/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(queryText) ||
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
	const polarity = /\benabl(?:e|ed|es|ing)\b/i.test(queryText)
		? "enable"
		: /\bdisabl(?:e|ed|es|ing)\b/i.test(queryText)
			? "disable"
			: undefined;
	const choiceName = (row: PropertyCandidate) =>
		row.schema_path
			.split(".")
			.at(-1)
			?.match(/^(enable|disable)_(.+)$/);
	const namedChoices = ranked.filter(row => {
		const name = choiceName(row);
		return row.anchor === "section" && name && propertyTerms(name[2]!).every(term => query.has(term));
	});
	const pair = namedChoices.find(row =>
		namedChoices.some(peer => {
			const a = choiceName(row)!,
				b = choiceName(peer)!;
			return (
				row.provider_name === peer.provider_name &&
				row.provider_type === peer.provider_type &&
				a[1] !== b[1] &&
				a[2] === b[2] &&
				row.schema_path.split(".").slice(0, -1).join(".") === peer.schema_path.split(".").slice(0, -1).join(".")
			);
		}),
	);
	const scalarIntent =
		ranked[0]?.anchor.startsWith("schema-") &&
		ranked[0].coverage >= 0.35 &&
		propertyTerms(ranked[0].schema_path.split(".").at(-1) ?? "").length > 0 &&
		propertyTerms(ranked[0].schema_path.split(".").at(-1) ?? "").every(term => query.has(term));
	if (
		pair &&
		!scalarIntent &&
		(!polarity || (/\benabl(?:e|ed|es|ing)\b/i.test(queryText) && /\bdisabl(?:e|ed|es|ing)\b/i.test(queryText))) &&
		!namedChoices.some(row => propertySchemaIdentifiers(queryText).includes(choiceName(row)![0]))
	)
		return { kind: "choices", destinations: namedChoices.slice(0, 5), reason: "Missing enable or disable choice" };
	const first = ranked[0];
	if (!first) return { kind: "none", destinations: [], reason: "No supported candidate" };
	if (propertyRequestsDirectObjectField(queryText, first) && first.score > 0) {
		const peers = identityPeers.filter(
			row => row.schema_path === first.schema_path && row.anchor.startsWith("schema-"),
		);
		if (peers.some(row => row.provider_type !== first.provider_type || row.provider_name !== first.provider_name))
			return { kind: "choices", destinations: peers.slice(0, 5), reason: "Missing provider identity or role" };
		return { kind: "leaf", destinations: [first], reason: "Exact documented object identity field" };
	}
	const filterTerms = /\b(?:field|attribute|property|parameter|argument)\b\s+filters?\s+.+?\s+by\b/i.test(queryText)
		? propertyQueryTerms(propertyRequestedText(queryText) ?? "")
		: [];
	const filterLocal = new Set(propertyTerms(`${first.schema_path.split(".").at(-1)} ${first.description}`));
	const filterLeaf = propertyTerms(first.schema_path.split(".").at(-1) ?? "");
	const filterInput =
		first.flags?.some(flag => flag === "optional" || flag === "required") === true &&
		filterTerms.length > 0 &&
		filterLeaf.length > 0 &&
		filterLeaf.every(term => filterTerms.includes(term)) &&
		filterTerms.filter(term => filterLocal.has(term)).length / filterTerms.length >= 0.5;
	const blockTarget = propertyRequestedBlockText(queryText);
	const blockTerms = propertyQueryTerms(blockTarget ?? "");
	const blockLeaf = propertyTerms(first.schema_path.split(".").at(-1) ?? "");
	const blockNamedExplicit =
		first.anchor === "section" &&
		blockTerms.length > 0 &&
		blockLeaf.length > 0 &&
		blockLeaf.length === blockTerms.length &&
		blockLeaf.every(term => blockTerms.includes(term));
	const rootRequest = propertyRequestsRootField(queryText)
		? propertyQueryTerms(propertyRequestedText(queryText) ?? "")
		: [];
	const rootLocal = new Set([
		...propertyTerms(`${first.schema_path} ${first.description}`),
		...(first.documentation_terms ?? []),
	]);
	const rootValueSupported =
		!first.schema_path.includes(".") &&
		rootRequest.length > 0 &&
		rootRequest.filter(term => rootLocal.has(term)).length / rootRequest.length >= 0.35;
	if ((first.coverage < 0.35 && !blockNamedExplicit && !filterInput && !rootValueSupported) || first.score <= 0)
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
			...(first.documentation_terms ?? []),
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
				identifiersMatch(row) &&
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
		if (
			first.provider_name === "workload" &&
			parts.includes("advertise_on_public") &&
			otherParts.includes("advertise_on_public") &&
			parts.includes("multi_ports") !== otherParts.includes("multi_ports") &&
			!propertyWorkloadPortCount(queryText)
		)
			return {
				kind: "choices",
				destinations: collisions.slice(0, 5),
				reason: "Missing public port count architecture",
			};
		const servicePair =
			(parts.includes("service") && otherParts.includes("stateful_service")) ||
			(parts.includes("stateful_service") && otherParts.includes("service"));
		if (
			servicePair &&
			(first.provider_name === "workload"
				? !propertyWorkloadArchitecture(queryText)
				: !/\b(?:stateless|stateful|stateful_service)\b/i.test(queryText) &&
					!/\bservice[./]|\b(?:under|branch|path)\s+`?service`?\b/i.test(queryText))
		)
			return {
				kind: "choices",
				destinations: collisions.slice(0, 5),
				reason: "Missing stateless or stateful service architecture",
			};
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
	const groupNamed =
		first.anchor === "section" &&
		completeFieldTerms(first) &&
		/\b(?:define|configure|declare|specify)\b/i.test(queryText) &&
		!/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(queryText) &&
		!ranked
			.slice(1)
			.some(
				other =>
					other.provider_type === first.provider_type &&
					other.provider_name === first.provider_name &&
					other.schema_path.startsWith(`${first.schema_path}.`) &&
					completeFieldTerms(other),
			);
	const blockNamed =
		blockNamedExplicit ||
		groupNamed ||
		(first.anchor === "section" && propertyRequestsBlock(queryText) && completeFieldTerms(first));
	const second = ranked.slice(1).find(other => {
		if (
			(fieldNamed ||
				(first.anchor.startsWith("schema-") &&
					requestedTerms.some(
						term =>
							propertyTerms(parts.at(-1)!).includes(term) && !propertyTerms(other.schema_path).includes(term),
					))) &&
			other.anchor === "section" &&
			other.provider_type === first.provider_type &&
			other.provider_name === first.provider_name &&
			first.schema_path.startsWith(`${other.schema_path}.`)
		)
			return false;
		if (
			propertyNamesCollection(queryText, first) &&
			other.provider_type === first.provider_type &&
			other.provider_name === first.provider_name &&
			other.schema_path.startsWith(`${first.schema_path}.`)
		)
			return false;
		if (filterInput && other.flags?.length && !other.flags.some(flag => flag === "optional" || flag === "required"))
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
			const leafTerms = new Set(propertyTerms(parts.at(-1) ?? ""));
			const ownContext = new Set(propertyTerms(parts.slice(0, -1).join(" ")).filter(term => !leafTerms.has(term)));
			const peerContext = new Set(
				propertyTerms(other.schema_path.split(".").slice(0, -1).join(" ")).filter(term => !leafTerms.has(term)),
			);
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
					...(row.documentation_terms ?? []),
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
