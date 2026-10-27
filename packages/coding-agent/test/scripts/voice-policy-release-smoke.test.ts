import { expect, test } from "bun:test";
import { parseVoicePolicySmokeOutput } from "../../../../scripts/voice-policy-smoke-output";

const receipt = {
	policy: { version: "16", sha256: "a".repeat(64) },
	failedBootstrap: { failedLifecyclePersisted: true, closures: 1, admissions: 0 },
	startupReplay: { rejectedExchanges: 4, callerDelegations: 1 },
	requestedIdentityReplay: { wrongIdentityRejected: 1, correctIdentityAccepted: 1, partialSpeechPreserved: 1 },
	startupAdmission: { assistantOnlyRejected: 4, callerAccepted: 1, englishDefault: true },
	resultReplay: { handoffPaths: 2, omissionsDetected: 2, multiSegmentMatches: 2 },
	pronunciationReplay: { handoffPaths: 2, exactResultsPreserved: 2, speechProjections: 2 },
	renderedInstructionsSha256: "b".repeat(64),
	backendStartSha256: "c".repeat(64),
	backendEndSha256: "d".repeat(64),
};
const output = `${JSON.stringify(receipt)}\nXCSH_VOICE_POLICY_SMOKE_OK`;
test("compiled startup receipt allows the observed native loader diagnostic", () => {
	expect(parseVoicePolicySmokeOutput(`Loaded native addon from /tmp/example.node\n${output}`)).toEqual(receipt);
	expect(parseVoicePolicySmokeOutput(output)).toEqual(receipt);
});
test("missing, duplicate, malformed and incomplete startup evidence is rejected", () => {
	for (const value of [
		"XCSH_VOICE_POLICY_SMOKE_OK",
		`${output}\nextra`,
		`${JSON.stringify(receipt)}\n${output}`,
		output.replace('"rejectedExchanges":4', '"rejectedExchanges":0'),
		output.replace('"callerDelegations":1', '"callerDelegations":0'),
		output.replace('"startupReplay"', '"missingReplay"'),
		`unknown diagnostic\n${output}`,
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});

test("compiled result fidelity evidence is required for the current voice policy", () => {
	for (const value of [
		output.replace('"resultReplay"', '"missingReplay"'),
		output.replace('"omissionsDetected":2', '"omissionsDetected":0'),
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});

test("compiled result replay rejects missing multi-segment checks", () => {
	for (const value of [
		output.replace('"multiSegmentMatches":2', '"multiSegmentMatches":0'),
		output.replace('"multiSegmentMatches"', '"missingSegments"'),
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});

test("compiled receipt rejects missing pronunciation delivery and exact result replay", () => {
	for (const value of [
		output.replace('"pronunciationReplay"', '"missingPronunciation"'),
		output.replace('"exactResultsPreserved":2', '"exactResultsPreserved":0'),
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});

test("compiled speech projection evidence is mandatory", () => {
	for (const value of [
		output.replace('"speechProjections":2', '"speechProjections":0'),
		output.replace('"speechProjections"', '"missingSpeechProjection"'),
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});

test("packaged startup caller admission and language evidence is mandatory", () => {
	for (const value of [
		output.replace('"startupAdmission"', '"missingAdmission"'),
		output.replace('"assistantOnlyRejected":4', '"assistantOnlyRejected":0'),
		output.replace('"englishDefault":true', '"englishDefault":false'),
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});

test("requested identity and partial speech replay are mandatory", () => {
	for (const outputText of [
		output.replace('"requestedIdentityReplay"', '"missingIdentity"'),
		output.replace('"wrongIdentityRejected":1', '"wrongIdentityRejected":0'),
		output.replace('"partialSpeechPreserved":1', '"partialSpeechPreserved":0'),
	])
		expect(() => parseVoicePolicySmokeOutput(outputText)).toThrow();
});

test("compiled release rejects absent or duplicate failed-bootstrap closure evidence", () => {
	for (const value of [
		output.replace('"failedBootstrap"', '"missingFailureEvidence"'),
		output.replace('"failedLifecyclePersisted":true', '"failedLifecyclePersisted":false'),
		output.replace('"closures":1', '"closures":2'),
		output.replace('"admissions":0', '"admissions":1'),
	])
		expect(() => parseVoicePolicySmokeOutput(value)).toThrow();
});
