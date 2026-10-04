import { Database } from "bun:sqlite";
import { TerraformDocumentationRepository, terraformProviderMention, terraformQueryIdentity } from "../../src/internal-urls/terraform-documentation";
import { searchPropertyIndex } from "../../src/internal-urls/terraform-property-index";
import { candidatePage, encodeDevelopmentResponse, resolveDiscoveryResponse } from "./semantic-development-context";

const [configPath, operation, value, offset = "0"] = process.argv.slice(2);
if (!configPath || !value || !["candidates", "read", "search", "discover"].includes(operation ?? ""))
 throw new Error("Use CONFIG candidates CASE_ID [OFFSET] or CONFIG read EXACT_URI or CONFIG search QUERY");
const config = await Bun.file(configPath).json() as { index: string; assets: string; input: string };
const db = new Database(config.index, { readonly: true });
try {
 if (operation === "candidates") {
  // Input is sanitized before launching the model; no expected answers or case kinds.
  const cases = await Bun.file(config.input).json() as Array<{ id: string; prompt: string }>;
  const item = cases.find(row => row.id === value);
  if (!item) throw new Error("Unknown development case");
  const role = terraformQueryIdentity(item.prompt).providerType;
  const names = (db.query("SELECT DISTINCT provider_name FROM terraform_documents WHERE (? IS NULL OR provider_type=?) ORDER BY provider_name")
   .all(role ?? null, role ?? null) as Array<{provider_name: string}>).map(row => row.provider_name);
  const name = terraformProviderMention(item.prompt, names);
  const candidates = searchPropertyIndex(db, item.prompt, { providerType: role, providerName: name }, 2000).slice(0, 20).map(row => {
   const parentPath = row.schema_path.split(".").slice(0, -1).join(".");
   const parent = db.query("SELECT path,anchor FROM terraform_destinations WHERE provider_type=? AND provider_name=? AND schema_path=?")
    .get(row.provider_type, row.provider_name, parentPath) as { path: string; anchor: string } | null;
   return { uri: `xcsh://terraform-documentation/${row.path}#${row.anchor}`, schema_path: row.schema_path,
    description: row.description, parent_uri: parent ? `xcsh://terraform-documentation/${parent.path}#${parent.anchor}` : null };
  });
  process.stdout.write(JSON.stringify(candidatePage({ ...item, candidates }, Number(offset))) + "\n");
 } else if(operation === "search" || operation === "discover") {
  const url = new URL(operation === "search" ? "xcsh://terraform-documentation/" : value);
  if(url.protocol!=="xcsh:" || url.hostname!=="terraform-documentation" || !["", "/"].includes(url.pathname) || url.hash) throw new Error("Root discovery URI required");
  if(operation === "search") url.searchParams.set("search", value);
  const assets = await Bun.file(config.assets).json();
  const repo = new TerraformDocumentationRepository(assets, "unused");
  repo.database = async () => db;
  const result = await resolveDiscoveryResponse(url, async attempt => {
   const resource = await repo.resolve(Object.assign(attempt, { rawHost: "terraform-documentation" }));
   return "Unpublished development corpus; pin fields do not certify this preview.\n" + resource.content;
  });
  process.stdout.write(JSON.stringify(result) + "\n");
 } else {
  const url = new URL(value);
  if (url.protocol !== "xcsh:" || url.hostname !== "terraform-documentation" || !url.pathname.endsWith(".md") || !url.hash)
   throw new Error("Exact anchored Terraform destination required");
  if (url.searchParams.size && !(url.searchParams.size === 1 && ["hint", "context", "full"].includes(url.searchParams.get("view") ?? "")))
   throw new Error("Unsupported read query");
  const assets = await Bun.file(config.assets).json();
  const repo = new TerraformDocumentationRepository(assets, "unused");
  repo.database = async () => db;
  const result = await repo.resolve(Object.assign(url, { rawHost: "terraform-documentation" }));
  const content = "Unpublished development corpus; pin fields do not certify this preview.\n" + result.content;
  const view = url.searchParams.get("view");
  const budget = view === "hint" ? 4096 : view === "full" || !view ? Number.MAX_SAFE_INTEGER : 16384;
  process.stdout.write(JSON.stringify(encodeDevelopmentResponse(content, budget, value)) + "\n");
 }
} catch (error) {
 process.exitCode = 1;
 process.stdout.write(JSON.stringify({development_only:true,qualification_passed:false,status:"error",uri:value,error:error instanceof Error?error.message:String(error)}) + "\n");
} finally { db.close(); }
