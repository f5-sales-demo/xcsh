import { createHash } from "node:crypto";
import { resolve } from "node:path";

const [catalogArgument, commit] = process.argv.slice(2);
if (!catalogArgument || !/^[0-9a-f]{40}$/.test(commit ?? "")) {
	throw new Error("usage: update-builtin-marketplace-snapshot.ts <marketplace.json> <40-character commit>");
}

const catalogPath = resolve(catalogArgument);
const content = await Bun.file(catalogPath).text();
JSON.parse(content);
const directory = resolve(import.meta.dir, "../src/extensibility/plugins/marketplace");
const snapshotPath = resolve(directory, "builtin-marketplace-snapshot.ts");
const provenancePath = resolve(directory, "builtin-marketplace.provenance.json");
const snapshot = `const builtinMarketplaceSnapshot = ${JSON.stringify(content)};\n\nexport default builtinMarketplaceSnapshot;\n`;
const provenance = {
	repository: "https://github.com/f5-sales-demo/marketplace",
	sourcePath: ".xcsh-plugin/marketplace.json",
	commit,
	sha256: createHash("sha256").update(content).digest("hex"),
	capturedAt: new Date().toISOString(),
};
await Bun.write(snapshotPath, snapshot);
await Bun.write(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
const format = Bun.spawn(["bun", "x", "biome", "format", "--write", snapshotPath, provenancePath], {
	stdout: "inherit",
	stderr: "inherit",
});
if ((await format.exited) !== 0) throw new Error("Failed to format generated marketplace snapshot");
