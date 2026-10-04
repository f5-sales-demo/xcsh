import { expect, test } from "bun:test";
import { validateModelDecisionRecords } from "./model-decision-records";

test("model decisions bind unchanged query and every permitted destination", () => {
 const cases = [{ id: "one", kind: "ambiguous", prompt: "Terraform query", expected: ["a", "b"] }];
 const record = { id: "one", preserve_filters: "Terraform query", decision: { choices: [{ destination: "a" }, { destination: "b" }] } };
 expect(validateModelDecisionRecords([record], cases)).toEqual(["one"]);
 expect(() => validateModelDecisionRecords([record, record], cases)).toThrow();
 expect(() => validateModelDecisionRecords([{ ...record, preserve_filters: "changed" }], cases)).toThrow();
 expect(() => validateModelDecisionRecords([{ ...record, decision: { choices: [{ destination: "a" }, { destination: "a" }] } }], cases)).toThrow();
 expect(() => validateModelDecisionRecords([record], [{ ...cases[0]!, kind: "answerable" }])).toThrow();
});
