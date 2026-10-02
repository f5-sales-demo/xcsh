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
	listening: "listen",
	kubernetes: "k8s",
	blindfolded: "blindfold",
	unencrypted: "clear",
	encrypted: "tls",
	encryption: "tls",
	pkcs12: "p12",
	certificated: "certificate",
	cert: "certificate",
	certs: "certificate",
	initial: "create",
	provision: "create",
	allocation: "allocate",
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
 const original=query.toLowerCase();
 if(/\btimeout\b|\bduration\b/.test(original)) terms.push("timeout");
 if(/\b(?:auto|automatic|automatically)\b/.test(original)&&/\bcertificates?\b/.test(original)) terms.push("auto","certificate");

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
 const directFields=new Set<string>();
 for(const candidate of sections){
  const path=candidate.schema_path.split(".");
  if(terraformSectionTerms(path.at(-1)??"").some(term=>terminalWords.has(term)&&terms.includes(term))) directFields.add(path.slice(0,-1).join("."));
 }
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
			ranking -= Math.max(0, section.schema_path.split(".").length - 1) * 0.3;
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
            const terminalPhrase=terraformSectionTerms(section.schema_path.split(".").at(-1)??"").join(" ");
            if(terminalPhrase.split(" ").length>1 && original.replace(/[_-]/g," ").includes(terminalPhrase)) ranking+=12;
            if(section.schema_path.endsWith(".dns_name") && /dns|hostname/.test(original)) ranking+=16;
            if(section.schema_path==="https_auto_cert" && /(?:auto|automatically).*(?:provision|manage).*(?:certificate)|(?:certificate).*(?:auto|automatically)/.test(original)) ranking+=40;
            if(/\b(?:platform|volterra)\b/.test(original)&&section.schema_path.endsWith(".volterra_trusted_ca")) ranking+=30;
            if(terms.includes("timeout") && section.schema_path.startsWith("timeouts.")) ranking+=24;
			const coverage = terms.length ? covered.length / terms.length : 0;
			return { ...section, ranking: Number(ranking.toFixed(12)), coverage };
		})
.map(section=>{
   if(section.anchor==="section"){
    if(directFields.has(section.schema_path)) return {...section,ranking:section.ranking-20};
   }
   return section;
  })
		.filter(section => section.ranking > 0)
		.sort(
			(a, b) =>
				b.ranking - a.ranking ||
				(a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
				(a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0),
		);
}

