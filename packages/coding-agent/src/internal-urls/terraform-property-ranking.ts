// Deterministic indexed property ranking. Scores are ranking values, never probabilities.
export interface PropertyCandidate {
	provider_type: string;
	provider_name: string;
	schema_path: string;
	path: string;
	anchor: string;
	description: string;
	aliases?: string[];
	type?: string | null;
	nesting?: string | null;
	flags?: string[];
	evidence_terms?: string[];
	documentation_terms?: string[];
}
const stop = new Set(
	"a an the and to of for in on with by as from at we our my your i how which what where can do does is are be been have has it this that its resource managed provider terraform field attribute property parameter configure configures configuration configuring defining define declares declare declaring specified specifies specify sets set setting outputs output generated existing list string boolean block schema using use when need".split(
		" ",
	),
);
const variants: Record<string, string> = {
	addr: "address",
	prefixes: "prefix",
	retries: "retry",
	policies: "policy",
	gateway: "gw",
	gateways: "gw",
	bodies: "body",
	identifier: "ids",
	identifiers: "ids",
	timestamp: "time",
	hostname: "dns",
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
			.replace(/regular expressions?/g, "regex")
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
			.replace(/\bxcsh_[a-z0-9_]+\b/g, "")
			.replace(/\b(?:arguments?|flags?)\b/g, "")
			.replace(/\b(?:whether|should)\b/g, "")
			.replace(/\b(?:criteria|criterion)\b/g, "conditions")
			.replace(/\bregular expressions\b/g, "regex values")
			.replace(
				/\b(?:active\s+)?hostnames?\s+(?:routed|served)\s+by\s+(?:the\s+)?(?:proxy|load[ -]?balancer)\b/g,
				"domains matched host authority",
			)
			.replace(/\b(?:active\s+)?hostnames?\s+(?:routed|served)\s+by\b/g, "domains matched by")
			.replace(/\((?:such as|e\.g\.|for example)\b[^)]*\)/gi, "")
			.replace(/\bdata[ -]+sources?\b|\bmanaged\s+resource\b|\bresource\s+declaration\b|\bdeclaration\b/g, "")
			.replace(/operating[ -]+system/g, "os")
			.replace(/mutual[ -]+tls/g, "mtls")
			.replace(/\badvertised\b/g, "advertise")
			.replace(/http\/1\.1/g, "http v1")
			.replace(/\b(?:listening|listener)\b/g, "listen")
			.replace(/\bdestination\s+port\b/g, "endpoint port")
			.replace(/\bprefixes\b/g, "prefix")
			.replace(/active operational state/g, "active")
			.replace(/load[ -]+balancer/g, "loadbalancer")
			.replace(/application[ -]+firewall/g, "app firewall")
			.replace(/\bsource network address translation\b/g, "snat")
			.replace(/\bip address prefix(?:es)?\b/g, "prefix")
			.replace(/\bstrip(?:ping|ped)?\b/g, "remove")
			.replace(/\bbefore forwarding\b/g, "upstream")
			.replace(/\bpermits\b/g, "permit"),
	);
}
export function propertyRequestedType(text: string): string | undefined {
	if (!/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(text)) return undefined;
	if (/\b(?:boolean|bool)\s+(?:field|attribute|property|parameter|argument|flag)\b/i.test(text)) return "bool";
	if (/\bscalar\s+list\b/i.test(text)) return "list";
	if (/\b(?:numeric|number)\s+(?:field|attribute|property|parameter|argument)\b/i.test(text)) return "number";
	return undefined;
}
export function propertyRequestsRootField(text: string): boolean {
	return /\b(?:top[ -]level|root[ -]level|root|direct)\s+(?:attribute|field|property|parameter|argument|flag)\b/i.test(
		text,
	);
}
export function propertySchemaIdentifiers(text: string): string[] {
	const request = text.replace(/\((?:such as|e\.g\.|for example)\b[^)]*\)/gi, "");
	return [
		...new Set(
			(request.toLowerCase().match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) ?? []).filter(
				term => !term.startsWith("xcsh_"),
			),
		),
	];
}
export function propertyRequestsBlock(text: string): boolean {
	if (/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(text)) return false;
	if (/\b(?:select|choose|enable|disable)\b/i.test(text)) return true;
	return /\bblock\b/i.test(text.replace(/\b(?:resource|provider|existing)\s+block\b/gi, "container"));
}
export function propertyRequestedBlockText(text: string): string | undefined {
	if (!propertyRequestsBlock(text)) return undefined;
	const before = text.match(
		/\b(?:declare|configure|specify|set|select|choose|enable|disable)\s+(.+?)\s+block\b/i,
	)?.[1];
	const after = text.match(/\b(?:which|what)\s+(?:configuration\s+|schema\s+)?block\s+(.+)/i)?.[1];
	const definition = text.match(/\bdefinition\s+of\s+(?:the\s+)?(.+?)\s+(?:list\s+|configuration\s+)?block\b/i)?.[1];
	return (definition ?? before ?? after)?.split(/\b(?:during|when|to|in|under|within|for)\b/i)[0]?.trim();
}
export function propertyRequestedText(text: string): string | undefined {
	if (propertyRequestsBlock(text)) return undefined;
	const fieldText = text.replace(
		/\b(field|attribute|property|parameter|argument|flag)\b\s+(?:in|under|inside|within)\s+.+?\s+((?:sets?|specifies|defines?|holds?|provides?|accepts?|indicates?|configures?|controls?|determines?|designates?|toggles?|enables?|disables?|exposes?|returns?|outputs?|describes?|filters?)\b)/i,
		"$1 $2",
	);
	const filterCriterion = fieldText
		.match(/\b(?:field|attribute|property|parameter|argument)\b\s+filters?\s+.+?\s+by\s+(.+)/i)?.[1]
		?.split(/\bin\b|\busing\b/i)[0]
		?.trim();
	const field = fieldText.match(
		/\b(?:which|what)\s+(?:[a-z-]+\s+){0,3}(?:field|attribute|property|parameter|argument|flag)\b\s+(?:(?:sets?|specifies|defines?|holds?|provides?|accepts?|indicates?|configures?|controls?|determines?|designates?|toggles?|enables?|disables?|exposes?|returns?|outputs?|describes?|filters?)\s+)?(.+)/i,
	)?.[1];
	const identifierField =
		field && /\bidentifier\s+(?:field|attribute|property|parameter|argument)\b/i.test(text)
			? `identifier ${field}`
			: undefined;
	const classificationField =
		field && /^whether\s+(?:it|this|that)\s+is\s+(?:an?\s+)?[^?!.]+\bor\b\s+/i.test(field)
			? `type ${field}`
			: undefined;
	const operation =
		text.match(/\b(?:how|where)\b.*?\b(?:configure|specify|set|supply|define)\b\s+(.+)/i)?.[1] ??
		(/\bxcsh_[a-z0-9_]+\b/i.test(text)
			? text.match(/\b(?:declare|configure|specify|set)\b\s+(?!(?:(?:an?|the)\s+)?xcsh_)(.+)/i)?.[1]
			: undefined) ??
		text.match(
			/\b(?:specify|set|provide|supply)\b\s+(?!(?:(?:an?|the)\s+)?(?:xcsh_|resource\b|data[ -]source\b|provider\b))(.+)/i,
		)?.[1];
	const lookup = /\bxcsh_[a-z0-9_]+\b/i.test(text)
		? [
				...text.matchAll(
					/\b(?:read|fetch|retrieve|inspect|look up|lookup|query(?=\s+(?:(?:the|an?)\s+)?(?!xcsh_)[a-z][a-z0-9]*_[a-z0-9_]+\b))\b\s+(.+)/gi,
				),
			]
				.map(match => match[1]!.split(/\b(?:from|using|via|for)\b/i)[0]!.trim())
				.find(
					value =>
						!/^xcsh_|^(?:the |an? )?(?:data[ -]source|resource|existing object)\b/i.test(value) &&
						propertyTerms(value.replace(/\bxcsh_[a-z0-9_]+\b/gi, "").replace(/data[ -]source/gi, "")).length > 0,
				)
		: undefined;
	const passive =
		/\bwhere\b.*?\b(?:is|are)\b\s+(?!(?:(?:an?|the)\s+)?xcsh_)(.+?)\s+\b(?:specified|configured|defined|set|documented)\b/i.exec(
			text,
		)?.[1];
	return (filterCriterion ?? identifierField ?? classificationField ?? field ?? operation ?? lookup ?? passive)
		?.replace(/\bxcsh_[a-z0-9_]+\b/gi, "")
		.split(/\bused\s+to\b|\bat\s+which\b|\bwhen\s+(?:handling|processing|matching|calling|invoking|executing)\b/i)[0]
		?.split(
			/\bfor\b(?!\s+[a-z]*(?:tion|sion|ing)\b)|\breferenced in\b|\bto\s+(?:handle|match|configure|enable|provide)\b|\bwhen\s+(?:declaring|configuring|reading)\b|\bof\s+(?:an? |the )?(?:existing |managed )?(?:resource|load balancer|site|object)\b/i,
		)[0]
		?.trim();
}
export function propertyRequestsCollection(text: string): boolean {
	return (
		/\b(?:list|collection|set|array)\s+of\b/i.test(propertyRequestedText(text) ?? text) &&
		!/\b(?:item|element|entry|field|attribute|property|parameter|argument|flag)\b/i.test(text)
	);
}
export function propertyNamesCollection(text: string, candidate: PropertyCandidate): boolean {
	if (!propertyRequestsCollection(text) || !["list", "set", "map"].includes(candidate.nesting ?? candidate.type ?? ""))
		return false;
	const noun = (propertyRequestedText(text) ?? text)
		.match(/\b(?:list|collection|set|array)\s+of\s+(.+)/i)?.[1]
		?.split(/\b(?:for|in|under|within|on)\b/i)[0];
	const target = propertyQueryTerms(noun ?? "");
	const leaf = propertyQueryTerms((candidate.schema_path.split(".").at(-1) ?? "").replaceAll("_", " "));
	return leaf.length > 0 && leaf.every(term => target.includes(term));
}
export function propertyRequestsDirectObjectField(queryText: string, candidate: PropertyCandidate): boolean {
	if (candidate.schema_path.includes(".") || !candidate.anchor.startsWith("schema-")) return false;
	if (!/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(queryText)) return false;
	const request = propertyRequestedText(queryText);
	if (!request) return false;
	const generic = new Set(["object", "configured", "assigned", "computed", "value"]);
	const target = propertyQueryTerms(request).filter(term => !generic.has(term));
	const leaf = propertyTerms(candidate.schema_path);
	return leaf.length > 0 && target.length === leaf.length && leaf.every(term => target.includes(term));
}
export function preparePropertyScope(rows: readonly PropertyCandidate[]) {
	const prepared = rows.map(row => ({
		...row,
		leaf: propertyTerms(row.schema_path.split(".").at(-1)!),
		context: propertyTerms(row.schema_path.split(".").slice(0, -1).join(" ")),
		descriptionTerms: propertyTerms(row.description),
		aliasTerms: propertyTerms((row.aliases ?? []).join(" ")),
	}));
	const frequencies = new Map<string, number>();
	for (const row of prepared)
		for (const term of new Set([...row.leaf, ...row.context, ...row.descriptionTerms, ...row.aliasTerms]))
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
	const ask = request ?? propertyRequestedBlockText(queryText) ?? queryText;
	const asksField =
		Boolean(request) ||
		/\b(field|attribute|property|parameter|argument|flag)\b/i.test(queryText) ||
		(!propertyRequestsBlock(queryText) && /\bwhere\b.*\b(?:specify|set)\b/i.test(queryText));
	const requested = asksField ? new Set(propertyQueryTerms(ask)) : new Set<string>();
	const query = propertyQueryTerms(queryText).filter(t => !providerTerms.has(t) || requested.has(t));
	const target = propertyQueryTerms(ask).filter(t => !providerTerms.has(t) || requested.has(t));
	const requestedType = propertyRequestedType(queryText);
	return scope.rows
		.filter(row => !requestedType || row.type == null || row.type === requestedType)
		.filter(row => !candidates || candidates.has(`${row.path}#${row.anchor}`))
		.map(row => {
			const weight = (term: string) => scope.weights.get(term) ?? 0;
			const union = new Set([...row.leaf, ...row.context, ...row.descriptionTerms, ...row.aliasTerms]);
			let coverage = 0,
				total = 0,
				local = 0,
				context = 0;
			for (const term of query) {
				const w = weight(term);
				total += w;
				if (union.has(term)) coverage += w;
				// A repeated leaf word is not additional evidence for an ancestor branch.
				if (row.context.includes(term) && !row.leaf.includes(term)) context += w;
				const localWeight =
					asksField &&
					/\bto\s+(?:handle|match|configure|enable|provide)\b|\bwhen\s+(?:declaring|configuring|reading)\b|\bof\s+(?:an? |the )?(?:existing |managed )?(?:resource|load balancer|site|object)\b/i.test(
						queryText,
					) &&
					!target.includes(term)
						? 0.35
						: 1;
				if (row.leaf.includes(term)) local += w * 3 * localWeight;
				else if (row.descriptionTerms.includes(term)) local += w * localWeight;
				else if (row.aliasTerms.includes(term)) local += w * 0.25 * localWeight;
			}
			const localTerms = new Set([...row.leaf, ...row.descriptionTerms]);
			let precision = 0;
			for (const term of target) {
				if (localTerms.has(term)) precision += weight(term);
				else if (row.aliasTerms.includes(term)) precision += weight(term) * 0.25;
			}
			const requestedLeaf = row.leaf.filter(term => target.includes(term)).length;
			const leafComplete = row.leaf.length > 0 && row.leaf.every(term => target.includes(term));
			let score =
				(local + context * 0.6) * (total ? (coverage / total) ** 2 : 0) +
				precision * 1.5 +
				(leafComplete ? 12 : requestedLeaf * 3);
			if (propertyRequestsDirectObjectField(queryText, row)) score += 12;
			if (propertyNamesCollection(queryText, row) && total > 0 && coverage / total >= 0.35) score += 36;
			else if (asksField && row.anchor === "section") score -= 12;
			if (
				row.anchor === "section" &&
				row.leaf.length >= 2 &&
				leafComplete &&
				/\b(?:configure|select|enable|choose)\b/i.test(queryText) &&
				!/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(queryText)
			)
				score += 24;
			if (
				!asksField &&
				propertyRequestsBlock(queryText) &&
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
			const {
				leaf: _leaf,
				context: _context,
				descriptionTerms: _descriptionTerms,
				aliasTerms: _aliasTerms,
				...candidate
			} = row;
			return {
				...candidate,
				...(row.aliasTerms.length
					? {
							evidence_terms: row.aliasTerms.filter(
								term =>
									!row.context.includes(term) ||
									row.leaf.includes(term) ||
									row.descriptionTerms.includes(term),
							),
						}
					: {}),
				score: Number(score.toFixed(12)),
				coverage: total ? coverage / total : 0,
			};
		})
		.sort(
			(a, b) =>
				b.score - a.score ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
}
