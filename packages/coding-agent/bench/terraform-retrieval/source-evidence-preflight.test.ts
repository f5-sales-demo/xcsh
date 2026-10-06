import { expect,test } from "bun:test";
import { validateModelReadEvidence, validateCaseSourceEvidence, validateSourceEvidenceUri, validateSourceEvidenceBinding } from "./source-evidence-preflight";
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

test("omitted provider needs cross-provider exact and ancestor-path adjudication",()=>{
 const uri="xcsh://terraform-documentation/documentation/resources/other/index.md#schema-name";
 const peer={uri,provider_name:"other",schema_path:"custom.name",description:"Other object name.",markdown:"Other object name."};
 expect(validateCaseSourceEvidence(cases,[evidence],[...source,peer]).some(e=>e.includes("cross-provider"))).toBe(true);
 const explicit=[{...cases[0]!,prompt:"Configure xcsh_fixture managed resource name"}];
 expect(validateCaseSourceEvidence(explicit,[{...evidence,peer_adjudications:[{...evidence.peer_adjudications[0]!,prompt_quote:"managed resource"}]}],[...source,peer])).toEqual([]);
});

test("mandatory model reads must contain evidence beyond headings and navigation",()=>{
 const title={...source[0]!,markdown:"# Fixture\n\nBreadcrumbs:\n- [Root](../index.md)\n- Fixture\n"};
 const c={id:"model",model_expectations:{must_read:[a],required_citation_destinations:[a]}};
 expect(validateModelReadEvidence([c],[title])).toEqual([`model: Mandatory read contains navigation only ${a}`]);
 expect(validateModelReadEvidence([c],source)).toEqual([]);
 expect(validateModelReadEvidence([{...c,model_expectations:{must_read:[a],required_citation_destinations:[b]}}],source)).toEqual([`model: Mandatory citation lacks its own mandatory read ${b}`]);
});

test("same field meaning with a different key still needs source adjudication",()=>{
 const uri="xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-display_name";
 const peer={...source[0]!,uri,schema_path:"display_name"};
 expect(validateCaseSourceEvidence(cases,[evidence],[...source,peer]).some(e=>e.includes("same-meaning"))).toBe(true);
});
test("substantive requirement lists are not navigation-only sections",()=>{
 const c={id:"model",model_expectations:{must_read:[a],required_citation_destinations:[a]}};
 expect(validateModelReadEvidence([c],[{...source[0]!,markdown:"# Requirements\n- The name is required.\n"}])).toEqual([]);
});

test("malformed mandatory evidence lists fail explicitly",()=>{
 const bad={id:"model",model_expectations:{must_read:"invalid" as unknown as string[],required_citation_destinations:[]}};
 expect(validateModelReadEvidence([bad],source)).toEqual(["model: Invalid mandatory read or citation list"]);
 expect(validateModelReadEvidence([{id:"model",model_expectations:{must_read:[a,a]}}],source)).toContain("model: Duplicate mandatory read or citation");
});
