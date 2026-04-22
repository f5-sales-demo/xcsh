import { beforeAll, describe, expect, it } from "bun:test";
import { getThemeByName, initTheme } from "../src/modes/theme/theme";

beforeAll(async () => {
	await initTheme();
});

describe("theme: profile_f5xc segment uses F5 brand red in xcsh themes", () => {
	for (const name of ["xcsh-light", "xcsh-dark"]) {
		it(`${name} statusLineProfileF5xcBg resolves to the same ANSI as accent`, async () => {
			const theme = await getThemeByName(name);
			expect(theme).toBeDefined();
			expect(theme!.fg("statusLineProfileF5xcBg", "●")).toBe(theme!.fg("accent", "●"));
		});
	}
});
