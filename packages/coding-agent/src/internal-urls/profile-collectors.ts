import { $which, logger } from "@f5-sales-demo/pi-utils";
import { $ } from "bun";

import type { UserProfile } from "./user-profile";

export interface ProfileCollector {
	/** Unique identifier for this collector */
	readonly id: string;
	/** Human-readable name */
	readonly name: string;
	/** Fields this collector is the authoritative source for. Overwrites even pre-existing values. */
	readonly authoritativeFields?: readonly string[];
	/** Check if this collector can run (binary exists, platform ok, etc.) */
	available(): Promise<boolean>;
	/** Run the collector and return partial profile fields to merge */
	collect(): Promise<Partial<UserProfile>>;
}

// ---------------------------------------------------------------------------
// Shared helpers (pure — unit-tested directly, no I/O)
// ---------------------------------------------------------------------------

/**
 * Split a full name into given + family. The first whitespace token is the
 * given name; everything after it is the family name. Blank input yields {}.
 */
export function splitFullName(full: string): { givenName?: string; familyName?: string } {
	const trimmed = full.trim();
	if (!trimmed) return {};
	const parts = trimmed.split(/\s+/);
	const out: { givenName?: string; familyName?: string } = { givenName: parts[0] };
	if (parts.length > 1) out.familyName = parts.slice(1).join(" ");
	return out;
}

// ---------------------------------------------------------------------------
// Salesforce
// ---------------------------------------------------------------------------

const SALESFORCE_SOQL_FIELDS =
	"Id, Username, FirstName, LastName, Email, Title, Department, Division, CompanyName, " +
	"ManagerId, Manager.Name, Manager.Email, Street, City, State, PostalCode, Country, Phone, MobilePhone";

/** Map a single Salesforce `User` SOQL record onto profile fields. */
export function parseSalesforceUserRecord(rec: Record<string, unknown>): Partial<UserProfile> {
	const profile: Partial<UserProfile> = {};

	if (rec.FirstName) profile.givenName = rec.FirstName as string;
	if (rec.LastName) profile.familyName = rec.LastName as string;
	if (rec.Email) profile.email = rec.Email as string;

	const phone = (rec.Phone || rec.MobilePhone) as string | undefined;
	if (phone) profile.telephone = phone;

	if (rec.Title) profile.jobTitle = rec.Title as string;
	if (rec.Department) profile.department = rec.Department as string;
	if (rec.Division) profile.division = rec.Division as string;

	profile.worksFor = { name: (rec.CompanyName as string) || "F5" };

	const mgr = rec.Manager as Record<string, unknown> | undefined;
	if (mgr && (mgr.Name || mgr.Email)) {
		profile.manager = {};
		if (mgr.Name) Object.assign(profile.manager, splitFullName(mgr.Name as string));
		if (mgr.Email) profile.manager.email = mgr.Email as string;
	}

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

	if (rec.Id) profile.identifiers = { ...profile.identifiers, salesforceId: rec.Id as string };

	return profile;
}

const salesforceCollector: ProfileCollector = {
	id: "salesforce",
	name: "Salesforce",
	authoritativeFields: ["givenName", "familyName", "email", "jobTitle", "department", "division", "worksFor"],

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
			const orgProc = await $`sf org display --json`.quiet().nothrow();
			if (orgProc.exitCode !== 0) return {};
			const orgData = JSON.parse(orgProc.stdout.toString()) as Record<string, unknown>;
			const orgResult = orgData.result as Record<string, unknown> | undefined;
			const username = orgResult?.username as string | undefined;
			if (!username) return {};

			const soql = `SELECT ${SALESFORCE_SOQL_FIELDS} FROM User WHERE Username = '${username}'`;
			const queryProc = await $`sf data query --query ${soql} --json`.quiet().nothrow();
			if (queryProc.exitCode !== 0) return {};

			const queryData = JSON.parse(queryProc.stdout.toString()) as Record<string, unknown>;
			const queryResult = queryData.result as Record<string, unknown> | undefined;
			const records = queryResult?.records as Record<string, unknown>[] | undefined;
			const rec = records?.[0];
			if (!rec) return {};

			return parseSalesforceUserRecord(rec);
		} catch (err: unknown) {
			logger.debug("salesforce collector failed", { error: err });
			return {};
		}
	},
};

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

/** Map `gh api user` JSON output onto profile fields. */
export function parseGithubUserJson(stdout: string): Partial<UserProfile> {
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(stdout) as Record<string, unknown>;
	} catch {
		return {};
	}

	const profile: Partial<UserProfile> = {};
	const sameAs: string[] = [];

	const login = data.login as string | undefined;
	if (login) {
		profile.identifiers = { ...profile.identifiers, github: login };
		sameAs.push(`https://github.com/${login}`);
	}

	const name = data.name as string | undefined;
	if (name) Object.assign(profile, splitFullName(name));

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
}

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
			return parseGithubUserJson(proc.stdout.toString());
		} catch (err: unknown) {
			logger.debug("github collector failed", { error: err });
			return {};
		}
	},
};

