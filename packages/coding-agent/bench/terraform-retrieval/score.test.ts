import { expect, test } from "bun:test";
import {
	scoreDestinations,
	validateIndependentFreeze,
	validateModelActivation,
 validateModelSubsetPreflight,
	validatePreviewEvidence,
	validateQualificationEligibility,
	validateQualificationSource,
} from "./score";

const a = "xcsh://terraform-documentation/documentation/resources/a/index.md#section";
const b = "xcsh://terraform-documentation/documentation/resources/b/index.md#section";

test("ambiguity requires every permitted destination among five meaningful choices", () => {
	expect(scoreDestinations("ambiguous", false, [a], [a, b]).selectionCorrect).toBe(false);
	expect(scoreDestinations("ambiguous", false, [a, b], [a, b]).selectionCorrect).toBe(true);
	expect(scoreDestinations("ambiguous", true, [a, b], [a, b]).selectionCorrect).toBe(false);
	expect(scoreDestinations("ambiguous", false, [a], [a]).selectionCorrect).toBe(false);
});

test("answerable selection requires first exact destination and preserves anchor identity", () => {
	expect(scoreDestinations("answerable", true, [a], [a]).selectionCorrect).toBe(true);
	expect(scoreDestinations("answerable", false, [a], [a]).selectionCorrect).toBe(false);
	expect(scoreDestinations("answerable", true, [b, a], [a]).selectionCorrect).toBe(false);
	expect(scoreDestinations("answerable", true, [a.replace("#section", "#other")], [a]).selectionCorrect).toBe(false);
	expect(
		scoreDestinations("answerable", true, [a.replace("#section", "?view=context#section")], [a]).selectionCorrect,
	).toBe(true);
});

test("heldout qualification binds provider receipt and exact reviewed index", () => {
	const freeze = {
		source_provider_version: "v1.0.0",
		source_commit: "a",
		receipt_sha256: "b",
		source_index_sha256: "c",
	};
	const pin = { provider_version: "v1.0.0", source_commit: "a", receipt_sha256: "b", index: { sha256: "c" } };
	expect(() => validateQualificationSource(freeze, pin, false)).not.toThrow();
	expect(() => validateQualificationSource(freeze, { ...pin, index: { sha256: "changed" } }, false)).toThrow();
	expect(() => validateQualificationSource(freeze, { ...pin, index: { sha256: "changed" } }, true)).not.toThrow();
	expect(() => validateQualificationSource(freeze, { ...pin, source_commit: "changed" }, true)).toThrow();
});

test("a disqualified frozen benchmark may run only as explicit regression", () => {
	const audit = { suite_sha256: "suite", qualification_eligible: false, reason: "Nonunique answerable labels" };
	expect(() => validateQualificationEligibility(audit, "suite", false)).toThrow("Nonunique");
	expect(() => validateQualificationEligibility(audit, "suite", true)).not.toThrow();
	expect(() => validateQualificationEligibility(audit, "different", true)).toThrow("digest");
	expect(() => validateQualificationEligibility(undefined, "suite", false)).not.toThrow();
});

test("unpublished preview evidence is regression-only and bound to the actual index", () => {
	const preview = {
		preview: true as const,
		unpublished_source: true as const,
		provenance_pin_is_baseline: true as const,
		source_commit: "a".repeat(40),
		index: { sha256: "b".repeat(64) },
	};
	expect(() => validatePreviewEvidence(preview, "b".repeat(64), true)).not.toThrow();
	expect(() => validatePreviewEvidence(preview, "b".repeat(64), false)).toThrow("regression");
	expect(() => validatePreviewEvidence(preview, "c".repeat(64), true)).toThrow("index");
	expect(() => validatePreviewEvidence({ ...preview, source_commit: "invalid" }, "b".repeat(64), true)).toThrow(
		"source",
	);
	expect(() => validatePreviewEvidence(undefined, "b".repeat(64), true)).not.toThrow();
});

test("new independent freezes require approved complete digest-bound review", () => {
	const freeze = {
		schema_version: 2,
		independent_review_sha256: "review-hash",
		implementation_and_retrieval_outputs_withheld: true,
	};
	const review = { verdict: "approve", findings: [], reviewed_case_ids: ["a", "b"] };
	expect(() => validateIndependentFreeze(freeze, review, "review-hash", ["a", "b"])).not.toThrow();
	expect(() => validateIndependentFreeze(freeze, review, "changed", ["a", "b"])).toThrow("digest");
	expect(() =>
		validateIndependentFreeze(freeze, { ...review, reviewed_case_ids: ["a"] }, "review-hash", ["a", "b"]),
	).toThrow("coverage");
	expect(() =>
		validateIndependentFreeze(freeze, { ...review, verdict: "needs-attention" }, "review-hash", ["a", "b"]),
	).toThrow("approve");
});

test("model acceptance requires explicit Terraform activation while ordinary controls remain ordinary", () => {
	expect(() =>
		validateModelActivation([{ id: "a", kind: "answerable", prompt: "Which field sets a certificate URL?" }]),
	).toThrow("activation");
	expect(() =>
		validateModelActivation([
			{ id: "a", kind: "answerable", prompt: "Which Terraform field sets a certificate URL?" },
			{ id: "c", kind: "control", behavior: "ordinary-discovery", prompt: "Find API guidance" },
		]),
	).not.toThrow();
});


test("fresh retrieval qualification requires a complete activated model subset",()=>{
 const rows=[...Array.from({length:28},(_,i)=>({id:`a${i}`,kind:"answerable",prompt:"Terraform fixture"})),...Array.from({length:8},(_,i)=>({id:`b${i}`,kind:"ambiguous",prompt:"Terraform fixture"})),...Array.from({length:4},(_,i)=>({id:`c${i}`,kind:"control",prompt:"Ordinary API docs"}))];
 expect(()=>validateModelSubsetPreflight(rows,rows.map(c=>c.id),false)).not.toThrow();
 expect(()=>validateModelSubsetPreflight(rows.slice(1),rows.map(c=>c.id),false)).toThrow("28/8/4");
 expect(()=>validateModelSubsetPreflight([{...rows[0]!,prompt:"Which field?"},...rows.slice(1)],rows.map(c=>c.id),false)).toThrow("activation");
 expect(()=>validateModelSubsetPreflight(rows,[],false)).toThrow("IDs");
 expect(()=>validateModelSubsetPreflight([],[],true)).not.toThrow();
});
