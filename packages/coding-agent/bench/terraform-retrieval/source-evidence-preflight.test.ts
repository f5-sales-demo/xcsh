import { expect,test } from "bun:test";
import { validateCaseSourceEvidence, validateSourceEvidenceUri, validateSourceEvidenceBinding } from "./source-evidence-preflight";
const a="xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name";
const b="xcsh://terraform-documentation/documentation/data-sources/fixture/index.md#schema-name";
const child="xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-namespace";
const source=[{uri:a,provider_name:"fixture",schema_path:"name",description:"Object name.",markdown:"Object name. Required."},{uri:b,provider_name:"fixture",schema_path:"name",description:"Object name.",markdown:"Object name. Computed."},{uri:child,provider_name:"fixture",schema_path:"namespace",description:"Reference namespace.",markdown:"Reference namespace."}];
const cases=[{id:"one",kind:"answerable",prompt:"Configure the managed resource name",expected:[a]}];
const evidence={id:"one",answer_sections:[{uri:a,quote:"Object name."}],peer_adjudications:[{uri:b,disposition:"excluded" as const,reason:"Explicit managed resource role.",prompt_quote:"managed resource",source_quote:"Computed."}]};
test("future freeze evidence requires exact quotes and cross-role peer accounting",()=>{
 expect(validateCaseSourceEvidence(cases,[evidence],source)).toEqual([]);
 expect(validateCaseSourceEvidence(cases,[{...evidence,peer_adjudications:[]}],source).some(e=>e.includes("Unreviewed"))).toBe(true);
 expect(validateCaseSourceEvidence(cases,[{...evidence,answer_sections:[{uri:a,quote:"Reference namespace."}]}],source).some(e=>e.includes("exact-section"))).toBe(true);
});
test("child evidence cannot masquerade as the expected section and missing records fail closed",()=>{
 expect(validateCaseSourceEvidence(cases,[{...evidence,answer_sections:[{uri:child,quote:"Reference namespace."}]}],source).some(e=>e.includes("own evidence"))).toBe(true);
 expect(validateCaseSourceEvidence(cases,[],source)).toContain("Missing source evidence one");
 expect(validateCaseSourceEvidence(cases,[evidence,evidence],source).some(e=>e.includes("duplicate"))).toBe(true);
});
test("permitted or excluded peers must agree with frozen labels",()=>{
 expect(validateCaseSourceEvidence(cases,[{...evidence,peer_adjudications:[{...evidence.peer_adjudications[0]!,disposition:"permitted"}]}],source).some(e=>e.includes("Permitted peer"))).toBe(true);
});

test("source evidence destinations must be canonical and credential-free",()=>{
 expect(validateSourceEvidenceUri(a)).toBe(true);
 for(const uri of [a.replace("/resources/","/resources/../resources/"),a.replace("xcsh://","xcsh://user@"),a.replace("terraform-documentation/","terraform-documentation:9/"),a.replace("#schema-name","?view=context#schema-name")]) expect(validateSourceEvidenceUri(uri)).toBe(false);
});
test("expected ambiguity peers still require reviewed disposition",()=>{
 const c={...cases[0]!,kind:"ambiguous",expected:[a,b]};
 const e={...evidence,answer_sections:[{uri:a,quote:"Object name."},{uri:b,quote:"Object name."}],peer_adjudications:[]};
 expect(validateCaseSourceEvidence([c],[e],source).some(error=>error.includes("Unreviewed same-leaf peer"))).toBe(true);
});

test("qualification source evidence must be bound to an independent v2 review",()=>{
 const freeze={schema_version:2,files:{"case-source-evidence.json":"a"},independent_review_sha256:"b"};
 expect(()=>validateSourceEvidenceBinding(freeze,{source_evidence_sha256:"a"},"a","b")).not.toThrow();
 expect(()=>validateSourceEvidenceBinding({...freeze,schema_version:1},{source_evidence_sha256:"a"},"a","b")).toThrow("schema v2");
 expect(()=>validateSourceEvidenceBinding(freeze,{source_evidence_sha256:"a"},"changed","b")).toThrow("source evidence hash");
 expect(()=>validateSourceEvidenceBinding(freeze,{source_evidence_sha256:"a"},"a","changed")).toThrow("review digest");
 expect(()=>validateSourceEvidenceBinding(freeze,{source_evidence_sha256:"changed"},"a","b")).toThrow("did not bind");
});

 test("internal source freeze binds exact evidence with explicit user waiver",()=>{
 const freeze={schema_version:3,files:{"case-source-evidence.json":"source"},internal_review_sha256:"review",independent_review_waived_by_user:true,retrieval_results_withheld:true};
 expect(()=>validateSourceEvidenceBinding(freeze,{source_evidence_sha256:"source"},"source","review")).not.toThrow();
 expect(()=>validateSourceEvidenceBinding({...freeze,retrieval_results_withheld:false},{source_evidence_sha256:"source"},"source","review")).toThrow();
 expect(()=>validateSourceEvidenceBinding(freeze,{source_evidence_sha256:"other"},"source","review")).toThrow();
 });
