import {Database} from "bun:sqlite";
import {populateAncestorSectionIndex} from "./ancestor-section-index-core";
export {searchAncestorSections} from "./ancestor-section-index-core";
export function buildAncestorSectionIndex(source:Database,output:string):Database {
 const db=new Database(output,{create:true});
 db.exec("CREATE TABLE terraform_destinations(provider_type TEXT,provider_name TEXT,schema_path TEXT,path TEXT,anchor TEXT,description TEXT)");
 const insert=db.prepare("INSERT INTO terraform_destinations VALUES(?,?,?,?,?,?)");
 const rows=source.query("SELECT provider_type,provider_name,schema_path,path,anchor,description FROM terraform_destinations ORDER BY provider_type,provider_name,schema_path").all() as Array<Record<string,string>>;
 db.transaction(()=>{for(const row of rows)insert.run(row.provider_type,row.provider_name,row.schema_path,row.path,row.anchor,row.description);})();
 populateAncestorSectionIndex(db);
 db.exec("PRAGMA journal_mode=DELETE;VACUUM");
 return db;
}
