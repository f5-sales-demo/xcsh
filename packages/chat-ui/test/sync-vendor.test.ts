import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, listSourceFiles, MANIFEST_NAME, vendor, verifySelf, verifySync } from "../scripts/sync-vendor";

function tmp(): string {
	return mkdtempSync(join(tmpdir(), "chat-ui-vendor-"));
}

describe("listSourceFiles", () => {
	test("lists the .ts/.tsx source (posix paths, sorted, no tests/scripts)", () => {
		const files = listSourceFiles();
		expect(files.length).toBeGreaterThan(10);
		expect(files).toContain("index.ts");
		expect(files).toContain("components/Composer.tsx");
		expect(files).toContain("theme/tokens.ts");
		// deterministic ordering
		expect([...files]).toEqual([...files].sort());
		// no test files or backslashes
		expect(files.every(f => !f.includes("\\") && !f.includes(".test."))).toBe(true);
	});
});

describe("buildManifest", () => {
	test("hashes every source file; deterministic (no timestamps/SHAs that churn)", () => {
		const a = buildManifest();
		const b = buildManifest();
		expect(a).toEqual(b);
		expect(a.generatedFrom).toBe("@f5-sales-demo/xcsh-chat-ui");
		expect(Object.keys(a.files)).toEqual(listSourceFiles());
		for (const h of Object.values(a.files)) expect(h).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe("vendor + verifySelf", () => {
	test("copies the source tree + a manifest into the target; the copy self-verifies", () => {
		const dir = tmp();
		try {
			vendor(dir);
			// files copied, preserving layout
			expect(readFileSync(join(dir, "index.ts"), "utf8")).toBe(readFileSync(join(listSrc(), "index.ts"), "utf8"));
			expect(readdirSync(dir)).toContain(MANIFEST_NAME);
			// self-check passes on a clean copy
			expect(verifySelf(dir)).toEqual({ ok: true, problems: [] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("verifySelf FAILS when a vendored file is hand-edited (drift / tamper)", () => {
		const dir = tmp();
		try {
			vendor(dir);
			writeFileSync(join(dir, "index.ts"), "// tampered\n");
			const r = verifySelf(dir);
			expect(r.ok).toBe(false);
			expect(r.problems.some(p => p.includes("index.ts"))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("verifySelf FAILS when a vendored file is missing", () => {
		const dir = tmp();
		try {
			vendor(dir);
			rmSync(join(dir, "theme/tokens.ts"));
			expect(verifySelf(dir).ok).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("verifySync (upstream drift, source present)", () => {
	test("passes for a freshly vendored copy", () => {
		const dir = tmp();
		try {
			vendor(dir);
			expect(verifySync(dir)).toEqual({ ok: true, problems: [] });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("fails when the target manifest is behind the source (a source file changed)", () => {
		const dir = tmp();
		try {
			vendor(dir);
			// Simulate the source advancing by rewriting the target's manifest hash for one file.
			const mPath = join(dir, MANIFEST_NAME);
			const m = JSON.parse(readFileSync(mPath, "utf8")) as { files: Record<string, string> };
			m.files["index.ts"] = "0".repeat(64);
			writeFileSync(mPath, `${JSON.stringify(m, null, 2)}\n`);
			const r = verifySync(dir);
			expect(r.ok).toBe(false);
			expect(r.problems.some(p => p.includes("index.ts"))).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// Resolve the chat-ui src dir for the equality assertion above.
function listSrc(): string {
	return join(import.meta.dir, "..", "src");
}
