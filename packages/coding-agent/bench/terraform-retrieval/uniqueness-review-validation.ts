// Quote checks prove cited evidence exists, not that the reasoning establishes uniqueness.
export interface ReviewCase {id:string;prompt:string;expected:string[]}
export interface UniquenessReview {id:string;verdict:string;expected:string[];missing_context?:string|null;source_evidence:string|string[];alternatives:{destination:string;prompt_quote:string;source_quote:string;reason:string}[]}
const normalize=(text:string)=>text.replace(/\s+/g," ").trim().toLowerCase();
export function validateUniquenessReview(cases:readonly ReviewCase[],reviews:readonly UniquenessReview[],sections:ReadonlyMap<string,string>):string[]{
 const errors:string[]=[],byId=new Map(cases.map(c=>[c.id,c])),seen=new Set<string>();
 for(const review of reviews){const c=byId.get(review.id);if(!c){errors.push(`Unknown review case ${review.id}`);continue;}if(seen.has(review.id))errors.push(`Duplicate review ${review.id}`);seen.add(review.id);const fail=(msg:string)=>errors.push(`${review.id}: ${msg}`);
 if(!["valid","ambiguous","invalid"].includes(review.verdict))fail("unknown verdict");
 for(const uri of review.expected)if(!sections.has(uri))fail(`unknown destination ${uri}`);
 if(review.verdict==="valid"){
 if(JSON.stringify([...review.expected].sort())!==JSON.stringify([...c.expected].sort()))fail("valid review changed expected destination");
 if(review.missing_context?.trim())fail("valid review has missing context");
 if(!(Array.isArray(review.source_evidence)?review.source_evidence.some(x=>x.trim()):review.source_evidence?.trim()))fail("missing source evidence");
 }
 if(review.verdict==="ambiguous"&&(review.expected.length<2||!review.missing_context?.trim()))fail("ambiguous review needs alternatives and missing context");
 for(const alt of review.alternatives??[]){const source=sections.get(alt.destination);if(source===undefined)fail(`unknown alternative ${alt.destination}`);if(!alt.prompt_quote?.trim()||!normalize(c.prompt).includes(normalize(alt.prompt_quote)))fail(`invented prompt quote ${alt.destination}`);if(!alt.source_quote?.trim()||source!==undefined&&!normalize(source).includes(normalize(alt.source_quote)))fail(`invented source quote ${alt.destination}`);if(!alt.reason?.trim())fail("missing exclusion reason");}
 }
 for(const c of cases)if(!seen.has(c.id))errors.push(`Missing review ${c.id}`);
 return errors;
}
