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
	const storagePhrase =
		/\b(clear|unencrypted|encrypted|blindfolded)\s+((?:(?:authorization[ -]key|private[ -]key|client[ -]password|api[ -]token|key|password|token|credential)s?\s+))(?:store\s+reference|secret\s+url|secret\s+location|storage\s+location)\b/i.exec(
			clause,
		);
	const storageMatch =
		storagePhrase && /\b(?:key|password|token|credential)s?\b/i.test(storagePhrase[2]!.replaceAll("-", " "))
			? storagePhrase
			: null;
	if (
		storageMatch &&
		!/\b(?:locate|find|where\s+is)\s+(?:(?:the|a|an)\s+)?$/i.test(clause.slice(0, storageMatch.index))
	)
		return { uncertain: true };
	const representationMatch = match ?? storageMatch;
	if (!representationMatch)
		return {
			uncertain:
				/\b(?:clear|unencrypted|encrypted|blindfolded)\b/i.test(clause) &&
				/\b(?:key|password|token|credential)[ -]|\bcredential\b/i.test(clause) &&
				/\bstore\s+reference\b/i.test(clause),
		};
	const clear =
		(storageMatch && /^(?:clear|unencrypted)$/i.test(storageMatch[1]!)) ||
		/\b(?:clear|unencrypted)[ -](?:api[ -]token[ -])?secrets?\b/i.test(clause);
	const encrypted =
		(storageMatch && /^(?:encrypted|blindfolded)$/i.test(storageMatch[1]!)) ||
		/\b(?:encrypted|blindfolded)[ -](?:api[ -]token[ -])?secrets?\b/i.test(clause);
	const uncertain =
		(clear && encrypted) ||
		Boolean(
			representationMatch &&
				/\b(?:clear|unencrypted)\b/i.test(clause) &&
				/\b(?:encrypted|blindfolded)\b/i.test(clause),
		) ||
		/[`"'‘’“”]|\b(?:not|no|never|without|or|and|either|versus|vs|example|avoid|excluding|instead|rather|such as|for instance|while|when|unless|but)\b/i.test(
			clause,
		) ||
		clauses.some(
			other =>
				other !== clause &&
				/\b(?:secret|secrets|clear|unencrypted|encrypted|blindfolded|example|for instance)\b/i.test(other),
		);
	if (uncertain) return { uncertain: true };
	return {
		branch: /^(?:clear|unencrypted)$/i.test(representationMatch[1]!) ? "clear_secret_info" : "blindfold_secret_info",
		uncertain: false,
	};
}

export function filterSecretRepresentation<T extends { schema_path: string }>(text: string, rows: readonly T[]): T[] {
	const representation = requestedSecretRepresentation(text);
	return representation.branch
		? rows.filter(row => row.schema_path.split(".").includes(representation.branch!))
		: [...rows];
}
