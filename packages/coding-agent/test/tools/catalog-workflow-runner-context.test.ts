import { describe, expect, it } from "bun:test";
import { CONSOLE_CATALOG_DATA } from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog.generated";
import { CatalogWorkflowRunnerTool } from "@f5xc-salesdemos/xcsh/tools/catalog-workflow-runner";

const catalogIsEmpty = Object.keys(CONSOLE_CATALOG_DATA.workflows).length === 0;

describe.skipIf(catalogIsEmpty)("runner context-driven base_url/namespace", () => {
	const tool = new CatalogWorkflowRunnerTool({ settings: { get: () => undefined } } as never);

	it("errors clearly when no base_url, no env, and no active context", async () => {
		const prev = process.env.XCSH_API_URL;
		process.env.XCSH_API_URL = "";
		try {
			await expect(
				tool.execute("t", {
					resource: "health-check",
					operation: "create",
					params: { name: "x", namespace: "demo" },
				} as never),
			).rejects.toThrow(/base_url|active tenant context|XCSH_API_URL/i);
		} finally {
			if (prev !== undefined) process.env.XCSH_API_URL = prev;
		}
	});
});
