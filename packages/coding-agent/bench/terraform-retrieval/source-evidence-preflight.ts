// Structural evidence checks cannot certify semantic uniqueness or reviewer independence.
export interface EvidenceCase { id: string; kind: string; expected: string[] }
export interface EvidenceDestination { uri: string; provider_name: string; schema_path: string; description: string; markdown: string }
export interface CaseSourceEvidence {
 id: string;
 answer_sections: { uri: string; quote: string }[];
 peer_adjudications: { uri: string; disposition: "permitted" | "excluded"; reason: string; prompt_quote: string; source_quote: string }[];
}
export function validateSourceEvidenceBinding(
 freeze: { schema_version?: number; files?: Record<string,string>; independent_review_sha256?: string; internal_review_sha256?: string; independent_review_waived_by_user?: boolean; retrieval_results_withheld?: boolean },
 review: { source_evidence_sha256?: string },
 evidenceHash: string,
 reviewHash: string,
): void {
 const internal=freeze.schema_version===3;
 if(freeze.schema_version!==2&&!internal) throw new Error("Qualification requires frozen source evidence schema v2 or v3");
 if(internal&&(freeze.independent_review_waived_by_user!==true||freeze.retrieval_results_withheld!==true)) throw new Error("Internal freeze requires user waiver and withheld retrieval results");
 if(freeze.files?.["case-source-evidence.json"]!==evidenceHash) throw new Error("Frozen case source evidence hash mismatch");
 if((internal?freeze.internal_review_sha256:freeze.independent_review_sha256)!==reviewHash) throw new Error("Frozen independent review digest mismatch");
 if(review.source_evidence_sha256!==evidenceHash) throw new Error("Independent reviewer did not bind the case source evidence");
}
export function validateSourceEvidenceUri(uri: string): boolean {
 try {
 const url=new URL(uri);
 return url.protocol === "xcsh:" && url.hostname === "terraform-documentation" && !url.username && !url.password && !url.port && !url.search && Boolean(url.hash) &&
 url.pathname.startsWith("/documentation/") && url.href === uri && !/%|\\|(?:^|\/)\.{1,2}(?:\/|$)/.test(url.pathname);
 } catch {return false;}
}
export function validateCaseSourceEvidence(
 cases: readonly (EvidenceCase & { prompt: string })[],
 evidence: readonly CaseSourceEvidence[],
 source: readonly EvidenceDestination[],
): string[] {
 const errors: string[] = [], seen = new Set<string>();
 const byId = new Map(cases.map(c => [c.id,c]));
 const byUri = new Map(source.map(d => [d.uri,d]));
 for (const record of evidence) {
 const c = byId.get(record.id);
 if (!c || seen.has(record.id)) { errors.push(`Unknown or duplicate evidence case ${record.id}`); continue; }
 seen.add(record.id);
 const fail = (message: string) => errors.push(`${c.id}: ${message}`);
 if (!record.answer_sections?.length) fail("Missing complete answer-section evidence");
 const answerUris = new Set<string>();
 for (const section of record.answer_sections ?? []) {
 const d = byUri.get(section.uri);
 if (!validateSourceEvidenceUri(section.uri) || !d || !section.quote?.trim() || !d.markdown.includes(section.quote)) fail(`Invalid exact-section quote ${section.uri}`);
 answerUris.add(section.uri);
 }
 for (const uri of c.expected) {
 if (!validateSourceEvidenceUri(uri) || !byUri.has(uri)) fail(`Unknown expected destination ${uri}`);
 if (!answerUris.has(uri)) fail(`Expected destination lacks its own evidence ${uri}`);
 }
 const adjudications = new Map<string, CaseSourceEvidence["peer_adjudications"][number]>();
 for (const peer of record.peer_adjudications ?? []) {
 if (adjudications.has(peer.uri)) fail(`Duplicate peer adjudication ${peer.uri}`);
 adjudications.set(peer.uri,peer);
 const d = byUri.get(peer.uri);
 if (!validateSourceEvidenceUri(peer.uri) || !d || !peer.source_quote?.trim() || !d.markdown.includes(peer.source_quote)) fail(`Invalid peer-section quote ${peer.uri}`);
 if (!peer.prompt_quote?.trim() || !c.prompt.includes(peer.prompt_quote)) fail(`Invalid peer prompt quote ${peer.uri}`);
 if (!peer.reason?.trim() || !["permitted","excluded"].includes(peer.disposition)) fail(`Invalid peer disposition ${peer.uri}`);
 if (peer.disposition === "permitted" && !c.expected.includes(peer.uri)) fail(`Permitted peer missing from expected destinations ${peer.uri}`);
 if (peer.disposition === "excluded" && c.expected.includes(peer.uri)) fail(`Expected destination excluded ${peer.uri}`);
 }
 for (const uri of c.expected) {
 const d = byUri.get(uri); if (!d || !d.schema_path) continue;
 const leaf = d.schema_path.split(".").at(-1);
 const explicitProvider=/\bxcsh_[a-z0-9_]+\b/i.test(c.prompt);
 for (const peer of source) {
 if (peer.uri === uri) continue;
 if(peer.uri.split("#")[1]?.startsWith("schema-")&&d.uri.split("#")[1]?.startsWith("schema-")&&peer.provider_name===d.provider_name&&peer.schema_path&&peer.description.trim()&&
 peer.schema_path.split(".").at(-1)!==leaf&&
 peer.description.replace(/\s+/g," ").trim()===d.description.replace(/\s+/g," ").trim()&&!adjudications.has(peer.uri))
 fail(`Unreviewed same-meaning peer ${peer.uri}`);
 const role=(value:string)=>new URL(value).pathname.split("/")[2];
 if(!explicitProvider&&peer.provider_name!==d.provider_name&&role(peer.uri)===role(d.uri)&&
 (peer.schema_path===d.schema_path||peer.schema_path.endsWith(`.${d.schema_path}`))&&!adjudications.has(peer.uri))
 fail(`Unreviewed cross-provider schema peer ${peer.uri}`);
 if (peer.provider_name === d.provider_name && peer.schema_path.split(".").at(-1) === leaf &&
 peer.description.replace(/\s+/g," ").trim() === d.description.replace(/\s+/g," ").trim() && !adjudications.has(peer.uri))
 fail(`Unreviewed same-leaf peer ${peer.uri}`);
 }
 }
 }
 for (const c of cases) if (!seen.has(c.id)) errors.push(`Missing source evidence ${c.id}`);
 return errors;
}

