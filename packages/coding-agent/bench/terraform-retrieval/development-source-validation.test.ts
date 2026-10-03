import {expect,test} from "bun:test";
import {validateDevelopmentCases} from "./development-source-validation";
const uri="xcsh://terraform-documentation/documentation/resources/fixture/properties/index.md#schema-name";
const destinations=[{uri,depth:1,provider_type:"resources",provider_name:"fixture",schema_path:"name",description:"Name."},{uri:uri.replace("resources/","data-sources/"),depth:1,provider_type:"data-sources",provider_name:"fixture",schema_path:"name",description:"Name."}];
const candidate={id:"dev-1",prompt:"Read resource name",kind:"answerable" as const,expected:[uri],depth:1,source_evidence:"Name.",alternatives:[{destination:destinations[1]!.uri,excluded_by:"The user explicitly requests a managed resource."}],missing_context:null};
test("source validation requires real destinations, depth and alternative adjudication",()=>{
 expect(validateDevelopmentCases([candidate],destinations)).toEqual([]);
 expect(validateDevelopmentCases([{...candidate,depth:9}],destinations).some(x=>x.includes("depth"))).toBe(true);
 expect(validateDevelopmentCases([{...candidate,expected:[uri.replace("schema-name","fabricated")]}],destinations).some(x=>x.includes("destination"))).toBe(true);
 expect(validateDevelopmentCases([{...candidate,alternatives:[]}],destinations).some(x=>x.includes("alternative"))).toBe(true);
});
test("ambiguous cases need multiple verified destinations and missing context",()=>{
 const ambiguous={...candidate,kind:"ambiguous" as const,expected:destinations.map(d=>d.uri),missing_context:"Provider role",alternatives:[]};
 expect(validateDevelopmentCases([ambiguous],destinations)).toEqual([]);
 expect(validateDevelopmentCases([{...ambiguous,expected:[uri]}],destinations).some(x=>x.includes("ambiguous"))).toBe(true);
 expect(validateDevelopmentCases([candidate,candidate],destinations).some(x=>x.includes("duplicate"))).toBe(true);
});

test("same-role alternatives cannot be excluded by invented resource intent",()=>{
 const data=destinations[1]!;const peer={...data,uri:data.uri.replace("schema-name","schema-peer"),schema_path:"peer.name"};
 const item={...candidate,prompt:"Read the name via data.xcsh_fixture data source",expected:[data.uri],alternatives:[{destination:uri,excluded_by:"The user requests a data source, not a resource."},{destination:peer.uri,excluded_by:"Prompt explicitly configures a managed resource, not querying a data source."}]};
 expect(validateDevelopmentCases([item],[...destinations,peer]).some(error=>error.includes("contradictory role exclusion"))).toBe(true);
});
