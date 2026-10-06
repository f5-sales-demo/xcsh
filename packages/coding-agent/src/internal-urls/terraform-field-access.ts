export function requestedFieldAccess(query: string): "input" | "output" | undefined {
	// Preserve literal field identifiers while rejecting quotations, examples and path-like labels.
	const text = query.replace(/`([a-z][a-z0-9_]*)`/gi, "$1");
	if (/["`“”]/.test(text) || /\be\.g\.|\b(?:dont|don.t|cannot|can.t|do not)\b/i.test(text)) return undefined;
	const clauses = text.split(/[!?;]|\.(?=\s|$)/);
	const requests = new Set<"input" | "output">();
	for (const clause of clauses) {
		if (/\b(?:not|no|never|without|either|or|example|such as|called|named)\b/i.test(clause)) continue;
		if (/\binput\b/.test(clause) && /\boutput\b/.test(clause)) return undefined;
		const access =
			/\b(?:find|locate|select|identify)\s+(?:(?:the|an?|data[ -]source)\s+)*(input|output)\s+(?:field|attribute|argument|parameter|property|that|which|showing)\b|\bdata[ -]source (input|output)\s+(?:field|attribute|argument|parameter|property|that|which|showing)\b/i.exec(
				clause,
			);
		const legacy = /\b(configurable|configuration) argument\b|\bread[ -]only attribute\b/i.exec(clause);
		if (access) requests.add((access[1] ?? access[2])!.toLowerCase() as "input" | "output");
		else if (legacy) requests.add(legacy[1] ? "input" : "output");
	}
	return requests.size === 1 ? [...requests][0] : undefined;
}
export function matchesFieldAccess(row: { flags?: string[] }, access: "input" | "output" | undefined) {
	if (!access || !row.flags?.length) return true;
	return access === "input"
		? row.flags.some(f => f === "optional" || f === "required")
		: row.flags.includes("computed");
}
