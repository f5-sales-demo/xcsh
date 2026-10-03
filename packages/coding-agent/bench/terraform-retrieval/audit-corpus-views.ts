// Reproducible source-corpus view audit; never retrieval or installed-model qualification.
import {readFile,writeFile} from "node:fs/promises";
import {TerraformDocumentationRepository,type TerraformEmbeddedAssets} from "../../src/internal-urls/terraform-documentation";
import type {InternalUrl} from "../../src/internal-urls/types";
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const assetFile=arg("--assets"),output=arg("--output"),cache=arg("--cache");
if(!assetFile||!output||!cache)throw new Error("--assets --output --cache required");
const assets=JSON.parse(await readFile(assetFile,"utf8")) as TerraformEmbeddedAssets;
const repo=new TerraformDocumentationRepository(assets,cache),db=await repo.database();
const rows=db.query("SELECT path FROM terraform_documents ORDER BY path").all() as {path:string}[];
const read=(uri:string)=>repo.resolve(Object.assign(new URL(uri),{rawHost:"terraform-documentation"}) as InternalUrl);
let hints=0,contexts=0,maxHint=0,maxContext=0,continuations=0,fullReads=0,oversizedReads=0;
const failures:{path:string;error:string}[]=[],begin=performance.now();
try {for(const row of rows){try{
 const base=`xcsh://terraform-documentation/${row.path}`;
 const hint=await read(`${base}?view=hint`),hintBytes=Buffer.byteLength(hint.content);
 if(hintBytes>4096)throw new Error("Hint budget exceeded");maxHint=Math.max(maxHint,hintBytes);hints++;
 let next=`${base}?view=context`;const visited=new Set<string>();
 while(next){if(visited.has(next))throw new Error("Continuation loop");visited.add(next);
 const result=await read(next),bytes=Buffer.byteLength(result.content);if(bytes>16384)throw new Error("Context budget exceeded");maxContext=Math.max(maxContext,bytes);contexts++;
 for(const match of result.content.matchAll(/^Full:\s*(xcsh:\/\/\S+)/gm)){const full=await read(match[1]!);if(!full.content.trim())throw new Error("Empty full read");fullReads++;}
 for(const match of result.content.matchAll(/Oversized section:[^\n]*Complete section:\s*(xcsh:\/\/\S+)/g)){const full=await read(match[1]!);if(!full.content.trim())throw new Error("Empty oversized section read");oversizedReads++;}
 next=result.content.match(/^Continue:\s*(xcsh:\/\/\S+)/m)?.[1]??"";
 if(next){const url=new URL(next);if(url.hostname!=="terraform-documentation"||url.pathname!==new URL(base).pathname||url.searchParams.get("view")!=="context")throw new Error("Continuation escaped document context");continuations++;}
 }
 }catch(error){failures.push({path:row.path,error:String(error)});}}}
finally{db.close();}
const report={source_only:true,qualification_passed:false,provider_version:assets.pin.provider_version,index_sha256:assets.pin.index?.sha256,documents:rows.length,hints,contexts,max_hint_bytes:maxHint,max_context_bytes:maxContext,continuations,full_reads:fullReads,oversized_full_reads:oversizedReads,elapsed_ms:performance.now()-begin,failures,limitations:["Source corpus views and full-read destinations only; no semantic accuracy or installed-model acceptance.","Repeated full reads counted per context response."]};
await writeFile(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(failures.length)process.exitCode=1;
