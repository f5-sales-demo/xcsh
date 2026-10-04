// Development structural peer index; never infers validator requirements from prose.
import type { Database } from "bun:sqlite";
export interface StructuralDestination {
 provider_type:string; provider_name:string; schema_path:string; path:string; anchor:string;
}
export function populateStructuralPeers(db:Database,rows:readonly StructuralDestination[]){
 db.exec(`CREATE TABLE structural_destinations(provider_type TEXT NOT NULL,provider_name TEXT NOT NULL,schema_path TEXT NOT NULL,path TEXT NOT NULL,anchor TEXT NOT NULL,parent_path TEXT NOT NULL,terminal TEXT NOT NULL,depth INTEGER NOT NULL,PRIMARY KEY(provider_type,provider_name,schema_path));
 CREATE INDEX structural_terminal_peers ON structural_destinations(provider_type,provider_name,terminal,schema_path);
 CREATE INDEX structural_parent_peers ON structural_destinations(provider_type,provider_name,parent_path,schema_path);
 CREATE TABLE structural_segments(provider_type TEXT NOT NULL,provider_name TEXT NOT NULL,schema_path TEXT NOT NULL,position INTEGER NOT NULL,segment TEXT NOT NULL,PRIMARY KEY(provider_type,provider_name,schema_path,position));
 CREATE INDEX structural_segment_lookup ON structural_segments(provider_type,provider_name,segment,position,schema_path);`);
 const destination=db.prepare("INSERT INTO structural_destinations VALUES(?,?,?,?,?,?,?,?)");
 const segment=db.prepare("INSERT INTO structural_segments VALUES(?,?,?,?,?)");
 db.transaction(()=>{for(const row of [...rows].sort((a,b)=>a.provider_type.localeCompare(b.provider_type)||a.provider_name.localeCompare(b.provider_name)||a.schema_path.localeCompare(b.schema_path))){
 const parts=row.schema_path.split("."); if(parts.some(part=>!part))throw new Error("Invalid structural schema path");
 destination.run(row.provider_type,row.provider_name,row.schema_path,row.path,row.anchor,parts.slice(0,-1).join("."),parts.at(-1)!,parts.length);
 parts.forEach((part,position)=>segment.run(row.provider_type,row.provider_name,row.schema_path,position,part));
 }})();
}
export function structuralPeers(db:Database,row:StructuralDestination){
 const terminal=row.schema_path.split(".").at(-1)!;
 return db.query("SELECT provider_type,provider_name,schema_path,path,anchor,parent_path,terminal,depth FROM structural_destinations WHERE provider_type=? AND provider_name=? AND terminal=? ORDER BY schema_path").all(row.provider_type,row.provider_name,terminal) as Array<StructuralDestination&{parent_path:string;terminal:string;depth:number}>;
}
export function orderedSegments(db:Database,row:StructuralDestination){
 return (db.query("SELECT segment FROM structural_segments WHERE provider_type=? AND provider_name=? AND schema_path=? ORDER BY position").all(row.provider_type,row.provider_name,row.schema_path) as {segment:string}[]).map(r=>r.segment);
}

export interface StructuralRelationship {
 path:string;anchor:string;type:string;target_path:string;target_anchor:string;enforcement:string;source:string;choice_group:string|null;
}
export function populateStructuralRelationships(db:Database,relationships:readonly StructuralRelationship[]){
 db.exec(`CREATE TABLE structural_relationships(path TEXT NOT NULL,anchor TEXT NOT NULL,type TEXT NOT NULL,target_path TEXT NOT NULL,target_anchor TEXT NOT NULL,enforcement TEXT NOT NULL,source TEXT NOT NULL,choice_group TEXT);
 CREATE INDEX structural_destination_lookup ON structural_destinations(path,anchor);
 CREATE INDEX structural_relationship_lookup ON structural_relationships(path,anchor,type,choice_group);
 CREATE INDEX structural_choice_lookup ON structural_relationships(path,choice_group,target_path,target_anchor);`);
 const exists=db.prepare("SELECT 1 FROM structural_destinations WHERE path=? AND anchor=?");
 const insert=db.prepare("INSERT INTO structural_relationships VALUES(?,?,?,?,?,?,?,?)");
 db.transaction(()=>{for(const r of relationships){
 if(!exists.get(r.path,r.anchor)||!exists.get(r.target_path,r.target_anchor))throw new Error("Missing structural relationship destination");
 insert.run(r.path,r.anchor,r.type,r.target_path,r.target_anchor,r.enforcement,r.source,r.choice_group);
 }})();
}
export function verifiedStructuralRelationships(db:Database,row:StructuralDestination){
 return db.query("SELECT path,anchor,type,target_path,target_anchor,enforcement,source,choice_group FROM structural_relationships WHERE path=? AND anchor=? ORDER BY type,choice_group,target_path,target_anchor").all(row.path,row.anchor) as StructuralRelationship[];
}
