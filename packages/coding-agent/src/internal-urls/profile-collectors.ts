import { $which, logger } from "@f5xc-salesdemos/pi-utils";
import { $ } from "bun";

import type { UserProfile } from "./user-profile";

export interface ProfileCollector {
	/** Unique identifier for this collector */
	readonly id: string;
	/** Human-readable name */
	readonly name: string;
	/** Check if this collector can run (binary exists, platform ok, etc.) */
	available(): Promise<boolean>;
	/** Run the collector and return partial profile fields to merge */
	collect(): Promise<Partial<UserProfile>>;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

const githubCollector: ProfileCollector = {
	id: "github",
	name: "GitHub",

	async available(): Promise<boolean> {
		if (!$which("gh")) return false;
		try {
			const proc = await $`gh auth status`.quiet().nothrow();
			return proc.exitCode === 0;
		} catch {
			return false;
		}
	},

	async collect(): Promise<Partial<UserProfile>> {
		try {
			const proc = await $`gh api user`.quiet().nothrow();
			if (proc.exitCode !== 0) return {};

			const data = JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
			const profile: Partial<UserProfile> = {};
			const sameAs: string[] = [];

			const login = data.login as string | undefined;
			if (login) {
				profile.identifiers = { ...profile.identifiers, github: login };
				sameAs.push(`https://github.com/${login}`);
			}

			const name = data.name as string | undefined;
			if (name) {
				const parts = name.split(" ");
				if (parts.length >= 2) {
					profile.givenName = parts[0];
					profile.familyName = parts.slice(1).join(" ");
				}
			}

			const email = data.email as string | undefined;
			if (email) profile.email = email;

			const bio = data.bio as string | undefined;
			if (bio) profile.description = bio;

			const blog = data.blog as string | undefined;
			if (blog) {
				profile.url = blog;
				sameAs.push(blog);
			}

			const twitterUsername = data.twitter_username as string | undefined;
			if (twitterUsername) {
				profile.identifiers = { ...profile.identifiers, twitter: twitterUsername };
				sameAs.push(`https://x.com/${twitterUsername}`);
			}

			if (sameAs.length > 0) profile.sameAs = sameAs;

			return profile;
		} catch (err: unknown) {
			logger.debug("github collector failed", { error: err });
			return {};
		}
	},
};

// ---------------------------------------------------------------------------
// System (macOS)
// ---------------------------------------------------------------------------

const systemCollector: ProfileCollector = {
	id: "system",
	name: "System",

	async available(): Promise<boolean> {
		return process.platform === "darwin";
	},

	async collect(): Promise<Partial<UserProfile>> {
		try {
			const proc = await $`defaults read NSGlobalDomain AppleLanguages`.quiet().nothrow();
			if (proc.exitCode !== 0) return {};

			const raw = proc.stdout.toString().trim();
			// Plist array format: (\n    "en-US",\n    "fr-FR"\n)
			const inner = raw.replace(/^\(\s*/, "").replace(/\s*\)$/, "");
			const languages = inner
				.split(",")
				.map(s => s.trim().replace(/^"/, "").replace(/"$/, ""))
				.filter(s => s.length > 0);

			if (languages.length === 0) return {};
			return { knowsLanguage: languages };
		} catch (err: unknown) {
			logger.debug("system collector failed", { error: err });
			return {};
		}
	},
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PROFILE_COLLECTORS: readonly ProfileCollector[] = [githubCollector, systemCollector];
