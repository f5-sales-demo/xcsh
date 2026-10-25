interface VoicePolicySmokeReceipt {
	policy: { version: string; sha256: string };
	failedBootstrap: { failedLifecyclePersisted: boolean; closures: number; admissions: number };
	startupReplay: { rejectedExchanges: number; callerDelegations: number };
 requestedIdentityReplay: { wrongIdentityRejected: number; correctIdentityAccepted: number; partialSpeechPreserved: number };
 startupAdmission: { assistantOnlyRejected: number; callerAccepted: number; englishDefault: boolean };
	resultReplay: { handoffPaths: number; omissionsDetected: number; multiSegmentMatches: number };
	pronunciationReplay: { handoffPaths: number; exactResultsPreserved: number; speechProjections: number };
	renderedInstructionsSha256: string;
	backendStartSha256: string;
	backendEndSha256: string;
}
/** Accept only the known native loader preamble followed by one complete behavioral receipt. */
export function parseVoicePolicySmokeOutput(output: string): VoicePolicySmokeReceipt {
	const lines = output.trim().split(/\r?\n/);
	if (lines.pop() !== "XCSH_VOICE_POLICY_SMOKE_OK") throw new Error("Missing compiled voice policy success marker");
	if (lines[0]?.startsWith("Loaded native addon from ")) lines.shift();
	if (lines.length !== 1) throw new Error("Expected one compiled voice policy receipt");
	const receipt = JSON.parse(lines[0]!) as VoicePolicySmokeReceipt;
	if (!receipt?.policy || typeof receipt.policy.version !== "string" || !/^\d+$/.test(receipt.policy.version) ||
		![receipt.policy.sha256, receipt.renderedInstructionsSha256, receipt.backendStartSha256, receipt.backendEndSha256]
			.every(hash => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)) ||
		receipt.failedBootstrap?.failedLifecyclePersisted !== true || receipt.failedBootstrap?.closures !== 1 || receipt.failedBootstrap?.admissions !== 0 ||
		receipt.requestedIdentityReplay?.wrongIdentityRejected !== 1 || receipt.requestedIdentityReplay?.correctIdentityAccepted !== 1 || receipt.requestedIdentityReplay?.partialSpeechPreserved !== 1 || receipt.startupAdmission?.assistantOnlyRejected !== 4 || receipt.startupAdmission?.callerAccepted !== 1 || receipt.startupAdmission?.englishDefault !== true || receipt.startupReplay?.rejectedExchanges !== 4 || receipt.startupReplay?.callerDelegations !== 1 ||
		receipt.resultReplay?.handoffPaths !== 2 || receipt.resultReplay?.omissionsDetected !== 2 || receipt.resultReplay?.multiSegmentMatches !== 2 || receipt.pronunciationReplay?.handoffPaths !== 2 || receipt.pronunciationReplay?.exactResultsPreserved !== 2 || receipt.pronunciationReplay?.speechProjections !== 2)
		throw new Error("Incomplete compiled startup behavioral evidence");
	return receipt;
}
