import { createHash } from "node:crypto";

const DENIAL =
	/\b(?:i (?:have|hold) no (?:stored )?(?:details|information|memor(?:y|ies))(?:\s+or\s+(?:details|information|memor(?:y|ies)))*\s+about you|i (?:do not|don't) know (?:anything|details|information) about you|i only know (?:about )?(?:this|the current) (?:chat|conversation)|i know nothing about you)\b/i;
const GENERIC_IDENTITY = /\b(?:i am|i'm) (?:chatgpt|an? (?:openai|general-purpose) assistant)\b/i;
const COMMON = new Set([
	"about",
	"across",
	"after",
	"before",
	"being",
	"could",
	"evidence",
	"facts",
	"knowledge",
	"memory",
	"project",
	"should",
	"their",
	"there",
	"these",
	"those",
	"through",
	"using",
	"would",
]);

function terms(value: string): Set<string> {
	return new Set(
		value
			.toLowerCase()
			.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{3,}/gu)
			?.filter(term => !COMMON.has(term)) ?? [],
	);
}

export interface PersonaProbeScore {
	passed: boolean;
	deniedKnownContext: boolean;
	genericIdentity: boolean;
	knowledgeTermMatches: number;
	responseBytes: number;
	responseDigest: string;
}

/** Score without returning or persisting prompt, memory, or transcript text. */
export function scorePersonaResponse(response: string, userKnowledge: string): PersonaProbeScore {
	const responseTerms = terms(response);
	const knowledgeTermMatches = [...terms(userKnowledge)].filter(term => responseTerms.has(term)).length;
	const deniedKnownContext = Boolean(userKnowledge.trim()) && DENIAL.test(response);
	const genericIdentity = GENERIC_IDENTITY.test(response);
	return {
		passed: Boolean(userKnowledge.trim()) && !genericIdentity && knowledgeTermMatches >= 1 && !deniedKnownContext,
		deniedKnownContext,
		genericIdentity,
		knowledgeTermMatches,
		responseBytes: Buffer.byteLength(response),
		responseDigest: createHash("sha256").update(response).digest("hex"),
	};
}