export function validateModelReadEvidence(
 cases: readonly {id:string;model_expectations?:{must_read?:string[];required_citation_destinations?:string[]}}[],
 source: readonly EvidenceDestination[],
):string[]{
 const errors:string[]=[],byUri=new Map(source.map(s=>[s.uri,s]));
 for(const c of cases){
 const reads=c.model_expectations?.must_read??[];
 const citations=c.model_expectations?.required_citation_destinations??[];
 if(!Array.isArray(reads)||!Array.isArray(citations)||reads.some(uri=>typeof uri!=="string")||citations.some(uri=>typeof uri!=="string")){
 errors.push(`${c.id}: Invalid mandatory read or citation list`);continue;
 }
 if(new Set(reads).size!==reads.length||new Set(citations).size!==citations.length)
 errors.push(`${c.id}: Duplicate mandatory read or citation`);
 for(const uri of reads){
 const section=byUri.get(uri);
 if(!validateSourceEvidenceUri(uri)||!section){errors.push(`${c.id}: Unknown mandatory read ${uri}`);continue;}
 const content=section.markdown.replace(/Breadcrumbs:\n(?:\n|[-*] [^\n]*\n)*/g, "");
 const substantive=content.split("\n").filter(line=>{
 const text=line.trim();
 return text&&!text.startsWith("#")&&!/^<[^>]+>$/.test(text)&&text!=="Breadcrumbs:"&&
 !/^[-*] \[[^\]]+\]\([^)]+\)(?:[:;.]?\s*)$/.test(text)&&!/^\[[^\]]+\]\([^)]+\)$/.test(text);
 });
 if(!substantive.length)errors.push(`${c.id}: Mandatory read contains navigation only ${uri}`);
 }
 for(const uri of citations)
 if(!reads.includes(uri))errors.push(`${c.id}: Mandatory citation lacks its own mandatory read ${uri}`);
 }
 return errors;
}
