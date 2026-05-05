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
// Salesforce
// ---------------------------------------------------------------------------

const salesforceCollector: ProfileCollector = {
	id: "salesforce",
	name: "Salesforce",

	async available(): Promise<boolean> {
		if (!$which("sf")) return false;
		try {
			const proc = await $`sf org display --json`.quiet().nothrow();
			if (proc.exitCode !== 0) return false;
			const parsed = JSON.parse(proc.stdout.toString()) as Record<string, unknown>;
			const result = parsed.result as Record<string, unknown> | undefined;
			return typeof result?.username === "string" && result.username.length > 0;
		} catch {
			return false;
		}
	},

	async collect(): Promise<Partial<UserProfile>> {
		try {
			// Get username
			const orgProc = await $`sf org display --json`.quiet().nothrow();
			if (orgProc.exitCode !== 0) return {};
			const orgData = JSON.parse(orgProc.stdout.toString()) as Record<string, unknown>;
			const orgResult = orgData.result as Record<string, unknown> | undefined;
			const username = orgResult?.username as string | undefined;
			if (!username) return {};

			// Build and run SOQL
			const soql = `SELECT Id, Username, FirstName, LastName, Email, Title, Department, Division, CompanyName, AboutMe, ManagerId, Manager.Name, Manager.Email, UserRole.Name, Profile.Name, Street, City, State, PostalCode, Country, Phone, MobilePhone FROM User WHERE Username = '${username}'`;
			const queryProc = await $`sf data query --query ${soql} --json`.quiet().nothrow();
			if (queryProc.exitCode !== 0) return {};

			const queryData = JSON.parse(queryProc.stdout.toString()) as Record<string, unknown>;
			const queryResult = queryData.result as Record<string, unknown> | undefined;
			const records = queryResult?.records as Record<string, unknown>[] | undefined;
			const rec = records?.[0];
			if (!rec) return {};

			// Map fields
			const profile: Partial<UserProfile> = {};

			if (rec.FirstName) profile.givenName = rec.FirstName as string;
			if (rec.LastName) profile.familyName = rec.LastName as string;
			if (rec.Email) profile.email = rec.Email as string;

			const phone = (rec.Phone || rec.MobilePhone) as string | undefined;
			if (phone) profile.telephone = phone;

			if (rec.Title) profile.jobTitle = rec.Title as string;
			if (rec.Department) profile.department = rec.Department as string;
			if (rec.Division) profile.division = rec.Division as string;

			const companyName = (rec.CompanyName as string) || "F5";
			profile.worksFor = { name: companyName };

			// Manager
			const mgr = rec.Manager as Record<string, unknown> | undefined;
			if (mgr) {
				const mgrName = mgr.Name as string | undefined;
				const mgrEmail = mgr.Email as string | undefined;
				if (mgrName || mgrEmail) {
					profile.manager = {};
					if (mgrName) {
						const parts = mgrName.split(" ");
						profile.manager.givenName = parts[0];
						if (parts.length > 1) profile.manager.familyName = parts.slice(1).join(" ");
					}
					if (mgrEmail) profile.manager.email = mgrEmail;
				}
			}

			// Address
			const street = rec.Street as string | undefined;
			const city = rec.City as string | undefined;
			const state = rec.State as string | undefined;
			const postalCode = rec.PostalCode as string | undefined;
			const country = rec.Country as string | undefined;
			if (street || city || state || postalCode || country) {
				profile.address = {};
				if (street) profile.address.streetAddress = street;
				if (city) profile.address.addressLocality = city;
				if (state) profile.address.addressRegion = state;
				if (postalCode) profile.address.postalCode = postalCode;
				if (country) profile.address.addressCountry = country;
			}

			// Identifiers
			if (rec.Id) {
				profile.identifiers = { salesforceId: rec.Id as string };
			}

			return profile;
		} catch (err: unknown) {
			logger.debug("salesforce collector failed", { error: err });
			return {};
		}
	},
};

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

export const PROFILE_COLLECTORS: readonly ProfileCollector[] = [salesforceCollector, githubCollector, systemCollector];