// ---------------------------------------------------------------------------
// Git (local config)
// ---------------------------------------------------------------------------

const gitCollector: ProfileCollector = {
	id: "git",
	name: "Git",

	async available(): Promise<boolean> {
		return Boolean($which("git"));
	},

	async collect(): Promise<Partial<UserProfile>> {
		try {
			const profile: Partial<UserProfile> = {};

			const nameProc = await $`git config --get user.name`.quiet().nothrow();
			if (nameProc.exitCode === 0) {
				const name = nameProc.stdout.toString().trim();
				if (name) Object.assign(profile, splitFullName(name));
			}

			const emailProc = await $`git config --get user.email`.quiet().nothrow();
			if (emailProc.exitCode === 0) {
				const email = emailProc.stdout.toString().trim();
				if (email) profile.email = email;
			}

			return profile;
		} catch (err: unknown) {
			logger.debug("git collector failed", { error: err });
			return {};
		}
	},
};

// ---------------------------------------------------------------------------
// System (identity + UI languages)
// ---------------------------------------------------------------------------

async function detectDarwinLanguages(): Promise<string[]> {
	const proc = await $`defaults read NSGlobalDomain AppleLanguages`.quiet().nothrow();
	if (proc.exitCode !== 0) return [];

	const raw = proc.stdout.toString().trim();
	const inner = raw.replace(/^\(\s*/, "").replace(/\s*\)$/, "");
	return inner
		.split(",")
		.map(s => s.trim().replace(/^"/, "").replace(/"$/, ""))
		.filter(s => s.length > 0);
}

function detectLinuxLanguages(): string[] {
	const languages: string[] = [];

	// $LANGUAGE is a colon-separated priority list (e.g., "fr:de:en")
	const langList = process.env.LANGUAGE;
	if (langList) {
		for (const l of langList.split(":")) {
			const trimmed = l.trim();
			if (trimmed) languages.push(trimmed);
		}
	}

	// Fall back to $LANG (e.g., "fr_FR.UTF-8")
	if (languages.length === 0) {
		const lang = process.env.LANG;
		if (lang) {
			const code = lang.split(".")[0];
			if (code && code !== "C" && code !== "POSIX") languages.push(code.replace(/_/g, "-"));
		}
	}

	return languages;
}

/** Best-effort full name from the OS account record (macOS `id -F`, Linux GECOS). */
async function detectSystemFullName(): Promise<string> {
	if (process.platform === "darwin") {
		const proc = await $`id -F`.quiet().nothrow();
		if (proc.exitCode === 0) return proc.stdout.toString().trim();
		return "";
	}

	// Linux: GECOS field (comma-separated) of the passwd entry for the current user.
	const user = process.env.USER || process.env.LOGNAME;
	if (!user || !$which("getent")) return "";
	const proc = await $`getent passwd ${user}`.quiet().nothrow();
	if (proc.exitCode !== 0) return "";
	const gecos = proc.stdout.toString().trim().split(":")[6] ?? "";
	return gecos.split(",")[0]?.trim() ?? "";
}

const systemCollector: ProfileCollector = {
	id: "system",
	name: "System",

	async available(): Promise<boolean> {
		return process.platform === "darwin" || process.platform === "linux";
	},

	async collect(): Promise<Partial<UserProfile>> {
		const profile: Partial<UserProfile> = {};
		try {
			const fullName = await detectSystemFullName();
			if (fullName) Object.assign(profile, splitFullName(fullName));
		} catch (err: unknown) {
			logger.debug("system collector: name detection failed", { error: err });
		}
		try {
			const languages = process.platform === "darwin" ? await detectDarwinLanguages() : detectLinuxLanguages();
			if (languages.length > 0) profile.knowsLanguage = languages;
		} catch (err: unknown) {
			logger.debug("system collector: language detection failed", { error: err });
		}
		return profile;
	},
};

// ---------------------------------------------------------------------------
// Registry
//
// Order encodes seed priority: `mergeProfile` is first-wins for scalar fields,
// so higher-trust identity sources come first (Salesforce → GitHub → git →
// system). Plugins may append more via `registerProfileCollector`.
// ---------------------------------------------------------------------------

const _collectors: ProfileCollector[] = [salesforceCollector, githubCollector, gitCollector, systemCollector];

export const PROFILE_COLLECTORS: readonly ProfileCollector[] = _collectors;

export function registerProfileCollector(collector: ProfileCollector): void {
	if (_collectors.some(c => c.id === collector.id)) {
		logger.warn(`Profile collector '${collector.id}' already registered, skipping`);
		return;
	}
	_collectors.push(collector);
}

export function unregisterProfileCollector(id: string): boolean {
	const idx = _collectors.findIndex(c => c.id === id);
	if (idx === -1) return false;
	_collectors.splice(idx, 1);
	return true;
}

export const collectorRegistry = {
	register: registerProfileCollector,
	unregister: unregisterProfileCollector,
};
