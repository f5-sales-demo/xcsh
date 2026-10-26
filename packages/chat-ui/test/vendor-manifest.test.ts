import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MANIFEST_NAME, vendor, verifySelf } from "../scripts/sync-vendor";

test("vendor digests identify their algorithm and preserve strict content verification", () => {
	const root = mkdtempSync(join(tmpdir(), "voice-vendor-hash-"));
	try {
		const source = join(root, "source"),
			target = join(root, "target");
		mkdirSync(join(source, "theme"), { recursive: true });
		writeFileSync(join(source, "theme/tokens.ts"), "export const colors = [];\n");
		vendor(target, source);
		const manifest = JSON.parse(readFileSync(join(target, MANIFEST_NAME), "utf8")) as {
			files: Record<string, string>;
		};
		expect(manifest.files["theme/tokens.ts"]).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(verifySelf(target).ok).toBe(true);
		manifest.files["theme/tokens.ts"] = manifest.files["theme/tokens.ts"]!.replace(/^sha256:/, "");
		writeFileSync(join(target, MANIFEST_NAME), JSON.stringify(manifest));
		expect(verifySelf(target).ok).toBe(true);
		writeFileSync(join(target, "theme/tokens.ts"), "export const changed = true;\n");
		expect(verifySelf(target).ok).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
