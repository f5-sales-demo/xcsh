import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@f5xc-salesdemos/pi-utils";
import type { SfUserProfile } from "./types";

export function getProfilePath(): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	return path.join(home, ".xcsh", "sf-profile.json");
}

export async function loadUserProfile(): Promise<SfUserProfile | null> {
	try {
		const raw = await fs.readFile(getProfilePath(), "utf8");
		const profile = JSON.parse(raw) as SfUserProfile;
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
		return profile;
	} catch (err) {
		if (isEnoent(err)) return null;
		return null;
	}
}

export async function saveUserProfile(profile: SfUserProfile): Promise<void> {
	const profilePath = getProfilePath();
	await fs.mkdir(path.dirname(profilePath), { recursive: true });
	await fs.writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
}

export async function clearUserProfile(): Promise<void> {
	try {
		await fs.unlink(getProfilePath());
	} catch (err) {
		if (!isEnoent(err)) throw err;
	}
}
