import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { dts } from "rolldown-plugin-dts";
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
// Emit with the workspace compiler, then bundle the emitted declarations with Oxc.
// Declaration input avoids a second compiler and keeps both module formats standalone.
const declarationDirectory = mkdtempSync(path.join(os.tmpdir(), "xcsh-core-declarations-"));
try {
	execFileSync(
		path.resolve(directory, "../../node_modules/.bin/tsc"),
		["-p", "tsconfig.declarations.json", "--outDir", declarationDirectory],
		{ cwd: directory, stdio: "inherit" },
	);
	const bundle = await rolldown({
		input: path.join(declarationDirectory, "packages/f5-core/src/index.d.ts"),
		plugins: [dts({ dtsOnly: true, generator: "oxc", tsconfig: false })],
		resolve: {
			alias: {
				"@f5-sales-demo/pi-resource-management": path.join(
					declarationDirectory,
					"packages/resource-management/src/index.d.ts",
				),
			},
		},
		onwarn(warning) {
			throw new Error(`Declaration bundling warning: ${warning.message}`);
		},
	});
	try {
		const { output } = await bundle.generate({ format: "es" });
		if (output.length !== 1 || output[0]?.type !== "chunk") {
			throw new Error("Core declarations did not produce one standalone artifact");
		}
		const declarations = output[0].code;
		if (/["']@f5-sales-demo\/pi-resource-management["']/.test(declarations)) {
			throw new Error("Public declarations must be self-contained");
		}
		writeFileSync(path.join(directory, "dist/index.d.ts"), declarations);
		writeFileSync(path.join(directory, "dist/index.d.cts"), declarations);
	} finally {
		await bundle.close();
	}
} finally {
	rmSync(declarationDirectory, { recursive: true, force: true });
}
const receiptText = readFileSync(path.join(directory, "src/api-spec-index.generated.ts"), "utf8");
const receipt = /export const SPECIFICATION_RECEIPT = ([\s\S]+) as const;/.exec(receiptText)?.[1];
if (!receipt) throw new Error("Specification receipt missing");
writeFileSync(path.join(directory, "dist/specification.receipt.json"), receipt + "\n");
