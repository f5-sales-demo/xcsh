import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dir, "../../..");
const generator = path.join(repo, "packages/coding-agent/scripts/generate_public_citation_destinations.py");
const generated = path.join(repo, "packages/coding-agent/src/internal-urls/public-citation-destinations.generated.ts");
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function evidence() {
	const root = mkdtempSync(path.join(tmpdir(), "citation-generator-"));
	roots.push(root);
	mkdirSync(path.join(root, "assessment"));
	const receipts: Record<string, any> = {};
	for (const [source, file, archive] of [
		["content", "documentation-release.json", "html-to-markdown-content.tar.gz"],
		["provider", "terraform-documentation-release.json", "canonical-documentation.tar.gz"],
		["api", "spec-release.json", ""],
	]) {
		const pin = JSON.parse(readFileSync(path.join(repo, "tools", file), "utf8"));
		const asset = archive || `f5xc-api-specs-${pin.release_tag}.zip`;
		const value = pin.assets[asset];
		receipts[source] = {
			tag: pin.release_tag,
			assets: { [asset]: { sha256: typeof value === "string" ? value.slice(7) : value.sha256 } },
		};
	}
	return { root, receipts };
}
function rejected(root: string, receipts: any, reason: string) {
	writeFileSync(path.join(root, "assessment/source-receipts.json"), JSON.stringify(receipts));
	const before = createHash("sha256").update(readFileSync(generated)).digest("hex");
	const result = Bun.spawnSync(["python3", generator, "--evidence-root", root]);
	expect(result.exitCode).not.toBe(0);
	expect(new TextDecoder().decode(result.stderr)).toContain(reason);
	expect(createHash("sha256").update(readFileSync(generated)).digest("hex")).toBe(before);
}
for (const source of ["content", "provider", "api"]) {
	test(`generator refuses stale ${source} receipt tags before changing mappings`, () => {
		const { root, receipts } = evidence();
		receipts[source].tag += "-stale";
		rejected(root, receipts, `publication receipt tag disagrees with reviewed pin: ${source}`);
	});
	test(`generator refuses forged ${source} receipt digests before changing mappings`, () => {
		const { root, receipts } = evidence();
		Object.values(receipts[source].assets).forEach((asset: any) => {
			asset.sha256 = "0".repeat(64);
		});
		rejected(root, receipts, `publication receipt digest disagrees with reviewed pin: ${source}`);
	});
}
test("generator refuses modified publication manifest bytes even with current receipt identities", () => {
	const { root, receipts } = evidence();
	mkdirSync(path.join(root, "sources/content"), { recursive: true });
	writeFileSync(path.join(root, "sources/content/manifest.json"), "{}");
	rejected(root, receipts, "publication manifest digest disagrees with reviewed pin: content");
});
