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
const CONTAINER_WORKFLOW = path.resolve(import.meta.dir, "../../../../.github/workflows/container.yml");
const TDD_DOCKER_SCRIPT = path.resolve(import.meta.dir, "../../../../scripts/tdd-docker.sh");

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

	expect(ciWorkflow.match(/uses: \.\/\.github\/actions\/setup-rust/g)).toHaveLength(4);
	expect(ciWorkflow).toContain(`target: \${{ matrix.target }}`);
	expect(codesignWorkflow.match(/uses: \.\/\.github\/actions\/setup-rust/g)).toHaveLength(1);
	expect(setupAction).toContain("rustup toolchain install --profile minimal --no-self-update");
	expect(setupAction).toContain('rustup target add "$RUST_TARGET"');
	expect(setupAction).not.toContain("--toolchain");
	expect(setupAction).toContain('mktemp -d "${runner_temp%/}/rustup.XXXXXX"');
	expect(setupAction).toContain("4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10");
	expect(setupAction).toContain("9732d6c5e2a098d3521fca8145d826ae0aaa067ef2385ead08e6feac88fa5792");
	expect(setupAction).toContain("sha256sum -c -");
	expect(setupAction).not.toContain("sudo");
});

test("container publishing contract checks the ARM runner runs-on key", async () => {
	const workflow = await Bun.file(CONTAINER_WORKFLOW).text();
	const script = await Bun.file(TDD_DOCKER_SCRIPT).text();

	expect(workflow).toContain("runs-on: ubuntu-24.04-arm");
	expect(script).toContain("grep -Fq 'runs-on: ubuntu-24.04-arm' .github/workflows/container.yml");
	expect(script).not.toContain("runner: ubuntu-24.04-arm");
});
