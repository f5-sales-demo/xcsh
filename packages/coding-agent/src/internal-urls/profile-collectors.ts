import { logger } from "@f5xc-salesdemos/pi-utils";
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
