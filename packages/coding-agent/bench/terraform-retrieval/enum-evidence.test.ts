import {expect,test} from "bun:test";
import {evaluateEnumValue,validateEnumEvidence,type EnumValidatorEvidence} from "./enum-evidence";
const rule=(values:string[],case_sensitive=true,complete=true):EnumValidatorEvidence=>({version:1,validator:case_sensitive?"OneOf":"OneOfCaseInsensitive",values,case_sensitive,complete,source:"ast-validator:github.com/hashicorp/terraform-plugin-framework-validators/stringvalidator."+(case_sensitive?"OneOf":"OneOfCaseInsensitive")});
test("separate enum validators are conjunctive rather than a union",()=>{
 const evidence=[rule(["A","B"]),rule(["B","C"])];
 expect(evaluateEnumValue("A",evidence,true)).toBe("rejected");expect(evaluateEnumValue("B",evidence,true)).toBe("allowed");expect(evaluateEnumValue("C",evidence,true)).toBe("rejected");
});
test("mixed case rules retain each validator's comparison semantics",()=>{
 const evidence=[rule(["A","B"]),rule(["b","c"],false)];
 expect(evaluateEnumValue("B",evidence,true)).toBe("allowed");expect(evaluateEnumValue("b",evidence,true)).toBe("rejected");expect(evaluateEnumValue("C",evidence,true)).toBe("rejected");
});
test("coverage completeness never overrides an unresolved validator record",()=>{
 const evidence=[rule(["A","B"]),rule([],true,false)];
 expect(evaluateEnumValue("B",evidence,true)).toBe("unresolved");expect(evaluateEnumValue("C",evidence,true)).toBe("rejected");expect(evaluateEnumValue("B",[rule(["A","B"])],false)).toBe("unresolved");expect(evaluateEnumValue("B",[],true)).toBe("unresolved");
});
test("malformed partial and unowned enum evidence cannot become allowed-value proof",()=>{
 const good=rule(["A","B"]);
 for(const change of [{version:2},{complete:"true"},{complete:false},{values:[]},{values:["B","A"]},{values:["A","A"]},{source:"description"},{case_sensitive:false}])expect(()=>validateEnumEvidence([{...good,...change}])).toThrow();
});
