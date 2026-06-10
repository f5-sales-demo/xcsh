import { beforeEach, describe, expect, test } from "bun:test";
import {
	getLocale,
	getLocaleDisplayName,
	initI18n,
	LOCALE_DISPLAY_NAMES,
	mapToSupportedLocale,
	registerLocales,
	setLocale,
	t,
} from "./i18n";

const EN = {
	greeting: "Hello",
	"greeting.with.name": "Hello, {name}!",
	"items.count.one": "{count} item",
	"items.count.other": "{count} items",
	"error.notFound": "File not found: {path}",
};

const JA = {
	greeting: "こんにちは",
	"greeting.with.name": "こんにちは、{name}さん！",
	"items.count.one": "{count}個のアイテム",
	"items.count.other": "{count}個のアイテム",
	"error.notFound": "ファイルが見つかりません: {path}",
};

describe("i18n", () => {
	beforeEach(() => {
		registerLocales({ en: EN, ja: JA });
		setLocale("en");
	});

	test("t() returns English string by key", () => {
		expect(t("greeting")).toBe("Hello");
	});

	test("t() interpolates parameters", () => {
		expect(t("greeting.with.name", { name: "World" })).toBe("Hello, World!");
	});

	test("t() falls back to key when key is missing", () => {
		expect(t("nonexistent.key")).toBe("nonexistent.key");
	});

	test("t() handles plural: one", () => {
		expect(t("items.count", { count: 1 })).toBe("1 item");
	});

	test("t() handles plural: other", () => {
		expect(t("items.count", { count: 5 })).toBe("5 items");
	});

	test("setLocale() switches to Japanese", () => {
		setLocale("ja");
		expect(t("greeting")).toBe("こんにちは");
		expect(t("greeting.with.name", { name: "太郎" })).toBe("こんにちは、太郎さん！");
	});

	test("getLocale() returns current locale", () => {
		expect(getLocale()).toBe("en");
		setLocale("ja");
		expect(getLocale()).toBe("ja");
	});

	test("falls back to base locale (ja-jp -> ja)", () => {
		setLocale("ja-jp");
		expect(t("greeting")).toBe("こんにちは");
	});

	test("falls back to English for unknown locale", () => {
		setLocale("xx");
		expect(t("greeting")).toBe("Hello");
	});

	test("normalizes locale with underscores", () => {
		setLocale("ja_JP");
		expect(getLocale()).toBe("ja");
		expect(t("greeting")).toBe("こんにちは");
	});

	test("handles locale with encoding suffix", () => {
		setLocale("ja_JP.UTF-8");
		expect(getLocale()).toBe("ja");
		expect(t("greeting")).toBe("こんにちは");
	});

	test("interpolation leaves unmatched placeholders", () => {
		expect(t("error.notFound", { path: "/foo" })).toBe("File not found: /foo");
		expect(t("greeting.with.name", {})).toBe("Hello, {name}!");
	});

	test("initI18n() defaults to en when no env vars set", () => {
		const oldLang = Bun.env.LANG;
		const oldXcsh = Bun.env.XCSH_LOCALE;
		delete Bun.env.LANG;
		delete Bun.env.XCSH_LOCALE;
		initI18n();
		expect(getLocale()).toBe("en");
		if (oldLang) Bun.env.LANG = oldLang;
		if (oldXcsh) Bun.env.XCSH_LOCALE = oldXcsh;
	});

	test("initI18n() reads XCSH_LOCALE env var", () => {
		Bun.env.XCSH_LOCALE = "ja";
		initI18n();
		expect(getLocale()).toBe("ja");
		delete Bun.env.XCSH_LOCALE;
		setLocale("en");
	});

	test("initI18n() prefers explicit locale argument", () => {
		Bun.env.XCSH_LOCALE = "ja";
		initI18n("en");
		expect(getLocale()).toBe("en");
		delete Bun.env.XCSH_LOCALE;
	});
});

