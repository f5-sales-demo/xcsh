/** Contract evidence proves application routing, not observation of provider internals. */
export const LIVE_MODEL = "gpt-live-1";
export const LIVE_REFERENCE = "970111f6cb62cc02fe36a82ea7d71b37a2889c97";
export const VOICE_CHECKS = [
	"requestModel",
	"configuration",
	"eventParsing",
	"media",
	"delegation",
	"interruption",
	"closure",
	"packaging",
	"physical",
] as const;
export type VoiceCheckName = (typeof VOICE_CHECKS)[number];
export interface VoiceCheck {
	status: "passed" | "failed" | "untested" | "incomplete";
	evidence: readonly string[];
}
export interface VoiceCreationEvidence {
	requestedModel: string;
	route: string;
	status: number;
	returnedCallId: string;
	attachedCallId: string;
	fallbackApplied: boolean;
	configurationOverridden: boolean;
	routeTraced: boolean;
	providerModel?: string;
}
export function evaluateVoiceContract(input: {
	creation?: VoiceCreationEvidence;
	checks?: Partial<Record<VoiceCheckName, VoiceCheck>>;
}): {
	reference: string;
	modelEcho: "absent" | "matching" | "conflicting";
	checks: Record<VoiceCheckName, VoiceCheck>;
	qualified: boolean;
} {
	const creation = input.creation;
	const modelEcho =
		creation?.providerModel === undefined
			? "absent"
			: creation.providerModel === LIVE_MODEL
				? "matching"
				: "conflicting";
	const checks = Object.fromEntries(
		VOICE_CHECKS.map(name => {
			const check = input.checks?.[name];
			return [
				name,
				check
					? { ...check, status: check.status === "passed" && !check.evidence.length ? "incomplete" : check.status }
					: { status: "untested", evidence: [] },
			];
		}),
	) as Record<VoiceCheckName, VoiceCheck>;
	if (creation) {
		const passed =
			creation.requestedModel === LIVE_MODEL &&
			creation.route === "chatgpt-subscription" &&
			creation.routeTraced &&
			creation.status === 201 &&
			!!creation.returnedCallId &&
			creation.returnedCallId === creation.attachedCallId &&
			!creation.fallbackApplied &&
			!creation.configurationOverridden &&
			modelEcho !== "conflicting";
		checks.requestModel = {
			status: passed ? "passed" : "failed",
			evidence: ["creation-request-and-returned-call-binding"],
		};
	}
	return {
		reference: LIVE_REFERENCE,
		modelEcho,
		checks,
		qualified: VOICE_CHECKS.every(name => checks[name].status === "passed"),
	};
}
