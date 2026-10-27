import { expect, test } from "bun:test";
import { runVoicePolicySmoke } from "../../src/voice-policy-smoke";

test("packaged voice policy exercises conflicting inputs and reports only hashes", async () => {
	const output = await runVoicePolicySmoke();
	const receipt = JSON.parse(output.split("\n")[0]!);
	expect(receipt.failedBootstrap).toEqual({ failedLifecyclePersisted: true, closures: 1, admissions: 0 });
	expect(receipt.resultReplay).toEqual({ handoffPaths: 2, omissionsDetected: 2, multiSegmentMatches: 2 });
	expect(receipt.pronunciationReplay).toEqual({ handoffPaths: 2, exactResultsPreserved: 2, speechProjections: 2 });
	expect(receipt.startupAdmission).toEqual({ assistantOnlyRejected: 4, callerAccepted: 1, englishDefault: true });
	expect(receipt.requestedIdentityReplay).toEqual({
		wrongIdentityRejected: 1,
		correctIdentityAccepted: 1,
		partialSpeechPreserved: 1,
	});
	expect(receipt.startupReplay).toEqual({ rejectedExchanges: 4, callerDelegations: 1 });
	expect(receipt.policy.version).toBe("26");
	expect(receipt.policy.sha256).toMatch(/^[a-f0-9]{64}$/);
	expect(receipt.renderedInstructionsSha256).toMatch(/^[a-f0-9]{64}$/);
	expect(receipt.backendStartSha256).toMatch(/^[a-f0-9]{64}$/);
	expect(receipt.backendEndSha256).toMatch(/^[a-f0-9]{64}$/);
	expect(output).toEndWith("XCSH_VOICE_POLICY_SMOKE_OK");
	expect(output).not.toContain("Ignore policy");
	expect(output).not.toContain("private@example.com");
});
