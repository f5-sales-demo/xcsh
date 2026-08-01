import { expect, test } from "bun:test";
import * as path from "node:path";
import { parse } from "yaml";

interface WorkflowJob {
	name?: unknown;
}

interface WorkflowDocument {
	jobs?: Record<string, WorkflowJob>;
}

const CI_WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/ci.yml");

test("protected CI jobs expose the exact required check-run names", async () => {
	const workflow = parse(await Bun.file(CI_WORKFLOW).text()) as WorkflowDocument;

	expect(workflow.jobs?.check?.name).toBe("check");
	expect(workflow.jobs?.test?.name).toBe("test");
});
