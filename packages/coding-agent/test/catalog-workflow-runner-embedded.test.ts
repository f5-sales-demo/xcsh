import { describe, expect, it } from "bun:test";
import { CONSOLE_CATALOG_DATA } from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog.generated";
import { loadWorkflowYaml } from "@f5xc-salesdemos/xcsh/tools/catalog-workflow-runner";

const catalogIsEmpty = Object.keys(CONSOLE_CATALOG_DATA.workflows).length === 0;

describe("loadWorkflowYaml", () => {
	it.skipIf(catalogIsEmpty)("loads embedded workflow text when no catalog_path is given", () => {
		const yaml = loadWorkflowYaml({ resource: "http-load-balancer", operation: "create" });
		expect(typeof yaml).toBe("string");
		expect(yaml.length).toBeGreaterThan(0);
	});

	it("throws a clear error for an unknown embedded workflow", () => {
		expect(() => loadWorkflowYaml({ resource: "nope", operation: "create" })).toThrow(
			/no embedded console workflow/i,
		);
	});
});
