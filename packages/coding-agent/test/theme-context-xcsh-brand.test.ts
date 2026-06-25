import { beforeAll, describe, expect, it } from "bun:test";
import { getThemeByName, initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("theme: context_xcsh segment uses F5 brand red in xcsh themes", () => {
	for (const name of ["xcsh-light", "xcsh-dark"]) {
		it(`${name} statusLineContextF5xcBg resolves to the same ANSI as accent`, async () => {
			const theme = await getThemeByName(name);
			expect(theme).toBeDefined();
			expect(theme!.fg("statusLineContextF5xcBg", "●")).toBe(theme!.fg("accent", "●"));
		});
	}
});
