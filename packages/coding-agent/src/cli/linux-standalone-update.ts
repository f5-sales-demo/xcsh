import { createHash } from "node:crypto";
import path from "node:path";

const REPO = "f5-sales-demo/xcsh";
const MAX_INSTALLER_BYTES = 256 * 1024;

export interface LinuxInstallerInput {
	script: Buffer;
	installDir: string;
	version: string;
}

export interface LinuxStandaloneUpdateOptions {
	targetPath: string;
	arch?: string;
	fetchImpl?(input: string | URL | Request, init?: RequestInit): Promise<Response>;
	runInstaller?(input: LinuxInstallerInput): Promise<void>;
}

async function runInstaller(input: LinuxInstallerInput): Promise<void> {
	const child = Bun.spawn(["/bin/sh", "-s", "--", "--binary", "--ref", `v${input.version}`], {
		stdin: "pipe",
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, PI_INSTALL_DIR: input.installDir },
	});
	try {
		child.stdin.write(input.script);
		await child.stdin.end();
	} catch (error) {
		child.kill();
		await child.exited;
		throw error;
	}
	const exitCode = await child.exited;
	if (exitCode !== 0) throw new Error(`Verified Linux installer exited with status ${exitCode}`);
}

/** Use the published installer's complete integrity transaction for every Linux replacement. */
export async function updateLinuxStandalone(version: string, options: LinuxStandaloneUpdateOptions): Promise<void> {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
		throw new Error("A stable published version is required for Linux standalone updates");
	if (!path.posix.isAbsolute(options.targetPath) || path.posix.basename(options.targetPath) !== "xcsh")
		throw new Error("Linux standalone target must be an absolute xcsh executable path");
	const arch = options.arch ?? process.arch;
	if (arch !== "x64" && arch !== "arm64") throw new Error("Unsupported Linux standalone update architecture");

	const fetchImpl = options.fetchImpl ?? fetch;
	const tag = `v${version}`;
	const api = `https://api.github.com/repos/${REPO}`;
	const releaseResponse = await fetchImpl(`${api}/releases/tags/${tag}`, {
		signal: AbortSignal.timeout(30_000),
	});
	if (!releaseResponse.ok) throw new Error(`Cannot read immutable release metadata: ${releaseResponse.status}`);
	const release = (await releaseResponse.json()) as {
		tag_name?: unknown;
		draft?: unknown;
		prerelease?: unknown;
		immutable?: unknown;
		assets?: unknown;
	} | null;
	if (
		release?.tag_name !== tag ||
		release.draft !== false ||
		release.prerelease !== false ||
		release.immutable !== true
	)
		throw new Error("Linux self-update requires the exact published immutable release");
	if (!Array.isArray(release.assets)) throw new Error("Linux release is missing integrity assets");
	const binary = `xcsh-linux-${arch}`;
	for (const name of [binary, `${binary}.sha256`, `${binary}.provenance.json`, `${binary}.provenance.json.sha256`]) {
		const matches = release.assets.filter(asset => asset?.name === name);
		if (
			matches.length !== 1 ||
			typeof matches[0].digest !== "string" ||
			!/^sha256:[a-f0-9]{64}$/.test(matches[0].digest) ||
			!Number.isInteger(matches[0].size) ||
			matches[0].size <= 0
		)
			throw new Error("Linux release has incomplete or ambiguous integrity assets");
	}

	const sourceResponse = await fetchImpl(`${api}/contents/scripts/install.sh?ref=${tag}`, {
		signal: AbortSignal.timeout(30_000),
	});
	if (!sourceResponse.ok) throw new Error(`Cannot read tagged installer source: ${sourceResponse.status}`);
	const source = (await sourceResponse.json()) as {
		type?: unknown;
		path?: unknown;
		encoding?: unknown;
		size?: unknown;
		sha?: unknown;
		content?: unknown;
	} | null;
	if (
		source?.type !== "file" ||
		source.path !== "scripts/install.sh" ||
		source.encoding !== "base64" ||
		typeof source.size !== "number" ||
		!Number.isInteger(source.size) ||
		source.size <= 0 ||
		source.size > MAX_INSTALLER_BYTES ||
		typeof source.sha !== "string" ||
		!/^[a-f0-9]{40}$/.test(source.sha) ||
		typeof source.content !== "string"
	)
		throw new Error("Invalid tagged installer source metadata");
	const script = Buffer.from(source.content, "base64");
	const blobSha = createHash("sha1").update(`blob ${script.length}\0`).update(script).digest("hex");
	if (script.length !== source.size || blobSha !== source.sha)
		throw new Error("Tagged installer source does not match its Git blob identity");

	await (options.runInstaller ?? runInstaller)({
		script,
		installDir: path.posix.dirname(options.targetPath),
		version,
	});
}
