import { $pickenv } from "./env";

type LocaleMap = Record<string, string>;
type LocaleBundle = Record<string, LocaleMap>;

export const LOCALE_DISPLAY_NAMES: Record<string, string> = {
	ar: "Arabic",
	de: "German",
	en: "English",
	es: "Spanish",
	fr: "French",
	hi: "Hindi",
	it: "Italian",
	ja: "Japanese",
	ko: "Korean",
	"pt-br": "Brazilian Portuguese",
	th: "Thai",
	"zh-cn": "Simplified Chinese",
	"zh-tw": "Traditional Chinese",
};

export function getLocaleDisplayName(locale: string): string | undefined {
	const normalized = locale.toLowerCase().replace(/_/g, "-").split(".")[0];
	return LOCALE_DISPLAY_NAMES[normalized];
}

let currentLocale = "en";
let bundles: LocaleBundle = {};
let active: LocaleMap = {};

/**
 * Register all locale bundles. Call once at startup before any t() calls.
 * Keys are locale codes ("en", "ja", "zh-cn"), values are flat key→string maps.
 */
export function registerLocales(localeBundle: LocaleBundle): void {
	bundles = localeBundle;
	active = resolveBundle(currentLocale);
}

/**
 * Initialize i18n from environment / config.
 * Priority: explicit locale arg > XCSH_LOCALE env > PI_LOCALE env > LANG env > "en"
 */
export function initI18n(locale?: string): void {
	const resolved =
		locale || $pickenv("XCSH_LOCALE", "PI_LOCALE") || parseSystemLocale($pickenv("LANG", "LC_MESSAGES")) || "en";
	setLocale(resolved);
}

export function setLocale(locale: string): void {
	currentLocale = mapToSupportedLocale(locale) ?? normalizeLocale(locale);
	active = resolveBundle(currentLocale);
}

export function getLocale(): string {
	return currentLocale;
}

/**
 * Translate a key with optional parameter interpolation.
 * Falls back to the English string, then to the key itself.
 *
 * Usage:
 *   t("cli.error.patternRequired")
 *   t("cli.error.fileNotFound", { path: "/foo" })
 *   t("items.count", { count: 5 })  // uses ".one" / ".other" suffixes
 */
export function t(key: string, params?: Record<string, string | number>): string {
	let template = active[key];

	if (template === undefined && params && typeof params.count === "number") {
		const pluralSuffix = params.count === 1 ? ".one" : ".other";
		template = active[key + pluralSuffix];
		if (template === undefined) {
			template = bundles.en?.[key + pluralSuffix] ?? bundles.en?.[key];
		}
	}

	if (template === undefined) {
		template = bundles.en?.[key] ?? key;
	}

	if (!params) return template;

	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const val = params[name];
		return val !== undefined ? String(val) : match;
	});
}

/**
 * Map an OS locale code (macOS AppleLanguages, Linux LANG) to a supported xcsh locale.
 * Handles Apple script subtags (zh-Hans, zh-Hant) and regional variants (pt-BR, en-US).
 * Returns undefined if no supported locale matches.
 */
export function mapToSupportedLocale(osLocale: string): string | undefined {
	const normalized = normalizeLocale(osLocale);

	if (bundles[normalized]) return normalized;

	// Apple uses zh-hans / zh-hant (script subtags) instead of zh-cn / zh-tw
	if (normalized.startsWith("zh-hans")) return bundles["zh-cn"] ? "zh-cn" : undefined;
	if (normalized.startsWith("zh-hant")) return bundles["zh-tw"] ? "zh-tw" : undefined;

	// Try with region: pt-br, en-us, etc.
	const withRegion = normalized.split("-").slice(0, 2).join("-");
	if (bundles[withRegion]) return withRegion;

	// Fall back to base language: pt-br → pt, en-us → en
	const base = normalized.split("-")[0];
	if (bundles[base]) return base;

	return undefined;
}

function normalizeLocale(raw: string): string {
	return raw.toLowerCase().replace(/_/g, "-").split(".")[0];
}

function parseSystemLocale(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const normalized = normalizeLocale(raw);
	if (normalized === "c" || normalized === "posix") return "en";
	return normalized;
}

function resolveBundle(locale: string): LocaleMap {
	if (bundles[locale]) return bundles[locale];
	const base = locale.split("-")[0];
	if (bundles[base]) return bundles[base];
	return bundles.en ?? {};
}
