import { logger as log, mapToSupportedLocale, setLocale } from "@f5-sales-demo/pi-utils";
import { PROFILE_COLLECTORS } from "../internal-urls/profile-collectors";
import { loadProfile, mergeProfile, saveProfile } from "../internal-urls/user-profile";

/**
 * Discover the user's preferred language from the OS and user profile,
 * then apply it to the i18n system.
 *
 * Runs after Settings.init() so the profile path is accessible.
 * Skipped if XCSH_LOCALE is already set (env var takes precedence).
 */
export async function discoverAndApplyLanguage(): Promise<void> {
	if (process.env.XCSH_LOCALE) return;

	const profile = await loadProfile();

	if (!profile.knowsLanguage || profile.knowsLanguage.length === 0) {
		for (const collector of PROFILE_COLLECTORS) {
			if (collector.id !== "system") continue;
			try {
				const isAvailable = await collector.available();
				if (!isAvailable) continue;
				const partial = await collector.collect();
				if (partial.knowsLanguage && partial.knowsLanguage.length > 0) {
					mergeProfile(profile, partial);
					if (!profile.sources) profile.sources = {};
					(profile.sources as Record<string, string>).system = new Date().toISOString();
					await saveProfile(profile);
					log.debug(`Discovered OS languages: ${partial.knowsLanguage.join(", ")}`);
				}
			} catch {
				// Language detection is best-effort
			}
			break;
		}
	}

	if (!profile.knowsLanguage || profile.knowsLanguage.length === 0) return;

	const primary = profile.knowsLanguage[0];
	const supported = mapToSupportedLocale(primary);
	if (supported) {
		setLocale(supported);
		log.debug(`Applied locale from user profile: ${primary} → ${supported}`);
	}
}
