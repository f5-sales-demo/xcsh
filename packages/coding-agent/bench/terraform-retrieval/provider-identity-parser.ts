// Development parser: preserve spans and classify identities before retrieval.
export interface IdentityToken {text:string;start:number;end:number;quoted:boolean;kind:"word"|"boundary"|"symbol";}
export function identityTokens(text:string):IdentityToken[]{
 const tokens:IdentityToken[]=[];let quote:string|undefined;
 for(const m of text.matchAll(/[a-z0-9_-]+|[^\s]/gi)){const value=m[0],start=m.index!;
 if(["\"","\x27","`","‘","’","“","”"].includes(value)){if(quote){if(value===quote)quote=undefined;}else if(!(value==="\x27"&&/[a-z]/i.test(text[start-1]??"")&&/[a-z]/i.test(text[start+1]??"")))quote=value==="‘"?"’":value==="“"?"”":value;tokens.push({text:value,start,end:start+value.length,quoted:true,kind:"symbol"});continue;}
 tokens.push({text:value.toLowerCase(),start,end:start+value.length,quoted:!!quote,kind:/^[a-z0-9_-]+$/i.test(value)?"word":/[;!?]/.test(value)||(value==="."&&(start+1===text.length||/\s/.test(text[start+1]??"")))?"boundary":"symbol"});}
 return tokens;
}
export interface ProviderIdentityEvidence {name:string;start:number;end:number;classification:"provider"|"variable"|"function"|"quoted-value"|"example"|"rejected";valid:boolean;}
export function parseProviderIdentity(text:string){
 const tokens=identityTokens(text);const identities:ProviderIdentityEvidence[]=[];const roles=new Set<string>();
 const clauseBefore=(i:number)=>{let begin=i;while(begin>0&&tokens[begin-1]!.kind!=="boundary"&&tokens[begin-1]!.text!=="but")begin--;return tokens.slice(begin,i);};
 for(let i=0;i<tokens.length;i++){
 const t=tokens[i]!,before=clauseBefore(i),words=before.filter(x=>x.kind==="word").map(x=>x.text),next=tokens[i+1];
 const immediateNegative=words.at(-1)==="not"||words.at(-1)==="no"||words.at(-1)==="without"||words.at(-1)==="excluding"||words.slice(-3).join(" ")==="do not use";
 const example=words.includes("example")||words.slice(-2).join(" ")==="such as"||words.slice(-2).join(" ")==="for instance";
 const quotedValue=t.quoted&&words.some(w=>["description","label","value","text"].includes(w));
 if(t.text.startsWith("xcsh_")){
 let classification:ProviderIdentityEvidence["classification"]="provider";
 if((next?.text==="environment"&&tokens[i+2]?.text==="variable")||next?.text==="variable")classification="variable";
 else if(before.at(-1)?.text==="."&&["env","var","local","module"].includes(before.at(-2)?.text??""))classification="variable";
 else if(next?.text==="("&&!(tokens[i+2]?.text==="resource"&&tokens[i+3]?.text===")"))classification="function";
 else if(text.slice(t.start,t.end)===text.slice(t.start,t.end).toUpperCase())classification="variable";
 else if(quotedValue)classification="quoted-value";
 else if(example)classification="example";
 else if(immediateNegative)classification="rejected";
 const name=t.text.slice(5);identities.push({name,start:t.start,end:t.end,classification,valid:/^[a-z][a-z0-9_]*$/.test(name)});
 }
 if(t.quoted||immediateNegative||example)continue;
 let role:string|undefined;
 if(t.text==="data"&&(next?.text==="source"||(next?.text==="."&&tokens[i+2]?.text.startsWith("xcsh_"))))role="data-sources";
 else if(t.text==="data-source")role="data-sources";
 else if(t.text==="ephemeral")role="ephemeral-resources";
 else if(t.text==="resource"&&tokens[i-1]?.text!=="ephemeral")role="resources";
 else if(t.text==="action")role="actions";
 const negativeRole=words.at(-2)==="not"&&["a","an","the"].includes(words.at(-1)??"");
 if(role&&!negativeRole)roles.add(role);
 }
 return {identities,providerNames:[...new Set(identities.filter(i=>i.classification==="provider").map(i=>i.name))],explicitRole:roles.size===1?[...roles][0]:undefined,conflictingRoles:roles.size>1};
}
