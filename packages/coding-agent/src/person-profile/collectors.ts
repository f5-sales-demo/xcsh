import { $which } from "@f5-sales-demo/pi-utils";
import type { UserProfile } from "./schema";
import type { ProfileCollector } from "./service";

// ---------------------------------------------------------------------------
// Bounded CLI runner
//
// Collectors shell out to external CLIs (sf, gh, git, id, …). These run in a
// fire-and-forget background refresh, so a hung CLI must never leave a promise
// pending forever. Bun's `$` cannot be cancelled, so we spawn directly with an
// AbortSignal timeout that actually kills the child on expiry.
// ---------------------------------------------------------------------------

const CLI_TIMEOUT_MS = 15_000;

export interface CliResult {
	exitCode: number;
	stdout: string;
}

export async function runCli(cmd: string[], timeoutMs = CLI_TIMEOUT_MS, signal?: AbortSignal): Promise<CliResult> {
	try {
		const proc = Bun.spawn(cmd, {
			stdout: "pipe",
			stderr: "ignore",
			killSignal: "SIGKILL",
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
		});
		const reader = proc.stdout.getReader();
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 1024 * 1024) {
					proc.kill("SIGKILL");
					throw new Error("Collector output limit");
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const stdout = Buffer.concat(chunks).toString("utf8");
		const exitCode = await proc.exited;
		return { exitCode, stdout };
	} catch {
		return { exitCode: -1, stdout: "" };
	}
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

	if (rec.CompanyName) profile.worksFor = { name: rec.CompanyName as string };

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

	async available(signal?: AbortSignal): Promise<boolean> {
		if (!$which("sf")) return false;
		const proc = await runCli(["sf", "org", "display", "--json"], CLI_TIMEOUT_MS, signal);
		if (proc.exitCode !== 0) return false;
		try {
			const parsed = JSON.parse(proc.stdout) as Record<string, unknown>;
			const result = parsed.result as Record<string, unknown> | undefined;
			return typeof result?.username === "string" && result.username.length > 0;
		} catch {
			return false;
		}
	},

	async collect(signal?: AbortSignal): Promise<Partial<UserProfile>> {
		try {
			const orgProc = await runCli(["sf", "org", "display", "--json"], CLI_TIMEOUT_MS, signal);
			if (orgProc.exitCode !== 0) throw new Error("Collector unavailable");
			const orgData = JSON.parse(orgProc.stdout) as Record<string, unknown>;
			const orgResult = orgData.result as Record<string, unknown> | undefined;
			const username = orgResult?.username as string | undefined;
			if (typeof username !== "string" || !username || username.length > 320) return {};

			const soql = `SELECT ${SALESFORCE_SOQL_FIELDS} FROM User WHERE Username = '${username.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
			const queryProc = await runCli(["sf", "data", "query", "--query", soql, "--json"], CLI_TIMEOUT_MS, signal);
			if (queryProc.exitCode !== 0) throw new Error("Collector unavailable");

			const queryData = JSON.parse(queryProc.stdout) as Record<string, unknown>;
			const queryResult = queryData.result as Record<string, unknown> | undefined;
			const records = queryResult?.records as Record<string, unknown>[] | undefined;
			const rec = records?.[0];
			if (!rec) return {};

			return parseSalesforceUserRecord(rec);
		} catch {
			throw new Error("Collector unavailable");
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
		throw new Error("Collector unavailable");
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

	async available(signal?: AbortSignal): Promise<boolean> {
		if (!$which("gh")) return false;
		const proc = await runCli(["gh", "auth", "status"], CLI_TIMEOUT_MS, signal);
		return proc.exitCode === 0;
	},

	async collect(signal?: AbortSignal): Promise<Partial<UserProfile>> {
		const proc = await runCli(["gh", "api", "user"], CLI_TIMEOUT_MS, signal);
		if (proc.exitCode !== 0) throw new Error("Collector unavailable");
		return parseGithubUserJson(proc.stdout);
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

	async collect(signal?: AbortSignal): Promise<Partial<UserProfile>> {
		const profile: Partial<UserProfile> = {};

		const nameProc = await runCli(["git", "config", "--global", "--get", "user.name"], CLI_TIMEOUT_MS, signal);
		if (nameProc.exitCode === 0) {
			const name = nameProc.stdout.trim();
			if (name) Object.assign(profile, splitFullName(name));
		}

		const emailProc = await runCli(["git", "config", "--global", "--get", "user.email"], CLI_TIMEOUT_MS, signal);
		if (emailProc.exitCode === 0) {
			const email = emailProc.stdout.trim();
			if (email) profile.email = email;
		}

		return profile;
	},
};

// ---------------------------------------------------------------------------
// System (identity + UI languages)
// ---------------------------------------------------------------------------

async function detectDarwinLanguages(signal?: AbortSignal): Promise<string[]> {
	const proc = await runCli(["defaults", "read", "NSGlobalDomain", "AppleLanguages"], CLI_TIMEOUT_MS, signal);
	if (proc.exitCode !== 0) return [];

	const raw = proc.stdout.trim();
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

export function parseGecos(record: string): string {
	return (record.trim().split(":")[4] ?? "").split(",")[0]?.trim() ?? "";
}

/** Best-effort full name from the OS account record (macOS `id -F`, Linux GECOS). */
async function detectSystemFullName(signal?: AbortSignal): Promise<string> {
	if (process.platform === "darwin") {
		const proc = await runCli(["id", "-F"], CLI_TIMEOUT_MS, signal);
		return proc.exitCode === 0 ? proc.stdout.trim() : "";
	}

	// Linux: GECOS field (comma-separated) of the passwd entry for the current user.
	const user = process.getuid?.().toString();
	if (!user || !$which("getent")) return "";
	const proc = await runCli(["getent", "passwd", user], CLI_TIMEOUT_MS, signal);
	if (proc.exitCode !== 0) return "";
	return parseGecos(proc.stdout);
}

const systemCollector: ProfileCollector = {
	id: "system",
	name: "System",

	async available(): Promise<boolean> {
		return process.platform === "darwin" || process.platform === "linux";
	},

	async collect(signal?: AbortSignal): Promise<Partial<UserProfile>> {
		const profile: Partial<UserProfile> = {};
		try {
			const fullName = await detectSystemFullName(signal);
			if (fullName) Object.assign(profile, splitFullName(fullName));
		} catch {}
		try {
			const languages = process.platform === "darwin" ? await detectDarwinLanguages(signal) : detectLinuxLanguages();
			if (languages.length > 0) profile.knowsLanguage = languages;
		} catch {}
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

export const PROFILE_COLLECTORS: readonly ProfileCollector[] = [
	salesforceCollector,
	githubCollector,
	gitCollector,
	systemCollector,
];
