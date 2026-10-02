#!/usr/bin/env bun
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { TerraformDocumentationRepository, terraformHash, type TerraformEmbeddedAssets } from "../../src/internal-urls/terraform-documentation";
import type { InternalUrl } from "../../src/internal-urls/types";
import { scoreDestinations } from "./score";

interface Case {id:string;prompt:string;kind:'answerable'|'ambiguous'|'control';expected:string[];match_document?:boolean;behavior?:string;clarification?:string;depth?:number;}
const root=import.meta.dir;
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const assetFile=arg('--assets');if(!assetFile)throw new Error('--assets <JSON> required');
const assets=JSON.parse(await readFile(assetFile,'utf8')) as TerraformEmbeddedAssets;
const suiteFile=arg('--suite')??path.join(root,'heldout.json');
const output=arg('--output')??path.join(root,`qualification-${os.platform()}-${os.arch()}.json`);
const freeze=JSON.parse(await readFile(path.join(path.dirname(suiteFile),'freeze.json'),'utf8'));
const suiteBytes=await readFile(suiteFile);const suiteName=path.basename(suiteFile);
if(terraformHash(suiteBytes)!==freeze.files[suiteName])throw new Error('Frozen qualification suite hash mismatch');
const suite=JSON.parse(suiteBytes.toString()) as Case[];
const cache=arg('--cache')??path.join(os.tmpdir(),`xcsh-terraform-qualification-${terraformHash(suiteBytes).slice(0,12)}`);
const repo=new TerraformDocumentationRepository(assets,cache);
const coldStart=performance.now();await repo.database();const materializationMs=performance.now()-coldStart;
const read=(uri:string)=>repo.resolve(Object.assign(new URL(uri),{rawHost:'terraform-documentation'}) as InternalUrl);
const normalize=(uri:string)=>{const u=new URL(uri);u.search='';return u.href;};
const results=[];
const latency:number[]=[];const contextLatency:number[]=[];const routeLatency:number[]=[];let totalBytes=0;let callCount=0;let maxBytes=0;let maxContextBytes=0;
for(const c of suite){
 const activated=c.behavior!=='ordinary-discovery';
 if(!activated){results.push({id:c.id,passed:null,behavior:c.behavior,requires_model_uat:true});continue;}
 const uri=`xcsh://terraform-documentation/?search=${encodeURIComponent(c.prompt)}`;
 const times=[];let content='';
 for(let repetition=0;repetition<5;repetition++){
  const start=performance.now();const response=await read(uri);times.push(performance.now()-start);content=response.content;latency.push(times.at(-1)!);callCount++;totalBytes+=Buffer.byteLength(response.content);maxBytes=Math.max(maxBytes,Buffer.byteLength(response.content));
  if(Buffer.byteLength(response.content)>4096)throw new Error('Discovery budget violated');
 }
 const destinations=[...content.matchAll(/^Read: (\S+)/gm)].map(m=>normalize(m[1]!));
 const selected=content.includes('Selected leaf;');
 const {rank,top5,matchedExpected,selectionCorrect}=scoreDestinations(c.kind,selected,destinations,c.expected,c.match_document);
 let leafReadBytes:number|null=null;
 if(selected&&destinations[0]){
  const fullUri=new URL(destinations[0]);fullUri.searchParams.set('view','context');
  for(let repetition=0;repetition<5;repetition++){
   const started=performance.now();const section=await read(fullUri.href);const elapsed=performance.now()-started;
   contextLatency.push(elapsed);routeLatency.push(times[repetition]!+elapsed);callCount++;
   leafReadBytes=Buffer.byteLength(section.content);totalBytes+=leafReadBytes;maxContextBytes=Math.max(maxContextBytes,leafReadBytes);
   if(leafReadBytes>16384)throw new Error('Context budget violated');
  }
 }
 if(!selected)routeLatency.push(...times);
 const unsupported=c.behavior==='unsupported';
 const passed=c.kind==='answerable'?selectionCorrect:c.kind==='ambiguous'?selectionCorrect:unsupported?content.includes('No results.'):null;
 results.push({id:c.id,kind:c.kind,passed,top5,rank,matched_expected:matchedExpected,selected,selection_correct:selectionCorrect,destinations,times_ms:times,response_bytes:Buffer.byteLength(content),approx_response_tokens:Math.ceil(Buffer.byteLength(content)/4),leaf_read_bytes:leafReadBytes,requires_model_uat:passed===null});
}
const p95=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*.95)-1]??null;};
const responseLatency=[...latency,...contextLatency];const answerable=results.filter(r=>'kind' in r&&r.kind==='answerable');const scored=results.filter(r=>r.passed!==null);
const report={schema_version:1,source_provider_version:assets.pin.provider_version,source_commit:assets.pin.source_commit,index:assets.pin.index,suite_sha256:terraformHash(suiteBytes),frozen_source_provider_version:freeze.source_provider_version,platform:os.platform(),arch:os.arch(),materialization_ms:materializationMs,warm_p95_ms:p95(responseLatency),discovery_p95_ms:p95(latency),context_p95_ms:p95(contextLatency),route_p95_ms:p95(routeLatency),warm_measurement_count:responseLatency.length,discovery_measurement_count:latency.length,context_measurement_count:contextLatency.length,repetitions:5,model_network_ms:null,model_uat_required:true,max_discovery_bytes:maxBytes,max_context_bytes:maxContextBytes,total_response_bytes:totalBytes,tool_calls:callCount,index_file_bytes:(await stat(assets.indexGzipPath)).size,answerable_accuracy:answerable.filter(r=>r.passed).length/answerable.length,answerable_top5:answerable.filter(r=>'top5' in r&&r.top5).length/answerable.length,scored_accuracy:scored.filter(r=>r.passed).length/scored.length,overall_accuracy:null,qualification_passed:false,results};
await writeFile(output,`${JSON.stringify(report,null,2)}\n`);(await repo.database()).close();
console.log(JSON.stringify({...report,results:undefined}));
