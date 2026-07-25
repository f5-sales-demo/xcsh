/**
 * Vendor the shared `@f5-sales-demo/xcsh-chat-ui` source into a consumer repo
 * (the VS Code + Chrome extensions live in separate repos and cannot `workspace:*`
 * this private, source-only package). The consumer commits the vendored copy and
 * builds it with its own bundler (React 18/19 natively; Chrome via preact/compat).
 *
 * Drift is guarded WITHOUT needing the xcsh source (or any cross-repo credential)
 * in the consumer's CI: `vendor()` writes a `VENDOR-MANIFEST.json` of per-file
 * sha256 hashes, and the consumer runs `verifySelf()` to prove its committed copy
 * still matches those hashes (catches hand-edits / partial copies). `verifySync()`
 * — which needs the source present — catches UPSTREAM drift (the source advanced
 * past the vendored copy) and runs on the workstation / in xcsh's own CI where the
 * source exists.
 *
 *   bun scripts/sync-vendor.ts --target <dir>                 # write the vendored copy
 *   bun scripts/sync-vendor.ts --verify-sync --target <dir>   # fail if <dir> is behind source
 *
 * The manifest is pure content-hash (no timestamp / git SHA) so it is
 * deterministic — it changes only when the vendored source content changes.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const PKG_DIR = path.resolve(import.meta.dir, "..");
const SRC_DIR = path.join(PKG_DIR, "src");

/** Filename of the per-file hash manifest written into each vendored copy. */
export const MANIFEST_NAME = "VENDOR-MANIFEST.json";

/** Marker identifying the source package (embedded in the manifest). */
const GENERATED_FROM = "@f5-sales-demo/xcsh-chat-ui";

/** The manifest committed alongside a vendored copy. */
export interface VendorManifest {
	generatedFrom: string;
	/** Posix relative path → sha256 hex of the file's bytes. */
	files: Record<string, string>;
}

function sha256(content: Buffer | string): string {
	return createHash("sha256").update(content).digest("hex");
}

/**
 * The `.ts`/`.tsx` files under `srcDir` to vendor — the shipped component source
 * only (no test files). Returned as posix relative paths, sorted, so the copy +
 * manifest are deterministic across platforms.
 */
export function listSourceFiles(srcDir: string = SRC_DIR): string[] {
	const out: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
				out.push(full);
			}
		}
	};
	walk(srcDir);
	return out.map(f => path.relative(srcDir, f).split(path.sep).join("/")).sort();
}

/** Build the content-hash manifest for the source tree. */
export function buildManifest(srcDir: string = SRC_DIR): VendorManifest {
	const files: Record<string, string> = {};
	for (const rel of listSourceFiles(srcDir)) {
		files[rel] = sha256(fs.readFileSync(path.join(srcDir, rel)));
	}
	return { generatedFrom: GENERATED_FROM, files };
}

