import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IntegrationSetupPlan, IntegrationSetupStep } from "../integrations/types";
import { executableIdentity, exposeExecutable, findExecutable, getHost, type HostInfo } from "./host";

export interface ArchiveRecipe {
	readonly manifestUrl: string;
	readonly baseDir: string;
	readonly executable: string;
}
export interface SoftwareRecipe {
	readonly id: string;
	readonly executable: string;
	readonly versionArgs: readonly string[];
	readonly brew?: { readonly package: string; readonly cask?: boolean };
	readonly apt?: readonly string[];
	readonly winget?: string;
	readonly archive?: ArchiveRecipe;
}
export interface SoftwareResolution {
	readonly executable: string;
	readonly installer: string;
	readonly elevation: "none" | "sudo";
	readonly steps: readonly IntegrationSetupStep[];
	readonly notes: readonly string[];
	readonly validate: (signal?: AbortSignal) => Promise<void>;
}
export interface SoftwareEnvironment {
	host(signal?: AbortSignal): Promise<HostInfo>;
	find(name: string): string | undefined;
	identity(path: string): Promise<string>;
	run(argv: readonly string[], signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }>;
	exists(path: string): Promise<boolean>;
	home: string;
	dataHome: string;
}
async function boundedRun(argv: readonly string[], signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(15_000);
	const child = Bun.spawn([...argv], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		killSignal: "SIGKILL",
	});
	const reader = child.stdout.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 1024 * 1024) {
				child.kill("SIGKILL");
				throw new Error("Software probe exceeded output limit");
			}
			chunks.push(value);
		}
		return { code: await child.exited, stdout: Buffer.concat(chunks).toString(), stderr: "" };
	} finally {
		reader.releaseLock();
	}
}
const environment: SoftwareEnvironment = {
	host: getHost,
	find: findExecutable,
	identity: executableIdentity,
	run: boundedRun,
	home: homedir(),
	dataHome: process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
	exists: async path => {
		try {
			await lstat(path);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	},
};
export function parseArchiveManifest(value: unknown, architecture: string, recipe: ArchiveRecipe) {
	const data = value as { version?: unknown; gz?: unknown; sha256gz?: unknown; baseDir?: unknown };
	if (
		!data ||
		typeof data.version !== "string" ||
		!/^\d+\.\d+\.\d+$/.test(data.version) ||
		typeof data.gz !== "string" ||
		typeof data.sha256gz !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.sha256gz) ||
		data.baseDir !== recipe.baseDir
	)
		throw new Error("Invalid official archive manifest");
	const url = new URL(data.gz);
	const authority = new URL(recipe.manifestUrl);
	if (
		url.protocol !== "https:" ||
		url.origin !== authority.origin ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!url.pathname.includes(`/versions/${data.version}/`) ||
		!url.pathname.endsWith(`-linux-${architecture}.tar.gz`)
	)
		throw new Error("Invalid official archive manifest URL");
	return { version: data.version, url: url.href, sha256: data.sha256gz };
}
export async function resolveSoftware(
	recipe: SoftwareRecipe,
	signal?: AbortSignal,
	env = environment,
): Promise<SoftwareResolution> {
	signal?.throwIfAborted();
	if (
		!/^[a-z][a-z0-9_-]*$/.test(recipe.id) ||
		!/^[a-z][a-z0-9_-]*$/.test(recipe.executable) ||
		!recipe.versionArgs.length ||
		recipe.versionArgs.some(arg => typeof arg !== "string" || arg.includes("\0")) ||
		recipe.apt?.some(pkg => !/^[a-z0-9][a-z0-9+.-]*$/.test(pkg)) ||
		(recipe.brew && !/^[a-z0-9][a-z0-9@+._/-]*$/.test(recipe.brew.package)) ||
		(recipe.winget && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(recipe.winget))
	)
		throw new Error("Invalid software recipe");
	const info = await env.host(signal);
	const existing = env.find(recipe.executable);
	const fingerprint = async (current: HostInfo) =>
		JSON.stringify([
			current,
			env.find(recipe.executable),
			...(await Promise.all(Object.values(current.packageManagers).map(path => env.identity(path)))),
			env.find(recipe.executable) ? await env.identity(env.find(recipe.executable)!) : undefined,
		]);
	const initial = await fingerprint(info);
	let executable = existing ?? recipe.executable;
	let installer = "existing executable";
	let elevation: "none" | "sudo" = "none";
	const steps: IntegrationSetupStep[] = [];
	const notes: string[] = [];
	const aptPolicies = new Map<string, string>();
	let archiveDestination: string | undefined;
	let link: string | undefined;
	if (!existing && (await env.exists(join(env.home, ".local", "bin", recipe.executable))))
		throw new Error("Conflicting executable path exists. Inspect ~/.local/bin before reviewing setup again.");
	if (existing) {
		let valid = false;
		try {
			const result = await env.run([existing, ...recipe.versionArgs], signal);
			valid = result.code === 0 && /\d+\.\d+/.test(result.stdout);
		} catch {
			signal?.throwIfAborted();
		}
		if (!valid)
			throw new Error(
				`${recipe.executable} at ${existing} did not return a working version. Repair or remove that installation, then review setup again.`,
			);
		notes.push(`Reuse existing executable: ${existing}`);
		if (env === environment) exposeExecutable(existing);
	} else if (info.os === "darwin") {
		if (!recipe.brew || !info.packageManagers.brew)
			throw new Error("Homebrew is required on macOS. Install or make Homebrew available, then review setup again.");
		installer = "Homebrew";
		steps.push({
			kind: "install",
			argv: [info.packageManagers.brew, "install", ...(recipe.brew.cask ? ["--cask"] : []), recipe.brew.package],
			timeoutMs: 600_000,
		});
	} else if (info.os === "win32") {
		if (!recipe.winget || !info.packageManagers.winget)
			throw new Error("The official winget package and winget are required on Windows.");
		installer = "winget";
		steps.push({
			kind: "install",
			argv: [info.packageManagers.winget, "install", "--exact", "--id", recipe.winget],
			timeoutMs: 600_000,
		});
	} else if (info.os === "linux" && recipe.archive) {
		if (!["x64", "arm64"].includes(info.architecture))
			throw new Error(`Unsupported archive architecture: ${info.architecture}`);
		const url = recipe.archive.manifestUrl.replace("{arch}", info.architecture);
		const timeout = AbortSignal.timeout(30_000);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		const response = await fetch(url, {
			signal: combined,
			redirect: "error",
			headers: { "User-Agent": "curl/8.5.0 xcsh-software" },
		});
		if (!response.ok) throw new Error("Unable to fetch official stable archive manifest");
		const raw = await response.text();
		if (raw.length > 65536) throw new Error("Invalid official archive manifest size");
		const archive = parseArchiveManifest(JSON.parse(raw), info.architecture, recipe.archive);
		archiveDestination = join(env.dataHome, "xcsh", "software", recipe.id, archive.version);
		link = join(env.home, ".local", "bin", recipe.executable);
		if ((await env.exists(archiveDestination)) || (await env.exists(link)))
			throw new Error(
				"Archive destination or executable link already exists. Inspect that path before reviewing setup again.",
			);
		executable = join(archiveDestination, recipe.archive.baseDir, recipe.archive.executable);
		installer = "official archive";
		steps.push({
			kind: "archive-install",
			argv: [],
			timeoutMs: 600_000,
			archive: {
				...archive,
				destination: archiveDestination,
				link,
				baseDir: recipe.archive.baseDir,
				executable: recipe.archive.executable,
				versionArgs: recipe.versionArgs,
			},
		});
		notes.push(
			`Archive ${archive.version}: ${archive.url}`,
			`SHA-256: ${archive.sha256}`,
			`Destination: ${archiveDestination}`,
			`For direct shell use, add ${join(env.home, ".local", "bin")} to PATH. xcsh makes the executable available to subsequent setup and tools.`,
		);
	} else if (info.os === "linux") {
		if (!["debian", "ubuntu"].includes(info.distribution ?? "") || !recipe.apt?.length || !info.packageManagers.apt)
			throw new Error(
				"Declared apt packages on Debian/Ubuntu are required; configure the prerequisite yourself before setup.",
			);
		const aptCache = join(info.packageManagers.apt.slice(0, info.packageManagers.apt.lastIndexOf("/")), "apt-cache");
		for (const pkg of recipe.apt) {
			const result = await env.run([aptCache, "policy", pkg], signal);
			aptPolicies.set(pkg, result.stdout);
			if (result.code !== 0 || !/Candidate:\s*(?!\(none\))\S+/.test(result.stdout))
				throw new Error(
					`apt package ${pkg} is unavailable in configured repositories. Configure the prerequisite yourself, then review setup.`,
				);
		}
		if (info.effectiveUid !== 0) {
			if (!info.packageManagers.sudo || info.sudo !== "available")
				throw new Error("apt installation requires root or sudo capability");
			elevation = "sudo";
		}
		installer = "apt";
		steps.push({
			kind: "install",
			argv: [
				...(elevation === "sudo" ? [info.packageManagers.sudo!] : []),
				info.packageManagers.apt,
				"install",
				"--yes",
				...recipe.apt,
			],
			timeoutMs: 600_000,
			...(elevation === "sudo" ? { stdin: "inherit" } : {}),
		});
	} else throw new Error(`Unsupported host: ${info.os}`);
	notes.unshift(`Installer: ${installer}; required elevation: ${elevation}`);
	return Object.freeze({
		executable,
		installer,
		elevation,
		steps: Object.freeze(
			steps.map(step =>
				Object.freeze({
					...step,
					argv: Object.freeze([...step.argv]),
					...(step.archive
						? {
								archive: Object.freeze({
									...step.archive,
									versionArgs: Object.freeze([...step.archive.versionArgs]),
								}),
							}
						: {}),
				}),
			),
		),
		notes: Object.freeze(notes),
		validate: async (currentSignal?: AbortSignal) => {
			currentSignal?.throwIfAborted();
			if (
				initial !== (await fingerprint(await env.host(currentSignal))) ||
				(archiveDestination && (await env.exists(archiveDestination))) ||
				(link && (await env.exists(link)))
			)
				throw new Error("Software identity or prerequisites changed; review setup again");
			if (existing) {
				const result = await env.run([existing, ...recipe.versionArgs], currentSignal);
				if (result.code !== 0 || !/\d+\.\d+/.test(result.stdout))
					throw new Error("Existing executable changed; review setup again");
			}
			if (installer === "apt") {
				for (const pkg of recipe.apt!) {
					const cache = join(
						info.packageManagers.apt!.slice(0, info.packageManagers.apt!.lastIndexOf("/")),
						"apt-cache",
					);
					const result = await env.run([cache, "policy", pkg], currentSignal);
					if (result.code !== 0 || result.stdout !== aptPolicies.get(pkg))
						throw new Error("apt prerequisites changed; review setup again");
				}
			}
		},
	});
}
export async function prepareSoftwareSetup(
	recipe: SoftwareRecipe,
	plan: IntegrationSetupPlan,
	signal?: AbortSignal,
): Promise<IntegrationSetupPlan> {
	const resolution = await resolveSoftware(recipe, signal);
	const map = (argv: readonly string[]) =>
		argv[0] === recipe.executable ? [resolution.executable, ...argv.slice(1)] : argv;
	return {
		...plan,
		steps: [...resolution.steps, ...plan.steps.map(step => ({ ...step, argv: map(step.argv) }))],
		verification: plan.verification.map(step => ({ ...step, argv: map(step.argv) })),
		notes: resolution.notes,
		validate: resolution.validate,
	};
}
export const software = Object.freeze({ resolve: resolveSoftware, prepareSetup: prepareSoftwareSetup });
