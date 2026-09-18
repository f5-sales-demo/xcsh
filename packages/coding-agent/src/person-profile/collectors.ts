import { $which } from "@f5-sales-demo/pi-utils";
import type { UserProfile } from "./schema";
import type { ProfileCollection, ProfileCollector } from "./service";

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

	async collect(signal?: AbortSignal): Promise<ProfileCollection> {
		const profile: Partial<UserProfile> = {};
		const observations: ProfileCollection["observations"] = [];
		profile.interactionDevices = [{ identifier: "xcsh://computer", relationship: "uses" }];
		try {
			const fullName = await detectSystemFullName(signal);
			if (fullName) Object.assign(profile, splitFullName(fullName));
		} catch {}
		try {
			const languages = process.platform === "darwin" ? await detectDarwinLanguages(signal) : detectLinuxLanguages();
			if (languages.length > 0) {
				profile.preferredLanguage = languages[0];
				observations.push({
					field: "knowsLanguage",
					value: languages,
					source: "system",
					kind: "inferred",
					observedAt: new Date().toISOString(),
				});
			}
		} catch {}
		return { facts: profile, observations };
	},
};

// ---------------------------------------------------------------------------
// Registry
//
// Only host-local identity sources live in core. Provider discovery is owned by
// installed and enabled marketplace integrations.
// ---------------------------------------------------------------------------

export const PROFILE_COLLECTORS: readonly ProfileCollector[] = [gitCollector, systemCollector];
