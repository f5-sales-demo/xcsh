export const API_PREFLIGHT_MATRIX_SEED = 4393;

export const API_PREFLIGHT_MATRIX_AXES = {
	flow: ["single-turn", "multi-turn", "plan-mode", "long-task"],
	question: ["limit", "required-fields", "crud-endpoint", "allowlist", "follow-up"],
	control: ["positive", "tools-disabled", "terraform-only", "conceptual", "third-party", "unrelated"],
	outcome: ["success", "missing-data", "ambiguous-projection", "stale-index", "corrupt-index", "runtime-failure"],
} as const;

type MatrixAxes = typeof API_PREFLIGHT_MATRIX_AXES;
export type ApiPreflightMatrixCase = { id: string; prompt: string; expectedTrace: string[] } & {
	[Axis in keyof MatrixAxes]: MatrixAxes[Axis][number];
};

function seededRank(value: string, seed: number): number {
	let hash = seed >>> 0;
	for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
	return hash;
}

function cartesianRows(): Array<Record<keyof MatrixAxes, string>> {
	return API_PREFLIGHT_MATRIX_AXES.flow.flatMap(flow =>
		API_PREFLIGHT_MATRIX_AXES.question.flatMap(question =>
			API_PREFLIGHT_MATRIX_AXES.control.flatMap(control =>
				API_PREFLIGHT_MATRIX_AXES.outcome.map(outcome => ({ flow, question, control, outcome })),
			),
		),
	);
}

function pairKeys(row: Record<keyof MatrixAxes, string>): string[] {
	const axes = Object.keys(API_PREFLIGHT_MATRIX_AXES) as Array<keyof MatrixAxes>;
	return axes.flatMap((left, leftIndex) =>
		axes.slice(leftIndex + 1).map(right => `${left}=${row[left]}|${right}=${row[right]}`),
	);
}

function promptFor(row: Record<keyof MatrixAxes, string>): string {
	const questions = {
		limit: "What is the maximum number of routes on an F5 XC HTTP load balancer?",
		"required-fields": "Which fields are required to create an F5 XC origin pool?",
		"crud-endpoint": "What endpoint creates an F5 XC DNS zone?",
		allowlist: "Show field services.regional_edges from the F5 XC network allowlist.",
		"follow-up": "What is its maximum?",
	} as const;
	const controls = {
		positive: "",
		"tools-disabled": " Tools are disabled.",
		"terraform-only": " Answer only with Terraform concepts, not API metadata.",
		conceptual: " Explain the concept without API details.",
		"third-party": " This asks about the AWS Application Load Balancer, not F5 XC.",
		unrelated: " This follows an unrelated conversation turn.",
	} as const;
	const flows = {
		"single-turn": "",
		"multi-turn": " Continue the immediately preceding resource turn.",
		"plan-mode": " In plan mode, gather evidence before proposing steps.",
		"long-task": " As part of a longer task, answer this evidence checkpoint.",
	} as const;
	return `${questions[row.question as keyof typeof questions]}${controls[row.control as keyof typeof controls]}${flows[row.flow as keyof typeof flows]}`;
}

function expectedTraceFor(row: Record<keyof MatrixAxes, string>): string[] {
	if (row.control !== "positive") return [];
	if (["stale-index", "corrupt-index", "runtime-failure"].includes(row.outcome)) {
		return ["api-catalog-preflight:error"];
	}
	if (row.question === "allowlist") {
		return ["read:xcsh://api-spec/network-allowlist?field=services.regional_edges"];
	}
	if (row.outcome === "ambiguous-projection") {
		return ["read:xcsh://api-spec/network-allowlist?field=domains", "response:canonical-follow-up-urls"];
	}
	if (row.outcome === "missing-data") return ["api-catalog-preflight", "response:missing-authoritative-data"];
	return ["api-catalog-preflight", "read:exact-catalog-resource", "read:exact-owner-spec"];
}

export function generateApiPreflightPairwiseMatrix(seed = API_PREFLIGHT_MATRIX_SEED): ApiPreflightMatrixCase[] {
	const candidates = cartesianRows();
	const uncovered = new Set(candidates.flatMap(pairKeys));
	const selected: Array<Record<keyof MatrixAxes, string>> = [];
	while (uncovered.size > 0) {
		const best = candidates
			.filter(candidate => !selected.includes(candidate))
			.map(candidate => ({
				candidate,
				coverage: pairKeys(candidate).filter(pair => uncovered.has(pair)).length,
				rank: seededRank(JSON.stringify(candidate), seed),
			}))
			.sort((left, right) => right.coverage - left.coverage || left.rank - right.rank)[0];
		if (!best || best.coverage === 0) break;
		selected.push(best.candidate);
		for (const pair of pairKeys(best.candidate)) uncovered.delete(pair);
	}
	return selected.map((row, index) => ({
		...row,
		id: `api-preflight-${String(index + 1).padStart(2, "0")}`,
		prompt: promptFor(row),
		expectedTrace: expectedTraceFor(row),
	})) as ApiPreflightMatrixCase[];
}
