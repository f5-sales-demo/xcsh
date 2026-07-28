/**
 * Assembles the stealth init script injected into every page.
 *
 * Split out of `browser.ts` so the bundle can be built and asserted without a
 * `BrowserTool` instance — see `test/browser/stealth-bundle.test.ts` (CI) and
 * `test/e2e/stealth-surfaces.e2e.test.ts` (local, real Chrome).
 */

import stealthTamperingScript from "./puppeteer/00_stealth_tampering.txt" with { type: "text" };
import stealthActivityScript from "./puppeteer/01_stealth_activity.txt" with { type: "text" };
import stealthHairlineScript from "./puppeteer/02_stealth_hairline.txt" with { type: "text" };
import stealthBotdScript from "./puppeteer/03_stealth_botd.txt" with { type: "text" };
import stealthIframeScript from "./puppeteer/04_stealth_iframe.txt" with { type: "text" };
import stealthWebglScript from "./puppeteer/05_stealth_webgl.txt" with { type: "text" };
import stealthScreenScript from "./puppeteer/06_stealth_screen.txt" with { type: "text" };
import stealthFontsScript from "./puppeteer/07_stealth_fonts.txt" with { type: "text" };
import stealthAudioScript from "./puppeteer/08_stealth_audio.txt" with { type: "text" };
import stealthLocaleScript from "./puppeteer/09_stealth_locale.txt" with { type: "text" };
import stealthPluginsScript from "./puppeteer/10_stealth_plugins.txt" with { type: "text" };
import stealthHardwareScript from "./puppeteer/11_stealth_hardware.txt" with { type: "text" };
import stealthCodecsScript from "./puppeteer/12_stealth_codecs.txt" with { type: "text" };

/**
 * The injected surfaces, in load order. Order is load-bearing: `tampering` must
 * run first so later scripts' patched functions are already covered by its
 * `Function.prototype.toString` shim.
 *
 * There is deliberately no `worker` surface. It rewrote every Worker to a `blob:`
 * URL to inject a prelude, which broke relative-URL workers outright and any
 * worker under `worker-src 'self'`, while its prelude was dead code — it called
 * `Object_defineProperty`, a page-realm binding a worker realm does not inherit.
 * Chrome already propagates the page's CDP user-agent override into workers,
 * including the brand list, so nothing was lost by removing it. See #2560 and
 * test/e2e/stealth-workers.e2e.test.ts.
 */
export const STEALTH_SCRIPTS: ReadonlyArray<{ readonly name: string; readonly source: string }> = [
	{ name: "tampering", source: stealthTamperingScript },
	{ name: "activity", source: stealthActivityScript },
	{ name: "hairline", source: stealthHairlineScript },
	{ name: "botd", source: stealthBotdScript },
	{ name: "iframe", source: stealthIframeScript },
	{ name: "webgl", source: stealthWebglScript },
	{ name: "screen", source: stealthScreenScript },
	{ name: "fonts", source: stealthFontsScript },
	{ name: "audio", source: stealthAudioScript },
	{ name: "locale", source: stealthLocaleScript },
	{ name: "plugins", source: stealthPluginsScript },
	{ name: "hardware", source: stealthHardwareScript },
	{ name: "codecs", source: stealthCodecsScript },
];

export type StealthBundleOptions = {
	/**
	 * Name of a global to collect per-script failures into, as
	 * `[{ name, message }]`. Omit in production: each script is wrapped in its
	 * own try/catch so one failure cannot take down the rest, but recording those
	 * failures means writing a `window.<name>` that a detection script could look
	 * for — which would defeat the point of the bundle. Tests pass a name so a
	 * silently-broken script is assertable instead of invisible.
	 */
	readonly errorSink?: string;
};

/** Wraps one script so a failure cannot stop the scripts after it. */
function wrapScript(script: { name: string; source: string }, errorSink: string | undefined): string {
	const record = errorSink
		? `(globalThis[${JSON.stringify(errorSink)}] ||= []).push({ name: ${JSON.stringify(script.name)}, message: String(e && e.message || e) });`
		: "";
	return `
		try {
			${script.source};
		} catch (e) { ${record} }
	`;
}

/**
 * Builds the full init script.
 *
 * Caches pristine builtins up front so the surfaces can still reach unpatched
 * references after earlier surfaces have replaced the page's own.
 *
 * The cache is taken from the CURRENT realm, not a detached iframe. This script
 * is injected via `Page.addScriptToEvaluateOnNewDocument`, which runs before any
 * page script — and before any DOM at all: at that point `document.readyState`
 * is `"loading"` and `document.head`, `document.body` and
 * `document.documentElement` are all null. An earlier version created a helper
 * iframe and appended it to `document.head`, which threw on that first statement
 * outside every per-surface guard, so all fourteen surfaces silently never ran.
 * Because nothing else has executed yet, `globalThis`'s builtins are themselves
 * still pristine, which is exactly what the iframe was there to provide.
 */
export function buildStealthBundle(options: StealthBundleOptions = {}): string {
	const joint = STEALTH_SCRIPTS.map(script => wrapScript(script, options.errorSink)).join(";\n");

	return `(() => {
			// Native function cache — this script runs first, so the current realm's
			// builtins have not been touched yet.
			const nativeWindow = globalThis;

			// Cache pristine native functions
			const Function_toString = nativeWindow.Function.prototype.toString;
			const Object_getOwnPropertyDescriptor = nativeWindow.Object.getOwnPropertyDescriptor;
			const Object_getOwnPropertyDescriptors = nativeWindow.Object.getOwnPropertyDescriptors;
			const Object_getPrototypeOf = nativeWindow.Object.getPrototypeOf;
			const Object_defineProperty = nativeWindow.Object.defineProperty;
			const Object_getOwnPropertyDescriptorOriginal = nativeWindow.Object.getOwnPropertyDescriptor;
			const Object_create = nativeWindow.Object.create;
			const Object_keys = nativeWindow.Object.keys;
			const Object_getOwnPropertyNames = nativeWindow.Object.getOwnPropertyNames;
			const Object_entries = nativeWindow.Object.entries;
			const Object_setPrototypeOf = nativeWindow.Object.setPrototypeOf;
			const Object_assign = nativeWindow.Object.assign;
			const Window_setTimeout = nativeWindow.setTimeout;
			const Math_random = nativeWindow.Math.random;
			const Math_floor = nativeWindow.Math.floor;
			const Math_max = nativeWindow.Math.max;
			const Math_min = nativeWindow.Math.min;
			const Window_Event = nativeWindow.Event;
			const Promise_resolve = nativeWindow.Promise.resolve.bind(nativeWindow.Promise);
			const Window_Blob = nativeWindow.Blob;
			const Window_Proxy = nativeWindow.Proxy;
			const Intl_DateTimeFormat = nativeWindow.Intl.DateTimeFormat;
			const Date_constructor = nativeWindow.Date;

			${joint}
		})();`;
}
