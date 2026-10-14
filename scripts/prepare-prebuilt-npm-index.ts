import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";

const suffix = " && bun scripts/generate-terraform-documentation-index.ts";
export function remainingPinnedPrepack(command: string): string {
  if (!command.endsWith(suffix)) throw new Error("Unrecognized immutable-source prepack contract");
  const remaining = command.slice(0,-suffix.length);
  if (!remaining.trim()) throw new Error("Missing package preparation before corpus generation");
  return remaining;
}

/** Use only the original run's artifact; changing latest sources cannot replace its reviewed bytes. */
export function preparePrebuiltNpmIndex(sourceRoot: string): () => void {
  const pin = JSON.parse(fs.readFileSync(path.join(sourceRoot,"tools/terraform-documentation-release.json"),"utf8"));
  const index = pin.index;
  if (!/^v\d+\.\d+\.\d+$/.test(pin.provider_version) || !index ||
      ![index.sha256,index.gzip_sha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) ||
      ![index.size_bytes,index.gzip_size_bytes].every(value => Number.isSafeInteger(value) && value > 0 && value < 2 ** 31))
    throw new Error("Malformed immutable Terraform index pin");
  const internal = path.join(sourceRoot,"packages/coding-agent/src/internal-urls");
  const compressed = fs.readFileSync(path.join(internal,".documentation-generated/terraform/terraform-documentation.sqlite.gz"));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  if (compressed.length !== index.gzip_size_bytes || hash(compressed) !== index.gzip_sha256)
    throw new Error("Prebuilt Terraform gzip does not match the immutable source pin");
  const bytes = gunzipSync(compressed,{maxOutputLength:index.size_bytes});
  if (bytes.length !== index.size_bytes || hash(bytes) !== index.sha256)
    throw new Error("Prebuilt Terraform SQLite does not match the immutable source pin");
  const files = ["terraform-documentation-assets.generated.ts","terraform-provider-pin.generated.ts"].map(name => path.join(internal,name));
  const originals = files.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
  const restore = () => files.forEach((file,i) => {
    const original = originals[i];
    if (original === null) fs.rmSync(file,{force:true});
    else fs.writeFileSync(file,original);
  });
  try {
    fs.writeFileSync(files[0]!,`import indexGzipPath from "./.documentation-generated/terraform/terraform-documentation.sqlite.gz" with { type: "file" };\nimport type { TerraformEmbeddedAssets } from "./terraform-documentation";\nexport const EMBEDDED_TERRAFORM_DOCUMENTATION = { indexGzipPath, pin: ${JSON.stringify(pin)} } satisfies TerraformEmbeddedAssets;\n`);
    fs.writeFileSync(files[1]!,`export const EMBEDDED_PROVIDER_VERSION = ${JSON.stringify(pin.provider_version.slice(1))};\n`);
    return restore;
  } catch (error) { restore(); throw error; }
}
