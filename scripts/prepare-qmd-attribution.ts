import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** QMD builds the shipped index; its development dependency is not needed by readers. */
export async function prepareQmdAttribution(packageRoot: string, check = false): Promise<void> {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	const bytes = await readFile(path.join(packageRoot, "node_modules/@tobilu/qmd/package.json"));
	const metadata = JSON.parse(bytes.toString());
	if (
		metadata.name !== "@tobilu/qmd" ||
		typeof metadata.version !== "string" ||
		!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(metadata.version)
	)
		throw Error("Installed QMD metadata is invalid");
	if (metadata.version !== manifest.devDependencies?.["@tobilu/qmd"])
		throw Error("Installed QMD version differs from declared dependency");
	const output =
		JSON.stringify(
			{
				schemaVersion: 1,
				name: metadata.name,
				version: metadata.version,
				packageMetadataSha256: createHash("sha256").update(bytes).digest("hex"),
			},
			null,
			2,
		) + "\n";
	const destination = path.join(packageRoot, "src/internal-urls/qmd-attribution.generated.json");
	if (check) {
		if ((await readFile(destination, "utf8")) !== output)
			throw Error("Shipped QMD attribution differs from installed generator");
	} else await writeFile(destination, output);
}
if (import.meta.main)
	await prepareQmdAttribution(
		path.resolve(import.meta.dir, "../packages/coding-agent"),
		process.argv.includes("--check"),
	);
