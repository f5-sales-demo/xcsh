import { copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

interface PlatformManifest {
	name: string;
	version: string;
	os: string[];
	cpu: string[];
	main: string;
	files: string[];
	scripts?: Record<string, string>;
}

interface CandidateTarget {
	platform: NodeJS.Platform;
	arch: string;
}

export interface NativeCandidate {
	name: string;
	version: string;
	tarball: string;
}

const PACKAGE_TARGETS: Record<string, string> = {
	"linux-x64": "linux-x64-gnu",
	"linux-arm64": "linux-arm64-gnu",
	"darwin-x64": "darwin-x64",
	"darwin-arm64": "darwin-arm64",
	"win32-x64": "win32-x64-msvc",
};
const LIFECYCLE_HOOKS = ["prepack", "prepare", "postpack", "preinstall", "install", "postinstall"];

/** Pack the current host addon for prepublication installation without changing release pins. */
export async function packNativeCandidate(
	repoRoot: string,
	destination: string,
	target: CandidateTarget = { platform: process.platform, arch: process.arch },
): Promise<NativeCandidate> {
	const tag = `${target.platform}-${target.arch}`;
	const packageTarget = PACKAGE_TARGETS[tag];
	if (!packageTarget) throw new Error(`Unsupported native candidate platform: ${tag}`);
	const nativeRoot = path.join(repoRoot, "packages/natives");
	const manifestBytes = await readFile(path.join(nativeRoot, "npm", packageTarget, "package.json"));
	const manifest = JSON.parse(manifestBytes.toString()) as PlatformManifest;
	const wrapper = JSON.parse(await readFile(path.join(nativeRoot, "package.json"), "utf8")) as { version: string };
	const name = `@f5-sales-demo/pi-natives-${packageTarget}`;
	if (
		manifest.name !== name ||
		JSON.stringify(manifest.os) !== JSON.stringify([target.platform]) ||
		JSON.stringify(manifest.cpu) !== JSON.stringify([target.arch])
	) {
		throw new Error(`Native candidate platform identity mismatch: ${packageTarget}`);
	}
	if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version) || manifest.version !== wrapper.version) {
		throw new Error(`Native candidate version ${manifest.version} does not match wrapper ${wrapper.version}`);
	}
	if (LIFECYCLE_HOOKS.some(hook => manifest.scripts?.[hook])) {
		throw new Error("Native candidate has an unreviewed lifecycle hook");
	}
	const files =
		target.arch === "x64"
			? [`pi_natives.${tag}-baseline.node`, `pi_natives.${tag}-modern.node`]
			: [`pi_natives.${tag}.node`];
	if (JSON.stringify(manifest.files) !== JSON.stringify(files) || manifest.main !== files[0]) {
		throw new Error(`Native candidate files do not match the ${tag} contract`);
	}
	for (const filename of files) {
		const stat = await lstat(path.join(nativeRoot, "native", filename));
		if (!stat.isFile() || stat.size === 0)
			throw new Error(`Native candidate requires a nonempty regular file: ${filename}`);
	}
	destination = path.resolve(destination);
	const tarball = path.join(destination, `${name.slice(1).replaceAll("/", "-")}-${manifest.version}.tgz`);
	try {
		await lstat(tarball);
		throw new Error(`Native candidate tarball already exists: ${tarball}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(destination, { recursive: true });
	const stage = await mkdtemp(path.join(destination, "native-stage-"));
	try {
		await writeFile(path.join(stage, "package.json"), manifestBytes);
		for (const filename of files) {
			await copyFile(path.join(nativeRoot, "native", filename), path.join(stage, filename));
		}
		// Platform packages have no hooks. Refuse new hooks above instead of silently skipping required work.
		const pack = Bun.spawn(
			[process.execPath, "pm", "pack", "--ignore-scripts", "--destination", destination, "--quiet"],
			{
				cwd: stage,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [, stderr, code] = await Promise.all([
			new Response(pack.stdout).text(),
			new Response(pack.stderr).text(),
			pack.exited,
		]);
		if (code !== 0) throw new Error(`Native candidate pack failed (${code}): ${stderr}`);
		if (!(await lstat(tarball)).isFile()) throw new Error("Native candidate tarball missing after pack");
		return { name, version: manifest.version, tarball };
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const [repoRoot, destination] = process.argv.slice(2);
	if (!repoRoot || !destination || process.argv.length !== 4) {
		throw new Error("usage: native-candidate.ts <repo-root> <isolated-destination>");
	}
	console.log(JSON.stringify(await packNativeCandidate(repoRoot, destination)));
}