/** Serialize the manifest deterministically (stable key order, trailing newline). */
function renderManifest(manifest: VendorManifest): string {
	return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Copy the source tree into `targetDir` and write its manifest. The target's
 * previously-vendored `.ts`/`.tsx` and the manifest are removed first so a
 * renamed/deleted source file never lingers as a stale copy.
 */
export function vendor(targetDir: string, srcDir: string = SRC_DIR): void {
	// Remove prior vendored source + manifest (leave any sibling consumer files).
	if (fs.existsSync(targetDir)) {
		const stale = new Set<string>([MANIFEST_NAME, ...listSourceFiles(targetDir)]);
		for (const rel of stale) {
			fs.rmSync(path.join(targetDir, rel), { force: true });
		}
	}
	for (const rel of listSourceFiles(srcDir)) {
		const dest = path.join(targetDir, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(path.join(srcDir, rel), dest);
	}
	fs.writeFileSync(path.join(targetDir, MANIFEST_NAME), renderManifest(buildManifest(srcDir)));
}

function readManifest(targetDir: string): VendorManifest | null {
	const p = path.join(targetDir, MANIFEST_NAME);
	if (!fs.existsSync(p)) return null;
	try {
		return JSON.parse(fs.readFileSync(p, "utf8")) as VendorManifest;
	} catch {
		return null;
	}
}

/** Result of a drift check: `ok` plus human-readable `problems`. */
export interface VerifyResult {
	ok: boolean;
	problems: string[];
}

/**
 * Consumer-side self-check (NO source needed): every file in the committed
 * manifest exists in `targetDir` and hashes to the recorded value, and no extra
 * vendored `.ts`/`.tsx` file is present that the manifest doesn't cover. Catches
 * hand-edits, partial copies, and stray files.
 */
export function verifySelf(targetDir: string): VerifyResult {
	const manifest = readManifest(targetDir);
	if (!manifest) return { ok: false, problems: [`missing/unreadable ${MANIFEST_NAME} in ${targetDir}`] };
	const problems: string[] = [];
	for (const [rel, expected] of Object.entries(manifest.files)) {
		const full = path.join(targetDir, rel);
		if (!fs.existsSync(full)) {
			problems.push(`missing vendored file: ${rel}`);
			continue;
		}
		if (sha256(fs.readFileSync(full)) !== expected) problems.push(`hash mismatch (hand-edited?): ${rel}`);
	}
	const onDisk = new Set(listSourceFiles(targetDir));
	for (const rel of onDisk) {
		if (!(rel in manifest.files)) problems.push(`stray vendored file not in manifest: ${rel}`);
	}
	return { ok: problems.length === 0, problems };
}

/**
 * Upstream-drift check (source MUST be present): compare the live source hashes
 * against the target's committed manifest. Fails if the source added, removed, or
 * changed a file the vendored copy hasn't picked up — i.e. the consumer needs a
 * re-`vendor()`. Run on the workstation / in xcsh CI where the source exists.
 */
export function verifySync(targetDir: string, srcDir: string = SRC_DIR): VerifyResult {
	const manifest = readManifest(targetDir);
	if (!manifest) return { ok: false, problems: [`missing/unreadable ${MANIFEST_NAME} in ${targetDir}`] };
	const source = buildManifest(srcDir).files;
	const problems: string[] = [];
	for (const [rel, srcHash] of Object.entries(source)) {
		if (!(rel in manifest.files)) problems.push(`source added a file the vendor lacks: ${rel}`);
		else if (manifest.files[rel] !== srcHash) problems.push(`source changed; vendor is stale: ${rel}`);
	}
	for (const rel of Object.keys(manifest.files)) {
		if (!(rel in source)) problems.push(`source removed a file the vendor still has: ${rel}`);
	}
	return { ok: problems.length === 0, problems };
}

/** Resolve the default sibling consumer vendor dirs on the workstation (if present). */
function defaultSiblingTargets(): string[] {
	const root = path.resolve(PKG_DIR, "..", "..", ".."); // .../f5-sales-demo
	return [
		// vscode-xcsh vendors to `vendored/`, NOT `vendor/`: its .gitignore ignores
		// `vendor/`, so writing there would silently update a copy git never sees.
		path.join(root, "vscode-xcsh", "webview", "src", "vendored", "chat-ui"),
		path.join(root, "xcsh-chrome-extension", "src", "vendor", "chat-ui"),
	].filter(d => fs.existsSync(path.dirname(path.dirname(d))));
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const targetIdx = argv.indexOf("--target");
	const target = targetIdx >= 0 ? argv[targetIdx + 1] : undefined;
	const check = argv.includes("--verify-sync");
	const targets = target ? [target] : defaultSiblingTargets();

	if (targets.length === 0) {
		console.error("no --target given and no sibling consumer dirs found");
		process.exit(1);
	}

	let failed = false;
	for (const dir of targets) {
		if (check) {
			const r = verifySync(dir);
			if (r.ok) {
				console.log(`in sync: ${dir}`);
			} else {
				failed = true;
				console.error(`STALE: ${dir}`);
				for (const p of r.problems) console.error(`  - ${p}`);
			}
		} else {
			vendor(dir);
			console.log(`vendored → ${dir}`);
		}
	}
	if (failed) process.exit(1);
}
