import { describe, expect, test } from "bun:test";
import { buildStealthBundle, STEALTH_SCRIPTS } from "../../src/tools/browser-stealth";

// Pure assertions over the assembled init script — no browser launch, so these
// run in CI on every PR. The behavioural counterparts (does each surface
// actually change in a real Chrome) are in test/e2e/stealth-surfaces.e2e.test.ts,
// which is describe.skipIf(isCI) and local-only.

describe("stealth bundle composition", () => {
	test("carries all fourteen surfaces", () => {
		expect(STEALTH_SCRIPTS).toHaveLength(14);
		expect(STEALTH_SCRIPTS.map(s => s.name)).toEqual([
			"tampering",
			"activity",
			"hairline",
			"botd",
			"iframe",
			"webgl",
			"screen",
			"fonts",
			"audio",
			"locale",
			"plugins",
			"hardware",
			"codecs",
			"worker",
		]);
	});

	test("loads tampering first, so later patches are covered by its toString shim", () => {
		expect(STEALTH_SCRIPTS[0].name).toBe("tampering");
	});

	test("no surface is empty — a mis-resolved text import would yield a blank script", () => {
		for (const script of STEALTH_SCRIPTS) {
			expect(script.source.trim().length).toBeGreaterThan(0);
		}
	});

	test("every surface's source reaches the bundle", () => {
		const bundle = buildStealthBundle();
		for (const script of STEALTH_SCRIPTS) {
			expect(bundle).toInclude(script.source);
		}
	});

	test("isolates each surface in its own try/catch, so one failure cannot stop the rest", () => {
		const bundle = buildStealthBundle();
		// One guard per surface.
		expect(bundle.split("try {").length - 1).toBeGreaterThanOrEqual(STEALTH_SCRIPTS.length);
	});

	test("caches pristine natives BEFORE any surface runs", () => {
		const bundle = buildStealthBundle();
		const lastNativeCache = bundle.lastIndexOf("= nativeWindow");
		const firstSurface = bundle.indexOf(STEALTH_SCRIPTS[0].source);
		expect(lastNativeCache).toBeLessThan(firstSurface);
	});

	test("touches NO DOM, because the bundle runs before any DOM exists", () => {
		// Regression guard for the bug this module's E2E suite found: the preamble
		// used to build a helper iframe and append it to document.head, but
		// Page.addScriptToEvaluateOnNewDocument runs at readyState "loading", where
		// document.head, document.body and document.documentElement are ALL null.
		// That threw on the first statement, outside every per-surface guard, so all
		// fourteen surfaces silently never ran. Measured identically on puppeteer
		// 24.43.1 / Chrome 148, so it was not introduced by the 25.3.0 bump.
		const preamble = buildStealthBundle().slice(0, buildStealthBundle().indexOf(STEALTH_SCRIPTS[0].source));
		expect(preamble).not.toInclude("document.head");
		expect(preamble).not.toInclude("appendChild");
		expect(preamble).not.toInclude("createElement");
	});

	test("takes its native cache from the current realm", () => {
		expect(buildStealthBundle()).toInclude("const nativeWindow = globalThis;");
	});

	test("no surface reaches for document.head either — same document-start constraint", () => {
		for (const script of STEALTH_SCRIPTS) {
			expect(script.source).not.toInclude("document.head");
		}
	});
});

describe("surfaces must not break standard web behaviour", () => {
	/**
	 * A surface's CODE, with line comments stripped. These guards assert on what
	 * runs, and the comments in these files deliberately describe the very
	 * patterns being forbidden.
	 */
	const source = (name: string) => {
		const found = STEALTH_SCRIPTS.find(s => s.name === name);
		if (!found) throw new Error(`no such surface: ${name}`);
		return found.source
			.split("\n")
			.filter(line => !line.trimStart().startsWith("//"))
			.join("\n");
	};

	test("the iframe surface hands srcdoc back to the native setter", () => {
		// It used to redefine srcdoc as a non-writable data property and then assign
		// through the same element, so the write failed against its own frozen
		// property and every dynamically created srcdoc iframe loaded empty.
		const iframe = source("iframe");
		// Delegates to the prototype accessor rather than assigning through the
		// element it has just shadowed.
		expect(iframe).toInclude("nativeSrcdocDescriptor.set.call(iframe, newValue)");
		// Steps aside instead of freezing itself.
		expect(iframe).toInclude("delete iframe.srcdoc");
		// Defines srcdoc exactly once. The bug was a SECOND definition inside the
		// setter, as a non-writable data property, which made the subsequent write
		// a silent no-op.
		expect(iframe.split('Object_defineProperty(iframe, "srcdoc"').length - 1).toBe(1);
	});

	test("the locale surface does not touch timezone at all", () => {
		// Timezone is a CDP override (BrowserTool#applyTimezoneOverride). Doing it in
		// page script forced the profile's zone into every Intl.DateTimeFormat call,
		// overriding a caller's explicit timeZone, and rewrote only the displayed
		// zone name while leaving getTimezoneOffset contradicting it.
		const locale = source("locale");
		expect(locale).not.toInclude("Intl.DateTimeFormat =");
		expect(locale).not.toInclude("Date.prototype.toString");
		expect(locale).not.toInclude("Date.prototype.toTimeString");
		expect(locale).not.toInclude("Eastern Standard Time");
	});

	test("the locale surface still pins language and languages", () => {
		const locale = source("locale");
		expect(locale).toInclude('"language"');
		expect(locale).toInclude('"languages"');
	});
});

describe("stealth bundle failure reporting", () => {
	test("writes NO global by default — a window.__xcsh* marker would itself be detectable", () => {
		const bundle = buildStealthBundle();
		expect(bundle).not.toInclude("globalThis[");
		expect(bundle).not.toInclude("__xcshStealthErrors");
		// The production guard swallows silently, by design.
		expect(bundle).toInclude("catch (e) {  }");
	});

	test("records per-surface failures when a test opts in, naming the surface", () => {
		const bundle = buildStealthBundle({ errorSink: "__xcshStealthErrors" });
		expect(bundle).toInclude('globalThis["__xcshStealthErrors"]');
		for (const script of STEALTH_SCRIPTS) {
			expect(bundle).toInclude(`name: ${JSON.stringify(script.name)}`);
		}
	});

	test("the opt-in sink is the only difference from the production bundle", () => {
		const production = buildStealthBundle();
		const instrumented = buildStealthBundle({ errorSink: "__xcshStealthErrors" });
		// Strip the recording statements; what remains must match production byte for byte.
		const stripped = instrumented.replace(
			/\(globalThis\["__xcshStealthErrors"\] \|\|= \[\]\)\.push\(\{ name: "\w+", message: String\(e && e\.message \|\| e\) \}\);/g,
			"",
		);
		expect(stripped).toBe(production);
	});
});
