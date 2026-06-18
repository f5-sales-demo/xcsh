import { describe, expect, it } from "bun:test";
import type { ConsoleCatalogData } from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog-types";
import { EMPTY_CONSOLE_CATALOG } from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog-types";

describe("ConsoleCatalogData", () => {
	it("accepts a minimal catalogue shape", () => {
		const c: ConsoleCatalogData = {
			version: "0.0.0",
			workflows: { "http-load-balancer/create": "schema: x" },
			resources: { "http-load-balancer": "id: http-load-balancer" },
			routes: { "origin-pools": "id: origin-pools" },
			navigation: null,
		};
		expect(c.workflows["http-load-balancer/create"]).toContain("schema");
		expect(c.navigation).toBeNull();
		expect(c.resources["http-load-balancer"]).toContain("id");
		expect(c.routes["origin-pools"]).toContain("id");
	});

	it("exposes an empty zero-value catalogue", () => {
		expect(EMPTY_CONSOLE_CATALOG.version).toBe("unavailable");
		expect(Object.keys(EMPTY_CONSOLE_CATALOG.workflows)).toHaveLength(0);
	});
});
