import {test,expect} from "bun:test";import {Database} from "bun:sqlite";import {mkdtemp,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join} from "node:path";import {buildAncestorSectionIndex,searchAncestorSections} from "./ancestor-section-index";
test("ancestor section index ranks parent context while preserving role and exact anchor",async()=>{
 const root=await mkdtemp(join(tmpdir(),"terraform-section-"));
 const source=new Database(":memory:");
 source.exec("CREATE TABLE terraform_destinations(provider_type TEXT,provider_name TEXT,schema_path TEXT,path TEXT,anchor TEXT,description TEXT)");
 const insert=source.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 insert.run("resources","fixture","backend","backend","section","Public backend servers");
 insert.run("resources","fixture","backend.ip","backend","schema-backend--ip","Address");
 insert.run("resources","fixture","private","private","section","Private backend servers");
 insert.run("resources","fixture","private.ip","private","schema-private--ip","Address");
 insert.run("data-sources","fixture","backend.ip","data","schema-backend--ip","Address");
 const db=buildAncestorSectionIndex(source,join(root,"index.sqlite"));
 const second=buildAncestorSectionIndex(source,join(root,"second.sqlite"));second.close();
 expect(await Bun.file(join(root,"index.sqlite")).bytes()).toEqual(await Bun.file(join(root,"second.sqlite")).bytes());

 try{
  const rows=searchAncestorSections(db,"public backend IP address","fixture","resources");
  expect(rows[0]?.anchor).toBe("schema-backend--ip");
  expect(rows.every(r=>r.provider_type==="resources")).toBe(true);
  expect(searchAncestorSections(db,"unknown_word",undefined,undefined)).toEqual([]);
 }finally{db.close();source.close();await rm(root,{recursive:true,force:true});}
});
