import { chmod, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const RELEASE_REPOSITORY = "f5-sales-demo/xcsh";
const LOCK_STALE_AFTER_MS = 5 * 60_000;
const LOCK_WAIT_TIMEOUT_MS = 3 * 60_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface EnsureReleaseBinaryOptions {
	version: string;
	platform?: NodeJS.Platform;
	arch?: string;
	cacheRoot?: string;
	fetchImpl?: FetchLike;
}

export interface ReleaseBinaryResult {
	exitCode: number;
	signalCode?: NodeJS.Signals;
}

function unsupportedPlatform(platform: string, arch: string): never {
	throw new Error(
		`Unsupported xcsh platform: ${platform}/${arch}. Install a supported compiled release from https://github.com/${RELEASE_REPOSITORY}/releases.`,
	);
}

export function getReleaseAsset(platform: string, arch: string): string {
	if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `xcsh-linux-${arch}`;
	if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return `xcsh-darwin-${arch}`;
	if (platform === "win32" && arch === "x64") return "xcsh-windows-x64.exe";
	return unsupportedPlatform(platform, arch);
}

export function getReleaseDownloadUrl(version: string, asset: string): string {
	if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`Invalid xcsh package version: ${version}`);
	}
	return `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}/${asset}`;
}

export function getPackageDistributionChannel(moduleDirectory: string): "bun" | "npm" {
	const normalized = moduleDirectory.replaceAll("\\", "/").toLowerCase();
	return normalized.includes("/.bun/") ? "bun" : "npm";
}

export function getDefaultReleaseCacheRoot(platform: NodeJS.Platform = process.platform): string {
	if (process.env.XCSH_RELEASE_CACHE_DIR) return process.env.XCSH_RELEASE_CACHE_DIR;
	if (platform === "win32") {
		return join(process.env.LOCALAPPDATA || process.env.TEMP || tmpdir(), "xcsh", "releases");
	}
	return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "xcsh", "releases");
}

export function releaseValidationEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const validationEnvironment = { ...environment };
	delete validationEnvironment.XCSH_SMOKE_TEST_SPECS;
	delete validationEnvironment.XCSH_SMOKE_TEST_VERTEX_AUTH;
	return validationEnvironment;
}

async function validateReleaseBinary(
	binaryPath: string,
	version: string,
): Promise<{ valid: boolean; actual?: string }> {
	try {
		if (process.platform !== "win32") await chmod(binaryPath, 0o755);
		const child = Bun.spawn([binaryPath, "--version"], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: releaseValidationEnvironment(process.env),
		});
		const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
		if (exitCode !== 0) return { valid: false };
		const actual = stdout.match(/(?:xcsh\/)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1];
		return { valid: actual === version, actual };
	} catch {
		return { valid: false };
	}
}

async function cachedBinaryIsValid(binaryPath: string, version: string): Promise<boolean> {
	return (await validateReleaseBinary(binaryPath, version)).valid;
}

async function lockIsStale(lockPath: string): Promise<boolean> {
	try {
		const lockStat = await stat(lockPath);
		return Date.now() - lockStat.mtimeMs > LOCK_STALE_AFTER_MS;
	} catch {
		return false;
	}
}

export async function ensureReleaseBinary(options: EnsureReleaseBinaryOptions): Promise<string> {
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const asset = getReleaseAsset(platform, arch);
	const cacheRoot = options.cacheRoot ?? getDefaultReleaseCacheRoot(platform);
	const cacheDirectory = join(cacheRoot, `v${options.version}`, `${platform}-${arch}`);
	const binaryPath = join(cacheDirectory, asset);
	const lockPath = `${binaryPath}.lock`;
	const fetchImpl = options.fetchImpl ?? fetch;

	await mkdir(cacheDirectory, { recursive: true });
	if (await cachedBinaryIsValid(binaryPath, options.version)) return binaryPath;
	await rm(binaryPath, { force: true });

	const waitStartedAt = Date.now();
	let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
	while (!lockHandle) {
		try {
			lockHandle = await open(lockPath, "wx", 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await cachedBinaryIsValid(binaryPath, options.version)) return binaryPath;
			if (await lockIsStale(lockPath)) {
				await rm(lockPath, { force: true });
				continue;
			}
			if (Date.now() - waitStartedAt >= LOCK_WAIT_TIMEOUT_MS) {
				throw new Error(`Timed out waiting for the xcsh v${options.version} binary download lock`);
			}
			await Bun.sleep(100);
		}
	}

	const partialPath = `${binaryPath}.partial-${process.pid}-${crypto.randomUUID()}`;
	try {
		if (await cachedBinaryIsValid(binaryPath, options.version)) return binaryPath;

		const downloadUrl = getReleaseDownloadUrl(options.version, asset);
		const response = await fetchImpl(downloadUrl, { redirect: "follow" });
		if (!response.ok) {
			throw new Error(`Failed to download compiled xcsh v${options.version}: HTTP ${response.status}`);
		}
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength === 0) throw new Error(`Downloaded compiled xcsh v${options.version} was empty`);
		await Bun.write(partialPath, bytes);
		if (platform !== "win32") await chmod(partialPath, 0o755);

		const validation = await validateReleaseBinary(partialPath, options.version);
		if (!validation.valid) {
			const actual = validation.actual ? ` reported version ${validation.actual}` : " could not execute";
			throw new Error(`Downloaded xcsh${actual}; expected ${options.version}`);
		}

		await rename(partialPath, binaryPath);
		return binaryPath;
	} finally {
		await rm(partialPath, { force: true });
		await lockHandle.close();
		await rm(lockPath, { force: true });
	}
}

export async function runReleaseBinary(
	binaryPath: string,
	args: string[],
	distributionChannel: "bun" | "npm" = "npm",
): Promise<ReleaseBinaryResult> {
	const child = Bun.spawn([binaryPath, ...args], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, XCSH_DISTRIBUTION_CHANNEL: distributionChannel },
	});
	const forwardedSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
	const handlers = new Map<NodeJS.Signals, () => void>();
	for (const signal of forwardedSignals) {
		const handler = () => child.kill(signal);
		handlers.set(signal, handler);
		process.on(signal, handler);
	}

	try {
		const exitCode = await child.exited;
		return { exitCode, signalCode: (child.signalCode as NodeJS.Signals | null) ?? undefined };
	} finally {
		for (const [signal, handler] of handlers) process.off(signal, handler);
	}
}
