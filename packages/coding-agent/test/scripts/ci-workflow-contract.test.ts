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
const CODESIGN_WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/test-codesign.yml");
const RUST_SETUP_ACTION = path.resolve(import.meta.dir, "../../../../.github/actions/setup-rust/action.yml");

test("protected CI jobs expose the exact required check-run names", async () => {
	const workflow = parse(await Bun.file(CI_WORKFLOW).text()) as WorkflowDocument;

	expect(workflow.jobs?.check?.name).toBe("check");
	expect(workflow.jobs?.test?.name).toBe("test");
});

test("CI installs cross targets into the repository-selected Rust toolchain", async () => {
	const ciWorkflow = await Bun.file(CI_WORKFLOW).text();
	const codesignWorkflow = await Bun.file(CODESIGN_WORKFLOW).text();
	const setupAction = await Bun.file(RUST_SETUP_ACTION).text();

	for (const workflow of [ciWorkflow, codesignWorkflow]) {
		expect(workflow).not.toMatch(/nightly-\d{4}-\d{2}-\d{2}/);
		expect(workflow).toContain("uses: ./.github/actions/setup-rust");
	}

	expect(ciWorkflow.match(/uses: \.\/\.github\/actions\/setup-rust/g)).toHaveLength(3);
	expect(ciWorkflow).toContain("target: ${{ matrix.target }}");
	expect(codesignWorkflow.match(/uses: \.\/\.github\/actions\/setup-rust/g)).toHaveLength(1);
	expect(setupAction).toContain("rustup toolchain install --profile minimal --no-self-update");
	expect(setupAction).toContain('rustup target add "$RUST_TARGET"');
	expect(setupAction).not.toContain("--toolchain");
});
