export function requestedSecretRepresentation(text: string): { branch?: string; uncertain: boolean } {
	const normalized = text.replace(/\be\.g\./gi, "for example");
	const clauses = normalized.split(/[;!?]|\.(?=\s|$)/);
	const requests = clauses.filter(clause => /\b(?:locate|find|which\s+field|where\s+is)\b/i.test(clause));
	if (requests.length !== 1) return { uncertain: false };
	const clause = requests[0]!;
	const match =
		/\b(?:for|of)\s+(?:(?:the|a|an)\s+)?(clear|unencrypted|encrypted|blindfolded)[ -](?:api[ -]token[ -])?secrets?\b/i.exec(
			clause,
		);
	if (!match) return { uncertain: false };
	const uncertain =
		/[`"'‘’“”]|\b(?:not|no|never|without|or|and|either|versus|vs|example|avoid|excluding|instead|rather|such as|for instance|while|when)\b/i.test(
			clause,
		) ||
		clauses.some(
			other =>
				other !== clause &&
				/\b(?:secret|secrets|clear|unencrypted|encrypted|blindfolded|example|for instance)\b/i.test(other),
		);
	if (uncertain) return { uncertain: true };
	return {
		branch: /^(?:clear|unencrypted)$/i.test(match[1]!) ? "clear_secret_info" : "blindfold_secret_info",
		uncertain: false,
	};
}

export function filterSecretRepresentation<T extends { schema_path: string }>(text: string, rows: readonly T[]): T[] {
	const representation = requestedSecretRepresentation(text);
	return representation.branch
		? rows.filter(row => row.schema_path.split(".").includes(representation.branch!))
		: [...rows];
}
