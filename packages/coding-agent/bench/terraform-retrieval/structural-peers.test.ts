import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {populateStructuralPeers,structuralPeers,orderedSegments,populateStructuralRelationships,verifiedStructuralRelationships} from "./structural-peers";
const row=(schema_path:string,provider_type="resources",provider_name="fixture")=>({provider_type,provider_name,schema_path,path:"documentation/"+provider_type+"/"+provider_name+"/"+schema_path+"/index.md",anchor:"schema-"+schema_path.replaceAll(".","--")});
test("structural peers retain root, nested and reversed paths without conflating provider roles",()=>{
 const db=new Database(":memory:");const rows=[row("namespace"),row("sites.refs.namespace"),row("refs.sites.namespace"),row("sites.refs.namespace","data-sources"),row("sites.refs.namespace","resources","other")];populateStructuralPeers(db,rows);
 expect(structuralPeers(db,rows[0]!).map(r=>r.schema_path)).toEqual(["namespace","refs.sites.namespace","sites.refs.namespace"]);
 expect(orderedSegments(db,rows[1]!)).toEqual(["sites","refs","namespace"]);expect(orderedSegments(db,rows[2]!)).toEqual(["refs","sites","namespace"]);db.close();
});
test("structure is deterministic across insertion order and rejects malformed paths",()=>{
 const rows=[row("a.name"),row("b.name")];const a=new Database(":memory:"),b=new Database(":memory:");populateStructuralPeers(a,rows);populateStructuralPeers(b,rows.toReversed());expect(a.query("SELECT * FROM structural_destinations ORDER BY schema_path").all()).toEqual(b.query("SELECT * FROM structural_destinations ORDER BY schema_path").all());expect(a.query("SELECT * FROM structural_segments ORDER BY schema_path,position").all()).toEqual(b.query("SELECT * FROM structural_segments ORDER BY schema_path,position").all());a.close();b.close();const c=new Database(":memory:");expect(()=>populateStructuralPeers(c,[row("a..name")])).toThrow("Invalid structural");c.close();
});

test("verified choice constraints retain enforcement and reject missing targets atomically",()=>{
 const rows=[row("tls.clear"),row("tls.encrypted")];const relationship={path:rows[0]!.path,anchor:rows[0]!.anchor,type:"choice",target_path:rows[1]!.path,target_anchor:rows[1]!.anchor,enforcement:"provider-choice",source:"pinned-metadata",choice_group:"tls"};const db=new Database(":memory:");populateStructuralPeers(db,rows);populateStructuralRelationships(db,[relationship]);expect(verifiedStructuralRelationships(db,rows[0]!)).toEqual([relationship]);db.close();const bad=new Database(":memory:");populateStructuralPeers(bad,rows);expect(()=>populateStructuralRelationships(bad,[relationship,{...relationship,target_anchor:"absent"}])).toThrow("Missing structural relationship");expect(bad.query("SELECT * FROM structural_relationships").all()).toEqual([]);bad.close();
});
