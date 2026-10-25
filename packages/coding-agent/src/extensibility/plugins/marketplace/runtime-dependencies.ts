import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { bunExecPath } from "../../../bun-path";
import { directoryDigest } from "./tree-digest";

const RECEIPT = ".xcsh-runtime-dependencies.json";
export const RUNTIME_ARTIFACT_NAMES = new Set(["node_modules", RECEIPT]);
interface RuntimeDependencies {
	dependencies: Record<string, string>;
	lockFile: string;
	lockSha256: string;
}
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export async function inspectRuntimeDependencies(root: string): Promise<RuntimeDependencies | null> {
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(await fs.readFile(join(root, "package.json"), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw new Error("Plugin runtime dependency manifest is invalid", { cause: error });
	}
	const dependencies = manifest.dependencies;
	if (dependencies === undefined) return null;
	if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies))
		throw new Error("Plugin runtime dependencies must be a package-name mapping");
	const entries = Object.entries(dependencies);
	if (!entries.length) return null;
	if (
		entries.some(
			([name, value]) => !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) || typeof value !== "string" || !value,
		)
	)
		throw new Error("Plugin runtime dependency declarations are invalid");
	for (const lockFile of ["bun.lock", "bun.lockb"]) {
		try {
			const bytes = await fs.readFile(join(root, lockFile));
			return { dependencies: dependencies as Record<string, string>, lockFile, lockSha256: sha(bytes) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	throw new Error("Plugin runtime dependencies require a frozen Bun lockfile");
}

async function assertContainedLinks(directory: string, root: string): Promise<void> {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await assertContainedLinks(path, root);
		else if (entry.isSymbolicLink()) {
			const target = await fs.realpath(path);
			const containment = relative(root, target);
			if (containment === ".." || containment.startsWith(".." + sep) || resolve(root, containment) !== target)
				throw new Error("Plugin runtime dependency links must remain inside the prepared cache");
		}
	}
}

export async function prepareRuntimeDependencies(root: string): Promise<void> {
	const declared = await inspectRuntimeDependencies(root);
	if (!declared) return;
	const before = await fs.readFile(join(root, "package.json"));
	const child = Bun.spawn(
		[bunExecPath, "install", "--production", "--omit=peer", "--ignore-scripts", "--frozen-lockfile", "--no-save"],
		{
			cwd: root,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
	const exit = await child.exited;
	if (exit !== 0) throw new Error(`Plugin runtime dependency preparation failed (exit ${exit})`);
	if (
		!before.equals(await fs.readFile(join(root, "package.json"))) ||
		sha(await fs.readFile(join(root, declared.lockFile))) !== declared.lockSha256
	)
		throw new Error("Plugin runtime dependency preparation changed its frozen package metadata");
	const modules = join(root, "node_modules");
	for (const name of Object.keys(declared.dependencies)) {
		const installed = JSON.parse(await fs.readFile(join(modules, name, "package.json"), "utf8"));
		if (installed.name !== name || typeof installed.version !== "string" || !installed.version)
			throw new Error("Plugin runtime dependency installation is incomplete");
	}
	await assertContainedLinks(modules, await fs.realpath(root));
	await fs.writeFile(
		join(root, RECEIPT),
		JSON.stringify({
			schemaVersion: 1,
			dependencies: declared.dependencies,
			lockFile: declared.lockFile,
			lockSha256: declared.lockSha256,
			treeSha256: await directoryDigest(modules),
		}) + "\n",
		{ mode: 0o600, flag: "wx" },
	);
}

export async function verifyRuntimeDependencies(root: string): Promise<void> {
	const declared = await inspectRuntimeDependencies(root);
	if (!declared) return;
	const receipt = JSON.parse(await fs.readFile(join(root, RECEIPT), "utf8"));
	if (
		receipt.schemaVersion !== 1 ||
		receipt.lockFile !== declared.lockFile ||
		receipt.lockSha256 !== declared.lockSha256 ||
		JSON.stringify(receipt.dependencies) !== JSON.stringify(declared.dependencies)
	)
		throw new Error("Plugin runtime dependency receipt does not match its frozen declarations");
	await assertContainedLinks(join(root, "node_modules"), await fs.realpath(root));
	if (receipt.treeSha256 !== (await directoryDigest(join(root, "node_modules"))))
		throw new Error("Plugin runtime dependency integrity changed");
}
