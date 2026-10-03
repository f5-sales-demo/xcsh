import {Database} from "bun:sqlite";
import {readFile,writeFile} from "node:fs/promises";
import {terraformHash} from "../../src/internal-urls/terraform-documentation";
import {validateDevelopmentCases,type DevelopmentCase,type SourceDestination} from "./development-source-validation";
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const index=arg("--index"),suite=arg("--suite"),output=arg("--output");if(!index||!suite||!output)throw new Error("--index --suite --output required");
const bytes=await readFile(suite),payload=JSON.parse(bytes.toString());if(!payload.development_only||payload.qualification_passed!==false)throw new Error("Explicit development-only corpus required");
const db=new Database(index,{readonly:true});const rows=db.query("SELECT t.path,t.anchor,t.provider_type,t.provider_name,t.schema_path,t.description FROM terraform_destinations t ORDER BY provider_type,provider_name,schema_path").all() as any[];
const source:SourceDestination[]=rows.map(row=>({uri:`xcsh://terraform-documentation/${row.path}#${row.anchor}`,depth:row.schema_path?row.schema_path.split(".").length:0,provider_type:row.provider_type,provider_name:row.provider_name,schema_path:row.schema_path,description:row.description}));
const known=new Set(source.map(row=>row.uri));for(const row of db.query("SELECT s.path,s.anchor,d.provider_type,d.provider_name FROM terraform_sections s JOIN terraform_documents d ON d.path=s.path ORDER BY s.path,s.anchor").all() as any[]){const uri=`xcsh://terraform-documentation/${row.path}#${row.anchor}`;if(!known.has(uri)){known.add(uri);source.push({uri,depth:0,provider_type:row.provider_type,provider_name:row.provider_name,schema_path:"",description:""});}}
const cases=payload.cases as DevelopmentCase[],errors=validateDevelopmentCases(cases,source);db.close();
const counts={answerable:cases.filter(c=>c.kind==="answerable").length,ambiguous:cases.filter(c=>c.kind==="ambiguous").length,control:cases.filter(c=>c.kind==="control").length,answerable_depth8:cases.filter(c=>c.kind==="answerable"&&(c.depth??0)>=8).length};
const report={source_only:true,development_only:true,qualification_passed:false,suite_sha256:terraformHash(bytes),index_sha256:terraformHash(await readFile(index)),counts,errors,limitations:["Structural destination/depth/alternative checks only; independent semantic uniqueness and completeness review still required."]};await writeFile(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(errors.length)process.exitCode=1;
