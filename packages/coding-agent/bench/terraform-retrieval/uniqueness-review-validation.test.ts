import {expect,test} from "bun:test";
import {validateUniquenessReview} from "./uniqueness-review-validation";
const target="xcsh://terraform-documentation/documentation/resources/fixture/index.md#schema-name";
const peer="xcsh://terraform-documentation/documentation/data-sources/fixture/index.md#schema-name";
const cases=[{id:"case-1",prompt:"Read the managed resource name",expected:[target]}];
const sections=new Map([[target,"Name of the managed resource."],[peer,"Name of the existing resource."]]);
const item={id:"case-1",verdict:"valid",expected:[target],missing_context:null,source_evidence:"Name of the managed resource.",alternatives:[{destination:peer,prompt_quote:"managed resource",source_quote:"existing resource",reason:"Explicit role excludes a data source."}]};
test("source review requires actual prompt and destination section quotes",()=>{
 expect(validateUniquenessReview(cases,[item],sections)).toEqual([]);
 expect(validateUniquenessReview(cases,[{...item,alternatives:[{...item.alternatives[0]!,prompt_quote:"stateless service"}]}],sections).some(x=>x.includes("prompt quote"))).toBe(true);
 expect(validateUniquenessReview(cases,[{...item,alternatives:[{...item.alternatives[0]!,source_quote:"unseen source words"}]}],sections).some(x=>x.includes("source quote"))).toBe(true);
});
test("invalid duplicate and incomplete reviews cannot certify a corpus",()=>{
 expect(validateUniquenessReview(cases,[],sections).some(x=>x.includes("Missing"))).toBe(true);
 expect(validateUniquenessReview(cases,[item,item],sections).some(x=>x.includes("Duplicate"))).toBe(true);
 expect(validateUniquenessReview(cases,[{...item,expected:[peer]}],sections).some(x=>x.includes("changed"))).toBe(true);
 expect(validateUniquenessReview(cases,[{...item,missing_context:"Need role"}],sections).some(x=>x.includes("missing context"))).toBe(true);
});
