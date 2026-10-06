// One conservative interpretation shared by retrieval and selection.
export interface TerraformLifecycleIntent {
	operations: string[];
	field: boolean;
	evidence: string;
}
export function interpretTerraformLifecycle(query: string): TerraformLifecycleIntent | undefined {
	const explicitTrail = /\bfollow\s+`([a-z][a-z0-9_]*)`/i.exec(query)?.[1];
	if (explicitTrail && explicitTrail !== "timeouts" && !/\blifecycle\b/i.test(query)) return undefined;

	if (
		/\b(?:explain|find|verify|check)\s+(?:the\s+)?(?:documented\s+)?field\s+`timeout`/i.test(query) &&
		/\bfollow\s+`(?!timeouts`)[a-z][a-z0-9_]*`/i.test(query) &&
		!/\blifecycle\b/i.test(query)
	)
		return undefined;

	const clauses = query.split(/[.!?;]+/).filter(clause => /\btimeouts?\b|\bduration\b/i.test(clause));
	const transport =
		/\b(?:connection|idle|inactive|request|response|tls|handshake|probe|stream)\b|\bno[ -]traffic\b|\btimeout\s+per\s+retry\b|\bretry\s+attempt\b/i;
	if (
		!clauses.length ||
		query.split(/[.!?;]+/).some(clause => {
			const replacement = clause.match(
				/\bnot\s+(?:the\s+)?(?:resource|connection)\b[^.!?;]*?\b(?:but|rather)\s+(?:the\s+)?(resource|connection)\b/i,
			)?.[1];
			const affirmative = replacement ?? clause.split(/\b(?:not|rather than|instead of)\b/i)[0]!;
			return (
				transport.test(affirmative) &&
				(/\b(?:i mean|i meant|instead|rather|concerns?|refers? to)\b/i.test(clause) ||
					/\bnot\s+(?:the\s+)?resource\b/i.test(clause))
			);
		}) ||
		clauses.some(clause =>
			transport.test(
				clause
					.split(/\bnot\s+(?:an?\s+)?API timeout\b/i)[0]!
					.replace(/\binactive\s+(?:[a-z0-9_-]+\s+){0,2}resource\b/gi, "resource"),
			),
		)
	)
		return undefined;
	const question = query.replace(/\bproperty\s+(?:documentation|reference)\b/gi, "documentation");
	const block =
		/\btimeouts?\s+(?:configuration\s+)?block\b/i.test(question) &&
		!/\b(?:field|attribute|property|parameter)\b/i.test(question) &&
		(!/\b(?:duration|value|limit)\b[^.!?]*\b(?:in|inside|under|within)\b[^.!?]*\btimeouts?\s+(?:configuration\s+)?block\b/i.test(
			question,
		) ||
			/\b(?:entire|whole|complete)\b[^.!?]*\bblock\b/i.test(question));
	const evidence = clauses
		.map(clause => clause.replace(/,?\s+not\s+(?:an?\s+)?API timeout\b[^.!?;]*$/i, ""))
		.join(" ")
		.replace(
			/\b(?:read|refresh(?:ing|ed|es)?|inspect|update|modify|create|delete)\s+(?:the\s+)?(?:timeouts?\s+)?(?:documentation|docs|guide|page)\b/gi,
			"documentation",
		);
	const quotedOperations = /\btimeouts?\b/i.test(query)
		? [...new Set([...query.matchAll(/`(create|read|update|delete)`/gi)].map(m => m[1]!.toLowerCase()))]
		: [];
	const patterns: Array<[string, RegExp]> = [
		["create", /\b(?:create|creation|creating)\b/i],
		[
			"read",
			/\brefresh(?:ing|ed|es)?\b|\bread\s+(?:(?:or|and)\s+(?:create|update|delete)\s+)?operations?\b|\boperation\s+read\b|\bread\s+timeout\b/i,
		],
		["update", /\b(?:update|modification|modify|modifying)\b/i],
		["delete", /\b(?:delete|deletion|destroy|destruction|deleting)\b/i],
	];
	if (!/\btimeouts?\b/i.test(query) && !patterns.some(([, pattern]) => pattern.test(evidence))) return undefined;
	const conflicting = /\b(?:not|never|except|without|rather than|instead of)\b/i.test(evidence);
	return {
		operations: conflicting
			? []
			: patterns
					.filter(([name, pattern]) => quotedOperations.includes(name) || pattern.test(evidence))
					.map(([name]) => name),
		field: !block,
		evidence,
	};
}
export function lifecycleEvidence(evidence: string): string {
	return evidence
		.replace(/\bmaximum duration permitted\b/gi, "duration")
		.replace(/\b(?:creation|creating)\b/gi, "create")
		.replace(/\b(?:destruction|deletion|destroy|deleting)\b/gi, "delete")
		.replace(/\b(?:modification|modify|modifying)\b/gi, "update")
		.replace(/\brefresh(?:ing|ed|es)?\b/gi, "read");
}
