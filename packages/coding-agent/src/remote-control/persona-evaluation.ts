import { isDeepStrictEqual } from "node:util";
import { type PersonProfile, validateProfile } from "../person-profile/schema";
export interface PersonContractInvocation {
	toolName: string;
	action?: string;
	resource?: string;
	success: boolean;
	profile?: unknown;
}
/** Acceptance uses executed canonical calls and validated structured outcomes, never lexical overlap. */
export function scorePersonContract(
	invocations: readonly PersonContractInvocation[],
	expected: PersonProfile,
): { passed: boolean; canonicalCalls: number; matchingOutcomes: number; schemaVersion: number } {
	const canonical = invocations.filter(
		i =>
			i.success &&
			((i.toolName === "person_profile" && i.action === "get") ||
				(i.toolName === "read" && i.resource === "xcsh://user")),
	);
	const matchingOutcomes = canonical.filter(i => {
		try {
			validateProfile(i.profile);
			return isDeepStrictEqual(i.profile, expected);
		} catch {
			return false;
		}
	}).length;
	return {
		passed: matchingOutcomes > 0,
		canonicalCalls: canonical.length,
		matchingOutcomes,
		schemaVersion: expected.schemaVersion,
	};
}
