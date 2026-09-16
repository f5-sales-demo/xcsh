import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadReferenceBaseline, verifyReferenceCheckout, verifyReferenceFiles } from "./baseline";

const [version, source] = Bun.argv.slice(2);
const root = source && resolve(source);
if (!version || !root) throw new Error("Usage: bun install.ts <0.153.4|0.154.0> <pristine tagged Codex checkout>");
const manifest = await loadReferenceBaseline(version);
verifyReferenceCheckout(root, manifest);
await verifyReferenceFiles(root, manifest);
const patch = join(import.meta.dir, `codex-${manifest.version}.patch`);
for (const check of [true, false]) {
	const result = Bun.spawnSync(["git", "apply", "--unidiff-zero", ...(check ? ["--check"] : []), patch], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) throw new Error("Reference observation patch did not apply cleanly");
}
for (const crate of ["codex-api", "app-server-transport"]) {
	await copyFile(join(import.meta.dir, "capture.rs"), join(root, "codex-rs", crate, "src", "reference_capture.rs"));
}
process.stdout.write(`Installed observation hooks for Codex ${manifest.version} (${manifest.sourceCommit}).\n`);
