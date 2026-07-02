import { afterAll, beforeAll, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CatalogWorkflowRunnerTool } from "../../src/tools/catalog-workflow-runner";

let tmp: string;
const SAVED_TOKEN = process.env.XCSH_API_TOKEN;

beforeAll(() => {
	// No token → the runner skips its pre-create API check and goes straight to
	// the browser provider, which is exactly the path we want to exercise.
	delete process.env.XCSH_API_TOKEN;
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-seam-"));
	const wfDir = path.join(tmp, "catalog/workflows/test-res");
	fs.mkdirSync(wfDir, { recursive: true });
	fs.writeFileSync(
		path.join(wfDir, "create.yaml"),
		[
			"schema: urn:xcsh:console:workflow:v1",
			"id: test-res-create",
			"label: Create test-res",
			"resource: test-res",
			"operation: create",
			"params:",
			"  namespace:",
			"    required: true",
			"  name:",
			"    required: true",
			"steps:",
			"  - id: s1",
			"    action: navigate",
			"    url: /x",
		].join("\n"),
	);
});

afterAll(() => {
	if (SAVED_TOKEN !== undefined) process.env.XCSH_API_TOKEN = SAVED_TOKEN;
	fs.rmSync(tmp, { recursive: true, force: true });
});

it("execute() uses an injected provider instead of selectProvider", async () => {
	const tool = new CatalogWorkflowRunnerTool({ settings: { get: () => undefined } } as never);
	let acquireCalls = 0;
	tool.setProvider({
		name: "fake",
		acquire: async () => {
			acquireCalls++;
			throw new Error("INJECTED-PROVIDER-USED");
		},
		status: async () => ({ available: false, detail: "fake" }),
	} as never);

	await expect(
		tool.execute("t", {
			resource: "test-res",
			operation: "create",
			params: { name: "x", namespace: "demo" },
			base_url: "https://example.test",
			catalog_path: tmp,
		} as never),
	).rejects.toThrow("INJECTED-PROVIDER-USED");

	expect(acquireCalls).toBe(1);
});
