import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import manifest from "./source-manifest.json";

const root = Bun.argv[2] && resolve(Bun.argv[2]);
if (!root) throw new Error("Usage: bun install.ts <pristine pinned Codex source directory>");
for (const [file, expected] of Object.entries(manifest.files)) {
	const actual = createHash("sha256")
		.update(await readFile(join(root, file)))
		.digest("hex");
	if (actual !== expected) throw new Error(`Reference source differs from the pinned baseline: ${file}`);
}
const patch = join(import.meta.dir, "codex-0.153.4.patch");
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