describe("LOCALE_DISPLAY_NAMES", () => {
	test("has entries for all 13 supported locales", () => {
		const expected = ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt-br", "th", "zh-cn", "zh-tw"];
		for (const code of expected) {
			expect(LOCALE_DISPLAY_NAMES[code]).toBeDefined();
			expect(typeof LOCALE_DISPLAY_NAMES[code]).toBe("string");
		}
	});

	test("returns correct names for key locales", () => {
		expect(LOCALE_DISPLAY_NAMES.ko).toBe("Korean");
		expect(LOCALE_DISPLAY_NAMES.ja).toBe("Japanese");
		expect(LOCALE_DISPLAY_NAMES.en).toBe("English");
		expect(LOCALE_DISPLAY_NAMES["zh-cn"]).toBe("Simplified Chinese");
	});
});

describe("getLocaleDisplayName", () => {
	beforeEach(() => {
		registerLocales({ en: EN, ja: JA, "zh-cn": {}, "zh-tw": {}, "pt-br": {}, fr: {}, de: {} });
		setLocale("en");
	});

	test("returns display name for known locale", () => {
		expect(getLocaleDisplayName("ko")).toBe("Korean");
		expect(getLocaleDisplayName("ja")).toBe("Japanese");
		expect(getLocaleDisplayName("fr")).toBe("French");
	});

	test("returns display name for regional variant", () => {
		expect(getLocaleDisplayName("pt-br")).toBe("Brazilian Portuguese");
		expect(getLocaleDisplayName("zh-cn")).toBe("Simplified Chinese");
	});

	test("returns undefined for unknown locale", () => {
		expect(getLocaleDisplayName("xx")).toBeUndefined();
		expect(getLocaleDisplayName("sv")).toBeUndefined();
	});

	test("returns 'English' for 'en'", () => {
		expect(getLocaleDisplayName("en")).toBe("English");
	});

	test("normalizes case", () => {
		expect(getLocaleDisplayName("KO")).toBe("Korean");
		expect(getLocaleDisplayName("zh-CN")).toBe("Simplified Chinese");
	});
});

describe("mapToSupportedLocale", () => {
	beforeEach(() => {
		registerLocales({ en: EN, ja: JA, "zh-cn": {}, "zh-tw": {}, "pt-br": {}, fr: {}, de: {} });
		setLocale("en");
	});

	test("exact match", () => {
		expect(mapToSupportedLocale("ja")).toBe("ja");
		expect(mapToSupportedLocale("en")).toBe("en");
	});

	test("regional variant maps to base", () => {
		expect(mapToSupportedLocale("en-US")).toBe("en");
		expect(mapToSupportedLocale("ja-JP")).toBe("ja");
		expect(mapToSupportedLocale("fr-FR")).toBe("fr");
		expect(mapToSupportedLocale("de-DE")).toBe("de");
	});

	test("regional variant with exact match", () => {
		expect(mapToSupportedLocale("pt-BR")).toBe("pt-br");
		expect(mapToSupportedLocale("zh-CN")).toBe("zh-cn");
		expect(mapToSupportedLocale("zh-TW")).toBe("zh-tw");
	});

	test("Apple zh-Hans maps to zh-cn", () => {
		expect(mapToSupportedLocale("zh-Hans")).toBe("zh-cn");
		expect(mapToSupportedLocale("zh-Hans-CN")).toBe("zh-cn");
	});

	test("Apple zh-Hant maps to zh-tw", () => {
		expect(mapToSupportedLocale("zh-Hant")).toBe("zh-tw");
		expect(mapToSupportedLocale("zh-Hant-TW")).toBe("zh-tw");
	});

	test("underscore format", () => {
		expect(mapToSupportedLocale("pt_BR")).toBe("pt-br");
		expect(mapToSupportedLocale("ja_JP.UTF-8")).toBe("ja");
	});

	test("unsupported locale returns undefined", () => {
		expect(mapToSupportedLocale("xx")).toBeUndefined();
		expect(mapToSupportedLocale("sv-SE")).toBeUndefined();
	});
});
