// Development measurement of the actual bundled resolver; never held-out qualification.
import { readFile, writeFile } from "node:fs/promises";
import { TerraformDocumentationRepository, terraformHash } from "../../src/internal-urls/terraform-documentation";
import { EMBEDDED_TERRAFORM_DOCUMENTATION } from "../../src/internal-urls/terraform-documentation-assets.generated";
import type { InternalUrl } from "../../src/internal-urls/types";
const args=process.argv.slice(2);
const arg=(key:string)=>args[args.indexOf(key)+1];
const suiteFile=arg("--suite"), output=arg("--output"), cache=arg("--cache");
if(!suiteFile || !output || !cache || !EMBEDDED_TERRAFORM_DOCUMENTATION) throw new Error("Suite, output, cache and bundled assets required");
const bytes=await readFile(suiteFile); const parsed=JSON.parse(bytes.toString());
const cases=parsed.cases ?? parsed;
const repo=new TerraformDocumentationRepository(EMBEDDED_TERRAFORM_DOCUMENTATION,cache);
const cold=performance.now(); await repo.database(); const coldMs=performance.now()-cold;
const read=(uri:string)=>repo.resolve(Object.assign(new URL(uri),{rawHost:"terraform-documentation"}) as InternalUrl);
const results=[]; const timings:number[]=[];
for(const [index,item] of cases.entries()){
 let expectedHash=""; let discovery="",context=""; let destinations:string[]=[]; const times:number[]=[];
 for(let n=0;n<5;n++){
  const before=performance.now();
  discovery=(await read("xcsh://terraform-documentation/?search="+encodeURIComponent(item.prompt))).content;
  destinations=[...discovery.matchAll(/^Read: (\S+)/gm)].map(m=>m[1]!);
  context="";
  if(discovery.includes("Selected leaf;") && destinations[0]) context=(await read(destinations[0])).content;
  if(Buffer.byteLength(discovery)>4096 || Buffer.byteLength(context)>16384) throw new Error("Response bound exceeded");
  const hash=terraformHash(discovery+"\0"+context);
  if(!n)expectedHash=hash; else if(hash!==expectedHash) throw new Error("Non-deterministic response");
  times.push(performance.now()-before);
 }
 timings.push(...times);
 const exact=destinations.map(uri=>uri.replace("?view=context",""));
 const leaf=discovery.includes("Selected leaf;");
 results.push({id:item.id??`development-${index+1}`,kind:item.kind,selection:leaf?"leaf":exact.length?"choices":"none",destinations:exact,correct_leaf:item.kind==="answerable"&&leaf&&exact[0]===item.expected[0],wrong_leaf:item.kind==="answerable"&&leaf&&exact[0]!==item.expected[0],top5:item.expected.some((uri:string)=>exact.slice(0,5).includes(uri)),discovery_bytes:Buffer.byteLength(discovery),context_bytes:Buffer.byteLength(context),response_sha256:expectedHash,times_ms:times});
}
const report={development_only:true,qualification_passed:false,actual_production_resolver:true,provider_version:EMBEDDED_TERRAFORM_DOCUMENTATION.pin.provider_version,source_commit:EMBEDDED_TERRAFORM_DOCUMENTATION.pin.source_commit,index_sha256:EMBEDDED_TERRAFORM_DOCUMENTATION.pin.index.sha256,suite_sha256:terraformHash(bytes),cold_materialization_ms:coldMs,warm_p95_ms:timings.sort((a,b)=>a-b)[Math.ceil(timings.length*.95)-1],answerable:results.filter(r=>r.kind==="answerable").length,correct_leaf:results.filter(r=>r.correct_leaf).length,wrong_leaf:results.filter(r=>r.wrong_leaf).length,ambiguous_leaf:results.filter(r=>r.kind==="ambiguous"&&r.selection==="leaf").length,control_leaf:results.filter(r=>r.kind==="control"&&r.selection==="leaf").length,answerable_top5:results.filter(r=>r.kind==="answerable"&&r.top5).length,limitations:["Development labels only; no independently frozen qualification.","Complete resolver discovery and selected context timed; model/network time excluded.","No compiled installed artifact acceptance."],results};
await writeFile(output,JSON.stringify(report,null,2)+"\n"); console.log(JSON.stringify({...report,results:undefined}));
(await repo.database()).close();
