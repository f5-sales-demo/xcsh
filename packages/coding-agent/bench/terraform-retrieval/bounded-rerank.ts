import {Database} from "bun:sqlite";
import {terraformProviderMention,terraformQueryIdentity,rankTerraformProviderNames} from "../../src/internal-urls/terraform-documentation";
import {terraformSectionTerms,rankTerraformSections} from "./section-ranking";
export function boundedSectionCandidates(db:Database,query:string){
 const role=terraformQueryIdentity(query).providerType;
 const names=(db.query("SELECT DISTINCT provider_name name FROM terraform_documents WHERE (? IS NULL OR provider_type=?)").all(role??null,role??null) as {name:string}[]).map(r=>r.name);
 let provider=terraformProviderMention(query,names);
 if(!provider&&role==="actions"){const ranked=rankTerraformProviderNames(query,names);if(ranked[0]&&(!ranked[1]||ranked[0].score>ranked[1].score))provider=ranked[0].name;}
 const terms=terraformSectionTerms(query).filter(t=>t!=="xcsh");
 if(!terms.length)return [];
 const clauses=["documents_fts MATCH ?","d.active=1"];const args:Array<string|number>=[terms.map(t=>'"'+t+'"*').join(" OR ")];
 if(provider){clauses.push("td.provider_name=?");args.push(provider);}
 if(role){clauses.push("td.provider_type=?");args.push(role);}
 const rows=db.query("SELECT td.path,p.anchor,p.heading,c.doc markdown,td.metadata,ABS(bm25(documents_fts,1.5,4,1)) bm25 FROM documents_fts JOIN documents d ON d.id=documents_fts.rowid JOIN content c ON c.hash=d.hash JOIN terraform_passages p ON p.qmd_path=d.path JOIN terraform_documents td ON td.path=p.path WHERE "+clauses.join(" AND ")+" ORDER BY bm25 DESC,td.path,p.anchor LIMIT 50").all(...args) as Array<{path:string;anchor:string;heading:string;markdown:string;metadata:string;bm25:number}>;
 const candidates=rows.map(row=>{
  const m=JSON.parse(row.metadata);
  const schema_path=row.anchor.startsWith("schema-")?row.anchor.slice(7).replaceAll("--","."):m.schema_path.join(".");
  return {...row,schema_path,description:row.heading+" "+row.markdown};
 });
 return rankTerraformSections(query,candidates).slice(0,5);
}
