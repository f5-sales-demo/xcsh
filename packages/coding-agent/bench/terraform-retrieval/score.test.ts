import { expect, test } from "bun:test";
import { scoreDestinations, validateQualificationSource } from "./score";

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
 expect(scoreDestinations("answerable", true, [a.replace("#section", "?view=context#section")], [a]).selectionCorrect).toBe(true);
});

test("heldout qualification binds provider receipt and exact reviewed index", () => {
 const freeze={source_provider_version:"v1.0.0",source_commit:"a",receipt_sha256:"b",source_index_sha256:"c"};
 const pin={provider_version:"v1.0.0",source_commit:"a",receipt_sha256:"b",index:{sha256:"c"}};
 expect(()=>validateQualificationSource(freeze,pin,false)).not.toThrow();
 expect(()=>validateQualificationSource(freeze,{...pin,index:{sha256:"changed"}},false)).toThrow();
 expect(()=>validateQualificationSource(freeze,{...pin,index:{sha256:"changed"}},true)).not.toThrow();
 expect(()=>validateQualificationSource(freeze,{...pin,source_commit:"changed"},true)).toThrow();
});
