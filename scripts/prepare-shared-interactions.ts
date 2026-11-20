import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const SHARED_MODULES = [
	"answer-recap",
	"async-answer",
	"contract",
	"conversation-plan",
	"question-form",
	"question-reply",
	"transport",
] as const;
export async function prepareSharedInteractions(source: string, destination: string, check = false): Promise<void> {
	const files = new Map<string, Buffer>();
	for (const name of SHARED_MODULES) {
		const bytes = await readFile(path.join(source, name + ".ts"));
		const imports = [...bytes.toString().matchAll(/(?:from\s*|import\s*\(\s*|import\s+)(["'])([^"']+)\1/g)].map(
			match => match[2]!,
		);
		if (
			imports.some(
				value =>
					!value.startsWith("./") || !SHARED_MODULES.includes(value.slice(2) as (typeof SHARED_MODULES)[number]),
			)
		)
			throw Error("Shared interaction module has an unshipped dependency: " + name);
		files.set(name + ".ts", bytes);
	}
	const manifest = {
		schemaVersion: 1,
		files: Object.fromEntries(
			[...files].map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]),
		),
	};
	if (check) {
		const present = (await readdir(destination)).sort();
		if (JSON.stringify(present) !== JSON.stringify([...files.keys(), "manifest.json"].sort()))
			throw Error("Shared interaction asset membership differs");
		for (const [name, bytes] of files)
			if (!(await readFile(path.join(destination, name))).equals(bytes))
				throw Error("Shared interaction asset changed: " + name);
		if (
			JSON.stringify(JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8"))) !==
			JSON.stringify(manifest)
		)
			throw Error("Shared interaction manifest differs");
		return;
	}
	await mkdir(destination, { recursive: true });
	const present = await readdir(destination);
	if (present.some(name => !files.has(name) && name !== "manifest.json"))
		throw Error("Unregistered shared interaction asset");
	for (const [name, bytes] of files) await writeFile(path.join(destination, name), bytes);
	await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}
if (import.meta.main) {
	const root = path.resolve(import.meta.dir, "..");
	await prepareSharedInteractions(
		path.join(root, "packages/chat-ui/src/interactions"),
		path.join(root, "packages/coding-agent/src/shared-interactions"),
		process.argv.includes("--check"),
	);
}
