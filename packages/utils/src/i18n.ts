import {
	getLocaleDisplayName,
	LOCALE_DISPLAY_NAMES,
	mapToSupportedLocale,
	normalizeLocale,
} from "@f5-sales-demo/i18n-core";
import { $pickenv } from "./env";

export { getLocaleDisplayName, LOCALE_DISPLAY_NAMES, mapToSupportedLocale };

type LocaleMap = Record<string, string>;
type LocaleBundle = Record<string, LocaleMap>;

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
