#!/usr/bin/env bun
/**
 * Release gate: assert every macOS native addon is Developer-ID signed, built with
 * the hardened runtime, AND notarized — BEFORE it gets embedded into the compiled
 * binary. xcsh extracts the embedded `.node` to `~/.xcsh/natives/<ver>/` at runtime
 * and `dlopen`s it; that extracted copy is a byte-for-byte image of what we embed,
 * so it only loads on managed/MDM Macs if the embedded `.node` carried a real
 * Developer-ID + notarized signature. The sign step's own checks are soft
 * (`… || true`, and `notarytool --wait` does not fail on an `Invalid` result), so
 * without this gate a release could silently ship an ad-hoc / unnotarized addon
 * that dies at load with "pi_natives… could not verify it is free of malware".
 *
 * Usage: bun scripts/ci-release-verify-native-signing.ts [nativeDir]
 * macOS-only (uses codesign + spctl); no-op with a notice on other platforms.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { $ } from "bun";

if (process.platform !== "darwin") {
	console.log("ci-release-verify-native-signing: not macOS — skipping (nothing to verify here).");
	process.exit(0);
}

const repoRoot = path.join(import.meta.dir, "..");
const nativeDir = process.argv[2] ?? path.join(repoRoot, "packages", "natives", "native");
if (!fs.existsSync(nativeDir)) {
	console.error(`::error::native dir not found: ${nativeDir}`);
	process.exit(1);
}

// Only darwin addons can be codesigned/notarized; ignore linux/win .node here.
const nodes = fs
	.readdirSync(nativeDir)
	.filter(f => f.endsWith(".node") && f.includes("darwin"))
	.map(f => path.join(nativeDir, f));

if (nodes.length === 0) {
	console.error(`::error::no darwin *.node addons found in ${nativeDir} — nothing to verify (misconfigured build?)`);
	process.exit(1);
}

async function verifyOne(node: string): Promise<string[]> {
	const failures: string[] = [];
	const cs = await $`codesign -dvvv ${node}`.quiet().nothrow();
	const csText = `${cs.stdout.toString()}${cs.stderr.toString()}`;
	if (!/Authority=Developer ID Application/.test(csText)) {
		const adhoc = /Signature=adhoc/.test(csText) ? " (found ad-hoc signature)" : "";
		failures.push(`not Developer-ID Application signed${adhoc}`);
	}
	if (!/flags=0x[0-9a-f]*\([^)]*runtime/.test(csText)) {
		failures.push("missing hardened runtime (flags=…runtime)");
	}
	// `-t install` is the assessment type that recognizes a notarized standalone
	// Mach-O; `-t open`/`-t exec` return "Insufficient Context" for a bare dylib.
	const gk = await $`spctl -a -vv -t install ${node}`.quiet().nothrow();
	const gkText = `${gk.stdout.toString()}${gk.stderr.toString()}`;
	if (!/source=Notarized Developer ID/.test(gkText)) {
		failures.push(`not notarized (spctl: ${gkText.trim().split("\n").pop() ?? "no verdict"})`);
	}
	return failures;
}

let ok = 0;
const problems: string[] = [];
for (const node of nodes) {
	const failures = await verifyOne(node);
	if (failures.length === 0) {
		console.log(`✓ ${path.basename(node)} — Developer-ID + hardened-runtime + notarized`);
		ok++;
	} else {
		for (const f of failures) console.error(`::error::${path.basename(node)}: ${f}`);
		problems.push(path.basename(node));
	}
}

if (problems.length > 0) {
	console.error(`\n::error::native signing gate FAILED for ${problems.length}/${nodes.length}: ${problems.join(", ")}`);
	process.exit(1);
}
console.log(`\nnative signing gate PASSED: ${ok}/${nodes.length} darwin addon(s) Developer-ID signed + notarized.`);
