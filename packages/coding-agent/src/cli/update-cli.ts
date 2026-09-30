/** Context-aware executable update policy and standalone replacement. */
import * as fs from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { APP_NAME, isEnoent, VERSION } from "@f5-sales-demo/pi-utils";
import chalk from "chalk";
import { type LinuxInstallerInput, updateLinuxStandalone } from "./linux-standalone-update";
import {
	createInstallReceipt,
	defaultInstallChannelDependencies,
	formatUpdateRecommendation,
	resolveInstallChannel,
	type UpdateRecommendation,
} from "./update-recommendation";

const REPO = "f5-sales-demo/xcsh";

export interface ReleaseInfo {
	tag: string;
	version: string;
}

export interface UpdateCommandDependencies {
	currentVersion: string;
	getLatestRelease(): Promise<ReleaseInfo>;
	resolveRecommendation(): Promise<UpdateRecommendation>;
	updateStandalone(version: string): Promise<void>;
	stdout(value: string): void;
	stderr(value: string): void;
}

async function getLatestRelease(): Promise<ReleaseInfo> {
	const response = await fetch("https://registry.npmjs.org/@f5-sales-demo/xcsh/latest");
	if (!response.ok) throw new Error(`Failed to fetch release info: ${response.statusText}`);
	const data = (await response.json()) as { version?: string };
	if (!data.version) throw new Error("Latest release response did not include a version");
	return { tag: `v${data.version}`, version: data.version };
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const difference = (pa[i] || 0) - (pb[i] || 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function getBinaryName(platform = process.platform, arch = process.arch): string {
	if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `${APP_NAME}-linux-${arch}`;
	if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return `${APP_NAME}-darwin-${arch}`;
	throw new Error(`Unsupported standalone update platform: ${platform}/${arch}`);
}

async function validateExecutableVersion(executable: string, expectedVersion: string): Promise<void> {
	const child = Bun.spawn([executable, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	const [exitCode, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	const actual = output.match(/\/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/u)?.[1];
	if (exitCode !== 0 || actual !== expectedVersion) {
		throw new Error(
			actual
				? `${APP_NAME} at ${executable} reports ${actual}; expected ${expectedVersion}`
				: `${APP_NAME} at ${executable} could not be verified as ${expectedVersion}`,
		);
	}
}

export interface StandaloneReplacementOptions {
	targetPath: string;
	platform?: NodeJS.Platform;
	arch?: NodeJS.Architecture;
	fetchImpl?(input: string | URL | Request, init?: RequestInit): Promise<Response>;
	rename?(source: string, destination: string): Promise<void>;
	readFile?(file: string): Promise<string>;
	writeFile?(file: string, contents: string): Promise<void>;
	unlink?(file: string): Promise<void>;
	validate?(executable: string, expectedVersion: string): Promise<void>;
	runLinuxInstaller?(input: LinuxInstallerInput): Promise<void>;
}

async function ignoreMissing(unlink: (file: string) => Promise<void>, file: string): Promise<void> {
	try {
		await unlink(file);
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}
}

/** Replace a proven standalone executable and receipt as one rollback-safe transaction. */
export async function replaceStandaloneExecutable(
	expectedVersion: string,
	options: StandaloneReplacementOptions,
): Promise<void> {
	const targetPath = options.targetPath;
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	if (platform === "linux") {
		if (arch !== "x64" && arch !== "arm64") throw new Error("Unsupported Linux standalone update architecture");
		return updateLinuxStandalone(expectedVersion, {
			targetPath,
			arch,
			fetchImpl: options.fetchImpl,
			runInstaller: options.runLinuxInstaller,
		});
	}
	const binaryName = getBinaryName(platform, arch);
	const url = `https://github.com/${REPO}/releases/download/v${expectedVersion}/${binaryName}`;
	const tempPath = `${targetPath}.new-${process.pid}`;
	const receiptPath = path.join(path.dirname(targetPath), "xcsh-install.json");
	const tempReceiptPath = `${receiptPath}.new-${process.pid}`;
	const backupPath = `${targetPath}.bak-${process.pid}`;
	const backupReceiptPath = `${receiptPath}.bak-${process.pid}`;
	const fetchImpl = options.fetchImpl ?? fetch;
	const rename = options.rename ?? fs.promises.rename;
	const readFile = options.readFile ?? (file => fs.promises.readFile(file, "utf8"));
	const writeFile =
		options.writeFile ??
		(async (file, contents) => fs.promises.writeFile(file, contents, { flag: "wx", mode: 0o644 }));
	const unlink = options.unlink ?? fs.promises.unlink;
	const validate = options.validate ?? validateExecutableVersion;
	const receiptContents = `${JSON.stringify(createInstallReceipt("standalone", expectedVersion, targetPath, platform, arch))}\n`;
	let originalBinaryMoved = false;
	let originalReceiptMoved = false;
	let replacementBinaryInstalled = false;
	let replacementReceiptInstalled = false;
	let committed = false;

	try {
		const response = await fetchImpl(url, { redirect: "follow" });
		if (!response.ok || !response.body) throw new Error(`Download failed: ${response.statusText}`);
		await pipeline(response.body, fs.createWriteStream(tempPath, { mode: 0o755, flags: "wx" }));
		await fs.promises.chmod(tempPath, 0o755);
		await validate(tempPath, expectedVersion);
		await writeFile(tempReceiptPath, receiptContents);
		if ((await readFile(tempReceiptPath)) !== receiptContents)
			throw new Error("Staged install receipt validation failed");

		await rename(targetPath, backupPath);
		originalBinaryMoved = true;
		await rename(receiptPath, backupReceiptPath);
		originalReceiptMoved = true;
		await rename(tempPath, targetPath);
		replacementBinaryInstalled = true;
		await rename(tempReceiptPath, receiptPath);
		replacementReceiptInstalled = true;
		await validate(targetPath, expectedVersion);
		if ((await readFile(receiptPath)) !== receiptContents) throw new Error("Installed receipt validation failed");
		committed = true;
		await ignoreMissing(unlink, backupPath).catch(() => {});
		originalBinaryMoved = false;
		await ignoreMissing(unlink, backupReceiptPath).catch(() => {});
		originalReceiptMoved = false;
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		if (replacementReceiptInstalled) {
			try {
				await ignoreMissing(unlink, receiptPath);
				replacementReceiptInstalled = false;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (originalReceiptMoved) {
			try {
				await rename(backupReceiptPath, receiptPath);
				originalReceiptMoved = false;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (replacementBinaryInstalled) {
			try {
				await ignoreMissing(unlink, targetPath);
				replacementBinaryInstalled = false;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (originalBinaryMoved) {
			try {
				await rename(backupPath, targetPath);
				originalBinaryMoved = false;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
		}
		if (rollbackErrors.length > 0)
			throw new AggregateError([error, ...rollbackErrors], "Self-update rollback failed");
		throw error;
	} finally {
		await ignoreMissing(unlink, tempPath).catch(() => {});
		await ignoreMissing(unlink, tempReceiptPath).catch(() => {});
		if (committed) {
			await ignoreMissing(unlink, backupPath).catch(() => {});
			await ignoreMissing(unlink, backupReceiptPath).catch(() => {});
		}
	}
}

export async function updateStandaloneExecutable(expectedVersion: string): Promise<void> {
	return replaceStandaloneExecutable(expectedVersion, { targetPath: await realpath(process.execPath) });
}

function defaultUpdateCommandDependencies(): UpdateCommandDependencies {
	return {
		currentVersion: VERSION,
		getLatestRelease,
		resolveRecommendation: () => resolveInstallChannel(defaultInstallChannelDependencies(VERSION)),
		updateStandalone: updateStandaloneExecutable,
		stdout: value => console.log(value),
		stderr: value => console.error(value),
	};
}

/** Run the executable self-update policy. */
export async function runUpdateCommand(
	opts: { force: boolean; check: boolean },
	deps: UpdateCommandDependencies = defaultUpdateCommandDependencies(),
): Promise<number> {
	deps.stdout(chalk.dim(`Current version: ${deps.currentVersion}`));

	let recommendation: UpdateRecommendation;
	try {
		recommendation = await deps.resolveRecommendation();
	} catch (error) {
		deps.stderr(chalk.red(`Update blocked: installation provenance check failed: ${error}`));
		return 1;
	}
	deps.stdout(chalk.dim(`Detected channel: ${recommendation.channel}`));
	if (recommendation.action === "blocked") {
		deps.stderr(chalk.red(formatUpdateRecommendation(recommendation)));
		return 1;
	}

	let release: ReleaseInfo;
	try {
		release = await deps.getLatestRelease();
	} catch (error) {
		deps.stderr(chalk.red(`Failed to check for updates: ${error}`));
		return 1;
	}

	const comparison = compareVersions(release.version, deps.currentVersion);
	if (comparison > 0) deps.stdout(chalk.cyan(`New version available: ${release.version}`));
	else if (opts.force) deps.stdout(chalk.yellow(`Forcing update recommendation for ${release.version}`));
	else deps.stdout(chalk.green("✓ Already up to date"));

	if (opts.check) {
		deps.stdout(formatUpdateRecommendation(recommendation));
		return 0;
	}

	if (recommendation.action !== "self-update") {
		deps.stdout(formatUpdateRecommendation(recommendation));
		return 0;
	}
	if (comparison <= 0 && !opts.force) return 0;

	try {
		await deps.updateStandalone(release.version);
		deps.stdout(chalk.green(`✓ Updated to ${release.version}`));
		deps.stdout(chalk.dim(`Restart ${APP_NAME} to use the new version`));
		return 0;
	} catch (error) {
		deps.stderr(chalk.red(`Update failed: ${error}`));
		return 1;
	}
}

export function getBrewUpgradeCommand(): string {
	return "brew upgrade --cask f5-sales-demo/tap/xcsh";
}
