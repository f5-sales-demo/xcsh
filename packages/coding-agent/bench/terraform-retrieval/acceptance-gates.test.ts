import {expect,test} from "bun:test";
import {evaluateAcceptanceGates} from "./acceptance-gates";
const cases=Array.from({length:200},(_,i)=>({id:`case-${i}`,depth:i<50?8:1,kind:i<140?"answerable":i<180?"ambiguous":"control"}));
const evidence=()=>({cases,source_commit:"a".repeat(40),index_sha256:"b".repeat(64),suite_sha256:"c".repeat(64),heldout_eligible:true,independent_freeze_verified:true,retrieval:{regression:false,results:cases.map(c=>({...c,passed:true,top5:c.kind==="answerable"?true:undefined}))},platforms:["darwin","linux"].map(platform=>({platform,index_sha256:"b".repeat(64),source_commit:"a".repeat(40),suite_sha256:"c".repeat(64),response_parity_verified:true,offline_installed_verified:true,repetitions:5,warm_p95_ms:100,max_discovery_bytes:4096,max_context_bytes:16384})),model:{source_commit:"a".repeat(40),index_sha256:"b".repeat(64),suite_sha256:"c".repeat(64),installed:true,results:[...cases.slice(0,28),...cases.slice(140,148),...cases.slice(180,184)].map(c=>({...c,passed:true,trace_reviewed:true,exact_leaf_read:c.kind==="answerable",citations_verified:true,hcl_fields_verified:true,clarification_verified:true,unsupported_field_claims:0,false_live_apply_claims:0}))}});
test("accuracy aggregation requires all cases and exact installed provenance",()=>{
 expect(evaluateAcceptanceGates(evidence()).passed).toBe(true);expect(evaluateAcceptanceGates(evidence()).qualification_passed).toBe(false);
 const missing=evidence();missing.retrieval.results.pop();expect(evaluateAcceptanceGates(missing).passed).toBe(false);
 const stale=evidence();stale.model.index_sha256="d".repeat(64);expect(evaluateAcceptanceGates(stale).passed).toBe(false);
 const exposed=evidence();exposed.retrieval.regression=true;expect(evaluateAcceptanceGates(exposed).passed).toBe(false);
});
test("threshold does not excuse unsupported claims or missing top-five destinations",()=>{
 const data=evidence();for(let i=0;i<7;i++)data.retrieval.results[i]!.passed=false;expect(evaluateAcceptanceGates(data).passed).toBe(true);
 data.retrieval.results[7]!.passed=false;expect(evaluateAcceptanceGates(data).passed).toBe(false);
 const top=evidence();top.retrieval.results[0]!.top5=false;expect(evaluateAcceptanceGates(top).passed).toBe(false);
 const claim=evidence();claim.model.results[0]!.unsupported_field_claims=1;expect(evaluateAcceptanceGates(claim).passed).toBe(false);
 const latency=evidence();latency.platforms[0]!.warm_p95_ms=150.001;expect(evaluateAcceptanceGates(latency).passed).toBe(false);
});

test("missing claims evidence, depth coverage, and malformed latency never pass",()=>{
 const shallow=evidence();for(const c of shallow.cases)c.depth=1;expect(evaluateAcceptanceGates(shallow).passed).toBe(false);
 const latency=evidence();latency.platforms[0]!.warm_p95_ms=Number.NaN;expect(evaluateAcceptanceGates(latency).passed).toBe(false);
 const offline=evidence();offline.platforms[0]!.offline_installed_verified=false;expect(evaluateAcceptanceGates(offline).passed).toBe(false);
 const model=evidence();model.model.results[0]!.trace_reviewed=false;expect(evaluateAcceptanceGates(model).passed).toBe(false);
});
