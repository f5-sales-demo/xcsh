import { logger } from "@f5-sales-demo/pi-utils";
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
// System (macOS)
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

const systemCollector: ProfileCollector = {
	id: "system",
	name: "System",

	async available(): Promise<boolean> {
		return process.platform === "darwin" || process.platform === "linux";
	},

	async collect(): Promise<Partial<UserProfile>> {
		try {
			const languages = process.platform === "darwin" ? await detectDarwinLanguages() : detectLinuxLanguages();

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

const _collectors: ProfileCollector[] = [systemCollector];

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
