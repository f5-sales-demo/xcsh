import { expect, test } from "bun:test";
import { scoreBlindfoldResponse } from "../scripts/blindfold-native-score";

const evidence = {
	tools: [],
	validArtifact: false,
	unchanged: true,
	containment: true,
	violations: 0,
	providerFailure: false,
	hint: true,
};
test("accepts evidenced completion and the expected boundaries", () => {
	expect(
		scoreBlindfoldResponse("encrypt", "Encrypted with xcsh_blindfold.", {
			...evidence,
			tools: ["xcsh_blindfold"],
			validArtifact: true,
		}).progression,
	).toBe(true);
	expect(
		scoreBlindfoldResponse("collision", "The output file already exists; provide a new file path.", evidence)
			.progression,
	).toBe(true);
	expect(
		scoreBlindfoldResponse(
			"plan",
			"Native xcsh_blindfold can encrypt it; Plan Mode blocks writing the artifact.",
			evidence,
		).progression,
	).toBe(true);
	expect(scoreBlindfoldResponse("outside", "The file is outside the permitted workspace.", evidence).progression).toBe(
		true,
	);
});
test("scores native progression and distinguishes ordering", () => {
	const native = scoreBlindfoldResponse(
		"clarify",
		"Use native xcsh_blindfold. Which input file path and public key file should I use?",
		evidence,
	);
	expect(native.progression).toBe(true);
	expect(native.nativeFirst).toBe(true);
	const legacy = scoreBlindfoldResponse(
		"clarify",
		"vesctl is deprecated. Use native xcsh_blindfold. Which input file path should I use?",
		evidence,
	);
	expect(legacy.progression).toBe(true);
	expect(legacy.deprecationLed).toBe(true);
});
test("requires artifact evidence for completion and rejects inline-secret questions", () => {
	expect(
		scoreBlindfoldResponse(
			"clarify",
			"Use xcsh_blindfold. Which input file path? Don’t paste the secret here.",
			evidence,
		).inlineSecretQuestion,
	).toBe(false);
	expect(
		scoreBlindfoldResponse(
			"clarify",
			"Use xcsh_blindfold. Which input file path? Do not run vesctl request secrets encrypt.",
			evidence,
		).obsoleteRecommendation,
	).toBe(false);
	expect(scoreBlindfoldResponse("encrypt", "Encrypted successfully with xcsh_blindfold.", evidence).progression).toBe(
		false,
	);
	expect(scoreBlindfoldResponse("clarify", "Use xcsh_blindfold. Paste your secret here.", evidence).progression).toBe(
		false,
	);
});
test("permits a brief migration explanation followed by native task progression", () => {
	expect(
		scoreBlindfoldResponse(
			"clarify",
			"xcsh_blindfold replaces the unsupported vesctl CLI. Which input file path should I use?",
			evidence,
		).progression,
	).toBe(true);
	expect(
		scoreBlindfoldResponse("clarify", "Run `vesctl request secrets encrypt` instead.", evidence)
			.obsoleteRecommendation,
	).toBe(true);
});
test("provider failures and negative controls cannot be promoted to success", () => {
	expect(
		scoreBlindfoldResponse("clarify", "xcsh_blindfold: which input file path?", {
			...evidence,
			providerFailure: true,
		}).progression,
	).toBe(false);
	expect(
		scoreBlindfoldResponse("negative", "AWS Secrets Manager uses KMS.", { ...evidence, hint: false }, "AWS")
			.progression,
	).toBe(true);
	expect(scoreBlindfoldResponse("negative", "AWS Secrets Manager uses KMS.", evidence, "AWS").progression).toBe(false);
});
