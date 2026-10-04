import {expect,test} from "bun:test";
import {refineRankedProperty} from "../../src/internal-urls/terraform-property-refinement";
const row=(schema_path:string,score:number,extra:any={})=>({provider_type:"resources",provider_name:"fixture",schema_path,path:"page",anchor:"schema-"+schema_path,description:"Documented field.",score,coverage:0.4,...extra});
test("refinement retains actual field score and evidence, then ranks competing destinations",()=>{
 const block=row("connection",90,{anchor:"section",coverage:1});
 const field=row("connection.limit",12,{flags:["optional"],documentation_terms:["maximum","count"]});
 const peer=row("retry.limit",30,{path:"peer"});
 const result=refineRankedProperty([block,peer,field],"page",field.anchor);
 expect(result[0]?.schema_path).toBe("retry.limit");
 expect(result.find(r=>r.schema_path===field.schema_path)).toEqual(field);
 expect(result.some(r=>r.anchor==="section")).toBe(false);
});
test("unretrieved or differently scoped fields cannot borrow block scores",()=>{
 const block=row("connection",90,{anchor:"section"});
 const peer=row("limit",30,{provider_type:"data-sources",path:"page"});
 expect(refineRankedProperty([block,peer],"page",peer.anchor)).toEqual([block,peer]);
 expect(refineRankedProperty([block],"page","schema-connection.limit")).toEqual([block]);
});
test("refinement preserves ties and destination order independently of input order",()=>{
 const block=row("connection",90,{anchor:"section"});
 const field=row("connection.limit",30);
 const peer=row("retry.limit",30,{path:"a-peer"});
 expect(refineRankedProperty([block,field,peer],"page",field.anchor)).toEqual(refineRankedProperty([block,peer,field],"page",field.anchor));
});
