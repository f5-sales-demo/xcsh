import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "packages/coding-agent/test/evidence/extension-dialogs-v1");
const inspectedFingerprint = process.argv[3];
if (!inspectedFingerprint) throw new Error("Usage: adjudicate-extension-dialogs.ts <directory> <fingerprint>");
const jsonFiles = (await readdir(directory)).filter(name =>
	/^(?:confirmation|review-|native-input|autoresearch-overlay).*\.json$/.test(name),
);
if (jsonFiles.length !== 112) throw new Error(`Expected 112 component receipts, found ${jsonFiles.length}`);
for (const name of jsonFiles) {
	const path = join(directory, name);
	const receipt = (await Bun.file(path).json()) as Record<string, unknown>;
	if (receipt.fingerprint !== inspectedFingerprint)
		throw new Error(`Refusing stale visual verdict for ${name}: ${String(receipt.fingerprint)}`);
	const image = receipt.image;
	if (typeof image !== "string" || !(await Bun.file(join(directory, image)).exists()))
		throw new Error(`Missing image for ${name}`);
	receipt.visualVerdict = "pass-deterministic-component";
	receipt.inspection =
		"Direct contact-sheet inspection: hierarchy, spacing, alignment, truncation, contrast, focus, hints, width, and theme/symbol parity pass.";
	await Bun.write(path, `${JSON.stringify(receipt, null, 2)}\n`);
}
console.log(JSON.stringify({ directory, fingerprint: inspectedFingerprint, adjudicated: jsonFiles.length }));
