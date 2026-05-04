import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type SfUserProfile, XCSH_USER_KEY_PREFIX, XCSH_USER_KEYS } from "./types";

export function getSfConfigPath(): string {
	const sfHome = process.env.SF_HOME;
	if (sfHome) return path.join(sfHome, "config.json");
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return path.join(home, ".sf", "config.json");
}

async function readConfigFile(): Promise<Record<string, string>> {
	try {
		const raw = await fs.readFile(getSfConfigPath(), "utf8");
		return JSON.parse(raw) as Record<string, string>;
	} catch {
		return {};
	}
}

async function readConfigFileStrict(): Promise<Record<string, string>> {
	try {
		const raw = await fs.readFile(getSfConfigPath(), "utf8");
		return JSON.parse(raw) as Record<string, string>;
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}
		throw err;
	}
}

async function writeConfigFile(data: Record<string, string>): Promise<void> {
	const configPath = getSfConfigPath();
	await fs.mkdir(path.dirname(configPath), { recursive: true });
	await fs.writeFile(configPath, JSON.stringify(data, null, 2), "utf8");
}

export async function loadUserProfile(): Promise<SfUserProfile | null> {
	const config = await readConfigFile();
	const idKey = XCSH_USER_KEYS.userId;
	if (!config[idKey]) return null;

	const profile: Record<string, string | undefined> = {};
	for (const [field, configKey] of Object.entries(XCSH_USER_KEYS)) {
		const value = config[configKey];
		if (value !== undefined) profile[field] = value;
	}

	if (
		!profile.userId ||
		!profile.username ||
		!profile.firstName ||
		!profile.lastName ||
		!profile.email ||
		!profile.fetchedAt
	) {
		return null;
	}

	return profile as unknown as SfUserProfile;
}

export async function saveUserProfile(profile: SfUserProfile): Promise<void> {
	const config = await readConfigFileStrict();

	for (const [field, configKey] of Object.entries(XCSH_USER_KEYS)) {
		const value = profile[field as keyof SfUserProfile];
		if (value !== undefined && value !== null) {
			config[configKey] = String(value);
		}
	}

	await writeConfigFile(config);
}

export async function clearUserProfile(): Promise<void> {
	const config = await readConfigFileStrict();
	const cleaned: Record<string, string> = {};
	for (const [key, value] of Object.entries(config)) {
		if (!key.startsWith(XCSH_USER_KEY_PREFIX)) {
			cleaned[key] = value;
		}
	}
	await writeConfigFile(cleaned);
}
