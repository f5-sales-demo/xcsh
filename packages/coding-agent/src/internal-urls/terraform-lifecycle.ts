// One conservative interpretation shared by retrieval and selection.
export interface TerraformLifecycleIntent {
	operations: string[];
	field: boolean;
	evidence: string;
}
export function interpretTerraformLifecycle(query: string): TerraformLifecycleIntent | undefined {
	if (
		!/\btimeouts?\b|\bduration\b/i.test(query) ||
		/\b(?:connection|idle|request|response|tls|handshake|probe)\b/i.test(query)
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
	const clauses = query.split(/[.!?;]+/).filter(clause => /\btimeouts?\b|\bduration\b/i.test(clause));
	const evidence = clauses
		.join(" ")
		.replace(
			/\b(?:read|refresh(?:ing|ed|es)?|inspect|update|modify|create|delete)\s+(?:the\s+)?(?:timeouts?\s+)?(?:documentation|docs|guide|page)\b/gi,
			"documentation",
		);
	const patterns: Array<[string, RegExp]> = [
		["create", /\b(?:create|creation|creating)\b/i],
		["read", /\brefresh(?:ing|ed|es)?\b|\bread\s+operation\b|\boperation\s+read\b|\bread\s+timeout\b/i],
		["update", /\b(?:update|modification|modify|modifying)\b/i],
		["delete", /\b(?:delete|deletion|destroy|destruction|deleting)\b/i],
	];
	if (!/\btimeouts?\b/i.test(query) && !patterns.some(([, pattern]) => pattern.test(evidence))) return undefined;
	const conflicting = /\b(?:not|never|except|without|rather than|instead of)\b/i.test(evidence);
	return {
		operations: conflicting ? [] : patterns.filter(([, pattern]) => pattern.test(evidence)).map(([name]) => name),
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
