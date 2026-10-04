// Development identity parser. Lexical spans retain malformed references and opaque quotations.
export interface IdentityToken {
 text:string; start:number; end:number; quoted:boolean;
 kind:"word"|"boundary"|"symbol"; closed?:boolean; call?:boolean; malformed?:boolean;
}
export function identityTokens(text:string):IdentityToken[]{
 const tokens:IdentityToken[]=[];
 const closes:Record<string,string>={'"':'"',"'":"'","`":"`","‘":"’","“":"”"};
 for(let i=0;i<text.length;){
  if(/\s/u.test(text[i]!)){i++;continue;}
  const start=i, character=text[i]!;
  if(closes[character]){
   const close=closes[character]!;i++;
   while(i<text.length){if(text[i]==="\\"&&i+1<text.length){i+=2;continue;}if(text[i]===close)break;i++;}
   const closed=i<text.length;if(closed)i++;
   tokens.push({text:text.slice(start,i).toLowerCase(),start,end:i,quoted:true,kind:"word",closed});continue;
  }
  if(/[(),;!?]/.test(character)){
   i++;tokens.push({text:character,start,end:i,quoted:false,kind:/[;!?]/.test(character)?"boundary":"symbol"});continue;
  }
  let bracketDepth=0, indexQuote:string|undefined;
  while(i<text.length){
   const c=text[i]!;
   if(indexQuote){if(c==="\\"&&i+1<text.length){i+=2;continue;}if(c===indexQuote)indexQuote=undefined;i++;continue;}
   if(bracketDepth&&["'",'"'].includes(c)){indexQuote=c;i++;continue;}
   if(c==="["){bracketDepth++;i++;continue;}
   if(c==="]"&&bracketDepth){bracketDepth--;i++;continue;}
   if(!bracketDepth&&/\s|[(),;!?"`‘“]/u.test(c))break;
   i++;
  }
  // Consume balanced call arguments as opaque syntax, including quoted indexes and nested calls.
  let callStart=i;while(callStart<text.length&&/\s/.test(text[callStart]!))callStart++;
  let call=false,callClosed=true;
  const atom=text.slice(start,i);
  const callable=callStart===i||/(?:^|[.:])xcsh_/.test(atom);
  if(callable&&text[callStart]==="("&&!(callStart>i&&text.slice(callStart).match(/^\((?:resources?|data[ -]sources?|actions?|ephemeral resources?)\)(?=\s|$)/i))){
   call=true;let depth=1,callQuote:string|undefined;i=callStart+1;
   while(i<text.length&&depth){const c=text[i]!;if(callQuote){if(c==="\\"&&i+1<text.length){i+=2;continue;}if(c===callQuote)callQuote=undefined;}
    else if(c==='"'||c==="'")callQuote=c;else if(c==="(")depth++;else if(c===")")depth--;i++;}
   callClosed=depth===0;
  }
  // A period ending a prose atom is a sentence boundary; periods inside references stay literal.
  let end=i;const terminalPeriod=text[end-1]===".";const terminalColon=text[end-1]===":"&&!text.slice(start,end).includes("::");
  if(terminalPeriod||terminalColon)end--;
  if(end>start)tokens.push({text:text.slice(start,end).toLowerCase(),start,end,quoted:false,kind:"word",call,malformed:bracketDepth!==0||!!indexQuote||!callClosed});
  if(terminalPeriod)tokens.push({text:".",start:end,end:i,quoted:false,kind:"boundary"});
  else if(terminalColon)tokens.push({text:":",start:end,end:i,quoted:false,kind:"symbol"});
 }
 return tokens;
}
export interface ProviderIdentityEvidence {
 name:string;start:number;end:number;
 classification:"provider"|"variable"|"function"|"quoted-value"|"example"|"rejected";
 valid:boolean;
 role?:string; polarity?:"affirmative"|"rejected"; valueContext?:boolean;
}
const roles:Record<string,string>={resource:"resources",resources:"resources",action:"actions",actions:"actions",ephemeral:"ephemeral-resources","data-source":"data-sources","data-sources":"data-sources"};
const commandWords=new Set(["find","locate","inspect","query","read","configure","declare","identify"]);
export function parseProviderIdentity(text:string){
 const tokens=identityTokens(text),identities:ProviderIdentityEvidence[]=[],foundRoles=new Set<string>();
 let phrase:IdentityToken[]=[];
 const wordTexts=()=>phrase.filter(t=>!t.quoted&&t.kind==="word").map(t=>t.text);
 for(let i=0;i<tokens.length;i++){
  const token=tokens[i]!, next=tokens[i+1];
  if(token.kind==="boundary"||(!token.quoted&&token.text==="but")){phrase=[];continue;}
  if(!token.quoted&&commandWords.has(token.text)&&phrase.at(-1)?.text===",")phrase=[];
  const words=wordTexts();
  const negative=words.some((w,n)=>["not","no","never","without","excluding"].includes(w)&&words.slice(n+1).every(t=>["a","an","the","use","using","resource","resources","data","source","sources","data-source","data-sources","action","actions","ephemeral","provider","type","named","called","or","and"].includes(t)||t.startsWith("xcsh_")));
  const example=words.includes("example")||words.some((w,n)=>w==="such"&&words[n+1]==="as")||words.some((w,n)=>w==="for"&&words[n+1]==="instance");
  let raw=token.text;
  if(token.quoted){raw=raw.slice(1,token.closed? -1:undefined).replace(/\\(["'`])/g,"$1");}
  const match=/(?:^|[.:/])xcsh_/.exec(raw);
  if(match){
   const offset=match.index+match[0].length-5;
   const reference=raw.slice(offset),name=reference.slice(5).split(/[.(\[\s]/)[0]!;
   const prefix=raw.slice(0,offset),suffix=reference.slice(5+name.length);
   const valid=/^[a-z][a-z0-9_]*$/.test(name)&&(!suffix||/^(?:\.[a-z][a-z0-9_]*|\[(?:\d+|"[^"\\]*"|'[^'\\]*')\])*$/i.test(suffix))&&!token.malformed&&(!token.quoted||token.closed===true);
   const prefixRole=roles[words.at(-1)??""]??(["source","sources"].includes(words.at(-1)??"")&&words.at(-2)==="data"?"data-sources":undefined);
   const namedRole=["named","called"].includes(words.at(-1)??"")?(roles[words.at(-2)??""]??(["source","sources"].includes(words.at(-2)??"")&&words.at(-3)==="data"?"data-sources":undefined)):undefined;
   const suffixRole=roles[next?.text??""]??(next?.text==="data"&&["source","sources"].includes(tokens[i+2]?.text??"")?"data-sources":undefined);
   const role=prefixRole??namedRole??suffixRole;
   // Value context is a separate phrase property; role words cannot override it.
   const valueContext=words.some(w=>["description","label","value","text"].includes(w))&&!words.some(w=>commandWords.has(w));
   const quotedIdentity=!!role||(!valueContext&&["for","on","in","under"].includes(words.at(-1)??""));
   let classification:ProviderIdentityEvidence["classification"]="provider";
   if(/^(?:env|var|local|module)\./.test(prefix)||(!role&&text.slice(token.start,token.end)===text.slice(token.start,token.end).toUpperCase())||next?.text==="variable"||(next?.text==="environment"&&tokens[i+2]?.text==="variable"))classification="variable";
   else if(token.call||prefix.includes("::")||(next?.text==="("&&next.start===token.end)|| (next?.text==="("&&!/^(?:resource|resources|data|data-source|ephemeral|action|actions)$/.test(tokens[i+2]?.text??"")))classification="function";
   else if(token.quoted&&(valueContext||!quotedIdentity))classification="quoted-value";
   else if(example)classification="example";
   else if(negative)classification="rejected";
   identities.push({name,start:token.start,end:token.end,classification,valid,role,polarity:classification==="rejected"?"rejected":"affirmative",valueContext});
   if(classification==="provider"&&prefix==="data.")foundRoles.add("data-sources");
   if(classification==="provider"&&prefix==="resource.")foundRoles.add("resources");
   if(classification==="provider"&&prefix==="ephemeral.")foundRoles.add("ephemeral-resources");
  }
  if(!token.quoted&&!negative&&!example){
   let role:string|undefined=roles[token.text];
   if(token.text==="data"&&["source","sources"].includes(next?.text??""))role="data-sources";
   if(["resource","resources"].includes(token.text)&&phrase.at(-1)?.text==="ephemeral")role=undefined;
   if(role&&!(role==="actions"&&(["field","attribute","property","value","setting"].includes(next?.text??"")||(!next&&words.some(w=>commandWords.has(w))))))foundRoles.add(role);
  }
  phrase.push(token);
 }
 const nounPhrases=identities.map(i=>({start:i.start,end:i.end,identity:i.name,role:i.role,polarity:i.polarity,valueContext:i.valueContext,classification:i.classification}));
 return {identities,nounPhrases,providerNames:[...new Set(identities.filter(i=>i.classification==="provider").map(i=>i.name))],explicitRole:foundRoles.size===1?[...foundRoles][0]:undefined,conflictingRoles:foundRoles.size>1};
}
