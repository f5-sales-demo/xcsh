import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDtsBundle } from "dts-bundle-generator";
import { generateSpecification } from "./generate-specification";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
generateSpecification();
mkdirSync(path.join(directory, "dist"), { recursive: true });
for (const [format, filename] of [
	["esm", "index.js"],
	["cjs", "index.cjs"],
] as const) {
	const build = await Bun.build({
		entrypoints: [path.join(directory, "src/index.ts")],
		target: "node",
		format,
		minify: true,
		external: [],
		throw: true,
	});
	if (!build.success || build.outputs.length !== 1)
		throw new Error("Core bundle did not produce one standalone artifact");
	const text = await build.outputs[0]!.text();
	if (/\bBun\s*\.|from["']bun["']|require\(["']bun["']\)/.test(text))
		throw new Error("Core bundle contains a Bun runtime dependency");
	writeFileSync(path.join(directory, "dist", filename), text);
}
execFileSync(path.resolve(directory, "../../node_modules/.bin/tsgo"), ["-p", "tsconfig.build.json"], {
	cwd: directory,
	stdio: "inherit",
});
const declarations = generateDtsBundle(
	[
		{
			filePath: path.join(directory, "src/index.ts"),
			libraries: { inlinedLibraries: ["@f5-sales-demo/pi-resource-management"] },
			output: { noBanner: true, exportReferencedTypes: false },
		},
	],
	{ preferredConfigPath: path.join(directory, "tsconfig.declarations.json") },
);
if (declarations.length !== 1 || /["']@f5-sales-demo\/pi-resource-management["']/.test(declarations[0]!)) {
	throw new Error("Public declarations must be self-contained");
}
writeFileSync(path.join(directory, "dist/index.d.ts"), declarations[0]!);
writeFileSync(path.join(directory, "dist/index.d.cts"), declarations[0]!);
const receiptText = readFileSync(path.join(directory, "src/api-spec-index.generated.ts"), "utf8");
const receipt = /export const SPECIFICATION_RECEIPT = ([\s\S]+) as const;/.exec(receiptText)?.[1];
if (!receipt) throw new Error("Specification receipt missing");
writeFileSync(path.join(directory, "dist/specification.receipt.json"), receipt + "\n");
