import { describe, expect, it } from "bun:test";
import {
	CONSOLE_CATALOG_DATA,
	CONSOLE_CATALOG_VERSION,
} from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog.generated";

describe("console catalogue generated module", () => {
	it("exports a version string and a catalogue object", () => {
		expect(typeof CONSOLE_CATALOG_VERSION).toBe("string");
		expect(CONSOLE_CATALOG_DATA).toHaveProperty("workflows");
		expect(CONSOLE_CATALOG_DATA).toHaveProperty("resources");
	});
});
