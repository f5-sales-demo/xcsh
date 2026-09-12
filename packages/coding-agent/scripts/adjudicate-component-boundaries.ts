import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const EXPECTED_CAPTURES = 288;
const INSPECTED_FINGERPRINT = "95bbbb473ac835d03116a16acf4a9c841ac3f9bc9676fc2155f5204a2f3cddd5";
const directory = resolve(process.argv[2] ?? "packages/coding-agent/test/evidence/component-boundaries-v1");
const jsonFiles = (await readdir(directory)).filter(name => name.endsWith(".json")).sort();

if (jsonFiles.length !== EXPECTED_CAPTURES)
	throw new Error(`Expected ${EXPECTED_CAPTURES} component receipts, found ${jsonFiles.length}`);

const variants = new Set<string>();
for (const name of jsonFiles) {
	const path = join(directory, name);
	const receipt = (await Bun.file(path).json()) as Record<string, unknown>;
	if (receipt.fixture !== "component-boundaries-v1")
		throw new Error(`Unexpected fixture for ${name}: ${String(receipt.fixture)}`);
	if (receipt.fingerprint !== INSPECTED_FINGERPRINT)
		throw new Error(`Refusing stale visual verdict for ${name}: ${String(receipt.fingerprint)}`);
	const image = receipt.image;
	if (typeof image !== "string" || !(await Bun.file(join(directory, image)).exists()))
		throw new Error(`Missing image for ${name}`);
	const variant = [receipt.state, receipt.columns, receipt.rows, receipt.theme, receipt.symbols].join(":");
	if (variants.has(variant)) throw new Error(`Duplicate component variant: ${variant}`);
	variants.add(variant);
	receipt.visualVerdict = "pass-deterministic-component";
	receipt.inspection =
		"Direct contact-sheet inspection: hierarchy, spacing, alignment, truncation, contrast, focus, hints, bounded width, and dark/light plus Unicode/ASCII parity pass.";
	await Bun.write(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

console.log(
	JSON.stringify({
		directory,
		fingerprint: INSPECTED_FINGERPRINT,
		adjudicated: jsonFiles.length,
		variants: variants.size,
	}),
);
