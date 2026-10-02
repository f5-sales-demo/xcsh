import {test,expect} from "bun:test";import {Database} from "bun:sqlite";import {mkdtemp,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";import {buildTerraformIndex,terraformHash,type TerraformDocument,type TerraformPin} from "../../src/internal-urls/terraform-documentation";import {boundedSectionCandidates} from "./bounded-rerank";
test("bounded rerank retains distinct property fields and deterministic destinations",async()=>{
 const root=await mkdtemp(join(tmpdir(),"bounded-section-"));
 const path="documentation/resources/fixture/properties/index.md";
 const body='# Fixture\n\n<a id="schema-port"></a>\n### port\nTLS listener port.\n\n<a id="schema-name"></a>\n### name\nTLS listener name.\n';
 const metadata={id:"fixture",canonical_id:"fixture",path,provider_type:"resources",provider_name:"fixture",role:"reference",schema_path:[],summary:"TLS listener",aliases:[],parent_id:null,child_ids:[]};
 const doc:TerraformDocument={path,body,markdown:body,size_bytes:body.length,sha256:terraformHash(body),body_sha256:terraformHash(body),metadata};
 const pin={schema_version:2,source_root:"documentation",source_repository:"f5-sales-demo/terraform-provider-xcsh",provider_version:"v1.0.0",release_tag:"documentation-v1.0.0",source_commit:"a".repeat(40),receipt_sha256:"b".repeat(64),document_count:1,provider_schema_digest:"sha256:"+"c".repeat(64),spec_pin_digest:"sha256:"+"d".repeat(64),assets:{}} as TerraformPin;
 try {
  await buildTerraformIndex([doc],pin,join(root,"index.sqlite"));
  const db=new Database(join(root,"index.sqlite"),{readonly:true});
  try{
   const rows=boundedSectionCandidates(db,"Configure the TLS listener port in fixture resource");
   expect(rows[0]?.anchor).toBe("schema-port");
   expect(rows.some(row=>row.anchor==="schema-name")).toBe(true);
   expect(boundedSectionCandidates(db,"Configure the TLS listener port in fixture resource").map(row=>row.path+"#"+row.anchor)).toEqual(rows.map(row=>row.path+"#"+row.anchor));
  }finally{db.close();}
 }finally{await rm(root,{recursive:true,force:true});}
});
