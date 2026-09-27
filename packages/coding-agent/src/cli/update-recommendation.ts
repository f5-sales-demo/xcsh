import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const PACKAGE = "@f5-sales-demo/xcsh";
const WINDOWS_INSTALL_COMMAND =
	"irm https://raw.githubusercontent.com/f5-sales-demo/xcsh/main/scripts/install.ps1 | iex";

export type InstallChannel =
	| "homebrew-cask"
	| "macos-mdm"
	| "debian-apt"
	| "npm"
	| "bun"
	| "standalone"
	| "windows-installer"
	| "unknown";

export type UpdateRecommendation = {
	channel: InstallChannel;
	action: "external-command" | "self-update" | "managed" | "blocked";
	command?: string;
	evidence: string;
};

type CommandResult = { exitCode: number; stdout: string; stderr: string };

export interface InstallChannelDependencies {
	platform: NodeJS.Platform;
	arch: string;
	execPath: string;
	version: string;
	homeDir: string;
	env: NodeJS.ProcessEnv;
	realpath(value: string): Promise<string>;
	readFile(value: string): Promise<string>;
	run(command: string, args: string[]): Promise<CommandResult>;
}

interface InstallReceipt {
	schemaVersion: 1;
	channel: "standalone" | "windows-installer";
	version: string;
	executablePath: string;
	platform: string;
	arch: string;
}

function platformPath(platform: NodeJS.Platform): typeof path.posix | typeof path.win32 {
	return platform === "win32" ? path.win32 : path.posix;
}

