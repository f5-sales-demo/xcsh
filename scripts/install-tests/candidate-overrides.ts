import { readFileSync, writeFileSync } from "node:fs";

const names = [
  "@f5-sales-demo/pi-utils", "@f5-sales-demo/pi-natives",
  "@f5-sales-demo/pi-ai", "@f5-sales-demo/pi-agent-core",
  "@f5-sales-demo/pi-tui", "@f5-sales-demo/xcsh-stats",
  "@f5-sales-demo/pi-resource-management", "@f5-sales-demo/xcsh-f5-core",
  "@f5-sales-demo/xcsh",
];
const archives = process.argv.slice(2);
if (archives.length !== names.length || archives.some((archive) => !archive.trim())) {
  throw new Error("Candidate tarball inventory mismatch");
}
const overrides: Record<string, string> = Object.fromEntries(names.map((name, index) => [name, archives[index]!]));
const nativeJson = process.env.XCSH_NATIVE_CANDIDATE_JSON;
if (nativeJson !== undefined) {
  const native = JSON.parse(nativeJson);
  if (!native || typeof native.name !== "string" || !native.name.startsWith("@f5-sales-demo/pi-natives-") ||
    typeof native.tarball !== "string" || !native.tarball.trim()) {
    throw new Error("Candidate native tarball inventory mismatch");
  }
  overrides[native.name] = native.tarball;
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.overrides = overrides;
writeFileSync("package.json", JSON.stringify(pkg, null, 2));
