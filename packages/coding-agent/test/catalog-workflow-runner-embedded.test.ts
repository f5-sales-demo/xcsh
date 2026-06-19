import { afterAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONSOLE_CATALOG_DATA } from "@f5xc-salesdemos/xcsh/internal-urls/console-catalog.generated";
import { CatalogWorkflowRunnerTool, loadWorkflowYaml } from "@f5xc-salesdemos/xcsh/tools/catalog-workflow-runner";

const catalogIsEmpty = Object.keys(CONSOLE_CATALOG_DATA.workflows).length === 0;

// Catalogue `params` is a map keyed by name (urn:f5xc:console:workflow:v1).
// Validation runs before any browser session opens, so this exercises the map
// iteration without driving a real browser (it threw "{} is not iterable" when
// the runner wrongly treated params as a list).
describe.skipIf(catalogIsEmpty)("CatalogWorkflowRunnerTool map-style param validation", () => {
	const tool = new CatalogWorkflowRunnerTool({ settings: { get: () => undefined } } as never);

	it("reports missing required params from the catalogue param map", async () => {
		await expect(
			tool.execute("t", {
				resource: "http-load-balancer",
				operation: "create",
				params: {},
				base_url: "https://example.console.ves.volterra.io",
			} as never),
		).rejects.toThrow(/Missing required workflow params:.*(namespace|name|domains)/);
	});
});

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

	// Security: path-traversal guard (charset check — first line of defense)
	// Defense-in-depth: even if charset guard were bypassed, the catalog_path
	// branch also validates via realpathSync containment (see loadWorkflowYaml).
	it("rejects path-traversal in resource", () => {
		expect(() => loadWorkflowYaml({ resource: "../../etc", operation: "passwd" })).toThrow(
			/invalid resource or operation/i,
		);
	});

	it("rejects path-traversal in operation", () => {
		expect(() => loadWorkflowYaml({ resource: "http-load-balancer", operation: "../../../etc/passwd" })).toThrow(
			/invalid resource or operation/i,
		);
	});

	it.skipIf(catalogIsEmpty)("accepts valid resource and operation (non-regression)", () => {
		// Valid call must not throw the security guard
		const yaml = loadWorkflowYaml({ resource: "http-load-balancer", operation: "create" });
		expect(typeof yaml).toBe("string");
		expect(yaml.length).toBeGreaterThan(0);
	});
});

// =============================================================================
// catalog_path branch — symlink containment (realpathSync hardening)
// =============================================================================

describe("loadWorkflowYaml catalog_path branch", () => {
	let tmpDir: string | undefined;

	afterAll(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("reads a real workflow file from catalog_path", () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-test-"));
		const workflowsDir = path.join(tmpDir, "catalog", "workflows", "realres");
		fs.mkdirSync(workflowsDir, { recursive: true });

		const validYaml = [
			"schema: urn:f5xc:console:workflow:v1",
			"id: realres-create",
			"name: Real Resource Create",
			"resource: realres",
			"operation: create",
			"steps: []",
		].join("\n");
		fs.writeFileSync(path.join(workflowsDir, "create.yaml"), validYaml, "utf-8");

		const result = loadWorkflowYaml({ catalog_path: tmpDir, resource: "realres", operation: "create" });
		expect(result).toBe(validYaml);
	});

	it("throws when catalog_path workflows directory does not exist", () => {
		const missing = path.join(os.tmpdir(), `xcsh-no-such-dir-${Date.now()}`);
		expect(() => loadWorkflowYaml({ catalog_path: missing, resource: "realres", operation: "create" })).toThrow(
			/catalog workflows directory not found/i,
		);
	});

	it("throws when workflow file does not exist under catalog_path", () => {
		// Re-use the tmpDir created in the first test (if it exists), or make one
		const base = tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-test-"));
		if (!tmpDir) tmpDir = base;
		const workflowsDir = path.join(base, "catalog", "workflows");
		fs.mkdirSync(workflowsDir, { recursive: true });

		expect(() => loadWorkflowYaml({ catalog_path: base, resource: "missing", operation: "create" })).toThrow(
			/workflow not found/i,
		);
	});

	it("detects symlink escape via realpathSync containment check", () => {
		// Set up a fresh temp dir for this test
		const symlinkTmp = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-symlink-test-"));
		const workflowsDir = path.join(symlinkTmp, "catalog", "workflows");
		fs.mkdirSync(workflowsDir, { recursive: true });

		// Create an outside target directory and a decoy yaml inside it
		const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "xcsh-outside-"));
		fs.writeFileSync(path.join(outsideDir, "create.yaml"), "schema: evil", "utf-8");

		// Create symlink: workflows/evil -> outsideDir (escapes the base)
		const symlinkPath = path.join(workflowsDir, "evil");
		try {
			fs.symlinkSync(outsideDir, symlinkPath);
		} catch {
			// If symlink creation is not available in this env, skip
			fs.rmSync(symlinkTmp, { recursive: true, force: true });
			fs.rmSync(outsideDir, { recursive: true, force: true });
			console.log("Skipping symlink escape test: symlink creation not available");
			return;
		}

		try {
			expect(() => loadWorkflowYaml({ catalog_path: symlinkTmp, resource: "evil", operation: "create" })).toThrow(
				/path traversal detected/i,
			);
		} finally {
			fs.rmSync(symlinkTmp, { recursive: true, force: true });
			fs.rmSync(outsideDir, { recursive: true, force: true });
		}
	});
});