function comparablePath(value: string, platform: NodeJS.Platform): string {
	const normalized = platformPath(platform).resolve(value);
	return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function releaseAsset(platform: NodeJS.Platform, arch: string): string | undefined {
	if (platform === "linux" && (arch === "x64" || arch === "arm64")) return `xcsh-linux-${arch}`;
	if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return `xcsh-darwin-${arch}`;
	if (platform === "win32" && arch === "x64") return "xcsh-windows-x64.exe";
	return undefined;
}

function expectedReleaseCacheBinary(deps: InstallChannelDependencies): string | undefined {
	const asset = releaseAsset(deps.platform, deps.arch);
	if (!asset) return undefined;
	const pathApi = platformPath(deps.platform);
	const cacheRoot =
		deps.env.XCSH_RELEASE_CACHE_DIR ??
		(deps.platform === "win32"
			? pathApi.join(deps.env.LOCALAPPDATA ?? deps.env.TEMP ?? deps.homeDir, "xcsh", "releases")
			: pathApi.join(deps.env.XDG_CACHE_HOME ?? pathApi.join(deps.homeDir, ".cache"), "xcsh", "releases"));
	return pathApi.join(cacheRoot, `v${deps.version}`, `${deps.platform}-${deps.arch}`, asset);
}

function receiptIsValid(
	value: unknown,
	deps: InstallChannelDependencies,
	resolvedExecPath: string,
): value is InstallReceipt {
	if (!value || typeof value !== "object") return false;
	const receipt = value as Partial<InstallReceipt>;
	if (
		receipt.schemaVersion !== 1 ||
		(receipt.channel !== "standalone" && receipt.channel !== "windows-installer") ||
		receipt.version !== deps.version ||
		receipt.platform !== deps.platform ||
		receipt.arch !== deps.arch ||
		typeof receipt.executablePath !== "string" ||
		comparablePath(receipt.executablePath, deps.platform) !== comparablePath(resolvedExecPath, deps.platform)
	) {
		return false;
	}
	if (receipt.channel === "standalone") return deps.platform !== "win32";
	if (deps.platform !== "win32") return false;
	const localAppData = deps.env.LOCALAPPDATA;
	if (!localAppData) return false;
	return (
		comparablePath(resolvedExecPath, deps.platform) ===
		comparablePath(path.win32.join(localAppData, "xcsh", "xcsh.exe"), deps.platform)
	);
}

async function defaultRun(command: string, args: string[]): Promise<CommandResult> {
	try {
		const child = Bun.spawn([command, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return { exitCode, stdout, stderr };
	} catch (error) {
		return { exitCode: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	}
}

export function defaultInstallChannelDependencies(version: string): InstallChannelDependencies {
	return {
		platform: process.platform,
		arch: process.arch,
		execPath: process.execPath,
		version,
		homeDir: homedir(),
		env: process.env,
		realpath,
		readFile: value => readFile(value, "utf8"),
		run: defaultRun,
	};
}

function recommendationFor(channel: Exclude<InstallChannel, "unknown">, evidence: string): UpdateRecommendation {
	switch (channel) {
		case "homebrew-cask":
			return {
				channel,
				action: "external-command",
				command: "brew upgrade --cask f5-sales-demo/tap/xcsh",
				evidence,
			};
		case "macos-mdm":
			return { channel, action: "managed", evidence };
		case "debian-apt":
			return {
				channel,
				action: "external-command",
				command: "sudo apt-get update && sudo apt-get install --only-upgrade xcsh",
				evidence,
			};
		case "npm":
		case "bun":
			return {
				channel,
				action: "external-command",
				command: `${channel} update --global ${PACKAGE}`,
				evidence,
			};
		case "standalone":
			return { channel, action: "self-update", command: "xcsh self-update", evidence };
		case "windows-installer":
			return { channel, action: "external-command", command: WINDOWS_INSTALL_COMMAND, evidence };
	}
}

/** Resolve the owner of the running executable without mutating the installation. */
export async function resolveInstallChannel(deps: InstallChannelDependencies): Promise<UpdateRecommendation> {
	let resolvedExecPath: string;
	try {
		resolvedExecPath = await deps.realpath(deps.execPath);
	} catch {
		return { channel: "unknown", action: "blocked", evidence: "running executable could not be resolved" };
	}

	const signals: Array<{ channel: Exclude<InstallChannel, "unknown">; evidence: string }> = [];
	const diagnostics: string[] = [];
	const normalizedResolved = resolvedExecPath.replaceAll("\\", "/");

	if (
		deps.platform === "darwin" &&
		/^\/(?:opt\/homebrew|usr\/local)\/Caskroom\/xcsh\/[^/]+\/bin\/xcsh$/u.test(normalizedResolved)
	) {
		signals.push({ channel: "homebrew-cask", evidence: `running executable resolves to ${resolvedExecPath}` });
	}

	if (deps.platform === "darwin" && deps.execPath === "/usr/local/bin/xcsh" && resolvedExecPath === deps.execPath) {
		const pkg = await deps.run("pkgutil", ["--pkg-info", "com.f5.xcsh"]);
		const files = await deps.run("pkgutil", ["--files", "com.f5.xcsh"]);
		if (
			pkg.exitCode === 0 &&
			/(?:^|\n)package-id:\s*com\.f5\.xcsh(?:\n|$)/u.test(pkg.stdout) &&
			files.exitCode === 0 &&
			files.stdout.split("\n").some(line => line.trim() === "usr/local/bin/xcsh")
		) {
			signals.push({
				channel: "macos-mdm",
				evidence: "exact /usr/local/bin/xcsh identity and com.f5.xcsh receipt",
			});
		}
	}

	if (deps.platform === "linux") {
		const dpkg = await deps.run("dpkg-query", ["--search", resolvedExecPath]);
		if (dpkg.exitCode === 0 && dpkg.stdout.split("\n").some(line => line.trim() === `xcsh: ${resolvedExecPath}`)) {
			signals.push({ channel: "debian-apt", evidence: `dpkg package xcsh owns ${resolvedExecPath}` });
		}
	}

	const marker = deps.env.XCSH_DISTRIBUTION_CHANNEL;
	if (marker === "npm" || marker === "bun") {
		const expectedBinary = expectedReleaseCacheBinary(deps);
		if (
			expectedBinary &&
			comparablePath(expectedBinary, deps.platform) === comparablePath(resolvedExecPath, deps.platform)
		) {
			signals.push({
				channel: marker,
				evidence: `${marker} launcher marker and compiled-release cache path ${resolvedExecPath}`,
			});
		} else {
			diagnostics.push(`invalid ${marker} launcher marker for ${resolvedExecPath}`);
		}
	} else if (marker) {
		diagnostics.push(`invalid launcher marker ${marker}`);
	}

	const receiptPath = platformPath(deps.platform).join(
		platformPath(deps.platform).dirname(resolvedExecPath),
		"xcsh-install.json",
	);
	try {
		const parsed = JSON.parse(await deps.readFile(receiptPath));
		if (receiptIsValid(parsed, deps, resolvedExecPath)) {
			signals.push({
				channel: parsed.channel,
				evidence: `valid schema-v1 ${parsed.channel} receipt at ${receiptPath}`,
			});
		} else {
			diagnostics.push(`invalid or stale install receipt at ${receiptPath}`);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			diagnostics.push(`malformed install receipt at ${receiptPath}`);
		}
	}

	const uniqueChannels = [...new Set(signals.map(signal => signal.channel))];
	if (uniqueChannels.length > 1 || (uniqueChannels.length > 0 && diagnostics.length > 0)) {
		return {
			channel: "unknown",
			action: "blocked",
			evidence: `conflicting installation evidence: ${[...uniqueChannels, ...diagnostics].join(", ")}`,
		};
	}
	if (signals.length === 1) return recommendationFor(signals[0].channel, signals[0].evidence);
	if (signals.length > 1)
		return recommendationFor(signals[0].channel, signals.map(signal => signal.evidence).join("; "));

	return {
		channel: "unknown",
		action: "blocked",
		evidence: diagnostics.join("; ") || `no trusted installation provenance for ${resolvedExecPath}`,
	};
}

export function formatUpdateRecommendation(recommendation: UpdateRecommendation): string {
	switch (recommendation.action) {
		case "external-command":
			return `Update with: ${recommendation.command}\nNo update was performed; this installation is owned by ${recommendation.channel}.`;
		case "managed":
			return "Managed by your organization; request an MDM deployment.\nNo update was performed.";
		case "self-update":
			return "This official standalone installation can update itself with: xcsh self-update";
		case "blocked":
			return `Update blocked: ${recommendation.evidence}. Reinstall using the documented installation channel that owns this executable.`;
	}
}

export function formatStartupUpdateNotice(version: string, recommendation: UpdateRecommendation): string {
	const prefix = `Update available: v${version} — `;
	if (recommendation.action === "external-command") return `${prefix}run: ${recommendation.command}`;
	if (recommendation.action === "managed") return `${prefix}managed by your organization; request an MDM deployment`;
	if (recommendation.action === "self-update") return `${prefix}run: xcsh self-update`;
	return `${prefix}update blocked: ${recommendation.evidence}`;
}

export interface StartupUpdateDependencies {
	getLatestVersion(currentVersion: string): Promise<string | undefined>;
	resolveRecommendation(): Promise<UpdateRecommendation>;
}

export async function getStartupUpdateNotice(
	currentVersion: string,
	deps: StartupUpdateDependencies,
): Promise<string | undefined> {
	const latestVersion = await deps.getLatestVersion(currentVersion);
	if (!latestVersion) return undefined;
	return formatStartupUpdateNotice(latestVersion, await deps.resolveRecommendation());
}
