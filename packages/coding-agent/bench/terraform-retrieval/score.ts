export function scoreDestinations(
	kind: "answerable" | "ambiguous" | "control",
	selected: boolean,
	destinations: string[],
	expected: string[],
	matchDocument = false,
) {
	const normalize = (uri: string) => {
		const url = new URL(uri);
		url.search = "";
		return url.href;
	};
	const actual = destinations.map(normalize);
	const wanted = expected.map(normalize);
	const matches = (a: string, b: string) => (matchDocument ? a.split("#")[0] === b.split("#")[0] : a === b);
	const rank = actual.findIndex(uri => wanted.some(want => matches(uri, want))) + 1;
	const matchedExpected = wanted.filter(want => actual.slice(0, 5).some(uri => matches(uri, want))).length;
	const selectionCorrect =
		kind === "answerable"
			? selected && rank === 1
			: kind === "ambiguous"
				? !selected && wanted.length >= 2 && matchedExpected === wanted.length
				: null;
	return { rank: rank || null, top5: rank > 0 && rank <= 5, matchedExpected, selectionCorrect };
}

export function validateQualificationSource(
	freeze: {
		source_provider_version: string;
		source_commit?: string;
		receipt_sha256?: string;
		source_index_sha256?: string;
	},
	pin: { provider_version: string; source_commit: string; receipt_sha256: string; index?: { sha256: string } },
	regression: boolean,
): void {
	if (
		freeze.source_provider_version !== pin.provider_version ||
		(freeze.source_commit && freeze.source_commit !== pin.source_commit) ||
		(freeze.receipt_sha256 && freeze.receipt_sha256 !== pin.receipt_sha256)
	)
		throw new Error("Frozen qualification provider source mismatch");
	if (!regression && freeze.source_index_sha256 && freeze.source_index_sha256 !== pin.index?.sha256)
		throw new Error("Frozen qualification index mismatch; use --regression for post-analysis evidence");
}

export function validateQualificationEligibility(
	audit: { suite_sha256: string; qualification_eligible: boolean; reason: string } | undefined,
	suiteHash: string,
	regression: boolean,
): void {
	if (!audit) return;
	if (audit.suite_sha256 !== suiteHash) throw new Error("Benchmark eligibility audit digest mismatch");
	if (!audit.qualification_eligible && !regression) throw new Error("Benchmark cannot qualify: " + audit.reason);
}

export interface TerraformPreviewEvidence {
	preview: true;
	unpublished_source: true;
	provenance_pin_is_baseline: true;
	source_commit: string;
	index: { sha256: string };
}
export function validatePreviewEvidence(
	preview: TerraformPreviewEvidence | undefined,
	indexHash: string,
	regression: boolean,
): void {
	if (!preview) return;
	if (!regression) throw new Error("Unpublished preview requires explicit regression mode");
	if (
		preview.preview !== true ||
		preview.unpublished_source !== true ||
		preview.provenance_pin_is_baseline !== true ||
		!/^([a-f0-9]{40})$/.test(preview.source_commit)
	)
		throw new Error("Invalid unpublished preview source evidence");
	if (preview.index?.sha256 !== indexHash) throw new Error("Preview evidence index mismatch");
}

export function validateIndependentFreeze(
	freeze: {
		schema_version?: number;
		independent_review_sha256?: string;
		implementation_and_retrieval_outputs_withheld?: boolean;
	},
	review: { verdict: string; findings: unknown[]; reviewed_case_ids: string[] },
	reviewHash: string,
	caseIds: string[],
): void {
	if (freeze.schema_version !== 2) return;
	if (freeze.independent_review_sha256 !== reviewHash) throw new Error("Independent review digest mismatch");
	if (
		freeze.implementation_and_retrieval_outputs_withheld !== true ||
		review.verdict !== "approve" ||
		review.findings.length
	)
		throw new Error("Independent review must approve without unresolved findings");
	if (
		new Set(caseIds).size !== caseIds.length ||
		new Set(review.reviewed_case_ids).size !== review.reviewed_case_ids.length ||
		caseIds.length !== review.reviewed_case_ids.length ||
		caseIds.some(id => !review.reviewed_case_ids.includes(id))
	)
		throw new Error("Independent review coverage mismatch");
}

export function validateModelActivation(
	cases: Array<{ id: string; kind: string; prompt: string; behavior?: string }>,
): void {
	for (const item of cases)
		if ((item.kind === "answerable" || item.kind === "ambiguous") && !/\bterraform\b|\bhcl\b/i.test(item.prompt))
			throw new Error(`Model case ${item.id} lacks explicit Terraform activation`);
}


export function validateModelSubsetPreflight(cases:Array<{id:string;kind:string;prompt:string;behavior?:string}>,suiteIds:readonly string[],regression:boolean):void{
 if(regression)return;
 const counts=["answerable","ambiguous","control"].map(kind=>cases.filter(c=>c.kind===kind).length);
 if(cases.length!==40||JSON.stringify(counts)!==JSON.stringify([28,8,4]))throw new Error("Frozen model subset must be28/8/4");
 if(new Set(cases.map(c=>c.id)).size!==40||cases.some(c=>!suiteIds.includes(c.id)))throw new Error("Frozen model subset IDs do not match suite");
 validateModelActivation(cases);
}
