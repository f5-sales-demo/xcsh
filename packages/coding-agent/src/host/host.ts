import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { runCli } from "../person-profile/collectors";
import { type HostManagement, probeManagement } from "./management";

export interface HostInfo {
	readonly os: NodeJS.Platform;
	readonly architecture: string;
	readonly management: HostManagement;
	readonly packageManagers: Readonly<Partial<Record<"brew" | "apt" | "winget" | "sudo", string>>>;
	readonly effectiveUid?: number;
	readonly sudo: "available" | "unavailable" | "unknown";
	readonly distribution?: string;
}
export function findExecutable(name: string): string | undefined {
	const path =
		Bun.which(name, { PATH: process.env.PATH }) ?? Bun.which(join(homedir(), ".local", "bin", name)) ?? undefined;
	if (path) exposeExecutable(path);
	return path;
}
export async function executableIdentity(path: string): Promise<string> {
	const target = await realpath(path);
	const info = await stat(target);
	return JSON.stringify([
		path,
		target,
		info.dev,
		info.ino,
		info.size,
		info.mtimeMs,
		info.mode,
		createHash("sha256")
			.update(await readFile(target))
			.digest("hex"),
	]);
}
export function exposeExecutable(path: string): void {
	const directory = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
	const parts = (process.env.PATH ?? "").split(delimiter);
	if (!parts.includes(directory)) process.env.PATH = [directory, ...parts].join(delimiter);
}
export async function getHost(signal?: AbortSignal): Promise<HostInfo> {
	signal?.throwIfAborted();
	const managers: Partial<Record<"brew" | "apt" | "winget" | "sudo", string>> = {};
	for (const [key, name] of [
		["brew", "brew"],
		["apt", "apt-get"],
		["winget", "winget"],
		["sudo", "sudo"],
	] as const) {
		const path = Bun.which(name, { PATH: process.env.PATH });
		if (path) managers[key] = path;
	}
	let distribution: string | undefined;
	if (process.platform === "linux")
		try {
			distribution = (await readFile("/etc/os-release", "utf8")).match(/^ID=["']?([^"'\n]+)["']?/m)?.[1];
		} catch {
			/* unknown */
		}
	const effectiveUid = process.geteuid?.();
	const sudoResult =
		effectiveUid === 0 || !managers.sudo ? undefined : await runCli([managers.sudo, "-n", "-l"], 5000, signal);
	const management = await probeManagement(signal);
	signal?.throwIfAborted();
	return Object.freeze({
		os: process.platform,
		architecture: process.arch,
		management: management.status,
		packageManagers: Object.freeze(managers),
		effectiveUid,
		sudo: effectiveUid === 0 || sudoResult?.exitCode === 0 ? "available" : managers.sudo ? "unknown" : "unavailable",
		distribution,
	});
}
export const host = Object.freeze({ get: getHost, findExecutable });
