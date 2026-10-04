import {expect,test} from "bun:test";
import {filterSecretRepresentation,requestedSecretRepresentation} from "../../src/internal-urls/terraform-secret-representation";
test("representation filtering stays identical through alternatives hydration",()=>{
 const rows=[{schema_path:"password.clear_secret_info.url"},{schema_path:"password.blindfold_secret_info.location"},{schema_path:"other.value"}];
 const q="Locate the URL for unencrypted secrets";
 expect(filterSecretRepresentation(q,rows)).toEqual([rows[0]]);
 expect(filterSecretRepresentation(q,filterSecretRepresentation(q,rows))).toEqual([rows[0]]);
 expect(rows).toHaveLength(3);
 expect(filterSecretRepresentation(q+"; actually use encrypted ones",rows)).toEqual(rows);
});
test("representation parser preserves later correction and uncertainty",()=>{
 for(const q of ["Locate URL for clear secrets; or encrypted ones","Locate URL for clear secrets; e.g. production","Locate URL while setting value for clear secrets"])expect(requestedSecretRepresentation(q).uncertain).toBe(true);
 expect(requestedSecretRepresentation("Locate URL for clear secrets; no restart required").branch).toBe("clear_secret_info");
});
