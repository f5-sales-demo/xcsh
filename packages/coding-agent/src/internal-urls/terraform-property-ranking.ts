// Deterministic indexed property ranking. Scores are ranking values, never probabilities.
export interface PropertyCandidate {
	provider_type: string;
	provider_name: string;
	schema_path: string;
	path: string;
	anchor: string;
	description: string;
}
const stop = new Set(
	"a an the and to of for in on with by as from at we our my your i how which what where can do does is are be been have has it this that its resource managed provider terraform field attribute property parameter configure configures configuration configuring defining define declares declare declaring specified specifies specify sets set setting outputs output generated existing list string boolean block schema using use when need".split(
		" ",
	),
);
const variants: Record<string, string> = {
	addr: "address",
	gateway: "gw",
	gateways: "gw",
	bodies: "body",
	identifier: "ids",
	identifiers: "ids",
	timestamp: "time",
	hostname: "dns",
	expression: "regex",
	expressions: "regex",
	patterns: "value",
	values: "value",
	v6: "ipv6",
	v4: "ipv4",
	ending: "end",
	starting: "start",
	succeeded: "success",
	successful: "success",
	failed: "failure",
	redirection: "redirect",
	redirecting: "redirect",
	kubernetes: "k8s",
};
export function propertyTerms(text: string): string[] {
	const words =
		text
			.toLowerCase()
			.replace(/autonomous system number/g, "asn")
			.replace(/fully qualified domain names/g, "domains")
			.replace(/next[ -]hop/g, "nexthop")
			.replace(/app stack/g, "voltstack")
			.replace(/flasharray/g, "flash array")
			.replace(/flashblade/g, "flash blade")
			.replace(/assisted routing/g, "ar")
			.replace(/regular expression/g, "regex")
			.match(/[a-z0-9]+/g) ?? [];
	return [
		...new Set(
			words
				.map(
					t =>
						variants[t] ??
						(t.endsWith("s") && t.length > 4 && !t.endsWith("ss") && !["https", "status"].includes(t)
							? t.slice(0, -1)
							: t),
				)
				.filter(t => !stop.has(t)),
		),
	];
}
export function propertyQueryTerms(text: string): string[] {
	return propertyTerms(
		text
			.toLowerCase()
			.replace(/\bsource network address translation\b/g, "snat")
			.replace(/\bip address prefixes\b/g, "prefixes")
			.replace(/\bstrip(?:ping|ped)?\b/g, "remove")
			.replace(/\bbefore forwarding\b/g, "upstream")
			.replace(/\bpermits\b/g, "permit"),
	);
}
export function propertyRequestedText(text: string): string | undefined {
	if (/\bblock\b/i.test(text)) return undefined;
	const field = text.match(
		/\b(?:which|what)\s+(?:[a-z-]+\s+){0,3}(?:field|attribute|property|parameter)\b\s+(?:(?:sets?|specifies|defines?|holds?|provides?|accepts?|indicates?)\s+)?(.+)/i,
	)?.[1];
	const operation = text.match(/\b(?:how|where)\b.*?\b(?:configure|specify|set|supply|define)\b\s+(.+)/i)?.[1];
	return (field ?? operation)?.split(/\bfor\b|\breferenced in\b/i)[0]?.trim();
}
export function preparePropertyScope(rows: readonly PropertyCandidate[]) {
	const prepared = rows.map(row => ({
		...row,
		leaf: propertyTerms(row.schema_path.split(".").at(-1)!),
		context: propertyTerms(row.schema_path.split(".").slice(0, -1).join(" ")),
		descriptionTerms: propertyTerms(row.description),
	}));
	const frequencies = new Map<string, number>();
	for (const row of prepared)
		for (const term of new Set([...row.leaf, ...row.context, ...row.descriptionTerms]))
			frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
	const weights = new Map([...frequencies].map(([term, count]) => [term, Math.log(2 + rows.length / (1 + count))]));
	return { rows: prepared, weights };
}
export function rankPropertyScope(
	queryText: string,
	scope: ReturnType<typeof preparePropertyScope>,
	candidates?: ReadonlySet<string>,
) {
	const providerTerms = new Set(propertyTerms(scope.rows[0]?.provider_name ?? ""));
	const request = propertyRequestedText(queryText);
	const ask = request ?? queryText;
	const asksField =
		Boolean(request) ||
		/\b(field|attribute|property|parameter)\b/i.test(queryText) ||
		(!/\bblock\b/i.test(queryText) && /\bwhere\b.*\b(?:specify|set)\b/i.test(queryText));
	const requested = asksField ? new Set(propertyQueryTerms(ask)) : new Set<string>();
	const query = propertyQueryTerms(queryText).filter(t => !providerTerms.has(t) || requested.has(t));
	const target = propertyQueryTerms(ask).filter(t => !providerTerms.has(t) || requested.has(t));
	return scope.rows
		.filter(row => !candidates || candidates.has(`${row.path}#${row.anchor}`))
		.map(row => {
			const weight = (term: string) => scope.weights.get(term) ?? 0;
			const union = new Set([...row.leaf, ...row.context, ...row.descriptionTerms]);
			let coverage = 0,
				total = 0,
				local = 0,
				context = 0;
			for (const term of query) {
				const w = weight(term);
				total += w;
				if (union.has(term)) coverage += w;
				if (row.context.includes(term)) context += w;
				if (row.leaf.includes(term)) local += w * 3;
				else if (row.descriptionTerms.includes(term)) local += w;
			}
			const localTerms = new Set([...row.leaf, ...row.descriptionTerms]);
			let precision = 0;
			for (const term of target) if (localTerms.has(term)) precision += weight(term);
			const requestedLeaf = row.leaf.filter(term => target.includes(term)).length;
			const leafComplete = row.leaf.length > 0 && row.leaf.every(term => target.includes(term));
			let score =
				(local + context * 0.6) * (total ? (coverage / total) ** 2 : 0) +
				precision * 1.5 +
				(leafComplete ? 12 : requestedLeaf * 3);
			if (asksField && row.anchor === "section") score -= 12;
			if (
				!asksField &&
				/\bblock\b/i.test(queryText) &&
				row.anchor === "section" &&
				` ${queryText.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `.includes(
					` ${row.schema_path.split(".").at(-1)!.replaceAll("_", " ")} `,
				)
			)
				score += 20;
			for (const [positive, negative] of [
				["success", "failure"],
				["failure", "success"],
				["outside", "inside"],
				["inside", "outside"],
				["ipv6", "ipv4"],
				["ipv4", "ipv6"],
				["public", "private"],
				["private", "public"],
				["none", "and"],
				["or", "and"],
				["single", "dual"],
			])
				if (
					query.includes(positive!) &&
					!query.includes(negative!) &&
					union.has(negative!) &&
					!union.has(positive!)
				)
					score -= 30;
			const { leaf: _leaf, context: _context, descriptionTerms: _descriptionTerms, ...candidate } = row;
			return { ...candidate, score: Number(score.toFixed(12)), coverage: total ? coverage / total : 0 };
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
}
