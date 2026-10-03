// Structural source verification supports independent review; it never proves uniqueness.
export interface SourceDestination {uri:string;depth:number;provider_type:string;provider_name:string;schema_path:string;description:string}
export interface DevelopmentCase {id:string;prompt:string;kind:"answerable"|"ambiguous"|"control";expected:string[];depth?:number;source_evidence?:string|string[];alternatives?:{destination:string;excluded_by:string}[];missing_context?:string|null;behavior?:string}
export function validateDevelopmentCases(cases:readonly DevelopmentCase[],source:readonly SourceDestination[]):string[]{
 const errors:string[]=[],ids=new Set<string>(),byUri=new Map(source.map(row=>[row.uri,row]));
 const evidence=(value:unknown)=>typeof value==="string"?value.trim().length>0:Array.isArray(value)&&value.some(x=>typeof x==="string"&&x.trim().length>0);
 for(const item of cases){
  const fail=(message:string)=>errors.push(`${item.id}: ${message}`);
  if(!item.id||ids.has(item.id))fail("duplicate or missing case ID");ids.add(item.id);
  if(!item.prompt?.trim()||!["answerable","ambiguous","control"].includes(item.kind))fail("invalid prompt or kind");
  if(!Array.isArray(item.expected)){fail("invalid expected destinations");continue;}
  if(new Set(item.expected).size!==item.expected.length)fail("duplicate destination");
  for(const uri of item.expected)if(!byUri.has(uri))fail(`unknown destination ${uri}`);
  if(item.kind==="answerable"){
   if(item.expected.length!==1)fail("answerable requires one destination");
   const first=byUri.get(item.expected[0]??"");
   if(first&&item.depth!==first.depth)fail("source schema depth mismatch");
   if(!evidence(item.source_evidence))fail("missing source evidence");
   if(item.missing_context)fail("answerable cannot require missing destination context");
   if(first){const leaf=first.schema_path.split(".").at(-1),desc=first.description.replace(/\s+/g," ").trim();
    for(const other of source){if(other.uri===first.uri||other.provider_name!==first.provider_name||other.schema_path.split(".").at(-1)!==leaf||other.description.replace(/\s+/g," ").trim()!==desc)continue;
     if(!item.alternatives?.some(a=>a.destination===other.uri&&a.excluded_by?.trim()))fail(`missing alternative adjudication ${other.uri}`);
    }
   }
  }else if(item.kind==="ambiguous"){
   if(item.expected.length<2||!item.missing_context?.trim())fail("ambiguous case needs verified alternatives and missing context");
   if(!evidence(item.source_evidence))fail("missing source evidence");
  }else if(!item.behavior?.trim())fail("control requires expected behavior");
  for(const alternative of item.alternatives??[])if(!byUri.has(alternative.destination)||!alternative.excluded_by?.trim())fail("invalid alternative adjudication");
 }
 return errors;
}
