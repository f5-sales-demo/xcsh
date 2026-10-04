import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {populateStructuralPeers,structuralPeers,orderedSegments,populateStructuralRelationships,verifiedStructuralRelationships,filterStructuralDestinations} from "./structural-peers";
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

test("advisory prose cannot become a schema prerequisite or provider choice",()=>{
 for(const [type,enforcement] of [["requires","upstream-advisory"],["advisory","provider-schema"],["requires","provider-choice"]]){const a=row("a.name"),b=row("b.name"),db=new Database(":memory:");populateStructuralPeers(db,[a,b]);expect(()=>populateStructuralRelationships(db,[{path:a.path,anchor:a.anchor,type:type!,target_path:b.path,target_anchor:b.anchor,enforcement:enforcement!,source:"pinned",choice_group:null}])).toThrow("Invalid structural relationship enforcement");db.close();}
});

const binding=(parent:string[],segment:string|null)=>({parent,segment,polarity:"positive" as const,querySpan:[0,10] as [number,number],source:"explicit reviewed query span"});
test("every independent fork remains unresolved until bound evidence identifies it",()=>{
 const rows=[row("primary.ipv4.address"),row("primary.ipv6.address"),row("secondary.ipv4.address"),row("secondary.ipv6.address")];
 expect(filterStructuralDestinations(rows,[binding([],"primary")]).kind).toBe("choices");expect(filterStructuralDestinations(rows,[binding([],"primary"),binding(["primary"],"ipv6")]).destinations).toEqual([rows[1]!]);expect(filterStructuralDestinations(rows,[binding(["primary"],"ipv4"),binding(["primary"],"ipv6")]).kind).toBe("choices");
});
test("terminal end markers distinguish root fields from descendants",()=>{
 const rows=[row("namespace"),row("attachments.target.namespace")];expect(filterStructuralDestinations(rows,[]).kind).toBe("choices");expect(filterStructuralDestinations(rows,[binding([],"attachments"),binding(["attachments"],"target")]).destinations).toEqual([rows[1]!]);expect(filterStructuralDestinations(rows,[binding([],"namespace"),binding(["namespace"],null)]).destinations).toEqual([rows[0]!]);
});
test("ordered bindings disambiguate reversed paths while unbound words cannot",()=>{
 const rows=[row("source.destination.name"),row("destination.source.name")];expect(filterStructuralDestinations(rows,[]).kind).toBe("choices");expect(filterStructuralDestinations(rows,[binding([],"source"),binding(["source"],"destination")]).destinations).toEqual([rows[0]!]);
});
test("ancestor descriptions do not select a different leaf",()=>{
 const rows=[row("router.timeout"),row("router.interface_ip_map")];expect(filterStructuralDestinations(rows,[binding([],"router")]).kind).toBe("choices");expect(filterStructuralDestinations(rows,[binding(["router"],"interface_ip_map")]).destinations).toEqual([rows[1]!]);
});
