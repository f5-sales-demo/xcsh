import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
export interface RecoveryBinding {
	version: 1;
	tag: string;
	sourceSha: string;
	sourceRunId: string;
	controllerSha: string;
	arch: "x64";
	files: Record<string, string>;
}
const names = [
	"pi_natives.darwin-x64-baseline.node",
	"pi_natives.darwin-x64-modern.node",
	"xcsh-darwin-x64",
	"xcsh-darwin-x64.pkg",
	"xcsh-darwin-x64.provenance.json",
].sort();
export function validateRecoveryBinding(
	value: unknown,
	expected: { tag: string; sourceSha: string; sourceRunId: string; controllerSha: string },
): RecoveryBinding {
	const b = value as RecoveryBinding;
	if (
		!b ||
		b.version !== 1 ||
		b.arch !== "x64" ||
		!/^v\d+\.\d+\.\d+$/.test(b.tag) ||
		!/^[0-9a-f]{40}$/.test(b.sourceSha) ||
		!/^[0-9a-f]{40}$/.test(b.controllerSha) ||
		!/^[0-9]+$/.test(b.sourceRunId)
	)
		throw new Error("Invalid recovery receipt identity");
	for (const [key, value] of Object.entries(expected))
		if (b[key as keyof RecoveryBinding] !== value) throw new Error(`Recovery receipt ${key} mismatch`);
	if (
		!b.files ||
		JSON.stringify(Object.keys(b.files).sort()) !== JSON.stringify(names) ||
		!Object.values(b.files).every(d => /^sha256:[a-f0-9]{64}$/.test(d))
	)
		throw new Error("Invalid recovery artifact membership or digest");
	return b;
}
async function fileDigests(root: string): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const name of names) {
		const file = path.join(root, name);
		if (!(await lstat(file)).isFile()) throw new Error("Recovery artifact is not a regular file");
		files[name] = `sha256:${createHash("sha256")
			.update(await readFile(file))
			.digest("hex")}`;
	}
	return files;
}
export async function verifyRecoveryFiles(binding: RecoveryBinding, root: string): Promise<void> {
	const files = await fileDigests(root);
	for (const name of names)
		if (files[name] !== binding.files[name]) throw new Error(`Recovery artifact digest mismatch: ${name}`);
}
if (import.meta.main) {
	const [command, root, file] = process.argv.slice(2);
	if (!root || !file) throw new Error("Expected command, artifact directory, and receipt file");
	const expected = {
		tag: process.env.SOURCE_REF ?? process.env.TAG ?? "",
		sourceSha: process.env.SOURCE_SHA ?? "",
		sourceRunId: process.env.SOURCE_RUN_ID ?? "",
		controllerSha: process.env.CONTROLLER_SHA ?? "",
	};
	if (command === "create") {
		if (JSON.stringify((await readdir(root)).sort()) !== JSON.stringify(names))
			throw new Error("Unexpected files in recovery artifact directory");
		const b = validateRecoveryBinding(
			{ version: 1, arch: "x64", ...expected, files: await fileDigests(root) },
			expected,
		);
		await writeFile(file, `${JSON.stringify(b, null, 2)}\n`);
	} else if (command === "verify") {
		await verifyRecoveryFiles(validateRecoveryBinding(JSON.parse(await readFile(file, "utf8")), expected), root);
	} else throw new Error("Unknown recovery receipt command");
}
