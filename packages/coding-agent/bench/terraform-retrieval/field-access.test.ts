import {expect,test} from "bun:test";
import {requestedFieldAccess,matchesFieldAccess} from "./field-access";
const row=(flags:string[])=>({provider_type:"data-sources",provider_name:"fixture",schema_path:"value",path:"fixture",anchor:"schema-value",description:"Value",flags});
test("field access follows schema flags including optional computed attributes",()=>{expect(matchesFieldAccess(row(["computed"]),"input")).toBe(false);expect(matchesFieldAccess(row(["optional","computed"]),"input")).toBe(true);expect(matchesFieldAccess(row(["optional","computed"]),"output")).toBe(true);expect(matchesFieldAccess(row(["required"]),"output")).toBe(false);expect(matchesFieldAccess(row([]),"input")).toBe(true);});
test("alternative negative and quoted access labels remain unresolved",()=>{expect(requestedFieldAccess("Find the input that restricts regions")).toBe("input");expect(requestedFieldAccess("Find the output showing the source digest")).toBe("output");for(const q of ["input or output","not an input","either input","example output","\"output\" attribute","input and output"]){expect(requestedFieldAccess(q)).toBeUndefined();}});

test("input mentioned as payload content does not imply a configurable field",()=>{expect(requestedFieldAccess("Find the regex list matching successful response input")).toBeUndefined();expect(requestedFieldAccess("Locate an input argument for the configured region")).toBe("input");});

test("example payload terminology does not create access evidence",()=>{for(const q of ["For example locate the input argument","Find the output field such as payload","Locate the output field called input","Find the input field as an example"]){expect(requestedFieldAccess(q)).toBeUndefined();}});

test("access requests preserve sentence literals and reject payload and ambiguous labels",()=>{for(const q of ["Find the input payload regex","Find input and output fields","e.g. locate the output field","Don’t locate the output field","\"Illustration. Locate the output field. End\"","Locate output.field"]){expect(requestedFieldAccess(q)).toBeUndefined();}expect(requestedFieldAccess("Locate the input field `regions`")).toBe("input");});
