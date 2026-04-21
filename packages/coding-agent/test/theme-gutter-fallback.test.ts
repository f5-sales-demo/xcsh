import { beforeAll, describe, expect, it } from "bun:test";
import { getThemeByName, initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("theme: gutterSuccess / gutterError fallback", () => {
	it("dark.json defines gutterSuccess explicitly — distinct from success", async () => {
		const dark = await getThemeByName("dark");
		expect(dark).toBeDefined();
		// dark.json sets gutterSuccess="cyan" and success="green" — different ANSI
		expect(dark!.fg("gutterSuccess", "●")).not.toBe(dark!.fg("success", "●"));
	});

	it("dark.json defines gutterError explicitly — distinct from error only if theme author wants it", async () => {
		const dark = await getThemeByName("dark");
		expect(dark).toBeDefined();
		// dark.json sets gutterError="red" AND error="red" — same bytes; the fallback contract
		// says gutterError is OPTIONALLY independent. Here they happen to match intentionally.
		const dark_error = dark!.fg("error", "●");
		const dark_gutterError = dark!.fg("gutterError", "●");
		expect(dark_gutterError).toBe(dark_error);
	});

	it("a theme without gutter tokens falls back to success/error", async () => {
		// `titanium` is one of ~90 built-in default themes that does NOT define
		// gutterSuccess or gutterError in its JSON. The Theme constructor's
		// nullish-coalesce fallback should make theme.fg(\"gutterSuccess\", ...)
		// produce the same bytes as theme.fg(\"success\", ...).
		const titanium = await getThemeByName("titanium");
		expect(titanium).toBeDefined();
		expect(titanium!.fg("gutterSuccess", "●")).toBe(titanium!.fg("success", "●"));
		expect(titanium!.fg("gutterError", "●")).toBe(titanium!.fg("error", "●"));
	});

	it("fallback does not throw for gutterSuccess/gutterError on any built-in theme", async () => {
		// Spot-check several defaults. If any theme lacked the fallback, fg()
		// would throw "Unknown theme color" — this test pins the safety net.
		for (const name of ["dark", "light", "titanium", "graphite", "marble", "xcsh-dark"]) {
			const theme = await getThemeByName(name);
			expect(theme, `missing theme: ${name}`).toBeDefined();
			expect(() => theme!.fg("gutterSuccess", "●")).not.toThrow();
			expect(() => theme!.fg("gutterError", "●")).not.toThrow();
		}
	});
});
