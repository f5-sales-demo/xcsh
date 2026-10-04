// Development consumer contract for typed producer evidence; no metadata pin is changed.
export interface EnumValidatorEvidence {
 version:1;validator:"OneOf"|"OneOfCaseInsensitive";values:string[];
 case_sensitive:boolean;complete:boolean;source:string;
}
const sourcePrefix="ast-validator:github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator.";
export function validateEnumEvidence(value:unknown):EnumValidatorEvidence[]{
 if(!Array.isArray(value))throw new Error("Invalid enum evidence");
 for(const item of value){
  if(!item||typeof item!=="object"||Array.isArray(item)||item.version!==1||!["OneOf","OneOfCaseInsensitive"].includes(item.validator)||typeof item.case_sensitive!=="boolean"||typeof item.complete!=="boolean"||item.case_sensitive!==(item.validator==="OneOf")||item.source!==sourcePrefix+item.validator||!Array.isArray(item.values)||!item.values.every((v:unknown)=>typeof v==="string")||(item.complete?item.values.length===0:item.values.length!==0))throw new Error("Invalid enum evidence");
  for(let i=1;i<item.values.length;i++)if(item.values[i-1]>=item.values[i])throw new Error("Noncanonical enum values");
 }
 return value as EnumValidatorEvidence[];
}
export function evaluateEnumValue(value:string,evidence:readonly EnumValidatorEvidence[],coverageComplete:boolean):"allowed"|"rejected"|"unresolved" {
 const validated=validateEnumEvidence(evidence);
 for(const rule of validated){
  if(!rule.complete)continue;
  const matched=rule.case_sensitive?rule.values.includes(value):rule.values.some(allowed=>allowed.toLowerCase()===value.toLowerCase());
  if(!matched)return "rejected";
 }
 if(!coverageComplete||!validated.length||validated.some(rule=>!rule.complete))return "unresolved";
 return "allowed";
}
