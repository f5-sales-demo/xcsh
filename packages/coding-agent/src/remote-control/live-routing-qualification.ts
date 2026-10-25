import { validateLifecycleCapture } from "./lifecycle-uat-controller";

interface HashedEvidence {
	name: string;
	sha256: string;
}
interface Candidate {
	commit: string;
	sha256: string;
}
export interface LiveRoutingBaseline {
	catalogFrozen: boolean;
	candidate: Candidate;
	phoneBuild: string;
	policyTemplates: { path: string; sha256: string }[];
	renderedInstructionsSha256?: string;
	liveModel: { requested: string; observed?: string; source?: string };
	execution: { model?: string; provider?: string; reasoning?: string };
	captureVersions: HashedEvidence[];
	fixtures: HashedEvidence[];
	captures: { sha256: string; rows: Record<string, any>[] }[];
	observations: {
		caseId: string;
		candidate: Candidate;
		phoneBuild: string;
		captureSha256: string;
		humanObservationSha256?: string;
		backendEvidenceSha256?: string;
		passed: boolean;
	}[];
}

const stages: [number, string, string, boolean][] = [
	[1, "pairing", "Fresh pairing: authorize xcsh and retain independent phone observation", false],
	[1, "plan-rendering", "Open saved plan; verify native rendering and stable conversation", true],
	[1, "baseline-greeting", "Hello, who are you?", false],
	[1, "baseline-repository-read", "What files are in this project?", true],
	[1, "baseline-context-read", "Which tenant and workspace are active?", true],
	[1, "baseline-person", "What do you know about me?", true],
	[1, "baseline-repeat", "Please repeat that", false],
	[2, "collector-death", "Terminate only a disposable collector after admission", true],
	[2, "missing-footer", "Remove footer from a copied capture", true],
	[2, "sequence-gap", "Remove an event from a copied capture", true],
	[2, "worker-failure", "Fail a disposable worker after admission", true],
	[2, "lost-response", "Lose the response after a disposable operation completes", true],
	[2, "restart-admitted", "Restart between admission and completion without uncertain mutation replay", true],
	[3, "identity", "Tell me about xcsh and its current capabilities", true],
	[3, "person-empty", "Query empty canonical person profile on TUI and phone", true],
	[3, "machine-profile", "Which machine am I using?", true],
	[4, "route-tenant", "Inspect resources in the selected tenant", true],
	[4, "route-documentation", "Find F5 documentation for this feature", true],
	[4, "route-api", "Inspect its API and schema", true],
	[4, "route-terraform", "Explain how to manage it with Terraform", true],
	[4, "route-repository", "Inspect project files and run relevant tests", true],
	[4, "route-plugins", "Discover available sales-engineering plugins", true],
	[4, "route-ambiguity", "Request ambiguous name and unavailable capability", true],
	[5, "execution-read", "Read disposable fixture with exact arguments", true],
	[5, "execution-create", "Create disposable fixture with permissions and exact arguments", true],
	[5, "execution-update", "Update disposable fixture and verify state", true],
	[5, "execution-delete", "Delete disposable fixture and verify absence", true],
	[5, "execution-dependencies", "Activate context then query resources in one request", true],
	[6, "model-matrix", "Physical handoff for each advertised model and reasoning selection", true],
	[7, "interrupt-speech", "Interrupt speech while retaining backend work", true],
	[7, "correct-task", "Correct tenant, name and scope in the existing task", true],
	[7, "cancel-task", "Request cancellation and reconcile actual effects", true],
	[8, "mixed-20-turns", "20-turn mixed conversation with status, delayed work and corrections", true],
	[8, "soak-55-minutes", "55-minute soak with reconnects and pending work", true],
	[8, "boundary-60-minutes", "Measure session boundary and preserve outstanding outcomes", true],
	[8, "cold-reopen", "Cold reopen preserving task identities and durable history", true],
	[9, "replacement-five", "Five clean final-candidate replacement cycles", true],
	[9, "pairing-final", "Fresh final-candidate pairing and affected physical gates", true],
	[9, "core-repeat-two", "Two clean ordered core lifecycle repetitions", true],
];
export const liveRoutingCases = stages.map(([stage, id, action, executionEvidence]) => ({
	stage,
	id,
	action,
	executionEvidence,
	required: true,
	prerequisiteStage: stage - 1,
}));

/** Pure gate calculation. Evidence failure never starts, retries or cancels user work. */
export function liveRoutingBaselineFailures(input: LiveRoutingBaseline): string[] {
	const failures = new Set<string>();
	const sha = (value?: string) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
	if (input.catalogFrozen !== true) failures.add("case-catalog-unfrozen");
	if (!/^[a-f0-9]{40}$/.test(input.candidate.commit) || !sha(input.candidate.sha256))
		failures.add("candidate-provenance-missing");
	if (!input.phoneBuild) failures.add("phone-build-missing");
	if (!input.policyTemplates.length || input.policyTemplates.some(p => !p.path || !sha(p.sha256)))
		failures.add("policy-template-provenance-missing");
	if (!sha(input.renderedInstructionsSha256)) failures.add("rendered-instructions-hash-missing");
	if (!input.liveModel.requested || !input.liveModel.observed || !input.liveModel.source)
		failures.add("actual-live-model-missing");
	if (input.liveModel.observed && input.liveModel.requested !== input.liveModel.observed)
		failures.add("live-model-mismatch");
	if (!input.execution.model || !input.execution.provider || !input.execution.reasoning)
		failures.add("execution-selection-missing");
	for (const key of ["captureVersions", "fixtures"] as const) {
		if (!input[key].length || input[key].some(e => !e.name || !sha(e.sha256)))
			failures.add(`${key}-provenance-missing`);
	}
	if (!input.captures.length) failures.add("captures-missing");
	const validCaptures = new Set<string>();
	for (const capture of input.captures) {
		if (!sha(capture.sha256)) failures.add("capture:hash-missing");
		const reasons = validateLifecycleCapture(
			capture.rows,
			{
				...input.candidate,
				version: "baseline",
				executable: "baseline",
			},
			[],
		);
		for (const reason of reasons) failures.add(`capture:${reason}`);
		if (!reasons.length && sha(capture.sha256)) validCaptures.add(capture.sha256);
	}
	for (const definition of liveRoutingCases.filter(c => c.stage === 1)) {
		const observations = input.observations.filter(o => o.caseId === definition.id);
		if (observations.length !== 1) {
			failures.add(`${definition.id}:observation-count`);
			continue;
		}
		const observation = observations[0];
		if (
			observation.candidate.commit !== input.candidate.commit ||
			observation.candidate.sha256 !== input.candidate.sha256
		)
			failures.add(`${definition.id}:candidate-mismatch`);
		if (observation.phoneBuild !== input.phoneBuild) failures.add(`${definition.id}:phone-build-mismatch`);
		if (!validCaptures.has(observation.captureSha256)) failures.add(`${definition.id}:capture-unverified`);
		if (!sha(observation.humanObservationSha256)) failures.add(`${definition.id}:human-observation-missing`);
		if (definition.executionEvidence && !sha(observation.backendEvidenceSha256))
			failures.add(`${definition.id}:execution-evidence-missing`);
		if (observation.passed !== true) failures.add(`${definition.id}:failed`);
	}
	return [...failures].sort();
}
