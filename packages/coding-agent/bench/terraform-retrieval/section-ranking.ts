// Development experiment only; not imported by production retrieval.
const SECTION_VARIANTS: Record<string, string> = {
	automatic: "auto",
	automatically: "auto",
	succeeded: "success",
	successful: "success",
	succeeds: "success",
	failed: "failure",
	fails: "failure",
	creation: "create",
	creating: "create",
	modification: "update",
	destruction: "delete",
	rewriting: "rewrite",
	redirection: "redirect",
	hostname: "dns",
	kubernetes: "k8s",
	blindfolded: "blindfold",
	unencrypted: "clear",
	encrypted: "tls",
	encryption: "tls",
	pkcs12: "p12",
	certificated: "certificate",
};
const SECTION_STOPWORDS = new Set(
	"a an the and how where what do does i we you my our your can could should would please help tell for of in on with using use configure configuration setup set up terraform provider documentation document documented field fields attribute attributes is are be need needs explain which managed resource block".split(
		" ",
	),
);
export function terraformSectionTerms(value: string): string[] {
	return [
		...new Set(
			(value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
				.filter(term => !SECTION_STOPWORDS.has(term))
				.map(term => {
					const mapped = SECTION_VARIANTS[term] ?? term;
					return mapped.endsWith("s") && !mapped.endsWith("ss") && mapped.length > 4 && !["https", "status", "success"].includes(mapped)
						? mapped.slice(0, -1)
						: mapped;
				}),
		),
	];
}
export function rankTerraformSections<
	T extends { schema_path: string; description: string; path: string; anchor: string },
>(query: string, sections: readonly T[]): Array<T & { ranking: number; coverage: number }> {
	const terms = terraformSectionTerms(query);
	const terminalWords = new Set([
		"name",
		"port",
		"status",
		"url",
		"value",
		"id",
		"location",
		"prefix",
		"cipher",
		"version",
		"token",
		"ip",
	]);
	return sections
		.map(section => {
			const schemaTerms = new Set(terraformSectionTerms(section.schema_path));
			const descriptionTerms = new Set(terraformSectionTerms(section.description));
			const terminal = new Set(terraformSectionTerms(section.schema_path.split(".").at(-1) ?? ""));
			const covered = terms.filter(term => schemaTerms.has(term) || descriptionTerms.has(term));
			let ranking = terms.reduce(
				(sum, term) =>
					sum +
					(schemaTerms.has(term) ? 6 : 0) +
					(descriptionTerms.has(term) ? 2 : 0) +
					(terminal.has(term) ? 4 : 0),
				0,
			);
			ranking -= Math.max(0, section.schema_path.split(".").length - 1) * 0.6;
			for (const [positive, opposite] of [
				["https", "http"],
				["public", "private"],
				["private", "public"],
				["success", "failure"],
				["failure", "success"],
				["stateful", "service"],
			]) {
				if (terms.includes(positive!) && schemaTerms.has(opposite!) && !schemaTerms.has(positive!)) ranking -= 12;
			}
			for (const term of terms) if (terminalWords.has(term) && terminal.has(term)) ranking += 24;
			const coverage = terms.length ? covered.length / terms.length : 0;
			return { ...section, ranking: Number(ranking.toFixed(12)), coverage };
		})
		.filter(section => section.ranking > 0)
		.sort(
			(a, b) =>
				b.ranking - a.ranking ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
}

