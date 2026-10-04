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
			.replace(/bare[ -]+metal/g, "baremetal")
			.replace(/\bunmanaged\b/g, "not managed")
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
// Canonical workload service is stateless; stateful_service is its parallel architecture.
// Apply this distinction only within the workload provider, preserving missing/conflicting intent.
export function propertyWorkloadArchitecture(text: string): "stateless" | "stateful" | undefined {
	text = text.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "").replaceAll("`", "");
	const assertions = new Set<"stateless" | "stateful">();
	const negative =
		/\b(not|no|without)\s+([^,.!?;\n]*?)`?(stateless|stateful|stateful_service|service(?=[./]|\s+branch\b)|service(?=\s*$))\b/gi;
	for (const match of text.matchAll(negative)) {
		const between = match[2]!.replaceAll("`", "").trim().toLowerCase();
		const tail = text.slice(match.index! + match[0].length);
		if (
			match[3]!.toLowerCase() === "service" &&
			!/^[./]/.test(tail) &&
			!/\b(?:under|in|within|branch|path)(?:\s+(?:a|an|the))?$/i.test(between)
		)
			continue;
		const simpleOpposite =
			match[1]!.toLowerCase() !== "without" &&
			["", "a", "an", "the"].includes(between) &&
			match[3]!.toLowerCase() !== "service" &&
			!/^[./]/.test(tail);
		if (!simpleOpposite) return undefined;
		assertions.add(match[3]!.toLowerCase() === "stateless" ? "stateful" : "stateless");
	}
	const positiveText = text.replace(
		/\b(?:not|no)\s+(?:(?:a|an|the)\s+)?(?:stateless|stateful|stateful_service)\b/gi,
		"",
	);
	if (
		/\bstateless\b|\bservice\s+branch\b|\bservice[./]|\b(?:under|in|within|branch|path)\s+(?:(?:a|an|the)\s+)?service\b/i.test(
			positiveText,
		)
	)
		assertions.add("stateless");
	if (/\b(?:stateful|stateful_service)\b/i.test(positiveText)) assertions.add("stateful");
	return assertions.size === 1 ? [...assertions][0] : undefined;
}
export function propertyWorkloadPortCount(text: string): "single" | "multiple" | undefined {
	const query = text.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "");
	if (
		/\b(?:not|no|never|without|maybe|possibly)\b[^.!?;]*\b(?:one|single|multiple|multi)[ -]?(?:public[ -]?)?ports?\b/i.test(
			query,
		)
	)
		return undefined;
	if (
		/\b(?:one|single)\s+(?:or|and)\s+(?:multiple|multi)\b|\b(?:multiple|multi)\s+(?:or|and)\s+(?:one|single)\b/i.test(
			query,
		)
	)
		return undefined;
	const single = /\b(?:one|single)[ -](?:public[ -])?port\b/i.test(query);
	const multiple = /\b(?:multiple|multi)[ -](?:public[ -])?ports?\b/i.test(query);
	return single === multiple ? undefined : single ? "single" : "multiple";
}
export function propertyMatchesWorkloadPortCount(text: string, candidate: PropertyCandidate): boolean {
	if (candidate.provider_name !== "workload") return true;
	const count = propertyWorkloadPortCount(text);
	if (!count || !candidate.schema_path.split(".").includes("advertise_on_public")) return true;
	const multi = candidate.schema_path.split(".").includes("multi_ports");
	return count === "multiple" ? multi : !multi;
}
export function propertyMatchesWorkloadArchitecture(text: string, candidate: PropertyCandidate): boolean {
	if (candidate.provider_name !== "workload") return true;
	const architecture = propertyWorkloadArchitecture(text);
	if (!architecture) return true;
	const stateless = architecture === "stateless";
	const parts = candidate.schema_path.split(".");
	return stateless ? !parts.includes("stateful_service") : !parts.includes("service");
}
export function propertyQueryTerms(text: string): string[] {
	text = text
		.replace(/\bquery[ -]parameters?\b/gi, "query param")
		.replace(/\bhow\s+long\b/gi, "duration")
		.replace(/\bminimum\b/gi, "min minimum")
		.replace(/\bmaximum\b/gi, "max maximum")
		.replace(/\bdecrypt(?:s|ing)?\b/gi, "decryption decrypt")
		.replace(/\bcredential(?:s)?\b/gi, "cred credential")
		.replace(/\b(inactive|no[ -]traffic)\b/gi, value =>
			/\b(?:timeout|duration|period|interval)\b/i.test(text) ? `${value} idle` : value,
		)
		.replace(/\b(?:lasts|lasting)\b/gi, "duration")
		.replace(/\bcookie\s+(?:session\s+)?(?:persistence|stickiness)\b/gi, "cookie affinity")
		.replace(/\b(?:session\s+)?persistence(?=[^,.!?;]*\bcookie\b)/gi, "affinity");
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
			.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "")
			.replace(/\bdata[ -]+sources?\b|\bmanaged\s+resource\b|\bresource\s+declaration\b|\bdeclaration\b/g, "")
			.replace(/operating[ -]+system/g, "os")
			.replace(/mutual[ -]+tls/g, "mtls")
			.replace(/\badvertised\b/g, "advertise")
			.replace(/http\/1\.1/g, "http v1")
			.replace(/http\/2(?:\.0)?/g, "http2")
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
function groupingRequest(text: string): { key: string; uncertain: boolean } | undefined {
	const request = propertyRequestedText(text) ?? text;
	const match =
		/\b(?:grouped|keyed)\s+by\s+(?:the\s+)?(?:(`|")([^`"]+)\1|([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*)*))/i.exec(
			request,
		);
	if (!match) return undefined;
	const key = (match[2] ?? match[3] ?? "").split(/[,;.!?]|\b(?:for|in|under|within|on|with|or|and)\b/i)[0]!.trim();
	return { key, uncertain: /\b(?:not|no|never|without|maybe|possibly|or|and)\b/i.test(request) };
}
export function propertyUncertainGrouping(text: string): boolean {
	return groupingRequest(text)?.uncertain ?? false;
}
export function propertyGroupingKey(text: string): string | undefined {
	return groupingRequest(text)?.key;
}
export function propertyMatchesGrouping(text: string, candidate: PropertyCandidate): boolean {
	const key = propertyGroupingKey(text);
	if (!key) return true;
	const terms = propertyTerms(key);
	const relations = [...candidate.description.matchAll(/\bkeyed\s+by\s+([^.;\n]+)/gi)].map(match =>
		propertyTerms(match[1]!),
	);
	return (
		candidate.type === "map" &&
		terms.length > 0 &&
		relations.some(relation => terms.every(term => relation.includes(term)))
	);
}
export function propertyRequestedType(text: string): string | undefined {
	const query = text.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "");
	const requested = propertyRequestedText(query) ?? query;
	if (/\b(?:numeric|number)\s+(?:cap|limit|value)\b/i.test(requested)) {
		const clause =
			query.split(/[.!?;]+/).find(value => /\b(?:numeric|number)\s+(?:cap|limit|value)\b/i.test(value)) ?? requested;
		const assertion = /\b(?:numeric|number)\s+(?:cap|limit|value)\b/i.exec(clause)!;
		const before = clause.slice(0, assertion.index);
		const after = clause.slice(assertion.index + assertion[0].length);
		const tail = requested.slice(requested.search(/\b(?:numeric|number)\s+(?:cap|limit|value)\b/i));
		if (
			/\b(?:not|no|never|without|rather than|instead of|except|maybe|possibly|optional|for example|such as)\b/i.test(
				before,
			) ||
			/\b(?:or|and)\s+(?:(?:an?|the)\s+)?(?:unlimited|numeric|number|boolean|bool|object)\b/i.test(after) ||
			/\b(?:is|are)\s+(?:not|never)\s+(?:needed|required|wanted)\b/i.test(tail)
		)
			return undefined;
		return "number";
	}
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
function schemaPathMentions(text: string) {
	const query = text.toLowerCase().replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "");
	return [
		...query.matchAll(
			/\b(under|within|inside|schema path|branch|path|or|and|locate|find|point me to|where is|where are|where do i put|where do|where does|i need)\s+(?:(?:the|its)\s+)?(`?)([a-z][a-z0-9_.-]*\.[a-z0-9_.-]+)\2/g,
		),
	].map(match => {
		const suffix = query.slice(match.index! + match[0].length);
		const path = !match[2] && /^(?:\s+[a-z]|\s*[!?]|\s*$)/.test(suffix) ? match[3]!.replace(/\.$/, "") : match[3]!;
		const clause =
			query
				.slice(0, match.index)
				.split(/[;!?\n]|\.(?=\s)/)
				.at(-1) ?? "";
		return {
			start: match.index!,
			end: match.index! + match[0].length,
			path,
			qualifier: match[1]!,
			negative: /\b(?:not|no|without)\s+(?:(?:necessarily|a|an|the)\s+){0,3}$/.test(clause),
		};
	});
}
export function propertyMentionedSchemaPaths(text: string): string[] {
	return [...new Set(schemaPathMentions(text).map(match => match.path))];
}
export function propertyExplicitSchemaPaths(text: string): string[] {
	const matches = schemaPathMentions(text);
	if (matches.length !== 1) return [];
	const match = matches[0]!;
	return !match.negative && !["or", "and"].includes(match.qualifier) ? [match.path] : [];
}
export function propertyMatchesExplicitPaths(text: string, candidate: PropertyCandidate): boolean {
	return propertyExplicitSchemaPaths(text).every(path => `.${candidate.schema_path}.`.includes(`.${path}.`));
}
export function propertyScopeText(text: string): string {
	return text
		.toLowerCase()
		.replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "")
		.replaceAll("`", "");
}
function excludedIdentifierMentions(text: string) {
	const query = propertyScopeText(text).replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "");
	return [
		...query.matchAll(/\b(?:outside|excluding)\s+`?([a-z][a-z0-9]*_[a-z0-9_]+)`?(?=$|[\s,;!?]|\.(?:\s|$))/g),
	].map(match => ({
		identifier: match[1]!,
		uncertain: /\b(?:not|no|without)\s+(?:(?:necessarily|always|usually|only)\s+)?$/.test(
			query.slice(0, match.index),
		),
	}));
}
export function propertyExcludedSchemaIdentifiers(text: string): string[] {
	return [
		...new Set(
			excludedIdentifierMentions(text)
				.filter(match => !match.uncertain)
				.map(match => match.identifier),
		),
	];
}
export function propertyUncertainExcludedIdentifiers(text: string): string[] {
	return [
		...new Set(
			excludedIdentifierMentions(text)
				.filter(match => match.uncertain)
				.map(match => match.identifier),
		),
	];
}
export function propertyConflictingNamedScope(text: string): boolean {
	const query = propertyScopeText(text);
	return (
		/\b(?:outside\s+and\s+(?:inside|under|within)|(?:inside|under|within)\s+and\s+outside)\s+[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(
			query,
		) ||
		propertyExcludedSchemaIdentifiers(text).some(identifier =>
			new RegExp(`\\b(?:inside|under|within)\\s+${identifier}\\b`).test(query),
		)
	);
}
export function propertyInvalidExcludedScope(text: string): boolean {
	return /\b(?:outside|excluding)\s+[a-z][a-z0-9]*_[a-z0-9_]*(?:[-/:])[a-z0-9_/-]*/.test(propertyScopeText(text));
}
export function propertySchemaIdentifiers(text: string, providerName?: string): string[] {
	let request = text.toLowerCase().replace(/\((?:such as\b|e\.g\.|for example\b)[^)]*\)/gi, "");
	request = request.replace(/\b(?:grouped|keyed)\s+by\s+(?:the\s+)?(?:`[^`]+`|"[^"]+"|[a-z][a-z0-9_-]*)/gi, " ");
	const requiredPaths = propertyExplicitSchemaPaths(text);
	const excluded = new Set([
		...propertyExcludedSchemaIdentifiers(text),
		...propertyUncertainExcludedIdentifiers(text),
	]);
	const mentions = schemaPathMentions(request).filter(mention => !requiredPaths.includes(mention.path));
	for (const mention of mentions.reverse())
		request = request.slice(0, mention.start) + " " + request.slice(mention.end);
	return [
		...new Set(
			(request.toLowerCase().match(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) ?? []).filter(
				term =>
					!term.startsWith("xcsh_") &&
					!excluded.has(term) &&
					!(
						providerName === "workload" &&
						term === "stateful_service" &&
						propertyWorkloadArchitecture(text) !== "stateful"
					),
			),
		),
	];
}
export function propertyRequestsBlock(text: string): boolean {
	text = text.split(/\bto\s+(?:configure|enable|provide|handle|support)\b/i)[0]!;
	if (
		/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(text) ||
		/\b(?:which|what)\s+(?:fields|attributes|properties|parameters|arguments|flags)\b/i.test(text)
	)
		return false;
	if (
		/^\s*(?:specify|set|provide|supply|configure)\s+(?:(?:the|a|an)\s+)?(?:(?:listening|listener|target|cookie|session|idle)\s+)?(?:port|name|timeout|duration|value)\b/i.test(
			text,
		)
	)
		return false;
	if (/\bblock[ -]page\s+(?:body|content)\b/i.test(text)) return false;
	const intentText = text.split(/\bto\s+(?:configure|enable|provide|handle|support)\b/i)[0]!;
	if (
		/\bcookie\b/i.test(intentText) &&
		/\b(?:persistence|affinity|stickiness)\b/i.test(intentText) &&
		/\b(?:configure|set up|enable|specify)\b/i.test(intentText)
	)
		return true;
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
export function propertyHasNestedQualifier(text: string): boolean {
	return (
		/\b(?:within|inside|under)\b/i.test(text) ||
		/\bin\s+(?!(?:(?:an?|the)\s+)?(?:xcsh_|terraform\b|resource\b|data[ -]source\b|provider\b|action\b))[a-z][a-z0-9_]*(?:\b|[./])/i.test(
			text,
		)
	);
}
export function propertyValueLookup(text: string): string | undefined {
	const clauses = text.split(/;|[?!]|\.(?=\s|$)/);
	let needValue: string | undefined;
	for (const clause of clauses) {
		const placement = /\bwhere\s+(?:do|does)\s+(.+?)\s+(?:go|belong)\b/i.exec(clause);
		const lookup =
			/\b(?:find|locate|point me to|where do I put|where is|where are|I need)\s+(.+)/i.exec(clause) ?? placement;
		const operation = /\b(?:specify|set|provide|supply)\b/i.exec(clause);
		if (operation && (!lookup || operation.index < lookup.index)) return undefined;
		if (!lookup) continue;
		if (/\b(?:example|usage|guidance)\b/i.test(clause)) return undefined;
		let target = lookup[1]!.split(/\band\s+its\b/i)[0]!.trim();
		const labeled =
			/^(?:(?:the|a|an)\s+)?data[ -]source\s+((?:(?:input|output|field|attribute|property)\s+)+)(.+)/i.exec(target);
		if (labeled) {
			if (/\b(?:not|never|without)\b/i.test(clause.slice(0, lookup.index))) return undefined;
			const explicitField = /^(?:field|attribute|property)\s+$/i.test(labeled[1]!);
			target = labeled[2]!.split(/\b(?:for|from|using|via)\b|\bof\s+xcsh_/i)[0]!.trim();
			const literal = explicitField && /^`?[a-z][a-z0-9_]*`?$/i.test(target);
			if (/^(?:of|for|from|using|via|in|within|under|inside)\b/i.test(target)) return undefined;
			if (
				!literal &&
				(!propertyTerms(target).length ||
					/^(?:(?:the|a|an)\s+)?(?:input|output|field|attribute|property)\s*$/i.test(target))
			)
				return undefined;
		}
		if (/^I need\b/i.test(lookup[0]) && /\b(?:resource|data[ -]source|provider|action)\s*$/.test(target)) continue;
		if (!target || /^(?:(?:an?|the)\s+)?(?:resource\b|data[ -]source\b|provider\b|action\b|xcsh_)/i.test(target))
			return undefined;
		if (/^I need\b/i.test(lookup[0])) {
			needValue = target;
			continue;
		}
		return target;
	}
	return needValue;
}
export function propertyRequestedText(text: string): string | undefined {
	const passiveToggle = /\bhow\s+is\s+(.+?)\s+enabled\s+or\s+disabled\b/i.exec(text)?.[1];
	if (passiveToggle) return passiveToggle.trim();
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
		/\b(?:which|what)\s+(?:[a-z-]+\s+){0,3}(?:field|attribute|property|parameter|argument|flag|setting)\b\s+(?:(?:selects?|chooses?|names?|sets?|specifies|defines?|holds?|provides?|accepts?|indicates?|configures?|controls?|determines?|designates?|toggles?|enables?|disables?|exposes?|returns?|outputs?|describes?|filters?)\s+)?(.+)/i,
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
		text.match(/\b(?:how|where)\b.*?\b(?:configure|specify|set|supply|define|pass|write)\b\s+(.+)/i)?.[1] ??
		(/\bxcsh_[a-z0-9_]+\b/i.test(text)
			? text.match(/\b(?:declare|configure|specify|set)\b\s+(?!(?:(?:an?|the)\s+)?xcsh_)(.+)/i)?.[1]
			: undefined) ??
		text.match(
			/\b(?:specify|set|provide|supply)\b\s+(?!(?:(?:an?|the)\s+)?(?:xcsh_|resource\b|data[ -]source\b|provider\b))(.+)/i,
		)?.[1];
	const rawLabeledField =
		text.match(
			/\b(?:with|using)\s+(?:the\s+)?([a-z][a-z0-9_]*)\s+(?:field|attribute|property|parameter|argument|flag)\b/i,
		)?.[1] ??
		text.match(
			/\b(?:specify|set|provide|supply)\s+(?:the\s+)?([a-z][a-z0-9]*_[a-z0-9_]+)\s+(?:field|attribute|property|parameter|argument|flag)\b/i,
		)?.[1] ??
		text.match(
			/\b(?:with|using)\s+([a-z][a-z0-9]*_[a-z0-9_]+)\s+when\s+(?:running|executing|adding|invoking)\b/i,
		)?.[1];
	const labeledField =
		rawLabeledField &&
		/\b(?:xcsh_[a-z0-9_]+\s+action|action\s+xcsh_[a-z0-9_]+)\b/i.test(text) &&
		!/\b(?:resource|data[ -]source)\b/i.test(text) &&
		!propertyHasNestedQualifier(text) &&
		![
			"numeric",
			"number",
			"string",
			"boolean",
			"bool",
			"scalar",
			"list",
			"optional",
			"required",
			"computed",
		].includes(rawLabeledField.toLowerCase())
			? rawLabeledField
			: undefined;
	const queryProperty = text.match(
		/\bquery\s+((?:(?:the|an?)\s+)?(?:[a-z][a-z0-9_-]*\s+){0,2}(?:name|id|status|address|port|token|value))\s+of\s+[^.!?]+/i,
	)?.[1];
	const lookup = /\bxcsh_[a-z0-9_]+\b|\bto\s+(?:read|fetch|retrieve|inspect|look up|lookup)\b/i.test(text)
		? [
				...text.matchAll(
					/\b(?:read|fetch|retrieve|inspect|look up|lookup|query(?=\s+(?:(?:the|an?)\s+)?(?!xcsh_)[a-z][a-z0-9]*_[a-z0-9_]+\b))\b\s+(.+?)(?=\bto\s+(?:read|fetch|retrieve|inspect|look up|lookup)\b|\r?\n|$)/gi,
				),
			]
				.filter(
					(match, _index, matches) =>
						!/^inspect\b/i.test(match[0]) ||
						(!queryProperty && !matches.some(other => !/^inspect\b/i.test(other[0]))),
				)
				.map(match => match[1]!.split(/\b(?:from|using|via|for)\b/i)[0]!.trim())
				.reverse()
				.find(
					value =>
						!/^xcsh_|^(?:the |an? )?(?:data[ -]source|resource|existing)\b/i.test(value) &&
						propertyTerms(value.replace(/\bxcsh_[a-z0-9_]+\b/gi, "").replace(/data[ -]source/gi, "")).length > 0,
				)
		: undefined;
	const valueLookup = propertyValueLookup(text);
	const passive =
		/\bwhere\b.*?\b(?:is|are)\b\s+(?!(?:(?:an?|the)\s+)?xcsh_)(.+?)\s+\b(?:specified|configured|defined|set|documented)\b/i.exec(
			text,
		)?.[1];
	return (
		filterCriterion ??
		identifierField ??
		classificationField ??
		field ??
		labeledField ??
		valueLookup ??
		operation ??
		lookup ??
		queryProperty ??
		passive
	)
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
	if (propertyHasNestedQualifier(queryText)) return false;
	if (
		!/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(queryText) &&
		!/\bquery\s+(?:(?:the|an?)\s+)?(?:name|id|status|address|port|token|value)\s+of\b/i.test(queryText)
	)
		return false;
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
		.filter(row => propertyMatchesWorkloadArchitecture(queryText, row))
		.filter(row => propertyMatchesWorkloadPortCount(queryText, row))
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
			const capabilityTerms = row.leaf.filter(term => !["enable", "disable"].includes(term));
			const capabilityBlock =
				row.anchor === "section" &&
				row.leaf.some(term => ["enable", "disable"].includes(term)) &&
				capabilityTerms.length >= 2 &&
				capabilityTerms.every(term => target.includes(term)) &&
				!scope.rows.some(
					peer =>
						peer.anchor.startsWith("schema-") &&
						peer.schema_path
							.replace(/(^|\.)(?:enable|disable)_/g, "$1")
							.startsWith(`${row.schema_path.replace(/(^|\.)(?:enable|disable)_/g, "$1")}.`) &&
						peer.leaf.length > 0 &&
						peer.leaf.every(term => target.includes(term)),
				) &&
				/\b(?:configure|set|specify|enable|disable|select|choose)\b/i.test(queryText) &&
				!/\b(?:field|attribute|property|parameter|argument|flag)\b/i.test(queryText);
			if (capabilityBlock) score += 24;
			if (propertyRequestsDirectObjectField(queryText, row)) score += 12;
			if (propertyNamesCollection(queryText, row) && total > 0 && coverage / total >= 0.35) score += 36;
			else if (asksField && row.anchor === "section" && !capabilityBlock) score -= 12;
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
