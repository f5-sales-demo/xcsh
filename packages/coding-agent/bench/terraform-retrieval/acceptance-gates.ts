// Evidence aggregation is never authority to merge; every receipt must be independently verified.
interface Case {id:string;kind:string;depth?:number}
interface ModelResult extends Case {passed:boolean;trace_reviewed:boolean;exact_leaf_read:boolean;citations_verified:boolean;hcl_fields_verified:boolean;clarification_verified:boolean;unsupported_field_claims:number;false_live_apply_claims:number}
export interface AcceptanceEvidence {
 cases:Case[];source_commit:string;index_sha256:string;suite_sha256:string;heldout_eligible:boolean;independent_freeze_verified:boolean;internal_freeze?:{verified:boolean;user_waived_independent_review:boolean;retrieval_results_withheld:boolean};
 retrieval:{regression:boolean;results:(Case&{passed:boolean|null;top5?:boolean})[]};
 platforms:{platform:string;index_sha256:string;source_commit:string;suite_sha256:string;response_parity_verified:boolean;offline_installed_verified:boolean;repetitions:number;warm_p95_ms:number;max_discovery_bytes:number;max_context_bytes:number}[];
 model:{source_commit:string;index_sha256:string;suite_sha256:string;installed:boolean;results:ModelResult[]};
}
export function evaluateAcceptanceGates(e:AcceptanceEvidence){
 const failures:string[]=[],fail=(condition:boolean,message:string)=>{if(!condition)failures.push(message)};
 const counts=(rows:Case[])=>["answerable","ambiguous","control"].map(kind=>rows.filter(row=>row.kind===kind).length);
 fail(e.cases.length===200&&JSON.stringify(counts(e.cases))===JSON.stringify([140,40,20]),"Suite composition must be140/40/20");
 fail(new Set(e.cases.map(c=>c.id)).size===200,"Duplicate or missing suite IDs");
 fail(e.cases.filter(c=>c.kind==="answerable"&&(c.depth??0)>=8).length>=50,"At least50answerable cases must reach depth8");
 const internal=e.internal_freeze;
 fail(e.heldout_eligible&&(e.independent_freeze_verified||(internal?.verified===true&&internal.user_waived_independent_review===true&&internal.retrieval_results_withheld===true))&&!e.retrieval.regression,"Verified untouched held-out eligibility required");
 const expected=new Map(e.cases.map(c=>[c.id,c.kind])),results=e.retrieval.results;
 fail(results.length===200&&new Set(results.map(c=>c.id)).size===200&&results.every(c=>expected.get(c.id)===c.kind),"Complete200retrieval outcomes required");
 const answerable=results.filter(c=>c.kind==="answerable");
 const overall=results.filter(c=>c.passed===true).length/200,accuracy=answerable.filter(c=>c.passed===true).length/140;
 fail(overall>=0.95,"Overall accuracy below95percent");fail(accuracy>=0.95,"Answerable accuracy below95percent");fail(answerable.length===140&&answerable.every(c=>c.top5===true),"Every answerable destination must be top-five");
 fail(e.platforms.length===2&&new Set(e.platforms.map(p=>p.platform)).size===2&&e.platforms.some(p=>p.platform==="darwin")&&e.platforms.some(p=>p.platform==="linux"),"Mac and Ubuntu evidence required");
 for(const p of e.platforms){fail(p.index_sha256===e.index_sha256&&p.source_commit===e.source_commit&&p.suite_sha256===e.suite_sha256,`${p.platform}: provenance mismatch`);fail(p.response_parity_verified&&p.offline_installed_verified&&p.repetitions===5,`${p.platform}: installed offline parity/five repetitions required`);fail(Number.isFinite(p.warm_p95_ms)&&p.warm_p95_ms>=0&&p.warm_p95_ms<=150,`${p.platform}: latency gate failed`);fail(p.max_discovery_bytes<=4096&&p.max_context_bytes<=16384,`${p.platform}: response budget exceeded`);}
 const m=e.model;fail(m.installed&&m.source_commit===e.source_commit&&m.index_sha256===e.index_sha256&&m.suite_sha256===e.suite_sha256,"Installed model provenance mismatch");
 fail(m.results.length===40&&new Set(m.results.map(c=>c.id)).size===40&&JSON.stringify(counts(m.results))===JSON.stringify([28,8,4])&&m.results.every(c=>expected.get(c.id)===c.kind),"Installed model subset must be28/8/4");
 for(const c of m.results){fail(c.passed&&c.trace_reviewed&&c.citations_verified&&c.hcl_fields_verified&&(c.kind!=="answerable"||c.exact_leaf_read)&&(c.kind!=="ambiguous"||c.clarification_verified),`${c.id}: installed content/trace review failed`);fail(c.unsupported_field_claims===0&&c.false_live_apply_claims===0,`${c.id}: unsupported or false live-apply claim`);}
 return {benchmark_review_mode:e.independent_freeze_verified?"independent":"internal-user-waived",passed:failures.length===0,qualification_passed:false,overall_accuracy:overall,answerable_accuracy:accuracy,failures,limitations:["Accuracy/latency aggregation only; supplied receipt fields are untrusted until exact frozen bytes,digests,traces and installed binaries are verified. Archive/hash failure coverage,complete view/navigation tests,startup/index size metrics and publication/install acceptance remain separate mandatory gates."]};
}
