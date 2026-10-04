import {expect,test} from "bun:test";
import {selectPropertyDestination} from "../../src/internal-urls/terraform-property-selection";
const row=(schema_path:string,score:number,description="Listening port.")=>({provider_type:"resources",provider_name:"fixture",schema_path,path:schema_path,anchor:"schema-"+schema_path.replaceAll(".","--"),description,score,coverage:0.8});
test("selection keeps term ordering isolated across candidates and requests",()=>{
 const a=row("beta.port",40),b=row("alpha.port",39);
 const rows=[a,b];
 const before=structuredClone(rows);
 const first=selectPropertyDestination("Locate beta port",rows);
 const alpha=selectPropertyDestination("Locate alpha port",rows);
 expect(selectPropertyDestination("Locate alpha port",[...rows])).toEqual(alpha);
 expect(selectPropertyDestination("Locate beta port",rows)).toEqual(first);
 expect(rows).toEqual(before);
 expect(selectPropertyDestination("Locate beta port",[b,a])).toEqual(first);
});
test("eligible role peers beyond the response limit retain ambiguity",()=>{
 const first=row("connection.port",40);
 const noise=Array.from({length:5},(_,i)=>row("noise"+i+".value",30-i,"Opaque value."));
 const peer={...first,provider_type:"data-sources",path:"data",score:1};
 const result=selectPropertyDestination("Locate connection port",[first,...noise,peer],[],{identityResolved:false});
 expect(result.kind).toBe("choices");
 
});
